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

// Import Sport80 search function for Tier 2 verification
const { searchSport80ForLifter } = require('./searchSport80ForLifter.js');

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

// REAL Sport80 member page verification using puppeteer with bodyweight/total matching
async function verifyLifterParticipationInMeet(lifterInternalId, targetMeetId, expectedBodyweight = null, expectedTotal = null) {
    // Get target meet information for enhanced matching
    const { data: targetMeet, error: meetError } = await supabase
        .from('usaw_meets')
        .select('meet_id, meet_internal_id, Meet, Date')
        .eq('meet_id', targetMeetId)
        .single();
    
    if (meetError) {
        console.log(`    ❌ Error getting meet info: ${meetError.message}`);
        return false;
    }

    const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${lifterInternalId}`;
    console.log(`    🌐 Visiting: ${memberUrl}`);
    console.log(`    🎯 Looking for: "${targetMeet.Meet}" on ${targetMeet.Date}`);
    
    if (expectedBodyweight || expectedTotal) {
        console.log(`    📊 Expected: BW=${expectedBodyweight}kg, Total=${expectedTotal}kg`);
    }

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

        // Wait for table to load
        await page.waitForSelector('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Search through all pages of meet history
        let foundMeet = null;
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages && !foundMeet) {
            console.log(`    📄 Checking page ${currentPage} of meet history...`);

            // Extract meet information from current page with ENHANCED data extraction
            const pageData = await page.evaluate(() => {
                const meetRows = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr'));

                // Get headers to understand column structure
                const headers = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table thead th'))
                    .map(th => th.textContent.trim());

                const meetInfo = meetRows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length < 2) return null;

                    const meetName = cells[0]?.textContent?.trim();
                    const meetDate = cells[1]?.textContent?.trim();
                    
                    // ENHANCED: Extract bodyweight and total from the row
                    // Based on the user's console output, the structure is:
                    // ['Meet', 'Date', 'Age Category', 'Lifter', 'Body Weight (Kg)', 'Snatch Lift 1', 'Snatch Lift 2', 'Snatch Lift 3', 'C&J Lift 1', 'C&J Lift 2', 'C&J Lift 3', 'Best Snatch', 'Best C&J', 'Total']
                    
                    let bodyweight = null;
                    let bestSnatch = null;
                    let bestCJ = null;
                    let total = null;
                    
                    // Find bodyweight column (usually index 4: 'Body Weight (Kg)')
                    if (cells[4]) {
                        const bwText = cells[4].textContent?.trim();
                        if (bwText && !isNaN(parseFloat(bwText))) {
                            bodyweight = parseFloat(bwText);
                        }
                    }
                    
                    // Find best snatch column (usually index 11: 'Best Snatch')
                    if (cells[11]) {
                        const snatchText = cells[11].textContent?.trim();
                        if (snatchText && !isNaN(parseFloat(snatchText))) {
                            bestSnatch = parseFloat(snatchText);
                        }
                    }
                    
                    // Find best C&J column (usually index 12: 'Best C&J')
                    if (cells[12]) {
                        const cjText = cells[12].textContent?.trim();
                        if (cjText && !isNaN(parseFloat(cjText))) {
                            bestCJ = parseFloat(cjText);
                        }
                    }
                    
                    // Find total column (usually index 13: 'Total')
                    if (cells[13]) {
                        const totalText = cells[13].textContent?.trim();
                        if (totalText && !isNaN(parseFloat(totalText))) {
                            total = parseFloat(totalText);
                        }
                    }

                    return {
                        name: meetName,
                        date: meetDate,
                        bodyweight: bodyweight,
                        bestSnatch: bestSnatch,
                        bestCJ: bestCJ,
                        total: total,
                        rawCells: cells.map(c => c.textContent?.trim()) // For debugging
                    };
                }).filter(Boolean);

                return meetInfo;
            });

            // Match by meet name and date (with ±5 day tolerance)
            foundMeet = pageData.find(meet => {
                const nameMatch = meet.name === targetMeet.Meet;
                
                // Date matching with ±5 day tolerance
                let dateMatch = false;
                if (meet.date && targetMeet.Date) {
                    try {
                        const sport80Date = new Date(meet.date);
                        const targetDate = new Date(targetMeet.Date);
                        const daysDifference = Math.abs((sport80Date - targetDate) / (1000 * 60 * 60 * 24));
                        dateMatch = daysDifference <= 5;
                        
                        if (nameMatch) {
                            console.log(`    📅 Date comparison: Sport80="${meet.date}" vs Target="${targetMeet.Date}" (${daysDifference.toFixed(1)} days difference)`);
                        }
                    } catch (error) {
                        // Fallback to exact string match if date parsing fails
                        dateMatch = meet.date === targetMeet.Date;
                    }
                }
                
                return nameMatch && dateMatch;
            });

            if (foundMeet) {
                console.log(`    ✅ FOUND MEET: "${foundMeet.name}" on ${foundMeet.date} found on page ${currentPage}`);
                console.log(`    📊 Sport80 Data: BW=${foundMeet.bodyweight}kg, Total=${foundMeet.total}kg`);
                
                // ENHANCED: Compare bodyweight and total if provided
                let bodyweightMatch = true;
                let totalMatch = true;
                
                if (expectedBodyweight && foundMeet.bodyweight) {
                    const bwDiff = Math.abs(expectedBodyweight - foundMeet.bodyweight);
                    bodyweightMatch = bwDiff <= 2.0; // Allow 2kg tolerance for bodyweight
                    console.log(`    ⚖️  Bodyweight: Expected=${expectedBodyweight}kg, Found=${foundMeet.bodyweight}kg, Diff=${bwDiff.toFixed(1)}kg, Match=${bodyweightMatch}`);
                }
                
                if (expectedTotal && foundMeet.total) {
                    const totalDiff = Math.abs(expectedTotal - foundMeet.total);
                    totalMatch = totalDiff <= 5; // Allow 5kg tolerance for total
                    console.log(`    🏋️  Total: Expected=${expectedTotal}kg, Found=${foundMeet.total}kg, Diff=${totalDiff.toFixed(1)}kg, Match=${totalMatch}`);
                }
                
                if (bodyweightMatch && totalMatch) {
                    console.log(`    ✅ VERIFIED: Meet found with matching performance data`);
                    return true;
                } else {
                    console.log(`    ❌ PERFORMANCE MISMATCH: Meet found but performance data doesn't match`);
                    console.log(`    📋 Raw cells for debugging:`, foundMeet.rawCells);
                    return false;
                }
            }

            // Check for next page
            hasMorePages = await page.evaluate(() => {
                const nextBtn = document.querySelector('.v-data-footer__icons-after button:not([disabled])');
                if (nextBtn && !nextBtn.disabled) {
                    nextBtn.click();
                    return true;
                }
                return false;
            });

            if (hasMorePages) {
                // Wait for next page to load
                await new Promise(resolve => setTimeout(resolve, 3000));
                await page.waitForSelector('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr', { timeout: 10000 });
                currentPage++;
            }
        }

        console.log(`    ❌ NOT FOUND: "${targetMeet.Meet}" on ${targetMeet.Date} not found in ${currentPage} page(s) of history`);
        return false;

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

