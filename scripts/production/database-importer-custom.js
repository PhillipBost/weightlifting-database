/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const Papa = require('papaparse');
const path = require('path');
const puppeteer = require('puppeteer');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Import scraper function - adjust path as needed for GitHub
const { scrapeOneMeet } = require('./scrapeOneMeet.js');

// Load division codes for Base64 URL lookup
const DIVISION_CODES_PATH = path.join(__dirname, '../../division_base64_codes.json');
let divisionCodes = {};
if (fs.existsSync(DIVISION_CODES_PATH)) {
    const divisionData = JSON.parse(fs.readFileSync(DIVISION_CODES_PATH, 'utf8'));
    divisionCodes = divisionData.division_codes;
    console.log(`✅ Loaded ${Object.keys(divisionCodes).length} division codes for Tier 1 verification`);
} else {
    console.warn(`⚠️ Division codes file not found at ${DIVISION_CODES_PATH} - Tier 1 verification will be disabled`);
}

// Date utility functions for Tier 1
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

// Extract meet internal_id from Sport80 URL
function extractMeetInternalId(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }

    // Match pattern: https://usaweightlifting.sport80.com/public/rankings/results/7011
    const match = url.match(/\/rankings\/results\/(\d+)/);
    return match ? parseInt(match[1]) : null;
}

async function readCSVFile(filePath) {
    console.log(`📖 Reading CSV file: ${filePath}`);

    if (!fs.existsSync(filePath)) {
        throw new Error(`CSV file not found: ${filePath}`);
    }

    const csvContent = fs.readFileSync(filePath, 'utf8');
    const parsed = Papa.parse(csvContent, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
    });

    if (parsed.errors.length > 0) {
        console.log('⚠️ CSV parsing warnings:', parsed.errors);
    }

    console.log(`📊 Parsed ${parsed.data.length} records from CSV`);
    return parsed.data;
}

async function getExistingMeetIds() {
    console.log('🔍 Getting existing meet IDs from database...');

    let allMeets = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
        const { data: meets, error } = await supabase
            .from('usaw_meets')
            .select('meet_id, meet_internal_id')
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(`Failed to get existing meets: ${error.message}`);
        }

        if (!meets || meets.length === 0) {
            break;
        }

        allMeets.push(...meets);
        from += pageSize;

        console.log(`📄 Loaded ${allMeets.length} meets so far...`);

        if (meets.length < pageSize) {
            break; // Last page
        }
    }

    const existingMeetIds = new Set(allMeets.map(m => m.meet_id));
    const existingInternalIds = new Set(allMeets.filter(m => m.meet_internal_id).map(m => m.meet_internal_id));

    console.log(`📊 Found ${existingMeetIds.size} existing meets in database`);
    console.log(`📊 Found ${existingInternalIds.size} existing meet internal_ids`);

    return { meetIds: existingMeetIds, internalIds: existingInternalIds };
}

async function upsertMeetsToDatabase(meetings) {
    console.log(`🔄 Upserting ${meetings.length} meets to database...`);

    let newMeetIds = [];
    let errorCount = 0;

    // Process in batches of 100 to avoid overwhelming the database
    const batchSize = 100;

    for (let i = 0; i < meetings.length; i += batchSize) {
        const batch = meetings.slice(i, i + batchSize);
        console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(meetings.length / batchSize)} (${batch.length} records)`);

        try {
            // Transform CSV data to match database column names
            const dbRecords = batch.map(meet => ({
                meet_id: meet.meet_id,
                meet_internal_id: extractMeetInternalId(meet.URL),
                Meet: meet.Meet,
                Level: meet.Level,
                Date: meet.Date,
                Results: meet.Results,
                URL: meet.URL,
                batch_id: meet.batch_id,
                scraped_date: meet.scraped_date
            }));

            // Upsert to database (insert new, update existing)
            const { data, error } = await supabase
                .from('usaw_meets')
                .upsert(dbRecords, {
                    onConflict: 'meet_id',
                    count: 'exact'
                })
                .select('meet_id'); // Get the meet_ids that were processed

            if (error) {
                console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
                errorCount += batch.length;
            } else {
                console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} completed successfully`);
                // Track which meets were processed (could be new or updated)
                if (data) {
                    newMeetIds.push(...data.map(d => d.meet_id));
                }
            }

            // Small delay between batches to be respectful to the database
            if (i + batchSize < meetings.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

        } catch (error) {
            console.error(`💥 Error processing batch ${Math.floor(i / batchSize) + 1}:`, error.message);
            errorCount += batch.length;
        }
    }

    return { newMeetIds, errorCount };
}