// Extract internal_id by clicking a specific athlete's row on rankings page
async function extractInternalIdByClicking(page, divisionCode, startDate, endDate, targetAthleteName) {
    try {
        const url = buildRankingsURL(divisionCode, startDate, endDate);
        console.log(`      🌐 Loading rankings page for clicking...`);

        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for table to load
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 4000)); // Give Vue.js time to render

        // Find the target athlete across all pages
        let found = false;
        let currentPage = 1;

        while (!found) {
            // Search for target athlete on current page
            const athleteData = await page.evaluate((targetName) => {
                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                
                for (let index = 0; index < rows.length; index++) {
                    const row = rows[index];
                    const cells = Array.from(row.querySelectorAll('td'));
                    const athleteName = cells[3]?.textContent?.trim() || '';
                    
                    if (athleteName.toLowerCase().includes(targetName.toLowerCase()) ||
                        targetName.toLowerCase().includes(athleteName.toLowerCase())) {
                        
                        return {
                            found: true,
                            rowIndex: index,
                            athleteName: athleteName,
                            isClickable: row.classList.contains('row-clickable')
                        };
                    }
                }
                
                return { found: false };
            }, targetAthleteName);

            if (athleteData.found) {
                console.log(`      ✅ Found "${athleteData.athleteName}" on page ${currentPage}`);
                
                if (!athleteData.isClickable) {
                    console.log(`      ⚠️ Row is not clickable`);
                    return null;
                }

                // Click the row and wait for navigation
                console.log(`      🖱️ Clicking row...`);
                
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
                    page.evaluate((rowIndex) => {
                        const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                        if (rows[rowIndex]) {
                            rows[rowIndex].click();
                        }
                    }, athleteData.rowIndex)
                ]);
                
                // Extract internal_id from destination URL
                const currentUrl = page.url();
                const match = currentUrl.match(/\/member\/(\d+)/);
                
                if (match) {
                    return parseInt(match[1]);
                } else {
                    console.log(`      ❌ No internal_id in URL: ${currentUrl}`);
                    return null;
                }
            }

            // Check for next page
            const hasNextPage = await page.evaluate(() => {
                const nextBtn = document.querySelector('.v-data-footer__icons-after button:not([disabled])');
                if (nextBtn && !nextBtn.disabled) {
                    nextBtn.click();
                    return true;
                }
                return false;
            });

            if (hasNextPage) {
                console.log(`      ⏭️ Moving to page ${currentPage + 1}...`);
                await new Promise(resolve => setTimeout(resolve, 4000));
                await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 10000 });
                currentPage++;
            } else {
                console.log(`      ❌ Athlete not found on any page`);
                return null;
            }
        }

    } catch (error) {
        console.log(`      ❌ Error extracting internal_id: ${error.message}`);
        return null;
    }
}

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

                    // Extract internal_id from clickable row (Vue.js table)
                    let internalId = null;
                    if (colMap.athleteName > -1) {
                        // First try traditional link approach (fallback)
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
                        // Note: Vue.js clickable rows will be handled separately
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
                        gender: colMap.gender > -1 ? cellTexts[colMap.gender] : '',
                        _rowIndex: rows.indexOf(row), // Store row index for internal_id extraction
                        _hasClickableRow: row.classList.contains('row-clickable'),
                        _rowClasses: row.className // Debug: capture all row classes
                    };
                }).filter(a => a && a.athleteName);
            });

            // Extract internal_ids from clickable rows (Vue.js approach)
            const athletesNeedingInternalIds = pageAthletes.filter(a => a._hasClickableRow && !a.internalId);
            const totalClickableRows = pageAthletes.filter(a => a._hasClickableRow).length;
            
            console.log(`      📊 Page ${currentPage}: ${pageAthletes.length} athletes, ${totalClickableRows} clickable rows`);
            
            // Note: We don't extract internal_ids here - that's done in Tier 1.5 if needed
            // Tier 1 focuses on extracting rankings data (national_rank, club, etc.)

            // Clean up temporary properties
            pageAthletes.forEach(athlete => {
                delete athlete._rowIndex;
                delete athlete._hasClickableRow;
                delete athlete._rowClasses; // Clean up debug property
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
                console.log(`      ⏳ Moving to page ${currentPage + 1}, waiting for Vue.js re-render...`);
                await new Promise(resolve => setTimeout(resolve, 3000)); // Increased wait time
                
                // Wait for table to stabilize after pagination
                await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 10000 });
                await new Promise(resolve => setTimeout(resolve, 1000)); // Additional stabilization time
                
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

            // Tier 1.5: If athlete found but missing internal_id, extract it by clicking their row
            if (!targetAthlete.internalId) {
                console.log(`    🔗 Tier 1.5: Extracting internal_id for "${lifterName}" via row clicking...`);
                
                try {
                    const extractedId = await extractInternalIdByClicking(
                        page,
                        divisionCode,
                        startDate,
                        endDate,
                        lifterName
                    );
                    
                    if (extractedId) {
                        targetAthlete.internalId = extractedId;
                        console.log(`    ✅ Tier 1.5: Extracted internal_id ${extractedId}`);
                    } else {
                        console.log(`    ⚠️ Tier 1.5: Could not extract internal_id`);
                    }
                } catch (error) {
                    console.log(`    ⚠️ Tier 1.5: Failed to extract internal_id - ${error.message}`);
                }
            }

            // Try to disambiguate using internal_id if we have it
            if (potentialLifterIds.length === 0) {
                // New athlete case - return scraped data for enrichment
                console.log(`    ✅ Tier 1: Found new athlete "${lifterName}" in rankings - returning scraped data`);
                return {
                    lifterId: null, // No existing lifter ID since this is new
                    scrapedData: targetAthlete
                };
            } else if (potentialLifterIds.length === 1) {
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

            // Can't disambiguate - fall back to Tier 2, but preserve extracted internal_id
            console.log(`    ⚠️ Multiple candidates exist (${potentialLifterIds.length}) - proceeding to Tier 2 for disambiguation`);
            
            // Return extracted internal_id even though we couldn't disambiguate
            if (targetAthlete.internalId) {
                return {
                    lifterId: null, // No disambiguation achieved
                    scrapedData: targetAthlete,
                    extractedInternalId: targetAthlete.internalId // Preserve for later use
                };
            }
            
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

async function runSport80MemberUrlVerification(lifterName, potentialLifterIds, targetMeetId, expectedBodyweight = null, expectedTotal = null) {
    console.log(`  🔍 Tier 2: Running Sport80 member URL verification for ${potentialLifterIds.length} candidates...`);
    if (expectedBodyweight || expectedTotal) {
        console.log(`  📊 Expected performance: BW=${expectedBodyweight}kg, Total=${expectedTotal}kg`);
    }

    for (const lifterId of potentialLifterIds) {
        try {
            // Get the lifter's internal_id to build the member URL
            const { data: lifter, error } = await supabase
                .from('usaw_lifters')
                .select('internal_id, athlete_name')
                .eq('lifter_id', lifterId)
                .single();

            if (error) {
                console.log(`    ❌ Error fetching lifter ${lifterId}: ${error.message}`);
                continue;
            }

            if (lifter?.internal_id) {
                console.log(`    🔍 Checking lifter ${lifterId} (internal_id: ${lifter.internal_id})...`);

                // ENHANCED verification: Visit the member page and check if they participated in target meet WITH performance data matching
                const verified = await verifyLifterParticipationInMeet(lifter.internal_id, targetMeetId, expectedBodyweight, expectedTotal);

                if (verified) {
                    console.log(`    ✅ CONFIRMED: Using lifter ${lifterId} for meet ${targetMeetId}`);
                    return lifterId;
                }
            } else {
                console.log(`    🔍 Lifter ${lifterId} (${lifter.athlete_name}) has no internal_id - attempting Sport80 search...`);
                
                // NEW: For lifters without internal_ids, search Sport80 to find their internal_id
                const foundInternalId = await searchSport80ForLifter(lifter.athlete_name);
                
                if (foundInternalId) {
                    console.log(`    🎯 Found internal_id ${foundInternalId} for ${lifter.athlete_name} via Sport80 search`);
                    
                    // ENHANCED verification: Verify this lifter participated in the target meet WITH performance data matching
                    const expectedBodyweight = additionalData.bodyweight ? parseFloat(additionalData.bodyweight) : null;
                    const expectedTotal = additionalData.total ? parseFloat(additionalData.total) : null;
                    const verified = await verifyLifterParticipationInMeet(foundInternalId, targetMeetId, expectedBodyweight, expectedTotal);
                    
                    if (verified) {
                        // Update the lifter record with the found internal_id
                        const { error: updateError } = await supabase
                            .from('usaw_lifters')
                            .update({ internal_id: foundInternalId })
                            .eq('lifter_id', lifterId);
                            
                        if (!updateError) {
                            console.log(`    ✅ CONFIRMED & ENRICHED: Using lifter ${lifterId} for meet ${targetMeetId} (added internal_id ${foundInternalId})`);
                        } else {
                            console.log(`    ✅ CONFIRMED: Using lifter ${lifterId} for meet ${targetMeetId} (internal_id update failed: ${updateError.message})`);
                        }
                        
                        return lifterId;
                    }
                } else {
                    console.log(`    ❌ Could not find ${lifter.athlete_name} in Sport80 search`);
                }
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
// Enhanced logging utility for athlete matching
class MatchingLogger {
    constructor(lifterName, additionalData = {}) {
        this.lifterName = lifterName;
        this.additionalData = additionalData;
        this.sessionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        this.steps = [];
        this.startTime = Date.now();
    }

    log(step, data) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            session_id: this.sessionId,
            athlete_name: this.lifterName,
            internal_id: this.additionalData.internal_id || null,
            step: step,
            ...data
        };
        
        this.steps.push(logEntry);
        
        // Console output for immediate visibility
        const prefix = this.getStepPrefix(step);
        console.log(`${prefix} [${step}] ${data.message || JSON.stringify(data)}`);
        
        return logEntry;
    }

    getStepPrefix(step) {
        const prefixes = {
            'init': '🔍',
            'internal_id_query': '🎯',
            'internal_id_match': '✅',
            'internal_id_conflict': '⚠️',
            'internal_id_duplicate': '❌',
            'name_query': '📝',
            'name_match_single': '✅',
            'name_match_multiple': '⚠️',
            'name_match_none': '➕',
            'enrichment': '🔄',
            'tier1_verification': '🔍',
            'tier2_verification': '🔍',
            'disambiguation': '🎲',
            'fallback_create': '➕',
            'success': '✅',
            'error': '❌'
        };
        return prefixes[step] || '📋';
    }

    getSummary() {
        const duration = Date.now() - this.startTime;
        return {
            session_id: this.sessionId,
            athlete_name: this.lifterName,
            internal_id: this.additionalData.internal_id || null,
            duration_ms: duration,
            steps_count: this.steps.length,
            steps: this.steps
        };
    }

    logFinalResult(result, strategy) {
        this.log('success', {
            message: `Matching completed successfully`,
            strategy: strategy,
            lifter_id: result?.lifter_id || null,
            matched_name: result?.athlete_name || null,
            matched_internal_id: result?.internal_id || null,
            duration_ms: Date.now() - this.startTime
        });
    }

    logError(error, step = 'error') {
        this.log(step, {
            message: `Error occurred: ${error.message}`,
            error_type: error.constructor.name,
            stack: error.stack
        });
    }
}

async function findOrCreateLifter(lifterName, additionalData = {}) {
    const cleanName = lifterName?.toString().trim();
    if (!cleanName) {
        throw new Error('Lifter name is required');
    }

    // Initialize structured logging
    const logger = new MatchingLogger(cleanName, additionalData);
    
    logger.log('init', {
        message: `Starting athlete matching process`,
        athlete_name: cleanName,
        internal_id: additionalData.internal_id || null,
        target_meet_id: additionalData.targetMeetId || null,
        event_date: additionalData.eventDate || null,
        age_category: additionalData.ageCategory || null,
        weight_class: additionalData.weightClass || null
    });

    console.log(`  🔍 Looking for lifter: "${cleanName}"`);
    
    // Priority 1: If we have an internal_id, use it for matching first
    if (additionalData.internal_id) {
        logger.log('internal_id_query', {
            message: `Querying by internal_id: ${additionalData.internal_id}`,
            internal_id: additionalData.internal_id,
            query_type: 'internal_id_priority'
        });
        
        console.log(`  🎯 Checking internal_id: ${additionalData.internal_id}`);
        
        const { data: internalIdLifters, error: internalIdError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('internal_id', additionalData.internal_id);

        if (internalIdError) {
            logger.log('error', {
                message: `Database error during internal_id query: ${internalIdError.message}`,
                error_code: internalIdError.code,
                query_type: 'internal_id_priority'
            });
            console.log(`  ⚠️ Error checking internal_id: ${internalIdError.message}`);
        } else {
            logger.log('internal_id_query', {
                message: `Internal_id query returned ${internalIdLifters?.length || 0} results`,
                results_count: internalIdLifters?.length || 0,
                results: internalIdLifters?.map(l => ({
                    lifter_id: l.lifter_id,
                    athlete_name: l.athlete_name,
                    internal_id: l.internal_id
                })) || []
            });

            if (internalIdLifters && internalIdLifters.length > 1) {
                // Multiple lifters with same internal_id - this is a data integrity issue
                logger.log('internal_id_duplicate', {
                    message: `Data integrity issue: Multiple lifters found with same internal_id`,
                    internal_id: additionalData.internal_id,
                    duplicate_count: internalIdLifters.length,
                    duplicates: internalIdLifters.map(l => ({
                        lifter_id: l.lifter_id,
                        athlete_name: l.athlete_name
                    }))
                });
                
                console.log(`  ❌ DUPLICATE DETECTION: Found ${internalIdLifters.length} lifters with internal_id ${additionalData.internal_id}`);
                console.log(`  📋 Duplicate lifters: ${internalIdLifters.map(l => `${l.athlete_name} (ID: ${l.lifter_id})`).join(', ')}`);
                
                // Check if any of them match the current name
                const nameMatch = internalIdLifters.find(l => l.athlete_name === cleanName);
                if (nameMatch) {
                    logger.logFinalResult(nameMatch, 'internal_id_with_name_disambiguation');
                    console.log(`  ✅ Using name-matching duplicate: ${cleanName} (ID: ${nameMatch.lifter_id})`);
                    return nameMatch;
                } else {
                    // No name match - log for manual resolution and continue with name-based matching
                    logger.log('internal_id_conflict', {
                        message: `No name match among duplicates, continuing with name-based matching`,
                        expected_name: cleanName,
                        found_names: internalIdLifters.map(l => l.athlete_name)
                    });
                    console.log(`  ⚠️ No name match among duplicates - continuing with name-based matching`);
                }
            } else if (internalIdLifters && internalIdLifters.length === 1) {
                const existingLifter = internalIdLifters[0];
                
                // Check if names match
                if (existingLifter.athlete_name === cleanName) {
                    logger.logFinalResult(existingLifter, 'internal_id_exact_match');
                    console.log(`  ✅ Found exact match by internal_id: ${cleanName} (ID: ${existingLifter.lifter_id})`);
                    return existingLifter;
                } else {
                    // Internal_id matches but name doesn't - log conflict for manual resolution
                    logger.log('internal_id_conflict', {
                        message: `Internal_id exists but name mismatch`,
                        internal_id: additionalData.internal_id,
                        existing_name: existingLifter.athlete_name,
                        requested_name: cleanName,
                        existing_lifter_id: existingLifter.lifter_id
                    });
                    console.log(`  ⚠️ Internal_id conflict: ID ${additionalData.internal_id} exists for "${existingLifter.athlete_name}" but current name is "${cleanName}"`);
                    // Continue with name-based matching as fallback
                }
            } else {
                logger.log('internal_id_query', {
                    message: `No lifters found with internal_id ${additionalData.internal_id}`,
                    internal_id: additionalData.internal_id,
                    results_count: 0
                });
            }
        }
    } else {
        logger.log('init', {
            message: `No internal_id provided, skipping internal_id matching`,
            internal_id: null
        });
    }

    // Find ALL existing lifters by name (not just one)
    logger.log('name_query', {
        message: `Querying by athlete name: "${cleanName}"`,
        athlete_name: cleanName,
        query_type: 'name_based'
    });

    const { data: existingLifters, error: findError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .eq('athlete_name', cleanName);

    if (findError) {
        logger.logError(new Error(`Error finding lifter: ${findError.message}`), 'name_query');
        throw new Error(`Error finding lifter: ${findError.message}`);
    }

    const lifterIds = existingLifters ? existingLifters.map(l => l.lifter_id) : [];
    
    logger.log('name_query', {
        message: `Name query returned ${lifterIds.length} results`,
        results_count: lifterIds.length,
        results: existingLifters?.map(l => ({
            lifter_id: l.lifter_id,
            athlete_name: l.athlete_name,
            internal_id: l.internal_id
        })) || []
    });

    if (lifterIds.length === 0) {
        // No existing lifter found - attempt Tier 1 verification to extract internal_id before creating new record
        logger.log('name_match_none', {
            message: `No existing lifter found, attempting Tier 1 verification before creating new record`,
            athlete_name: cleanName,
            action: 'tier1_before_create'
        });
        console.log(`  ➕ No existing lifter found - attempting Tier 1 verification for: ${cleanName}`);
        
        // Tier 1: Base64 URL lookup protocol for new athletes
        console.log(`  🔍 DEBUG: Checking Tier 1 requirements for ${cleanName}:`);
        console.log(`    - eventDate: ${additionalData.eventDate}`);
        console.log(`    - ageCategory: ${additionalData.ageCategory}`);
        console.log(`    - weightClass: ${additionalData.weightClass}`);
        
        let tier1Result = null;
        
        if (additionalData.eventDate && additionalData.ageCategory && additionalData.weightClass) {
            console.log(`  🚀 Starting Tier 1 verification for new athlete: ${cleanName}`);
            
            logger.log('tier1_verification', {
                message: `Starting Tier 1 verification for new athlete`,
                athlete_name: cleanName,
                verification_type: 'base64_url_lookup_new_athlete'
            });

            tier1Result = await runBase64UrlLookupProtocol(
                cleanName,
                [], // No existing lifter IDs since this is a new athlete
                additionalData.targetMeetId,
                additionalData.eventDate,
                additionalData.ageCategory,
                additionalData.weightClass
            );

            // Enrich additionalData with Tier 1 results if found
            if (tier1Result && tier1Result.scrapedData) {
                console.log(`  ✅ Tier 1 found data for new athlete: ${cleanName}`);
                
                // Extract internal_id if found
                if (tier1Result.scrapedData.internalId && !additionalData.internal_id) {
                    additionalData.internal_id = tier1Result.scrapedData.internalId;
                    console.log(`  🔗 Extracted internal_id: ${additionalData.internal_id}`);
                }
            } else {
                console.log(`  ❌ Tier 1 verification found no data for new athlete: ${cleanName}`);
            }
        } else {
            console.log(`  ⚠️ Missing required data for Tier 1 verification (date, age category, or weight class)`);
        }
        
        // Create new lifter with enriched data
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
            logger.logError(new Error(`Error creating lifter: ${createError.message}`), 'name_match_none');
            throw new Error(`Error creating lifter: ${createError.message}`);
        }

        // Attach scraped data for enrichment if available
        if (tier1Result && tier1Result.scrapedData) {
            newLifter.scrapedData = tier1Result.scrapedData;
        }

        logger.logFinalResult(newLifter, 'create_new_with_tier1');
        console.log(`  ✅ Created new lifter: ${cleanName} (ID: ${newLifter.lifter_id})`);
        return newLifter;
    }

    if (lifterIds.length === 1) {
        // Single match found - update with internal_id if we have it and they don't
        const existingLifter = existingLifters[0];
        
        logger.log('name_match_single', {
            message: `Single lifter found by name`,
            lifter_id: existingLifter.lifter_id,
            athlete_name: existingLifter.athlete_name,
            existing_internal_id: existingLifter.internal_id,
            provided_internal_id: additionalData.internal_id
        });
        
        if (additionalData.internal_id && !existingLifter.internal_id) {
            logger.log('enrichment', {
                message: `Attempting to enrich lifter with internal_id`,
                lifter_id: existingLifter.lifter_id,
                internal_id: additionalData.internal_id,
                action: 'enrich_internal_id'
            });
            console.log(`  🔄 Enriching lifter ${cleanName} with internal_id: ${additionalData.internal_id}`);
            
            // Check for conflicts: ensure no other lifter already has this internal_id
            const { data: conflictCheck, error: conflictError } = await supabase
                .from('usaw_lifters')
                .select('lifter_id, athlete_name')
                .eq('internal_id', additionalData.internal_id)
                .neq('lifter_id', existingLifter.lifter_id);
                
            if (conflictError) {
                logger.log('error', {
                    message: `Error checking for internal_id conflicts: ${conflictError.message}`,
                    error_code: conflictError.code,
                    action: 'conflict_check'
                });
                console.log(`  ⚠️ Error checking for internal_id conflicts: ${conflictError.message}`);
            } else if (conflictCheck && conflictCheck.length > 0) {
                logger.log('internal_id_conflict', {
                    message: `Internal_id conflict detected during enrichment`,
                    internal_id: additionalData.internal_id,
                    conflicting_lifter_id: conflictCheck[0].lifter_id,
                    conflicting_athlete_name: conflictCheck[0].athlete_name,
                    target_lifter_id: existingLifter.lifter_id,
                    action: 'enrichment_blocked'
                });
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
                    logger.log('error', {
                        message: `Failed to update internal_id: ${updateError.message}`,
                        error_code: updateError.code,
                        action: 'enrichment_update'
                    });
                    console.log(`  ⚠️ Failed to update internal_id: ${updateError.message}`);
                } else {
                    logger.logFinalResult(updatedLifter, 'single_match_enriched');
                    console.log(`  ✅ Updated lifter with internal_id: ${cleanName} (ID: ${existingLifter.lifter_id})`);
                    return updatedLifter;
                }
            }
        } else if (additionalData.internal_id && existingLifter.internal_id && existingLifter.internal_id !== additionalData.internal_id) {
            // Existing lifter has different internal_id - log mismatch for manual resolution
            logger.log('internal_id_conflict', {
                message: `Internal_id mismatch detected`,
                lifter_id: existingLifter.lifter_id,
                existing_internal_id: existingLifter.internal_id,
                provided_internal_id: additionalData.internal_id,
                action: 'mismatch_detected'
            });
            console.log(`  ⚠️ Internal_id mismatch for ${cleanName}: existing=${existingLifter.internal_id}, new=${additionalData.internal_id}`);
        }
        
        console.log(`  ✅ Found 1 existing lifter: ${cleanName} (ID: ${lifterIds[0]})`);

        // Tier 1: Base64 URL lookup protocol
        logger.log('tier1_verification', {
            message: `Starting Tier 1 verification for single match`,
            lifter_id: existingLifter.lifter_id,
            verification_type: 'base64_url_lookup'
        });

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
            logger.logFinalResult(verifiedLifter, 'tier1_verified');
            console.log(`  ✅ Verified via Tier 1: ${cleanName} (ID: ${tier1Result.lifterId})`);
            // Attach scraped data for enrichment
            verifiedLifter.scrapedData = tier1Result.scrapedData;
            return verifiedLifter;
        }

        // Tier 2: Sport80 member URL verification (fallback)
        logger.log('tier2_verification', {
            message: `Starting Tier 2 verification`,
            lifter_id: existingLifter.lifter_id,
            verification_type: 'sport80_member_url'
        });

        const expectedBodyweight = additionalData.bodyweight ? parseFloat(additionalData.bodyweight) : null;
        const expectedTotal = additionalData.total ? parseFloat(additionalData.total) : null;
        const verifiedLifterId = await runSport80MemberUrlVerification(cleanName, lifterIds, additionalData.targetMeetId, expectedBodyweight, expectedTotal);

        if (verifiedLifterId) {
            const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
            logger.logFinalResult(verifiedLifter, 'tier2_verified');
            console.log(`  ✅ Verified lifter: ${cleanName} (ID: ${verifiedLifterId})`);
            return verifiedLifter;
        } else {
            // FALLBACK: Create new lifter if verification fails but we have valid data
            logger.log('fallback_create', {
                message: `Verification failed, creating new lifter record`,
                reason: 'verification_failed',
                original_lifter_id: existingLifter.lifter_id
            });
            console.log(`  ⚠️ Could not verify lifter ${cleanName} through two-tier verification - creating new record`);
            
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
                logger.logError(new Error(`Error creating fallback lifter: ${createError.message}`), 'fallback_create');
                throw new Error(`Error creating fallback lifter: ${createError.message}`);
            }

            logger.logFinalResult(newLifter, 'verification_fallback');
            console.log(`  ➕ Created fallback lifter: ${cleanName} (ID: ${newLifter.lifter_id})`);
            return newLifter;
        }
    }

    // Multiple matches found - use optimized verification for same-name athletes
    logger.log('name_match_multiple', {
        message: `Multiple lifters found with same name, starting disambiguation`,
        matches_count: lifterIds.length,
        matches: existingLifters.map(l => ({
            lifter_id: l.lifter_id,
            athlete_name: l.athlete_name,
            internal_id: l.internal_id
        }))
    });
    console.log(`  ⚠️ Found ${lifterIds.length} existing lifters with name "${cleanName}" - disambiguating...`);

    // If we have internal_id, try to use it for disambiguation first
    if (additionalData.internal_id) {
        logger.log('disambiguation', {
            message: `Attempting disambiguation via internal_id`,
            internal_id: additionalData.internal_id,
            candidates_count: existingLifters.length
        });

        const internalIdMatch = existingLifters.find(l => l.internal_id === additionalData.internal_id);
        if (internalIdMatch) {
            logger.logFinalResult(internalIdMatch, 'internal_id_disambiguation');
            console.log(`  ✅ Disambiguated via internal_id: ${cleanName} (ID: ${internalIdMatch.lifter_id})`);
            return internalIdMatch;
        }
        
        // Check if any lifter has null internal_id that we can enrich
        const nullInternalIdLifters = existingLifters.filter(l => !l.internal_id);
        if (nullInternalIdLifters.length === 1) {
            // Only one candidate without internal_id - enrich it
            const candidateLifter = nullInternalIdLifters[0];
            
            logger.log('enrichment', {
                message: `Single candidate without internal_id found for enrichment`,
                candidate_lifter_id: candidateLifter.lifter_id,
                internal_id: additionalData.internal_id
            });
            
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
                    logger.logFinalResult(updatedLifter, 'disambiguation_enriched');
                    console.log(`  ✅ Enriched and selected lifter: ${cleanName} (ID: ${candidateLifter.lifter_id})`);
                    return updatedLifter;
                }
            }
        }
    }

    // SAME NAME DISAMBIGUATION STRATEGY:
    // - Same name, same meet, SAME division: Skip Tier 1, start with Tier 2
    // - Same name, same meet, DIFFERENT division: Use normal Tier 1 → Tier 2 protocol
    
    // Check if we have existing results in the same division for this meet
    let hasSameDivisionResults = false;
    if (additionalData.targetMeetId && additionalData.ageCategory && additionalData.weightClass) {
        const { data: sameDivisionResults, error: divisionCheckError } = await supabase
            .from('usaw_meet_results')
            .select('lifter_id')
            .in('lifter_id', lifterIds)
            .eq('meet_id', additionalData.targetMeetId)
            .eq('age_category', additionalData.ageCategory)
            .eq('weight_class', additionalData.weightClass);
        
        if (!divisionCheckError && sameDivisionResults && sameDivisionResults.length > 0) {
            hasSameDivisionResults = true;
            console.log(`  🎯 Same name, same meet, SAME division detected - skipping Tier 1`);
        } else {
            console.log(`  🎯 Same name, same meet, DIFFERENT division - using normal protocol`);
        }
    }

    if (hasSameDivisionResults) {
        // SAME DIVISION: Skip Tier 1, start with Tier 2
        console.log(`  🔍 Tier 1 skipped - division rankings won't help distinguish same-division athletes`);
        
        // Tier 2: Sport80 member URL verification (primary for same-division disambiguation)
        logger.log('tier2_verification', {
            message: `Starting Tier 2 verification for same-division disambiguation`,
            candidates_count: lifterIds.length,
            verification_type: 'sport80_member_url',
            strategy: 'same_division_skip_tier1'
        });

        const expectedBodyweight = additionalData.bodyweight ? parseFloat(additionalData.bodyweight) : null;
        const expectedTotal = additionalData.total ? parseFloat(additionalData.total) : null;
        const verifiedLifterId = await runSport80MemberUrlVerification(cleanName, lifterIds, additionalData.targetMeetId, expectedBodyweight, expectedTotal);

        if (verifiedLifterId) {
            const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
            logger.logFinalResult(verifiedLifter, 'tier2_same_division_verification');
            console.log(`  ✅ Verified existing lifter via Tier 2: ${cleanName} (ID: ${verifiedLifterId})`);
            console.log(`     This lifter actually participated in meet ${additionalData.targetMeetId}`);
            return verifiedLifter;
        }

        // If Tier 2 found no match, these are different athletes with same name in same division
        logger.log('same_name_different_athletes', {
            message: `No existing lifter verified for this meet - different athletes with same name in same division`,
            candidates_checked: lifterIds.length,
            target_meet_id: additionalData.targetMeetId,
            reason: 'tier2_verification_failed_same_division'
        });
        console.log(`  🚨 SAME NAME, DIFFERENT ATHLETES (same division): None of the ${lifterIds.length} existing lifters verified for meet ${additionalData.targetMeetId}`);
        console.log(`     Creating new lifter record for different athlete with same name`);
        
        const { data: differentAthleteLifter, error: createError } = await supabase
            .from('usaw_lifters')
            .insert({
                athlete_name: cleanName,
                membership_number: additionalData.membership_number || null,
                internal_id: additionalData.internal_id || null
            })
            .select()
            .single();

        if (createError) {
            logger.logError(new Error(`Error creating different athlete lifter: ${createError.message}`), 'same_name_different_create');
            throw new Error(`Error creating different athlete lifter: ${createError.message}`);
        }

        logger.logFinalResult(differentAthleteLifter, 'same_name_different_athletes');
        console.log(`  ✅ Created separate lifter for different athlete: ${cleanName} (ID: ${differentAthleteLifter.lifter_id})`);
        return differentAthleteLifter;
        
    } else {
        // DIFFERENT DIVISION: Use normal Tier 1 → Tier 2 protocol
        console.log(`  🔍 Using normal Tier 1 → Tier 2 protocol for different division disambiguation`);
        
        // Tier 1: Base64 URL lookup protocol
        logger.log('tier1_verification', {
            message: `Starting Tier 1 verification for different-division disambiguation`,
            candidates_count: lifterIds.length,
            verification_type: 'base64_url_lookup'
        });

        const base64Result = await runBase64UrlLookupProtocol(
            cleanName,
            lifterIds,
            additionalData.targetMeetId,
            additionalData.eventDate,
            additionalData.ageCategory,
            additionalData.weightClass
        );

        if (base64Result && base64Result.lifterId) {
            const verifiedLifter = existingLifters.find(l => l.lifter_id === base64Result.lifterId);
            logger.logFinalResult(verifiedLifter, 'tier1_different_division_disambiguation');
            console.log(`  ✅ Verified via Tier 1: ${cleanName} (ID: ${base64Result.lifterId})`);
            // Attach scraped data for enrichment
            verifiedLifter.scrapedData = base64Result.scrapedData;
            return verifiedLifter;
        }

        // CRITICAL FIX: If Tier 1 extracted an internal_id but failed to disambiguate,
        // preserve the internal_id for later use when creating a new lifter
        if (base64Result && base64Result.extractedInternalId && !additionalData.internal_id) {
            additionalData.internal_id = base64Result.extractedInternalId;
            console.log(`  🔗 Preserving extracted internal_id ${additionalData.internal_id} for fallback lifter creation`);
        }

        // Tier 2: Sport80 member URL verification (fallback)
        logger.log('tier2_verification', {
            message: `Starting Tier 2 verification for different-division disambiguation`,
            candidates_count: lifterIds.length,
            verification_type: 'sport80_member_url'
        });

        const expectedBodyweight = additionalData.bodyweight ? parseFloat(additionalData.bodyweight) : null;
        const expectedTotal = additionalData.total ? parseFloat(additionalData.total) : null;
        const verifiedLifterId = await runSport80MemberUrlVerification(cleanName, lifterIds, additionalData.targetMeetId, expectedBodyweight, expectedTotal);

        if (verifiedLifterId) {
            const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
            logger.logFinalResult(verifiedLifter, 'tier2_different_division_disambiguation');
            console.log(`  ✅ Verified via Tier 2: ${cleanName} (ID: ${verifiedLifterId})`);
            return verifiedLifter;
        }
    }

    // If Tier 2 verification fails for all candidates, this is a different athlete with same name
    logger.log('same_name_different_athlete', {
        message: `Tier 2 verification failed for all candidates - different athlete with same name`,
        candidates_tested: lifterIds.length,
        reason: 'tier2_verification_failed_all_candidates'
    });
    console.log(`  🔍 Tier 2 verification failed for all ${lifterIds.length} candidates - this is a different athlete with same name`);

    // EXTREME DIFFERENCE DETECTION: Check for extreme bodyweight differences before fallback
    // GUARDRAIL: Only triggers for extreme cases (40+ kg AND different weight class categories)
    // GUARDRAIL: Only after existing Tier 1 and Tier 2 verification has failed
    if (additionalData.bodyweight && existingLifters.length > 0) {
        const currentBodyweight = parseFloat(additionalData.bodyweight);
        
        if (!isNaN(currentBodyweight)) {
            // Check existing results for same-name athletes to detect extreme differences
            const { data: existingResults, error: resultsError } = await supabase
                .from('usaw_meet_results')
                .select('lifter_id, body_weight_kg, weight_class, age_category')
                .in('lifter_id', lifterIds)
                .not('body_weight_kg', 'is', null);
            
            if (!resultsError && existingResults && existingResults.length > 0) {
                let hasExtremeDifference = false;
                let extremeDifferenceDetails = null;
                
                for (const existingResult of existingResults) {
                    const existingBodyweight = parseFloat(existingResult.body_weight_kg);
                    
                    if (!isNaN(existingBodyweight)) {
                        const bodyweightDiff = Math.abs(currentBodyweight - existingBodyweight);
                        
                        // EXTREME THRESHOLD: 40+ kg difference
                        if (bodyweightDiff >= 40) {
                            // Check for different weight class categories
                            const currentWeightClass = additionalData.weightClass || '';
                            const existingWeightClass = existingResult.weight_class || '';
                            const currentAgeCategory = additionalData.ageCategory || '';
                            const existingAgeCategory = existingResult.age_category || '';
                            
                            // Different categories: Youth vs Senior, Junior vs Senior, etc.
                            const isDifferentCategory = (
                                (currentAgeCategory.includes('Youth') && existingAgeCategory.includes('Senior')) ||
                                (currentAgeCategory.includes('Senior') && existingAgeCategory.includes('Youth')) ||
                                (currentAgeCategory.includes('Junior') && existingAgeCategory.includes('Senior')) ||
                                (currentAgeCategory.includes('Senior') && existingAgeCategory.includes('Junior'))
                            );
                            
                            // EXTREME CASE: 40+ kg difference AND different categories
                            if (isDifferentCategory || bodyweightDiff >= 50) {
                                hasExtremeDifference = true;
                                extremeDifferenceDetails = {
                                    bodyweightDiff: bodyweightDiff,
                                    currentBodyweight: currentBodyweight,
                                    existingBodyweight: existingBodyweight,
                                    currentWeightClass: currentWeightClass,
                                    existingWeightClass: existingWeightClass,
                                    currentAgeCategory: currentAgeCategory,
                                    existingAgeCategory: existingAgeCategory,
                                    isDifferentCategory: isDifferentCategory,
                                    existingLifterId: existingResult.lifter_id
                                };
                                break;
                            }
                        }
                    }
                }
                
                if (hasExtremeDifference) {
                    logger.log('extreme_difference_detected', {
                        message: `Extreme bodyweight difference detected - creating separate lifter`,
                        bodyweight_difference_kg: extremeDifferenceDetails.bodyweightDiff,
                        current_bodyweight: extremeDifferenceDetails.currentBodyweight,
                        existing_bodyweight: extremeDifferenceDetails.existingBodyweight,
                        current_weight_class: extremeDifferenceDetails.currentWeightClass,
                        existing_weight_class: extremeDifferenceDetails.existingWeightClass,
                        current_age_category: extremeDifferenceDetails.currentAgeCategory,
                        existing_age_category: extremeDifferenceDetails.existingAgeCategory,
                        different_categories: extremeDifferenceDetails.isDifferentCategory,
                        existing_lifter_id: extremeDifferenceDetails.existingLifterId,
                        reason: 'extreme_bodyweight_difference'
                    });
                    
                    console.log(`  🚨 EXTREME DIFFERENCE DETECTED: ${extremeDifferenceDetails.bodyweightDiff.toFixed(1)}kg bodyweight difference`);
                    console.log(`     Current: ${extremeDifferenceDetails.currentBodyweight}kg (${extremeDifferenceDetails.currentWeightClass}, ${extremeDifferenceDetails.currentAgeCategory})`);
                    console.log(`     Existing: ${extremeDifferenceDetails.existingBodyweight}kg (${extremeDifferenceDetails.existingWeightClass}, ${extremeDifferenceDetails.existingAgeCategory})`);
                    console.log(`     Different categories: ${extremeDifferenceDetails.isDifferentCategory}`);
                    console.log(`     Creating separate lifter due to extreme difference`);
                    
                    const { data: extremeNewLifter, error: extremeCreateError } = await supabase
                        .from('usaw_lifters')
                        .insert({
                            athlete_name: cleanName,
                            membership_number: additionalData.membership_number || null,
                            internal_id: additionalData.internal_id || null
                        })
                        .select()
                        .single();

                    if (extremeCreateError) {
                        logger.logError(new Error(`Error creating extreme difference lifter: ${extremeCreateError.message}`), 'extreme_difference_create');
                        // Fall through to normal fallback logic
                    } else {
                        logger.logFinalResult(extremeNewLifter, 'extreme_difference_separation');
                        console.log(`  ✅ Created separate lifter for extreme difference: ${cleanName} (ID: ${extremeNewLifter.lifter_id})`);
                        return extremeNewLifter;
                    }
                }
            }
        }
    }

    // FALLBACK: If we can't disambiguate, create a new lifter record
    // This ensures we don't lose athlete data due to disambiguation failures
    logger.log('fallback_create', {
        message: `Could not disambiguate, creating new lifter record`,
        candidates_count: existingLifters.length,
        reason: 'disambiguation_failed'
    });
    console.log(`  ⚠️ Could not disambiguate lifter "${cleanName}" - ${lifterIds.length} candidates found but none verified - creating new record`);
    
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
        logger.logError(new Error(`Error creating disambiguation fallback lifter: ${createError.message}`), 'fallback_create');
        throw new Error(`Error creating disambiguation fallback lifter: ${createError.message}`);
    }

    logger.logFinalResult(newLifter, 'disambiguation_fallback');
    console.log(`  ➕ Created disambiguation fallback lifter: ${cleanName} (ID: ${newLifter.lifter_id})`);
    return newLifter;
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

                console.log(`  🔍 Processing athlete ${index + 1}/${validResults.length}: ${lifterName}`);

                // Find or create lifter with two-tier verification system
                // Pass additional data needed for Tier 1 verification and extreme difference detection
                const lifter = await findOrCreateLifter(lifterName, {
                    targetMeetId: meetId,
                    eventDate: row.Date?.trim() || null,
                    ageCategory: row['Age Category']?.trim() || null,
                    weightClass: row['Weight Class']?.trim() || null,
                    bodyweight: row['Body Weight (Kg)']?.toString().trim() || null,
                    total: row.Total?.toString().trim() || null,
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
                // Use new constraint that includes weight_class to allow multiple results per athlete
                const { error: insertError } = await supabase
                    .from('usaw_meet_results')
                    .upsert(resultData, {
                        onConflict: 'meet_id, lifter_id, weight_class',
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
    scrapeOneMeet,
    findOrCreateLifter
};