// REAL Sport80 member page verification using puppeteer
async function verifyLifterParticipationInMeet(lifterInternalId, targetMeetId) {
    const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${lifterInternalId}`;
    console.log(`    🌐 Visiting: ${memberUrl}`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--disable-extensions'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1500, height: 1000 });

        // Navigate to the member page
        await page.goto(memberUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for the page to load and extract the page content
        const pageData = await page.evaluate(() => {
            // Extract meet information from the page
            const meetRows = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr'));

            const meetInfo = meetRows.map(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 2) return null;

                const meetName = cells[0]?.textContent?.trim();
                const meetDate = cells[1]?.textContent?.trim();

                // Extract meet ID from the URL if available
                const link = cells[0]?.querySelector('a');
                const meetUrl = link?.getAttribute('href');
                let meetId = null;

                if (meetUrl) {
                    const match = meetUrl.match(/\/rankings\/results\/(\d+)/);
                    if (match) {
                        meetId = parseInt(match[1]);
                    }
                }

                return {
                    name: meetName,
                    date: meetDate,
                    meetId: meetId,
                    url: meetUrl
                };
            }).filter(Boolean);

            return meetInfo;
        });

        // Check if the target meet ID appears in the athlete's meet history
        const foundMeet = pageData.find(meet => meet.meetId === targetMeetId);

        if (foundMeet) {
            console.log(`    ✅ VERIFIED: Lifter participated in meet ${targetMeetId} (${foundMeet.name})`);
            return true;
        } else {
            console.log(`    ❌ NOT FOUND: Meet ${targetMeetId} not in athlete's meet history`);
            return false;
        }

    } catch (error) {
        console.log(`    ❌ Error accessing member page: ${error.message}`);
        return false;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// ========================================
// TIER 1 HELPER FUNCTIONS
// ========================================

function buildRankingsURL(divisionCode, startDate, endDate) {
    const filters = {
        date_range_start: formatDate(startDate),
        date_range_end: formatDate(endDate),
        weight_class: divisionCode
    };

    const jsonStr = JSON.stringify(filters);
    const base64Encoded = Buffer.from(jsonStr).toString('base64');

    return `https://usaweightlifting.sport80.com/public/rankings/all?filters=${encodeURIComponent(base64Encoded)}`;
}

async function scrapeDivisionRankings(page, divisionCode, startDate, endDate) {
    try {
        const url = buildRankingsURL(divisionCode, startDate, endDate);
        console.log(`    🌐 URL: ${url}`);

        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for table to load
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Extract all athletes from all pages
        let allAthletes = [];
        let hasMorePages = true;
        let currentPage = 1;

        while (hasMorePages) {
            const pageAthletes = await page.evaluate(() => {
                const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                    .map(th => th.textContent.trim().toLowerCase());

                // Dynamic column mapping
                const colMap = {
                    nationalRank: headers.findIndex(h => h.includes('rank')),
                    athleteName: headers.findIndex(h => h.includes('athlete') || h.includes('lifter') && !h.includes('age')),
                    lifterAge: headers.findIndex(h => h.includes('lifter') && h.includes('age') || h.includes('comp') && h.includes('age') && !h.includes('category')),
                    club: headers.findIndex(h => h.includes('club') || h.includes('team')),
                    liftDate: headers.findIndex(h => h.includes('date')),
                    level: headers.findIndex(h => h.includes('level')),
                    wso: headers.findIndex(h => h.includes('wso') || h.includes('lws') || h.includes('state')),
                    total: headers.findIndex(h => h.includes('total')),
                    gender: headers.findIndex(h => h.includes('gender'))
                };

                // Fallbacks
                if (colMap.nationalRank === -1) colMap.nationalRank = 0;
                if (colMap.athleteName === -1) colMap.athleteName = 3;
                if (colMap.club === -1) colMap.club = 6;
                if (colMap.liftDate === -1) colMap.liftDate = 9;
                if (colMap.level === -1) colMap.level = 11;
                if (colMap.wso === -1) colMap.wso = 12;

                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));

                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const cellTexts = cells.map(cell => cell.textContent?.trim() || '');

                    if (cellTexts.length < 5) return null;

                    const rawAge = colMap.lifterAge > -1 ? cellTexts[colMap.lifterAge] : '';
                    const numericAge = rawAge.match(/\d{1,3}/)?.[0] || '';

                    // Extract internal_id from the athlete name link
                    let internalId = null;
                    if (colMap.athleteName > -1) {
                        const nameCell = cells[colMap.athleteName];
                        const link = nameCell.querySelector('a[href*="/member/"]');
                        if (link) {
                            const href = link.getAttribute('href');
                            // Extract ID from URLs like /public/rankings/member/12345
                            const match = href.match(/\/member\/(\d+)/);
                            if (match) {
                                internalId = parseInt(match[1]);
                            }
                        }
                    }

                    return {
                        nationalRank: colMap.nationalRank > -1 ? cellTexts[colMap.nationalRank] : '',
                        athleteName: colMap.athleteName > -1 ? cellTexts[colMap.athleteName] : '',
                        internalId: internalId,
                        lifterAge: numericAge,
                        club: colMap.club > -1 ? cellTexts[colMap.club] : '',
                        liftDate: colMap.liftDate > -1 ? cellTexts[colMap.liftDate] : '',
                        level: colMap.level > -1 ? cellTexts[colMap.level] : '',
                        wso: colMap.wso > -1 ? cellTexts[colMap.wso] : '',
                        total: colMap.total > -1 ? cellTexts[colMap.total] : '',
                        gender: colMap.gender > -1 ? cellTexts[colMap.gender] : ''
                    };
                }).filter(a => a && a.athleteName);
            });

            allAthletes = allAthletes.concat(pageAthletes);
            console.log(`      Page ${currentPage}: Extracted ${pageAthletes.length} athlete(s)`);

            // Check for next page
            const nextPageExists = await page.evaluate(() => {
                const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                if (nextBtn && !nextBtn.disabled) {
                    nextBtn.click();
                    return true;
                }
                return false;
            });

            if (nextPageExists) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                currentPage++;
            } else {
                hasMorePages = false;
            }
        }

        console.log(`    ✅ Scraped ${allAthletes.length} total athletes from division`);
        return allAthletes;

    } catch (error) {
        console.log(`    ❌ Error scraping division: ${error.message}`);
        return [];
    }
}

async function batchEnrichAthletes(scrapedAthletes, startDate, endDate, ageCategory, weightClass) {
    if (scrapedAthletes.length === 0) return;

    console.log(`    📊 Batch enrichment: Processing ${scrapedAthletes.length} athletes from scraped data...`);

    // Get athlete names to query
    const athleteNames = scrapedAthletes.map(a => a.athleteName).filter(name => name);
    if (athleteNames.length === 0) return;

    // Query database for athletes in this division/date range who have missing data
    // Note: Scraped rankings contain athletes from ALL meets in this division/date range
    const { data: potentialResults, error } = await supabase
        .from('usaw_meet_results')
        .select('result_id, lifter_id, lifter_name, wso, club_name, competition_age, gender, meet_id, date')
        .in('lifter_name', athleteNames)
        .gte('date', formatDate(startDate))
        .lte('date', formatDate(endDate))
        .eq('age_category', ageCategory)
        .eq('weight_class', weightClass);

    if (error) {
        console.warn(`    ⚠️  Batch enrichment query failed: ${error.message}`);
        return;
    }

    console.log(`    📝 Found ${potentialResults.length} potential database matches`);

    // Match scraped athletes with database results and update
    let updateCount = 0;
    let lifterIdUpdates = 0;

    for (const dbResult of potentialResults) {
        const scrapedAthlete = scrapedAthletes.find(a =>
            a.athleteName.toLowerCase() === dbResult.lifter_name.toLowerCase()
        );

        if (scrapedAthlete) {
            // Update meet results
            const updateData = {};
            if (!dbResult.competition_age && scrapedAthlete.lifterAge) {
                updateData.competition_age = parseInt(scrapedAthlete.lifterAge);
            }
            if (!dbResult.club_name && scrapedAthlete.club) {
                updateData.club_name = scrapedAthlete.club;
            }
            if (!dbResult.wso && scrapedAthlete.wso) {
                updateData.wso = scrapedAthlete.wso;
            }
            if (!dbResult.gender && scrapedAthlete.gender) {
                updateData.gender = scrapedAthlete.gender;
            }
            if (!dbResult.national_rank && scrapedAthlete.nationalRank) {
                updateData.national_rank = parseInt(scrapedAthlete.nationalRank);
            }

            if (Object.keys(updateData).length > 0) {
                const { error: updateError } = await supabase
                    .from('usaw_meet_results')
                    .update(updateData)
                    .eq('result_id', dbResult.result_id);

                if (!updateError) {
                    updateCount++;
                    console.log(`      ✅ Enriched: ${dbResult.lifter_name} (${Object.keys(updateData).join(', ')})`);
                }
            }

            // Also update usaw_lifters.internal_id if missing
            if (scrapedAthlete.internalId) {
                const { data: lifterData, error: lifterFetchError } = await supabase
                    .from('usaw_lifters')
                    .select('lifter_id, internal_id')
                    .eq('lifter_id', dbResult.lifter_id)
                    .single();

                if (!lifterFetchError && lifterData && !lifterData.internal_id) {
                    const { error: lifterUpdateError } = await supabase
                        .from('usaw_lifters')
                        .update({ internal_id: scrapedAthlete.internalId })
                        .eq('lifter_id', dbResult.lifter_id);

                    if (!lifterUpdateError) {
                        lifterIdUpdates++;
                        console.log(`      🔗 Linked internal_id ${scrapedAthlete.internalId} to ${dbResult.lifter_name}`);
                    }
                }
            }
        }
    }

    if (updateCount > 0 || lifterIdUpdates > 0) {
        console.log(`    🎉 Batch enrichment complete: Updated ${updateCount} result(s), ${lifterIdUpdates} internal_id(s)`);
    } else {
        console.log(`    ℹ️  No additional data to enrich`);
    }

    // Also check if we can enrich the meet's Level field
    // Find the most common level from scraped data (all athletes from one meet should have same level)
    const levels = scrapedAthletes
        .map(a => a.level)
        .filter(level => level && level.trim() !== '');

    if (levels.length > 0) {
        // Get the most common level value
        const levelCounts = {};
        levels.forEach(level => {
            levelCounts[level] = (levelCounts[level] || 0) + 1;
        });
        const mostCommonLevel = Object.keys(levelCounts).reduce((a, b) =>
            levelCounts[a] > levelCounts[b] ? a : b
        );

        // Find meets in this date range that need Level enrichment
        const meetIds = [...new Set(potentialResults.map(r => r.meet_id))];

        for (const meetId of meetIds) {
            // Check if meet's Level is missing or "Unknown"
            const { data: meetData, error: meetError } = await supabase
                .from('usaw_meets')
                .select('meet_id, Level')
                .eq('meet_id', meetId)
                .single();

            if (!meetError && meetData && (!meetData.Level || meetData.Level === 'Unknown')) {
                // Update the meet's Level
                const { error: updateError } = await supabase
                    .from('usaw_meets')
                    .update({ Level: mostCommonLevel })
                    .eq('meet_id', meetId);

                if (!updateError) {
                    console.log(`      📍 Updated meet ${meetId} Level: ${mostCommonLevel}`);
                }
            }
        }
    }
}

// ========================================
// TWO-TIER VERIFICATION SYSTEM
// ========================================

async function runBase64UrlLookupProtocol(lifterName, potentialLifterIds, targetMeetId, eventDate, ageCategory, weightClass) {
    console.log(`  🔍 Tier 1: Base64 URL Lookup Protocol (Division Rankings)`);

    // Check if division codes are loaded
    if (Object.keys(divisionCodes).length === 0) {
        console.log(`    ⚠️ Division codes not loaded - skipping Tier 1`);
        return null;
    }

    // Validate required data
    if (!eventDate || !ageCategory || !weightClass) {
        console.log(`    ⚠️ Missing required data (date, age category, or weight class) - skipping Tier 1`);
        return null;
    }

    // Map age category + weight class to division name
    const divisionName = `${ageCategory} ${weightClass}`;

    // Determine if division is active or inactive based on meet date
    const meetDate = new Date(eventDate);
    const activeDivisionCutoff = new Date('2025-06-01');
    const isActiveDivision = meetDate >= activeDivisionCutoff;

    let divisionCode;
    if (isActiveDivision) {
        divisionCode = divisionCodes[divisionName];
    } else {
        const inactiveName = `(Inactive) ${divisionName}`;
        divisionCode = divisionCodes[inactiveName];
    }

    // Try opposite if not found
    if (!divisionCode) {
        if (isActiveDivision) {
            const inactiveName = `(Inactive) ${divisionName}`;
            divisionCode = divisionCodes[inactiveName];
        } else {
            divisionCode = divisionCodes[divisionName];
        }
    }

    if (!divisionCode) {
        console.log(`    ❌ Division not found: "${divisionName}" - skipping Tier 1`);
        return null;
    }

    console.log(`    📋 Division: ${divisionName} ${isActiveDivision ? '' : '(Inactive)'} (code: ${divisionCode})`);
    console.log(`    📅 Date Range: ${formatDate(addDays(meetDate, -5))} to ${formatDate(addDays(meetDate, 5))} (±5 days)`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--disable-extensions'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1500, height: 1000 });

        // Calculate date range
        const startDate = addDays(meetDate, -5);
        const endDate = addDays(meetDate, 5);

        // Scrape division rankings
        const scrapedAthletes = await scrapeDivisionRankings(page, divisionCode, startDate, endDate);

        if (scrapedAthletes.length === 0) {
            console.log(`    ℹ️  No athletes found in division rankings`);
            return null;
        }

        // BATCH ENRICHMENT - Update all matching athletes in the database
        await batchEnrichAthletes(scrapedAthletes, startDate, endDate, ageCategory, weightClass);

        // VERIFICATION - Check if target lifter was found
        const targetAthlete = scrapedAthletes.find(a =>
            a.athleteName.toLowerCase() === lifterName.toLowerCase()
        );

        if (targetAthlete) {
            console.log(`    ✅ Tier 1 VERIFIED: "${lifterName}" found in division rankings`);

            // Try to disambiguate using internal_id if we have it
            if (potentialLifterIds.length === 1) {
                // Single candidate - return it
                return {
                    lifterId: potentialLifterIds[0],
                    scrapedData: targetAthlete
                };
            }

            // Multiple candidates - use internal_id to disambiguate
            if (targetAthlete.internalId) {
                console.log(`    🔗 Using internal_id ${targetAthlete.internalId} to disambiguate ${potentialLifterIds.length} candidates`);

                // Query database to find which lifter_id has this internal_id
                const { data: matchedLifter, error } = await supabase
                    .from('usaw_lifters')
                    .select('lifter_id, internal_id')
                    .in('lifter_id', potentialLifterIds)
                    .eq('internal_id', targetAthlete.internalId)
                    .single();

                if (!error && matchedLifter) {
                    console.log(`    ✅ Disambiguated via internal_id: Using lifter ${matchedLifter.lifter_id}`);
                    return {
                        lifterId: matchedLifter.lifter_id,
                        scrapedData: targetAthlete
                    };
                }

                // No match by internal_id - check if any candidates have null internal_id
                const { data: nullInternalIdCandidates, error: nullError } = await supabase
                    .from('usaw_lifters')
                    .select('lifter_id, internal_id')
                    .in('lifter_id', potentialLifterIds)
                    .is('internal_id', null);

                if (!nullError && nullInternalIdCandidates && nullInternalIdCandidates.length === 1) {
                    // Only one candidate has null internal_id - assume it's them and populate it
                    const lifterId = nullInternalIdCandidates[0].lifter_id;
                    console.log(`    🔗 Linking internal_id ${targetAthlete.internalId} to lifter ${lifterId}`);

                    await supabase
                        .from('usaw_lifters')
                        .update({ internal_id: targetAthlete.internalId })
                        .eq('lifter_id', lifterId);

                    return {
                        lifterId: lifterId,
                        scrapedData: targetAthlete
                    };
                }
            }

            // Can't disambiguate - fall back to Tier 2
            console.log(`    ⚠️ Multiple candidates exist (${potentialLifterIds.length}) - proceeding to Tier 2 for disambiguation`);
            return null;
        }

        console.log(`    ❌ Tier 1: "${lifterName}" not found in division rankings`);
        return null;

    } catch (error) {
        console.log(`    ⚠️ Tier 1 verification failed (technical error): ${error.message}`);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

async function runSport80MemberUrlVerification(lifterName, potentialLifterIds, targetMeetId) {
    console.log(`  🔍 Tier 2: Running Sport80 member URL verification...`);

    for (const lifterId of potentialLifterIds) {
        try {
            // Get the lifter's internal_id to build the member URL
            const { data: lifter, error } = await supabase
                .from('usaw_lifters')
                .select('internal_id')
                .eq('lifter_id', lifterId)
                .single();

            if (error || !lifter?.internal_id) {
                console.log(`    ❌ No internal_id for lifter ${lifterId} - skipping`);
                continue;
            }

            console.log(`    🔍 Checking lifter ${lifterId} (internal_id: ${lifter.internal_id})...`);

            // REAL verification: Visit the member page and check if they participated in target meet
            const verified = await verifyLifterParticipationInMeet(lifter.internal_id, targetMeetId);

            if (verified) {
                console.log(`    ✅ CONFIRMED: Using lifter ${lifterId} for meet ${targetMeetId}`);
                return lifterId;
            }

        } catch (error) {
            console.log(`    ❌ Error checking lifter ${lifterId}: ${error.message}`);
            continue;
        }
    }

    console.log(`    ❌ No matches found in Tier 2 verification`);
    return null;
}

// Lifter management with proper foreign key resolution and two-tier verification
async function findOrCreateLifter(lifterName, additionalData = {}) {
    const cleanName = lifterName?.toString().trim();
    if (!cleanName) {
        throw new Error('Lifter name is required');
    }

    console.log(`  🔍 Looking for lifter: "${cleanName}"`);
    
    // Priority 1: If we have an internal_id, use it for matching first
    if (additionalData.internal_id) {
        console.log(`  🎯 Checking internal_id: ${additionalData.internal_id}`);
        
        const { data: internalIdLifters, error: internalIdError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('internal_id', additionalData.internal_id);

        if (internalIdError) {
            console.log(`  ⚠️ Error checking internal_id: ${internalIdError.message}`);
        } else if (internalIdLifters && internalIdLifters.length > 1) {
            // Multiple lifters with same internal_id - this is a data integrity issue
            console.log(`  ❌ DUPLICATE DETECTION: Found ${internalIdLifters.length} lifters with internal_id ${additionalData.internal_id}`);
            console.log(`  📋 Duplicate lifters: ${internalIdLifters.map(l => `${l.athlete_name} (ID: ${l.lifter_id})`).join(', ')}`);
            
            // Check if any of them match the current name
            const nameMatch = internalIdLifters.find(l => l.athlete_name === cleanName);
            if (nameMatch) {
                console.log(`  ✅ Using name-matching duplicate: ${cleanName} (ID: ${nameMatch.lifter_id})`);
                return nameMatch;
            } else {
                // No name match - log for manual resolution and continue with name-based matching
                console.log(`  ⚠️ No name match among duplicates - continuing with name-based matching`);
            }
        } else if (internalIdLifters && internalIdLifters.length === 1) {
            const existingLifter = internalIdLifters[0];
            
            // Check if names match
            if (existingLifter.athlete_name === cleanName) {
                console.log(`  ✅ Found exact match by internal_id: ${cleanName} (ID: ${existingLifter.lifter_id})`);
                return existingLifter;
            } else {
                // Internal_id matches but name doesn't - log conflict for manual resolution
                console.log(`  ⚠️ Internal_id conflict: ID ${additionalData.internal_id} exists for "${existingLifter.athlete_name}" but current name is "${cleanName}"`);
                // Continue with name-based matching as fallback
            }
        }
    }

    // Find ALL existing lifters by name (not just one)
    const { data: existingLifters, error: findError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .eq('athlete_name', cleanName);

    if (findError) {
        throw new Error(`Error finding lifter: ${findError.message}`);
    }

    const lifterIds = existingLifters ? existingLifters.map(l => l.lifter_id) : [];

    if (lifterIds.length === 0) {
        // No existing lifter found - create new one
        console.log(`  ➕ Creating new lifter: ${cleanName}`);
        const { data: newLifter, error: createError } = await supabase
            .from('usaw_lifters')
            .insert({
                athlete_name: cleanName,
                membership_number: additionalData.membership_number || null,
                internal_id: additionalData.internal_id || null
            })
            .select()
            .single();

        if (createError) {
            throw new Error(`Error creating lifter: ${createError.message}`);
        }

        console.log(`  ✅ Created new lifter: ${cleanName} (ID: ${newLifter.lifter_id})`);
        return newLifter;
    }

    if (lifterIds.length === 1) {
        // Single match found - update with internal_id if we have it and they don't
        const existingLifter = existingLifters[0];
        
        if (additionalData.internal_id && !existingLifter.internal_id) {
            console.log(`  🔄 Enriching lifter ${cleanName} with internal_id: ${additionalData.internal_id}`);
            
            // Check for conflicts: ensure no other lifter already has this internal_id
            const { data: conflictCheck, error: conflictError } = await supabase
                .from('usaw_lifters')
                .select('lifter_id, athlete_name')
                .eq('internal_id', additionalData.internal_id)
                .neq('lifter_id', existingLifter.lifter_id);
                
            if (conflictError) {
                console.log(`  ⚠️ Error checking for internal_id conflicts: ${conflictError.message}`);
            } else if (conflictCheck && conflictCheck.length > 0) {
                console.log(`  ❌ Internal_id conflict detected: ${additionalData.internal_id} already assigned to ${conflictCheck[0].athlete_name} (ID: ${conflictCheck[0].lifter_id})`);
                console.log(`  ⚠️ Cannot enrich ${cleanName} (ID: ${existingLifter.lifter_id}) - manual resolution required`);
            } else {
                // No conflicts - proceed with enrichment
                const { data: updatedLifter, error: updateError } = await supabase
                    .from('usaw_lifters')
                    .update({ internal_id: additionalData.internal_id })
                    .eq('lifter_id', existingLifter.lifter_id)
                    .select()
                    .single();
                    
                if (updateError) {
                    console.log(`  ⚠️ Failed to update internal_id: ${updateError.message}`);
                } else {
                    console.log(`  ✅ Updated lifter with internal_id: ${cleanName} (ID: ${existingLifter.lifter_id})`);
                    return updatedLifter;
                }
            }
        } else if (additionalData.internal_id && existingLifter.internal_id && existingLifter.internal_id !== additionalData.internal_id) {
            // Existing lifter has different internal_id - log mismatch for manual resolution
            console.log(`  ⚠️ Internal_id mismatch for ${cleanName}: existing=${existingLifter.internal_id}, new=${additionalData.internal_id}`);
        }
        
        console.log(`  ✅ Found 1 existing lifter: ${cleanName} (ID: ${lifterIds[0]})`);

        // Tier 1: Base64 URL lookup protocol
        const tier1Result = await runBase64UrlLookupProtocol(
            cleanName,
            lifterIds,
            additionalData.targetMeetId,
            additionalData.eventDate,
            additionalData.ageCategory,
            additionalData.weightClass
        );

        if (tier1Result) {
            const verifiedLifter = existingLifters.find(l => l.lifter_id === tier1Result.lifterId);
            console.log(`  ✅ Verified via Tier 1: ${cleanName} (ID: ${tier1Result.lifterId})`);
            // Attach scraped data for enrichment
            verifiedLifter.scrapedData = tier1Result.scrapedData;
            return verifiedLifter;
        }

        // Tier 2: Sport80 member URL verification (fallback)
        const verifiedLifterId = await runSport80MemberUrlVerification(cleanName, lifterIds, additionalData.targetMeetId);

        if (verifiedLifterId) {
            const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
            console.log(`  ✅ Verified lifter: ${cleanName} (ID: ${verifiedLifterId})`);
            return verifiedLifter;
        } else {
            throw new Error(`Could not verify lifter ${cleanName} through two-tier verification`);
        }
    }

    // Multiple matches found - use two-tier verification to disambiguate
    console.log(`  ⚠️ Found ${lifterIds.length} existing lifters with name "${cleanName}" - disambiguating...`);

    // If we have internal_id, try to use it for disambiguation first
    if (additionalData.internal_id) {
        const internalIdMatch = existingLifters.find(l => l.internal_id === additionalData.internal_id);
        if (internalIdMatch) {
            console.log(`  ✅ Disambiguated via internal_id: ${cleanName} (ID: ${internalIdMatch.lifter_id})`);
            return internalIdMatch;
        }
        
        // Check if any lifter has null internal_id that we can enrich
        const nullInternalIdLifters = existingLifters.filter(l => !l.internal_id);
        if (nullInternalIdLifters.length === 1) {
            // Only one candidate without internal_id - enrich it
            const candidateLifter = nullInternalIdLifters[0];
            
            // Check for conflicts before enriching
            const { data: conflictCheck, error: conflictError } = await supabase
                .from('usaw_lifters')
                .select('lifter_id, athlete_name')
                .eq('internal_id', additionalData.internal_id);
                
            if (!conflictError && (!conflictCheck || conflictCheck.length === 0)) {
                console.log(`  🔄 Enriching candidate lifter ${cleanName} with internal_id: ${additionalData.internal_id}`);
                
                const { data: updatedLifter, error: updateError } = await supabase
                    .from('usaw_lifters')
                    .update({ internal_id: additionalData.internal_id })
                    .eq('lifter_id', candidateLifter.lifter_id)
                    .select()
                    .single();
                    
                if (!updateError) {
                    console.log(`  ✅ Enriched and selected lifter: ${cleanName} (ID: ${candidateLifter.lifter_id})`);
                    return updatedLifter;
                }
            }
        }
    }

    // Tier 1: Base64 URL lookup protocol
    const base64Result = await runBase64UrlLookupProtocol(
        cleanName,
        lifterIds,
        additionalData.targetMeetId,
        additionalData.eventDate,
        additionalData.ageCategory,
        additionalData.weightClass
    );

    if (base64Result) {
        const verifiedLifter = existingLifters.find(l => l.lifter_id === base64Result.lifterId);
        console.log(`  ✅ Verified via Tier 1: ${cleanName} (ID: ${base64Result.lifterId})`);
        // Attach scraped data for enrichment
        verifiedLifter.scrapedData = base64Result.scrapedData;
        return verifiedLifter;
    }

    // Tier 2: Sport80 member URL verification (fallback)
    const verifiedLifterId = await runSport80MemberUrlVerification(cleanName, lifterIds, additionalData.targetMeetId);

    if (verifiedLifterId) {
        const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
        console.log(`  ✅ Verified via Tier 2: ${cleanName} (ID: ${verifiedLifterId})`);
        return verifiedLifter;
    }

    throw new Error(`Could not disambiguate lifter "${cleanName}" - ${lifterIds.length} candidates found but none verified`);
}

async function processMeetCsvFile(csvFilePath, meetId, meetName) {
    const fileName = path.basename(csvFilePath);
    console.log(`\n📄 Processing: ${fileName}`);
    console.log(`🏋️ Meet: ${meetName} (ID: ${meetId})`);

    try {
        // Read CSV file
        const csvContent = fs.readFileSync(csvFilePath, 'utf8');

        // Parse CSV with pipe delimiter
        const parsed = Papa.parse(csvContent, {
            header: true,
            delimiter: '|',
            dynamicTyping: false,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim()
        });

        // Handle parsing errors gracefully
        if (parsed.errors.length > 0) {
            console.log(`  ⚠️ CSV parsing warnings:`, parsed.errors.slice(0, 3));

            const fatalErrors = parsed.errors.filter(error =>
                error.type === 'Quotes' ||
                error.code === 'TooFewFields' ||
                error.code === 'InvalidQuotes'
            );

            if (fatalErrors.length > 0 && (!parsed.data || parsed.data.length === 0)) {
                console.log(`  ❌ Fatal parsing errors - skipping file`);
                return { processed: 0, errors: 1 };
            }
        }

        // Robust data validation
        const validResults = parsed.data.filter(row => {
            return row &&
                typeof row === 'object' &&
                row.Lifter &&
                typeof row.Lifter === 'string' &&
                row.Lifter.trim() !== '';
        });

        if (validResults.length === 0) {
            console.log(`  ⚠️ No valid lifters found in ${fileName}`);
            return { processed: 0, errors: 1 };
        }

        console.log(`  📊 Found ${validResults.length} lifters in meet`);

        let processedCount = 0;
        let errorCount = 0;

        // Process each lifter result with proper lifter management
        for (const [index, row] of validResults.entries()) {
            try {
                const lifterName = String(row?.Lifter || '').trim();

                if (!lifterName) {
                    console.log(`  ⚠️ Skipping row ${index + 1} - missing lifter name`);
                    errorCount++;
                    continue;
                }

                // Find or create lifter with two-tier verification system
                // Pass additional data needed for Tier 1 verification
                const lifter = await findOrCreateLifter(lifterName, {
                    targetMeetId: meetId,
                    eventDate: row.Date?.trim() || null,
                    ageCategory: row['Age Category']?.trim() || null,
                    weightClass: row['Weight Class']?.trim() || null,
                    membership_number: row['Membership Number']?.trim() || null,
                    internal_id: row['Internal_ID'] ? parseInt(row['Internal_ID']) : null
                });

                // Create meet result with proper lifter_id
                // Apply scraped data from Tier 1 verification if available
                const resultData = {
                    meet_id: meetId,
                    lifter_id: lifter.lifter_id,
                    meet_name: row.Meet?.trim() || meetName,
                    date: row.Date?.trim() || null,
                    age_category: row['Age Category']?.trim() || null,
                    weight_class: row['Weight Class']?.trim() || null,
                    lifter_name: lifterName,
                    body_weight_kg: row['Body Weight (Kg)']?.toString().trim() || null,
                    snatch_lift_1: row['Snatch Lift 1']?.toString().trim() || null,
                    snatch_lift_2: row['Snatch Lift 2']?.toString().trim() || null,
                    snatch_lift_3: row['Snatch Lift 3']?.toString().trim() || null,
                    best_snatch: row['Best Snatch']?.toString().trim() || null,
                    cj_lift_1: row['C&J Lift 1']?.toString().trim() || null,
                    cj_lift_2: row['C&J Lift 2']?.toString().trim() || null,
                    cj_lift_3: row['C&J Lift 3']?.toString().trim() || null,
                    best_cj: row['Best C&J']?.toString().trim() || null,
                    total: row.Total?.toString().trim() || null,
                    // Enrich with scraped data from Tier 1 if available
                    club_name: lifter.scrapedData?.club || row.Club?.toString().trim() || null,
                    wso: lifter.scrapedData?.wso || null,
                    competition_age: lifter.scrapedData?.lifterAge ? parseInt(lifter.scrapedData.lifterAge) : null,
                    gender: lifter.scrapedData?.gender || null,
                    national_rank: lifter.scrapedData?.nationalRank ? parseInt(lifter.scrapedData.nationalRank) : null
                };

                // Upsert to database (insert new, update existing)
                const { error: insertError } = await supabase
                    .from('usaw_meet_results')
                    .upsert(resultData, {
                        onConflict: 'meet_id, lifter_id',
                        ignoreDuplicates: false
                    });

                if (insertError) {
                    if (insertError.code === '23505') {
                        console.log(`  ⚠️ Result already exists for ${lifterName}`);
                    } else {
                        console.error(`  ❌ Error inserting result for ${lifterName}:`, insertError.message);
                        errorCount++;
                    }
                } else {
                    processedCount++;
                }

            } catch (error) {
                console.error(`  ❌ Error processing row ${index + 1}:`, error.message);
                errorCount++;
            }
        }

        console.log(`  ✅ Processed ${processedCount} results with ${errorCount} errors`);
        return { processed: processedCount, errors: errorCount };

    } catch (error) {
        console.error(`❌ Error processing file ${fileName}:`, error.message);
        return { processed: 0, errors: 1 };
    }
}

module.exports = {
    extractMeetInternalId,
    getExistingMeetIds,
    upsertMeetsToDatabase,
    processMeetCsvFile,
    verifyLifterParticipationInMeet,
    scrapeOneMeet
};
