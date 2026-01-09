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
const { handleTotalAthleteString, getAmountMeetsOnPage } = require('../../utils/string_utils');

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

// REAL Sport80 member page verification using puppeteer
async function verifyLifterParticipationInMeet(lifterInternalId, targetMeetId, athleteName, requiredWeightClass = null, requiredTotal = null, requiredSnatch = null, requiredCJ = null, requiredBodyweight = null) {
    console.log(`    🐞 DEBUG verifyLifterParticipationInMeet: internalId=${lifterInternalId}, meetId=${targetMeetId}, name=${athleteName}, wc=${requiredWeightClass}, total=${requiredTotal}, sn=${requiredSnatch}, cj=${requiredCJ}, bw=${requiredBodyweight}`);
    // Get target meet information for enhanced matching
    const { data: targetMeet, error: meetError } = await supabase
        .from('usaw_meets')
        .select('meet_id, meet_internal_id, Meet, Date')
        .eq('meet_id', targetMeetId)
        .single();

    if (meetError) {
        console.log(`    ❌ Error getting meet info: ${meetError.message}`);
        return { verified: false };
    }

    const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${lifterInternalId}`;
    console.log(`    🌐 Visiting: ${memberUrl}`);
    console.log(`    🎯 Looking for: "${targetMeet.Meet}" on ${targetMeet.Date}`);

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
        let extractedGender = null;

        while (hasMorePages && !foundMeet) {
            console.log(`    📄 Checking page ${currentPage} of meet history...`);

            // Extract meet information from current page
            // Also extract CATEGORY column to infer gender if possible
            // Extract meet information from current page
            // Also extract CATEGORY column to infer gender if possible
            const pageData = await page.evaluate((targetName, targetDate) => {
                const meetRows = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr'));

                const meetInfo = meetRows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length < 3) return null;

                    const meetName = cells[0]?.textContent?.trim();
                    const meetDate = cells[1]?.textContent?.trim();
                    const ageCategory = cells[2]?.textContent?.trim(); // "Open Men's 67kg" etc

                    // Try to extract Total (usually around index 6, but let's be safe and check header or assume standard layout)
                    // Standard Layout: Meet, Date, Cat, BW, Sn, CJ, Total, Place, Points

                    const bwStr = cells[3]?.textContent?.trim();
                    const bodyweight = bwStr && !isNaN(parseFloat(bwStr)) ? parseFloat(bwStr) : null;

                    // Snatch = 4, CJ = 5, Total = 6
                    const snatchStr = cells[4]?.textContent?.trim();
                    const snatch = snatchStr && !isNaN(parseFloat(snatchStr)) ? parseFloat(snatchStr) : null;

                    const cjStr = cells[5]?.textContent?.trim();
                    const cj = cjStr && !isNaN(parseFloat(cjStr)) ? parseFloat(cjStr) : null;

                    const totalStr = cells[6]?.textContent?.trim();
                    const total = totalStr && !isNaN(parseFloat(totalStr)) ? parseFloat(totalStr) : null;

                    // DEBUG: Log cells if this looks like the target meet. Relaxed condition for debugging.
                    const debugTarget = targetName ? targetName.toLowerCase().substring(0, 5) : 'xxxxx';
                    if (meetName && (meetName.toLowerCase().includes(debugTarget) || meetName.includes('Arnold'))) {
                        console.log(`      🐞 DEBUG ROW for "${meetName}": [${cells.map((c, i) => `${i}:${c.textContent.trim()}`).join(', ')}]`);
                    }

                    return {
                        name: meetName,
                        date: meetDate,
                        category: ageCategory,
                        total: total,
                        snatch: snatch,
                        cj: cj,
                        bodyweight: bodyweight
                    };
                }).filter(Boolean);

                return meetInfo;

                return meetInfo;
            }, targetMeet.Meet, targetMeet.Date);

            if (currentPage === 1) {
                console.log(`    🔍 DEBUG: Extracted ${pageData.length} meets from page 1. First 3:`, pageData.slice(0, 3).map(m => `${m.name} (${m.date})`));
            }

            // Try to infer gender from any row on this page if we haven't yet
            if (!extractedGender && pageData.length > 0) {
                for (const row of pageData) {
                    if (row.category) {
                        const catLower = row.category.toLowerCase();
                        if (catLower.includes("men's") && !catLower.includes("women's")) {
                            extractedGender = 'M';
                            break;
                        } else if (catLower.includes("women's")) {
                            extractedGender = 'F';
                            break;
                        } else if (catLower.includes("boys")) {
                            extractedGender = 'M';
                            break;
                        } else if (catLower.includes("girls")) {
                            extractedGender = 'F';
                            break;
                        }
                    }
                }
                if (extractedGender) {
                    console.log(`    🚻 Extracted Gender from history: ${extractedGender}`);
                }
            }

            // Match by meet name and date
            // Match by meet name and date (with fuzzy logic)
            // Use for...of loop to support await inside
            for (const meet of pageData) {
                // Name match: Case-insensitive, trimmed
                const nameMatch = meet.name && targetMeet.Meet &&
                    meet.name.trim().toLowerCase() === targetMeet.Meet.trim().toLowerCase();

                // Date match: Allow +/- 5 days difference
                let dateMatch = false;
                if (meet.date && targetMeet.Date) {
                    try {
                        const d1 = new Date(meet.date);
                        const d2 = new Date(targetMeet.Date);

                        // Check if valid dates
                        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
                            const diffTime = Math.abs(d1 - d2);
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                            // Determine allowed window based on meet name type
                            // "Online Qualifier" meets often span up to a month (User specified +/- 30 days strictly for "Online Qualifier")
                            const isOnlineQualifier = (targetMeet.Meet || '').toLowerCase().includes('online qualifier');
                            const allowedDays = isOnlineQualifier ? 30 : 14; // 30 for "Online Qualifier", 14 for standard

                            dateMatch = diffDays <= allowedDays;

                            if (nameMatch && dateMatch && diffDays > 5) {
                                console.log(`      ⚠️ Name matched and date within extended window (${diffDays} days). Allowed: ${allowedDays} days (${isOnlineQualifier ? 'Online Qualifier' : 'Standard'})`);
                            } else if (nameMatch && !dateMatch && diffDays <= 60) {
                                console.log(`      ⚠️ Name matched but date difference is ${diffDays} days (${meet.date} vs ${targetMeet.Date}). Limit: ${allowedDays}`);
                            }
                        } else {
                            // Fallback to strict string match if dates invalid
                            console.log(`      ⚠️ Invalid date format: ${meet.date} or ${targetMeet.Date}, falling back to strict string match.`);
                            dateMatch = meet.date === targetMeet.Date;
                        }
                    } catch (e) {
                        console.log(`      ⚠️ Date comparison error: ${e.message}`);
                        dateMatch = meet.date === targetMeet.Date;
                    }
                }

                // SMART TIER 2: Verify Lifter Presence on Meet Page
                // If Name Matches but Date Mismatches, check the OFFICIAL Meet Results Page.
                // If the athlete is LISTED in the results, then they participated (ignoring date mismatch).
                if (nameMatch && !dateMatch) {
                    console.log(`      ℹ️  Possible DB Date Mismatch. Checking official meet page for presence of "${athleteName}"...`);
                    const isPresent = await verifyLifterOnMeetPage(browser, targetMeetId, athleteName);

                    if (isPresent) {
                        console.log(`      Found: Name Match + Date Mismatch (DB: ${targetMeet.Date} vs Member: ${meet.date})`);
                        console.log(`      ✅ SMART VERIFY: Athlete "${athleteName}" found on Official Meet Page. Confirming participation despite date mismatch.`);
                        dateMatch = true;
                    } else {
                        console.log(`      ❌ Smart Verify Failed: "${athleteName}" NOT found on Official Meet Page.`);
                    }
                }

                // ENHANCED VERIFICATION: Check Weight Class match
                let weightClassMatch = true;
                if (nameMatch && dateMatch && requiredWeightClass && requiredWeightClass !== 'Unknown' && meet.category) {
                    const cleanRequired = requiredWeightClass.replace('kg', '').trim().toLowerCase();
                    const cleanCategory = meet.category.toLowerCase();

                    if (cleanRequired.startsWith('+')) {
                        if (!cleanCategory.includes(cleanRequired)) {
                            weightClassMatch = false;
                        }
                    } else {
                        if (!cleanCategory.includes(cleanRequired)) {
                            weightClassMatch = false;
                        }
                    }

                    if (!weightClassMatch) {
                        console.log(`      ⛔ Weight Class Mismatch: Required "${requiredWeightClass}" vs History "${meet.category}"`);
                    } else {
                        console.log(`      ✅ Weight Class Verified: "${meet.category}" matches "${requiredWeightClass}"`);
                    }
                }

                // NEW: Check Total Match
                let totalMatch = true;
                if (nameMatch && dateMatch && requiredTotal !== null && meet.total !== null) {
                    if (Math.abs(meet.total - requiredTotal) > 0.1) {
                        totalMatch = false;
                        console.log(`      ⛔ Total Mismatch: Required ${requiredTotal} vs History ${meet.total}`);
                    } else {
                        console.log(`      ✅ Total Verified: ${meet.total} matches ${requiredTotal}`);
                    }
                }

                // NEW: Check Snatch Match
                let snatchMatch = true;
                if (nameMatch && dateMatch && requiredSnatch !== null && meet.snatch !== null) {
                    if (Math.abs(meet.snatch - requiredSnatch) > 0.1) {
                        snatchMatch = false;
                        console.log(`      ⛔ Snatch Mismatch: Required ${requiredSnatch} vs History ${meet.snatch}`);
                    } else {
                        console.log(`      ✅ Snatch Verified: ${meet.snatch} matches ${requiredSnatch}`);
                    }
                }

                // NEW: Check C&J Match
                let cjMatch = true;
                if (nameMatch && dateMatch && requiredCJ !== null && meet.cj !== null) {
                    if (Math.abs(meet.cj - requiredCJ) > 0.1) {
                        cjMatch = false;
                        console.log(`      ⛔ C&J Mismatch: Required ${requiredCJ} vs History ${meet.cj}`);
                    } else {
                        console.log(`      ✅ C&J Verified: ${meet.cj} matches ${requiredCJ}`);
                    }
                }

                // NEW: Check Bodyweight Match
                let bodyweightMatch = true;
                if (nameMatch && dateMatch && requiredBodyweight !== null && meet.bodyweight !== null) {
                    if (Math.abs(meet.bodyweight - requiredBodyweight) > 0.25) { // 0.25kg tolerance
                        bodyweightMatch = false;
                        console.log(`      ⛔ Bodyweight Mismatch: Required ${requiredBodyweight} vs History ${meet.bodyweight}`);
                    } else {
                        console.log(`      ✅ Bodyweight Verified: "${meet.bodyweight}" matches "${requiredBodyweight}"`);
                    }
                }

                if (nameMatch && dateMatch && weightClassMatch && totalMatch && snatchMatch && cjMatch && bodyweightMatch) {
                    foundMeet = meet;
                    break;
                }
            }

            if (foundMeet) {
                console.log(`    ✅ VERIFIED: "${foundMeet.name}" on ${foundMeet.date} found on page ${currentPage}`);

                // NEW: Scrape Membership Number from the page
                let membershipNumber = await page.evaluate(() => {
                    const text = document.body.innerText;

                    // Regex patterns
                    const patterns = [
                        /Membership\s*#\.?\s*(\d+)/i,
                        /Member\s*ID\.?\s*(\d+)/i,
                        /Member\s*Number\.?\s*(\d+)/i,
                        /USA\s*Weightlifting\s*#\s*:?\s*(\d+)/i,
                        /#\s*(\d{4,})/
                    ];

                    for (const p of patterns) {
                        const match = text.match(p);
                        if (match) return match[1];
                    }

                    // Strategy 3: Check Inputs
                    const inputs = Array.from(document.querySelectorAll('input'));
                    for (const input of inputs) {
                        const label = (input.name || input.id || input.getAttribute('aria-label') || '').toLowerCase();
                        if ((label.includes('member') || label.includes('number')) && /\d+/.test(input.value)) {
                            return input.value;
                        }
                    }

                    // DEBUG: Match context
                    const idx = text.toLowerCase().indexOf('member');
                    let context = '';
                    if (idx !== -1) {
                        const start = Math.max(0, idx - 50);
                        const end = Math.min(text.length, idx + 100);
                        context = 'CTX: ' + text.substring(start, end).replace(/\n/g, ' ');
                    }

                    const inputDump = inputs.slice(0, 5).map(i => `${i.id || i.name}: ${i.value}`).join(' | ');
                    return `DEBUG_FAIL: No Member text. Inputs: ${inputDump}. Context: ${context}`;
                });

                if (membershipNumber && (membershipNumber.startsWith('DEBUG_CONTEXT:') || membershipNumber.startsWith('DEBUG_FAIL:'))) {
                    // Only log DEBUG_FAIL if we really need it (commented out for production cleanliness)
                    // console.log(`    ⚠️ Membership Debug (Tier 2): ${membershipNumber}`);
                    membershipNumber = null;
                } else if (membershipNumber) {
                    console.log(`    ✅ Scraped Membership Number: ${membershipNumber}`);
                }

                return {
                    verified: true,
                    metadata: {
                        gender: extractedGender,
                        membershipNumber: membershipNumber
                    }
                };
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
        return { verified: false };

    } catch (error) {
        console.log(`    ❌ Error accessing member page: ${error.message}`);
        return { verified: false };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Helper to check if athlete exists on official meet results page
// Helper to check if athlete exists on official meet results page
async function verifyLifterOnMeetPage(browser, meetId, athleteName) {
    let page;
    try {
        page = await browser.newPage();
        const url = `https://usaweightlifting.sport80.com/public/rankings/results/${meetId}`;

        console.log(`      🔎 Checking official meet page for presence of "${athleteName}"...`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        // Wait for table to load
        await page.waitForSelector('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr', { timeout: 15000 });

        // Helper to get pagination text
        const getPageData = async () => {
            try {
                return await page.$eval(
                    ".data-table div div.v-data-table div.v-data-footer div.v-data-footer__pagination",
                    x => x.textContent
                );
            } catch (e) {
                return null;
            }
        };

        // Helper to check for athlete on current page
        const checkPageForAthlete = async (targetName) => {
            return await page.evaluate((targetName) => {
                const rows = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr'));
                const nameParts = targetName.toLowerCase().split(' ').map(p => p.trim()).filter(p => p.length > 0);

                for (const row of rows) {
                    const rowText = row.innerText.toLowerCase();
                    const allPartsFound = nameParts.every(part => rowText.includes(part));
                    if (allPartsFound) {
                        return true;
                    }
                }
                return false;
            }, targetName);
        };

        // Pagination loop
        let pageData = await getPageData();
        let found = false;
        let pageNum = 1;

        // Check first page
        found = await checkPageForAthlete(athleteName);
        if (found) {
            console.log(`      ✅ Found "${athleteName}" on page ${pageNum}`);
            return true;
        }

        while (!found && handleTotalAthleteString(pageData)) {
            pageNum++;
            console.log(`      ➡️ Checking next page (${pageNum})...`);

            await Promise.all([
                page.waitForNetworkIdle(),
                page.click('.data-table div div.v-data-table div.v-data-footer div.v-data-footer__icons-after'),
            ]);

            // Short wait to ensure DOM update
            await new Promise(r => setTimeout(r, 1000));

            pageData = await getPageData();
            found = await checkPageForAthlete(athleteName);

            if (found) {
                console.log(`      ✅ Found "${athleteName}" on page ${pageNum}`);
                return true;
            }
        }

        if (found) {
            console.log(`      ✅ Smart Verify Success: Found "${athleteName}" on Official Meet Page.`);
            return true;
        } else {
            console.log(`      ❌ Smart Verify Failed: "${athleteName}" NOT found on Official Meet Page after checking ${pageNum} pages.`);
            return false;
        }

    } catch (e) {
        console.log(`      ⚠️ Error searching meet page: ${e.message}`);
        return false;
    } finally {
        if (page) await page.close();
    }
}

// ========================================
// TIER 1 HELPER FUNCTIONS
// ========================================

// Extract internal_id and membership_number by clicking a specific athlete's row on rankings page
async function extractInternalIdByClicking(page, divisionCode, startDate, endDate, targetAthleteName, expectedTotal = null, expectedSnatch = null, expectedCJ = null, expectedBodyweight = null) {
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
            const athleteData = await page.evaluate((targetName, expTotal, expSnatch, expCJ, expBodyweight) => {
                const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                    .map(th => th.textContent.trim().toLowerCase());

                // Debug headers
                console.log('TABLE HEADERS:', headers);

                // Detect if we are in "Card/Mobile" view where cells have labels (e.g., "Total 172")
                const isCardView = headers.length <= 1 || headers[0].includes('Sort by');

                let colMap = { athleteName: -1, total: -1, snatch: -1, cj: -1, bodyweight: -1 };

                if (!isCardView) {
                    // Standard Table View Logic
                    colMap = {
                        athleteName: headers.findIndex(h => h.includes('athlete') || h.includes('lifter') || h.includes('name')),
                        total: headers.findIndex(h => h.includes('total')),
                        snatch: headers.findIndex(h => h === 'sn' || h.includes('snatch')),
                        cj: headers.findIndex(h => h === 'cj' || h.includes('clean') || h.includes('jerk')),
                        bodyweight: headers.findIndex(h => h.includes('bodyweight') || h.includes('bw') || h === 'wt')
                    };
                    // Fallbacks
                    if (colMap.athleteName === -1) colMap.athleteName = 1;
                    if (colMap.total === -1) colMap.total = 6;
                    if (colMap.snatch === -1) colMap.snatch = 4;
                    if (colMap.cj === -1) colMap.cj = 5;
                    if (colMap.bodyweight === -1) colMap.bodyweight = 3; // Standard: Lifter, Club, BW, S, C, T
                }

                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                const candidates = [];

                for (let index = 0; index < rows.length; index++) {
                    const row = rows[index];
                    const cells = Array.from(row.querySelectorAll('td'));

                    let athleteName = '';
                    let total = null;
                    let snatch = null;
                    let cj = null;
                    let bodyweight = null;

                    if (isCardView) {
                        // Parse "Label Value" format
                        cells.forEach(cell => {
                            const text = cell.textContent.trim();
                            if (text.startsWith('Name ')) athleteName = text.replace('Name ', '').trim();

                            // "Total 172"
                            if (text.startsWith('Total ')) {
                                const val = text.replace('Total ', '').trim();
                                if (!isNaN(parseFloat(val))) total = parseFloat(val);
                            }
                            // "Bodyweight 80.1"
                            if (text.startsWith('Bodyweight ')) {
                                const val = text.replace('Bodyweight ', '').trim();
                                if (!isNaN(parseFloat(val))) bodyweight = parseFloat(val);
                            }
                        });

                        // Fallback if "Name " prefix is missing but name is in standard slots
                        if (!athleteName) {
                            if (cells[3] && cells[3].textContent.includes('Name ')) {
                                athleteName = cells[3].textContent.replace('Name ', '').trim();
                            }
                        }
                    } else {
                        // Standard Column Logic
                        athleteName = cells[colMap.athleteName]?.textContent?.trim() || '';
                        if (!athleteName && cells.length > 3) {
                            if (cells[1]?.textContent?.length > 3) athleteName = cells[1].textContent.trim();
                        }

                        const totalStr = cells[colMap.total]?.textContent?.trim();
                        total = totalStr && !isNaN(parseFloat(totalStr)) ? parseFloat(totalStr) : null;

                        const bwStr = cells[colMap.bodyweight]?.textContent?.trim();
                        bodyweight = bwStr && !isNaN(parseFloat(bwStr)) ? parseFloat(bwStr) : null;

                        const snatchStr = cells[colMap.snatch]?.textContent?.trim();
                        snatch = snatchStr && !isNaN(parseFloat(snatchStr)) ? parseFloat(snatchStr) : null;

                        const cjStr = cells[colMap.cj]?.textContent?.trim();
                        cj = cjStr && !isNaN(parseFloat(cjStr)) && parseFloat(cjStr) < 400 ? parseFloat(cjStr) : null;
                    }

                    if (athleteName.toLowerCase().includes(targetName.toLowerCase()) ||
                        targetName.toLowerCase().includes(athleteName.toLowerCase())) {

                        // DEBUG row content
                        const debugCells = cells.map((c, i) => isCardView ? c.textContent.trim() : `[${i}] ${c.textContent.trim()}`);
                        console.log(`MATCHED ROW ${index} (CardView: ${isCardView}):`, debugCells.join(' | '));

                        candidates.push({
                            rowIndex: index,
                            athleteName: athleteName,
                            total: total,
                            snatch: snatch,
                            cj: cj,
                            bodyweight: bodyweight
                        });
                    }
                }

                // FILTERING LOGIC
                let selected = null;
                let matchType = 'none';

                // 1. Filter by Total (Strict)
                let validCandidates = candidates.filter(c => {
                    if (expTotal === null || c.total === null) return true;
                    // Allow small variance (floating point)
                    return Math.abs(c.total - expTotal) < 0.1;
                });

                // 1.5 Filter by Bodyweight (Strict)
                if (expBodyweight !== null) {
                    const strictBW = validCandidates.filter(c => c.bodyweight !== null && Math.abs(c.bodyweight - expBodyweight) < 0.2); // 0.2kg tolerance
                    if (strictBW.length > 0) validCandidates = strictBW;
                }

                // 2. Filter by Snatch/CJ if available (Strict) - Only if Card View didn't force them null
                if (!isCardView) {
                    if (expSnatch !== null) {
                        const strictSnatch = validCandidates.filter(c => c.snatch !== null && Math.abs(c.snatch - expSnatch) < 1);
                        if (strictSnatch.length > 0) validCandidates = strictSnatch;
                    }

                    if (expCJ !== null) {
                        const strictCJ = validCandidates.filter(c => c.cj !== null && Math.abs(c.cj - expCJ) < 1);
                        if (strictCJ.length > 0) validCandidates = strictCJ;
                    }
                }

                if (validCandidates.length === 1) {
                    selected = validCandidates[0];
                    matchType = 'strict_match';
                    console.log(`  ✅ Exact match found: ${selected.athleteName} (Total: ${selected.total})`);
                } else if (validCandidates.length > 1) {
                    console.log(`  ⚠️ Ambiguous matches remain: ${validCandidates.length}`);
                    matchType = 'ambiguous';
                    selected = null;
                } else {
                    console.log(`  ⚠️ No match found after detailed filtering.`);
                    matchType = 'no_match';
                }

                return {
                    found: !!selected,
                    rowIndex: selected ? selected.rowIndex : -1,
                    athleteName: selected ? selected.athleteName : '',
                    total: selected ? selected.total : null,
                    isClickable: true, // Assuming true if found
                    _debugCandidates: candidates.map(c => ({
                        rowIndex: c.rowIndex,
                        athleteName: c.athleteName,
                        total: c.total,
                        bodyweight: c.bodyweight,
                        matchType: (selected && c.rowIndex === selected.rowIndex) ? 'SELECTED' : 'rejected'
                    })),
                    _debugExp: { total: expTotal, bodyweight: expBodyweight }
                };
            }, targetAthleteName, expectedTotal, expectedSnatch, expectedCJ, expectedBodyweight);

            if (athleteData.found) {
                console.log(`      ✅ Found "${athleteData.athleteName}" on page ${currentPage}`);
                if (athleteData._debugCandidates) {
                    console.log(`      🐞 DEBUG CANDIDATES (Exp: ${JSON.stringify(athleteData._debugExp)}):`);
                    console.log(JSON.stringify(athleteData._debugCandidates, null, 2));
                }

                if (!athleteData.isClickable) {
                    console.log(`      ⚠️ Row is not clickable`);
                    return null;
                }

                // Click the row and wait for navigation
                console.log(`      🖱️ Clicking row... (Total: ${athleteData.total || 'N/A'})`);

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
                let internalId = match ? parseInt(match[1]) : null;

                if (!match) {
                    console.log(`      ❌ No internal_id in URL: ${currentUrl}`);
                    return null;
                }

                // NEW: Scrape Membership Number from the profile page
                let membershipNumber = null;
                try {
                    // Wait briefly for profile content
                    await page.waitForSelector('.v-card__text', { timeout: 10000 }).catch(() => { });

                    membershipNumber = await page.evaluate(() => {
                        const text = document.body.innerText;

                        // Regex patterns
                        const patterns = [
                            /Membership\s*#\.?\s*(\d+)/i,
                            /Member\s*ID\.?\s*(\d+)/i,
                            /Member\s*Number\.?\s*(\d+)/i,
                            /USA\s*Weightlifting\s*#\s*:?\s*(\d+)/i,
                            /#\s*(\d{4,})/
                        ];

                        for (const p of patterns) {
                            const match = text.match(p);
                            if (match) return match[1];
                        }

                        // Strategy 3: Check Inputs
                        const inputs = Array.from(document.querySelectorAll('input'));
                        for (const input of inputs) {
                            const label = (input.name || input.id || input.getAttribute('aria-label') || '').toLowerCase();
                            // Check for member/membership in label/name/id
                            if ((label.includes('member') || label.includes('number')) && /\d+/.test(input.value)) {
                                return input.value;
                            }
                        }

                        return null; // Silent failure here is fine, we just won't get usage
                    });

                    if (membershipNumber) {
                        console.log(`      ✅ Scraped Membership Number: ${membershipNumber}`);
                    }
                } catch (e) {
                    console.log(`      ⚠️ Could not scrape membership number: ${e.message}`);
                }

                return { internalId, membershipNumber };
            } else {
                if (athleteData._debugCandidates && athleteData._debugCandidates.length > 0) {
                    console.log(`      ⚠️ Candidates found but no strict match/unique selection (Exp: ${JSON.stringify(athleteData._debugExp)}):`);
                    console.log(JSON.stringify(athleteData._debugCandidates, null, 2));
                    // If we have candidates but failed to select, it is safer to stop or try next page?
                    // If we are looking for a name match, it is possible they are on the next page? 
                    // Unlikely if we found name matches but they were rejected by strict criteria.
                    // But we should continue just in case there is a better name match on next page (e.g. "John Smith" vs "John Smith Jr")
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
                console.log(`      ❌ Athlete not found (or no strict match) on any page`);
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
                    gender: headers.findIndex(h => h.includes('gender')),
                    membershipNumber: headers.findIndex(h => h.includes('member') || h.includes('membership') || h.includes('#'))
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
                        competitionAge: numericAge, // Ensure this property exists for enrichment
                        club: colMap.club > -1 ? cellTexts[colMap.club] : '',
                        liftDate: colMap.liftDate > -1 ? cellTexts[colMap.liftDate] : '',
                        level: colMap.level > -1 ? cellTexts[colMap.level] : '',
                        wso: colMap.wso > -1 ? cellTexts[colMap.wso] : '',
                        total: colMap.total > -1 ? cellTexts[colMap.total] : '',
                        gender: colMap.gender > -1 ? cellTexts[colMap.gender] : '',
                        membershipNumber: colMap.membershipNumber > -1 ? cellTexts[colMap.membershipNumber] : '',
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
        .select('result_id, lifter_id, lifter_name, wso, club_name, competition_age, gender, meet_id, date, national_rank, total')
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

    // Build a map of name counts to detect duplicates
    const nameCounts = scrapedAthletes.reduce((acc, a) => {
        const key = a.athleteName.toLowerCase();
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    for (const dbResult of potentialResults) {
        const nameLower = dbResult.lifter_name.toLowerCase();
        let scrapedAthlete = null;

        // Handle duplicates via Total disambiguation
        if (nameCounts[nameLower] > 1) {
            if (dbResult.total !== null && dbResult.total !== undefined) {
                const dbTotal = parseFloat(dbResult.total);
                const candidates = scrapedAthletes.filter(a => a.athleteName.toLowerCase() === nameLower);

                // Find candidate with matching total (tolerance 0.1)
                scrapedAthlete = candidates.find(a => {
                    const scrapedTotal = a.total && !isNaN(parseFloat(a.total)) ? parseFloat(a.total) : null;
                    return scrapedTotal !== null && Math.abs(scrapedTotal - dbTotal) <= 0.1;
                });

                if (scrapedAthlete) {
                    // console.log(`      ✅ Disambiguated enrichment for "${dbResult.lifter_name}" by Total (${dbTotal})`);
                } else {
                    console.log(`      ⚠️  Skipping batch enrichment for "${dbResult.lifter_name}" (Duplicate Name, Total Mismatch [DB: ${dbTotal}])`);
                    continue;
                }
            } else {
                console.log(`      ⚠️  Skipping batch enrichment for "${dbResult.lifter_name}" (Duplicate Name, DB missing Total)`);
                continue;
            }
        } else {
            scrapedAthlete = scrapedAthletes.find(a =>
                a.athleteName.toLowerCase() === nameLower
            );
        }

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

            // NEW: Batch update usaw_lifters.membership_number if found in rankings
            if (scrapedAthlete.membershipNumber) {
                // Clean the number (remove # prefix if present)
                const cleanMemNum = scrapedAthlete.membershipNumber.replace(/[^\d]/g, '');

                if (cleanMemNum) {
                    const { data: lifterData, error: lifterFetchError } = await supabase
                        .from('usaw_lifters')
                        .select('lifter_id, membership_number')
                        .eq('lifter_id', dbResult.lifter_id)
                        .single();

                    if (!lifterFetchError && lifterData && (!lifterData.membership_number || lifterData.membership_number.toString() !== cleanMemNum)) {
                        const { error: memUpdateError } = await supabase
                            .from('usaw_lifters')
                            .update({ membership_number: cleanMemNum })
                            .eq('lifter_id', dbResult.lifter_id);

                        if (!memUpdateError) {
                            console.log(`      💳 Enriched membership_number ${cleanMemNum} for ${dbResult.lifter_name}`);
                        }
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

// Helper to calculate standard IWF weight class from bodyweight and date
function calculateStandardWeightClass(ageCategory, bodyWeight, eventDateStr) {
    if (!bodyWeight || isNaN(bodyWeight)) return null;
    const itemDate = new Date(eventDateStr);
    const bw = parseFloat(bodyWeight);

    // Normalize Age Category/Gender
    const category = (ageCategory || '').toLowerCase();
    const isFemale = category.includes('women') || (category.includes('female') && !category.includes('male'));
    const genderKey = isFemale ? 'F' : 'M';

    // Determine Era
    const DATE_JUNE_2025 = new Date('2025-06-01');
    const DATE_NOV_2018 = new Date('2018-11-01');
    const DATE_JAN_1998 = new Date('1998-01-01');

    let era = 'legacy'; // Default to oldest if very old
    if (itemDate >= DATE_JUNE_2025) era = 'current';
    else if (itemDate >= DATE_NOV_2018) era = 'historical_2018';
    else if (itemDate >= DATE_JAN_1998) era = 'historical_1998';

    // Determine Specific Group based on Age Category String
    let group = 'senior'; // Default
    if (category.includes('11 under')) group = '11U';
    else if (category.includes('13 under')) group = '13U';
    else if (category.includes('14-15')) group = '14-15';
    else if (category.includes('16-17')) group = '16-17';
    else if (category.includes('junior')) group = 'junior';
    else if (category.includes('open') || category.includes('senior')) group = 'open';

    // Fallback for generic 'youth' if no specific group found but 'youth' is present
    if (category.includes('youth') && !['11U', '13U', '14-15', '16-17'].includes(group)) {
        // Default to oldest youth category if unspecified? Or error?
        // Let's default to 16-17 as it covers most weights, or maybe 13U if checking low weights.
        // Better: Use a broad mapping or 16-17 logic.
        group = '16-17';
    }

    // Weight Classes Mapping (Verified)
    const weightClasses = {
        current: {
            '11U': { M: [32, 36, 40, 44, 48, 52, 56, 60, 65], F: [30, 33, 36, 40, 44, 48, 53, 58, 63] },
            '13U': { M: [32, 36, 40, 44, 48, 52, 56, 60, 65], F: [30, 33, 36, 40, 44, 48, 53, 58, 63] },
            '14-15': { M: [48, 52, 56, 60, 65, 71, 79], F: [40, 44, 48, 53, 58, 63, 69] },
            '16-17': { M: [56, 60, 65, 71, 79, 88, 94], F: [44, 48, 53, 58, 63, 69, 77] },
            'junior': { M: [60, 65, 71, 79, 88, 94, 110], F: [48, 53, 58, 63, 69, 77, 86] },
            'open': { M: [60, 65, 71, 79, 88, 94, 110], F: [48, 53, 58, 63, 69, 77, 86] },
            'senior': { M: [60, 65, 71, 79, 88, 94, 110], F: [48, 53, 58, 63, 69, 77, 86] } // Alias for open
        },
        historical_2018: {
            '11U': { M: [32, 36, 39, 44, 49, 55, 61, 67, 73], F: [30, 33, 36, 40, 45, 55, 59, 64] }, // Assumed same as 13U if not explicit
            '13U': { M: [32, 36, 39, 44, 49, 55, 61, 67, 73], F: [30, 33, 36, 40, 45, 55, 59, 64] },
            '14-15': { M: [39, 44, 49, 55, 61, 67, 73, 81, 89], F: [36, 40, 45, 49, 55, 59, 64, 71, 76] },
            '16-17': { M: [49, 55, 61, 67, 73, 81, 89, 96, 102], F: [40, 45, 49, 55, 59, 64, 71, 76, 81] },
            'junior': { M: [55, 61, 67, 73, 81, 89, 96, 102, 109], F: [45, 49, 55, 59, 64, 71, 76, 81, 87] },
            'open': { M: [55, 61, 67, 73, 81, 89, 96, 102, 109], F: [45, 49, 55, 59, 64, 71, 76, 81, 87] },
            'senior': { M: [55, 61, 67, 73, 81, 89, 96, 102, 109], F: [45, 49, 55, 59, 64, 71, 76, 81, 87] }
        },
        historical_1998: {
            '11U': { M: [31, 35, 39, 44, 50, 56, 62, 69], F: [31, 35, 39, 44, 48, 53, 58] }, // Assumed 13U
            '13U': { M: [31, 35, 39, 44, 50, 56, 62, 69], F: [31, 35, 39, 44, 48, 53, 58] },
            '14-15': { M: [44, 50, 56, 62, 69, 77, 85], F: [44, 48, 53, 58, 63, 69] },
            '16-17': { M: [50, 56, 62, 69, 77, 85, 94, 105], F: [44, 48, 53, 58, 63, 69] },
            'junior': { M: [56, 62, 69, 77, 85, 94, 105], F: [48, 53, 58, 63, 69, 75, 90] },
            'open': { M: [56, 62, 69, 77, 85, 94, 105], F: [48, 53, 58, 63, 69, 75, 90] },
            'senior': { M: [56, 62, 69, 77, 85, 94, 105], F: [48, 53, 58, 63, 69, 75, 90] }
        }
    };

    // Safely access the limits
    const limits = weightClasses[era]?.[group]?.[genderKey];
    if (!limits) return null; // Logic gap or invalid combination

    // Find class
    for (const limit of limits) {
        if (bw <= limit) {
            // Exact format logic based on Era
            if (era === 'historical_1998') return `${limit} kg`; // Space usually? Code analysis showed mixed, but let's stick to simple "56kg" usually works for lookup if normalized, BUT standard code is 56kg.
            // Wait, user specified "1998 Era: +69 Kg". 
            // What about normal weights? "69 Kg" or "69kg"?
            // Report showed "Inactive (1998)" was sparse. "Inactive (2018)" had "31kg". 
            // Let's use standard "limit" + "kg" for normal weights across all eras unless verifying code fails.
            // Sport80 typically normalizes input.
            return `${limit}kg`;
        }
    }

    // Heavyweight Logic (Strict Era Formatting)
    const maxLimit = limits[limits.length - 1];
    if (era === 'current') {
        return `${maxLimit}+kg`; // 65+kg
    } else if (era === 'historical_2018') {
        return `+${maxLimit}kg`; // +73kg
    } else if (era === 'historical_1998') {
        return `+${maxLimit} Kg`; // +69 Kg (Capital K, Space)
    }

    return `${maxLimit}+kg`; // Fallback
}

// Helper to generate alternative divisions for Tier 1.7 verification
function generateAlternativeDivisions(originalCategory, bodyWeight, eventDateStr) {
    if (!originalCategory || !bodyWeight) return [];

    const catLower = originalCategory.toLowerCase();
    const isFemale = catLower.includes('women') || (catLower.includes('female') && !catLower.includes('male'));
    const genderStr = isFemale ? "Women's" : "Men's";

    // Ordered hierarchy for search
    const hierarchy = [
        `${genderStr} 11 Under Age Group`,
        `${genderStr} 13 Under Age Group`,
        `${genderStr} 14-15 Age Group`,
        `${genderStr} 16-17 Age Group`,
        `Junior ${genderStr}`,
        `Open ${genderStr}`
    ];

    // Find current index
    let currentIndex = -1;
    for (let i = 0; i < hierarchy.length; i++) {
        // Create simplified key (e.g. "13 Under", "Junior") to match robustly
        const coreKey = hierarchy[i].replace("Men's", "").replace("Women's", "").replace("Age Group", "").trim();
        if (originalCategory.includes(coreKey)) {
            currentIndex = i;
            break;
        }
    }

    const indices = new Set();

    // Always include Open (last index) as ultimate fallback
    indices.add(hierarchy.length - 1);

    if (currentIndex !== -1) {
        indices.add(currentIndex);
        // Add 2 Adjacent Down
        if (currentIndex - 1 >= 0) indices.add(currentIndex - 1);
        if (currentIndex - 2 >= 0) indices.add(currentIndex - 2);
        // Add 2 Adjacent Up
        if (currentIndex + 1 < hierarchy.length) indices.add(currentIndex + 1);
        if (currentIndex + 2 < hierarchy.length) indices.add(currentIndex + 2);
    }

    const candidates = [];

    // PRIORITY 1: The Original Category (but with calculated weight class) - equivalent to Tier 1.6
    if (currentIndex !== -1) {
        const cat = hierarchy[currentIndex];
        const wClass = calculateStandardWeightClass(cat, bodyWeight, eventDateStr);
        if (wClass) {
            candidates.push({ category: cat, weightClass: wClass });
        }
    }

    // PRIORITY 2: Adjacent / Alternative Categories (Tier 1.7)
    // Sort indices to ensure logical checking order (Youngest -> Oldest), EXCLUDING current index
    const sortedIndices = Array.from(indices).sort((a, b) => a - b);

    for (const i of sortedIndices) {
        if (i === currentIndex) continue; // Already added as Priority 1

        const cat = hierarchy[i];
        const wClass = calculateStandardWeightClass(cat, bodyWeight, eventDateStr);
        if (wClass) {
            candidates.push({ category: cat, weightClass: wClass });
        }
    }

    // Filter duplicates (e.g. if multiple categories map to same name/class)
    const uniqueCandidates = [];
    const seen = new Set();
    for (const c of candidates) {
        const key = `${c.category}|${c.weightClass}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueCandidates.push(c);
        }
    }

    return uniqueCandidates;
}

async function runBase64UrlLookupProtocol(lifterName, potentialLifterIds, targetMeetId, eventDate, ageCategory, weightClass, bodyweight = null, isFallbackCheck = false, expectedTotal = null, expectedSnatch = null, expectedCJ = null) {
    if (!isFallbackCheck) {
        console.log(`  🔍 Tier 1: Base64 URL Lookup Protocol (Division Rankings)`);
    } else {
        // Simplified log to reduce confusion
        console.log(`  🔍 Tier 1 (Alternative): Checking division ${ageCategory} ${weightClass}...`);
    }

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

    // Generate alternative division name with different spacing for 'kg'
    // e.g. "Open Men's 56kg" -> "Open Men's 56 kg" OR "Open Men's 56 kg" -> "Open Men's 56kg"
    let divisionNameAlt = '';
    if (weightClass.includes(' kg')) {
        divisionNameAlt = `${ageCategory} ${weightClass.replace(' kg', 'kg')}`;
    } else {
        divisionNameAlt = `${ageCategory} ${weightClass.replace('kg', ' kg')}`;
    }

    // Determine if division is active or inactive based on meet date
    const meetDate = new Date(eventDate);
    const activeDivisionCutoff = new Date('2025-06-01');
    const isActiveDivision = meetDate >= activeDivisionCutoff;

    let divisionCode;

    // Helper to check code for a given name
    const checkCode = (name) => {
        if (isActiveDivision) {
            return divisionCodes[name] || divisionCodes[`(Inactive) ${name}`];
        } else {
            return divisionCodes[`(Inactive) ${name}`] || divisionCodes[name];
        }
    };

    // Try original format
    divisionCode = checkCode(divisionName);

    // Try alternative format if not found
    if (!divisionCode && divisionNameAlt) {
        divisionCode = checkCode(divisionNameAlt);
        if (divisionCode) {
            console.log(`    ⚠️ Division Found using alternative formatting: "${divisionNameAlt}" (original: "${divisionName}")`);
        }
    }

    if (!divisionCode) {
        console.log(`    ❌ Division not found: "${divisionName}" (No Base64 code available, cannot generate URL)`);

        // TIER 1.6 FALLBACK LOGIC (Division Not Found)
        if (!isFallbackCheck && bodyweight) {
            const calculatedClass = calculateStandardWeightClass(ageCategory, bodyweight, eventDate);

            // Only proceed if calculated class is different and valid
            if (calculatedClass && calculatedClass !== weightClass) {
                console.log(`    ⚠️ Tier 1 failed (Invalid Division). Bodyweight (${bodyweight}kg) suggests alternative class: ${calculatedClass}`);

                // Recursively call with new weight class and fallback flag
                return await runBase64UrlLookupProtocol(
                    lifterName,
                    potentialLifterIds,
                    targetMeetId,
                    eventDate,
                    ageCategory,
                    calculatedClass,
                    bodyweight,
                    true,
                    expectedTotal,
                    expectedSnatch,
                    expectedCJ
                );
            }
        }

        console.log(`    ❌ ... skipping Tier 1`);
        return null;
    }

    console.log(`    📋 Division: ${divisionName} ${isActiveDivision ? '' : '(Inactive)'} (code: ${divisionCode})`);
    console.log(`    📅 Date Range: ${formatDate(addDays(meetDate, -3))} to ${formatDate(addDays(meetDate, 10))} (-3/+10 days)`);

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
        // Forward console logs from browser to Node.js
        page.on('console', msg => console.log('    🖥️ BROWSER LOG:', msg.text()));
        await page.setViewport({ width: 1500, height: 1000 });

        // Calculate date range: -3 days (buffer) to +10 days (long meets)
        const startDate = addDays(meetDate, -3);
        const endDate = addDays(meetDate, 10);

        // Scrape division rankings
        const scrapedAthletes = await scrapeDivisionRankings(page, divisionCode, startDate, endDate);

        if (scrapedAthletes.length === 0) {
            console.log(`    ℹ️  No athletes found in division rankings`);
            return null;
        }

        // BATCH ENRICHMENT - Update all matching athletes in the database
        await batchEnrichAthletes(scrapedAthletes, startDate, endDate, ageCategory, weightClass);

        // VERIFICATION - Check if target lifter was found
        let targetAthlete = null;

        if (expectedTotal) {
            targetAthlete = scrapedAthletes.find(a =>
                a.athleteName.toLowerCase() === lifterName.toLowerCase() &&
                a.total &&
                Math.abs(parseFloat(a.total) - parseFloat(expectedTotal)) <= 0.1
            );

            if (!targetAthlete) {
                console.log(`    ⚠️ Precise match with Total ${expectedTotal} failed. Trying name-only match as fallback...`);
                // Fallback to name only if precise total match fails (maybe total logic differs slightly)
                targetAthlete = scrapedAthletes.find(a =>
                    a.athleteName.toLowerCase() === lifterName.toLowerCase()
                );
            }
        } else {
            targetAthlete = scrapedAthletes.find(a =>
                a.athleteName.toLowerCase() === lifterName.toLowerCase()
            );
        }

        if (targetAthlete) {
            console.log(`    ✅ Tier 1${isFallbackCheck ? '.6' : ''} VERIFIED: "${lifterName}" found in division rankings`);


            // Tier 1.5: If athlete found but missing internal_id, extract it by clicking their row
            if (!targetAthlete.internalId && potentialLifterIds.length > 0) {
                console.log(`    🔗 Tier 1.5: Extracting internal_id for "${lifterName}" via row clicking...`);

                try {
                    const extractedData = await extractInternalIdByClicking(
                        page,
                        divisionCode,
                        startDate,
                        endDate,
                        lifterName,
                        expectedTotal,
                        expectedSnatch,
                        expectedCJ,
                        bodyweight
                    );

                    if (extractedData && extractedData.internalId) {
                        targetAthlete.internalId = extractedData.internalId;
                        console.log(`    ✅ Tier 1.5: Extracted internal_id ${extractedData.internalId}`);

                        // Handle Membership Number if found
                        if (extractedData.membershipNumber) {
                            targetAthlete.membershipNumber = extractedData.membershipNumber;
                            console.log(`    ✅ Tier 1.5: Extracted membership_number ${extractedData.membershipNumber}`);

                            // Immediate update to database if we have potential lifter ID(s)
                            if (potentialLifterIds.length > 0) {
                                const lifterId = potentialLifterIds[0]; // Naively assuming first if multiple, but logic below disambiguates
                                // Note: The main logic below handles disambiguation and updates. 
                                // We just need to make sure 'membershipNumber' is passed along or updated.

                                // Let's do a safe update here if we have a single candidate
                                if (potentialLifterIds.length === 1) {
                                    try {
                                        await supabase.from('usaw_lifters')
                                            .update({ membership_number: extractedData.membershipNumber })
                                            .eq('lifter_id', lifterId);
                                        console.log(`    💾 Saved: Updated membership # for lifter ${lifterId}`);
                                    } catch (e) { console.log('    ⚠️ Save Failed (Membership):', e.message); }
                                }
                            }
                        }

                    } else {
                        console.log(`    ⚠️ Tier 1.5: Could not extract internal_id`);
                    }
                } catch (error) {
                    console.log(`    ⚠️ Tier 1.5: Failed to extract internal_id - ${error.message}`);
                }
            }

            // Try to disambiguate using internal_id if we have it
            if (potentialLifterIds.length === 1) {
                // Single candidate - return it

                // TARGETED UPDATE: We know this is the correct lifter, so update metadata safely
                if (targetAthlete.internalId) {
                    const updateData = {};
                    if (targetAthlete.club) updateData.club_name = targetAthlete.club;
                    if (targetAthlete.wso) updateData.wso = targetAthlete.wso;
                    if (targetAthlete.gender) updateData.gender = targetAthlete.gender;
                    if (targetAthlete.nationalRank) updateData.national_rank = parseInt(targetAthlete.nationalRank);
                    if (targetAthlete.competitionAge) updateData.competition_age = parseInt(targetAthlete.competitionAge);

                    if (Object.keys(updateData).length > 0) {
                        try {
                            await supabase
                                .from('usaw_meet_results')
                                .update(updateData)
                                .eq('meet_id', targetMeetId)
                                .eq('lifter_id', potentialLifterIds[0]);

                            console.log(`      ✅ Targeted Enrichment: Updated metadata for ${lifterName} (ID: ${potentialLifterIds[0]})`);
                        } catch (err) {
                            console.log(`      ⚠️ Targeted Enrichment Error: ${err.message}`);
                        }
                    }
                }

                // TARGETED UPDATE (Lifter): Save Membership Number if found
                if (targetAthlete.membershipNumber) {
                    try {
                        const { error: memError } = await supabase.from('usaw_lifters')
                            .update({ membership_number: targetAthlete.membershipNumber })
                            .eq('lifter_id', potentialLifterIds[0])
                            .is('membership_number', null); // Only if currently null to avoid overwrite conflicts? actually users want this so maybe always?

                        if (!memError) {
                            console.log(`      💾 Saved Membership Number ${targetAthlete.membershipNumber} for lifter ${potentialLifterIds[0]}`);
                        }
                    } catch (err) { console.log('      ⚠️ Save Failed (Membership):', err.message); }
                }

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

                    // TARGETED UPDATE: We disambiguated via internal_id, so update metadata safely
                    const updateData = {};
                    if (targetAthlete.club) updateData.club_name = targetAthlete.club;
                    if (targetAthlete.wso) updateData.wso = targetAthlete.wso;
                    if (targetAthlete.gender) updateData.gender = targetAthlete.gender;
                    if (targetAthlete.nationalRank) updateData.national_rank = parseInt(targetAthlete.nationalRank);
                    if (targetAthlete.competitionAge) updateData.competition_age = parseInt(targetAthlete.competitionAge);

                    if (Object.keys(updateData).length > 0) {
                        try {
                            await supabase
                                .from('usaw_meet_results')
                                .update(updateData)
                                .eq('meet_id', targetMeetId)
                                .eq('lifter_id', matchedLifter.lifter_id);

                            console.log(`      ✅ Targeted Enrichment: Updated metadata for ${lifterName} (ID: ${matchedLifter.lifter_id})`);
                        } catch (err) {
                            console.log(`      ⚠️ Targeted Enrichment Error: ${err.message}`);
                        }
                    }

                    // TARGETED UPDATE (Lifter): Save Membership Number if found
                    if (targetAthlete.membershipNumber) {
                        try {
                            const { error: memError } = await supabase.from('usaw_lifters')
                                .update({ membership_number: targetAthlete.membershipNumber })
                                .eq('lifter_id', matchedLifter.lifter_id);

                            if (!memError) {
                                console.log(`      💾 Saved Membership Number ${targetAthlete.membershipNumber} for lifter ${matchedLifter.lifter_id}`);
                            }
                        } catch (err) { console.log('      ⚠️ Save Failed (Membership):', err.message); }
                    }

                    return {
                        lifterId: matchedLifter.lifter_id,
                        scrapedData: targetAthlete
                    };
                }

                // No match by internal_id - check if any candidates have null internal_id
                const { data: nullInternalIdCandidates, error: nullError } = await supabase
                    .from('usaw_lifters')
                    .select('lifter_id, internal_id, membership_number') // Added membership_number for metadata match
                    .in('lifter_id', potentialLifterIds)
                    .is('internal_id', null);

                if (!nullError && nullInternalIdCandidates && nullInternalIdCandidates.length >= 1) {
                    // Logic to resolve which candidate to link:
                    // 1. Metadata Match: Does one of them already have the scraped membership number?
                    // 2. Context Match: Does one of them own the result for the CURRENT meet?
                    // 3. Fallback: Arbitrary first one.

                    let bestCandidate = nullInternalIdCandidates[0]; // Default fallback
                    let resolutionMethod = 'Arbitrary (Fallback)';

                    // 1. Metadata Match
                    if (targetAthlete.membershipNumber) {
                        const metaMatch = nullInternalIdCandidates.find(c => c.membership_number === targetAthlete.membershipNumber);
                        if (metaMatch) {
                            bestCandidate = metaMatch;
                            resolutionMethod = `Metadata Match (Mem# ${targetAthlete.membershipNumber})`;
                        }
                    }

                    // 2. Context Match (if no metadata match yet)
                    if (resolutionMethod === 'Arbitrary (Fallback)') {
                        const { data: contextResults } = await supabase
                            .from('usaw_meet_results')
                            .select('lifter_id')
                            .eq('meet_id', targetMeetId)
                            .in('lifter_id', nullInternalIdCandidates.map(c => c.lifter_id));

                        if (contextResults && contextResults.length > 0) {
                            // Link to the lifter who presumably just competed in this meet
                            const participantId = contextResults[0].lifter_id;
                            const contextMatch = nullInternalIdCandidates.find(c => c.lifter_id === participantId);
                            if (contextMatch) {
                                bestCandidate = contextMatch;
                                resolutionMethod = `Context Match (Meet Participation)`;
                            }
                        }
                    }

                    if (nullInternalIdCandidates.length > 1) {
                        console.log(`    ⚠️ Duplicate Resolution: Found ${nullInternalIdCandidates.length} unlinked candidates. Resolved via ${resolutionMethod} -> ID: ${bestCandidate.lifter_id}`);
                    }

                    const lifterId = bestCandidate.lifter_id;
                    console.log(`    🔗 Linking internal_id ${targetAthlete.internalId} to lifter ${lifterId}`);

                    await supabase
                        .from('usaw_lifters')
                        .update({ internal_id: targetAthlete.internalId })
                        .eq('lifter_id', lifterId);

                    // TARGETED UPDATE (Lifter): Save Membership Number if found (SAME AS ABOVE)
                    if (targetAthlete.membershipNumber) {
                        try {
                            const { error: memError } = await supabase.from('usaw_lifters')
                                .update({ membership_number: targetAthlete.membershipNumber })
                                .eq('lifter_id', lifterId);

                            if (!memError) {
                                console.log(`      💾 Saved Membership Number ${targetAthlete.membershipNumber} for lifter ${lifterId}`);
                            }
                        } catch (err) { console.log('      ⚠️ Save Failed (Membership):', err.message); }
                    }

                    return {
                        lifterId: lifterId,
                        scrapedData: targetAthlete
                    };
                }
            }

            // If no potential lifters provided (New Athlete or Test Case), return the scraped match
            if (potentialLifterIds.length === 0) {
                return {
                    lifterId: null,
                    scrapedData: targetAthlete
                };
            }

            // Can't disambiguate - fall back to Tier 2
            console.log(`    ⚠️ Multiple candidates exist (${potentialLifterIds.length}) - proceeding to Tier 2 for disambiguation`);
            return null;
        }

        // TIER 1.6 FALLBACK LOGIC
        // TIER 1.7 MULTI-DIVISION SEARCH
        if (!targetAthlete && !isFallbackCheck && bodyweight) {
            console.log(`    ⚠️ Tier 1 failed. Initiating Extended Search (Tier 1.6 / 1.7) based on bodyweight (${bodyweight}kg)...`);

            const candidates = generateAlternativeDivisions(ageCategory, bodyweight, eventDate);
            console.log(`    📊 Generated ${candidates.length} candidate divisions to search`);

            for (const cand of candidates) {
                // Skip if identical to what we just ran (optimization)
                if (cand.category === ageCategory && cand.weightClass === weightClass) continue;

                // Determine Tier Label
                // Tier 1.6: Same Age, Different Weight
                // Tier 1.7: Different Age (Multi-Division)
                const tierLabel = (cand.category === ageCategory) ? "Tier 1.6" : "Tier 1.7";

                console.log(`    🔍 ${tierLabel}: Checking alternative: ${cand.category} / ${cand.weightClass}...`);

                // Recursively call with new parameters
                const result = await runBase64UrlLookupProtocol(
                    lifterName,
                    potentialLifterIds,
                    targetMeetId,
                    eventDate,
                    cand.category,
                    cand.weightClass,
                    bodyweight,
                    true, // Mark as fallback to prevent infinite recursion
                    expectedTotal
                );

                if (result) {
                    console.log(`    ✅ ${tierLabel} Success: Found athlete in ${cand.category}`);
                    return result; // Return immediately on success
                }
            }
        }

        console.log(`    ❌ Tier 1${isFallbackCheck ? '.6' : ''}: "${lifterName}" not found in division rankings`);
        return null;

    } catch (error) {
        console.log(`    ⚠️ Tier 1 verification failed (technical error): ${error.message}`);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

// Sport80 member URL verification wrapper
async function runSport80MemberUrlVerification(lifterName, potentialLifterIds, targetMeetId, weightClass = null, total = null, snatch = null, cj = null, bodyweight = null) {
    console.log(`    🐞 DEBUG runSport80MemberUrlVerification: name=${lifterName}, ids=${potentialLifterIds}, meet=${targetMeetId}, wc=${weightClass}, tot=${total}, sn=${snatch}, cj=${cj}, bw=${bodyweight}`);
    console.log(`  🔍 Tier 2: Running Sport80 member URL verification for ${potentialLifterIds.length} candidates...`);

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

                // REAL verification: Visit the member page and check if they participated in target meet
                const result = await verifyLifterParticipationInMeet(lifter.internal_id, targetMeetId, lifterName, weightClass, total, snatch, cj, bodyweight);

                if (result.verified) {
                    console.log(`    ✅ CONFIRMED: Using lifter ${lifterId} for meet ${targetMeetId}`);
                    // Also save membership number if found and missing
                    if (result.metadata?.membershipNumber) {
                        const { error: memError } = await supabase
                            .from('usaw_lifters')
                            .update({ membership_number: result.metadata.membershipNumber })
                            .eq('lifter_id', lifterId)
                            .is('membership_number', null); // Only if currently null

                        if (!memError) {
                            console.log(`      💾 Saved Membership Number ${result.metadata.membershipNumber} for lifter ${lifterId}`);
                        }
                    }

                    return {
                        lifterId: lifterId,
                        metadata: result.metadata
                    };
                }
            } else {
                console.log(`    🔍 Lifter ${lifterId} (${lifter.athlete_name}) has no internal_id - attempting Sport80 search...`);

                // NEW: For lifters without internal_ids, search Sport80 to find their internal_id
                const foundInternalId = await searchSport80ForLifter(lifter.athlete_name);

                if (foundInternalId) {
                    console.log(`    🎯 Found internal_id ${foundInternalId} for ${lifter.athlete_name} via Sport80 search`);

                    // Verify this lifter participated in the target meet
                    const result = await verifyLifterParticipationInMeet(foundInternalId, targetMeetId, lifter.athlete_name, weightClass, total, snatch, cj, bodyweight);

                    if (result.verified) {
                        // Update the lifter record with the found internal_id
                        const updatePayload = { internal_id: foundInternalId };
                        if (result.metadata?.membershipNumber) {
                            updatePayload.membership_number = result.metadata.membershipNumber;
                        }

                        const { error: updateError } = await supabase
                            .from('usaw_lifters')
                            .update(updatePayload)
                            .eq('lifter_id', lifterId);

                        if (!updateError) {
                            console.log(`    ✅ CONFIRMED & ENRICHED: Using lifter ${lifterId} for meet ${targetMeetId} (added internal_id ${foundInternalId}${updatePayload.membership_number ? ', Mem#' + updatePayload.membership_number : ''})`);
                        } else {
                            console.log(`    ✅ CONFIRMED: Using lifter ${lifterId} for meet ${targetMeetId} (update failed: ${updateError.message})`);
                        }

                        return {
                            lifterId: lifterId,
                            metadata: result.metadata
                        };
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
        // No existing lifter found - create new one
        logger.log('name_match_none', {
            message: `No existing lifter found, creating new record`,
            athlete_name: cleanName,
            action: 'create_new'
        });
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
            logger.logError(new Error(`Error creating lifter: ${createError.message}`), 'name_match_none');
            throw new Error(`Error creating lifter: ${createError.message}`);
        }

        logger.logFinalResult(newLifter, 'create_new');
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
            additionalData.weightClass,
            additionalData.bodyweight, // Pass bodyweight for Tier 1.6
            false, // isFallbackCheck
            additionalData.expectedTotal, // Pass expectedTotal
            additionalData.expectedSnatch,
            additionalData.expectedCJ
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

        const tier2Result = await runSport80MemberUrlVerification(
            cleanName,
            lifterIds,
            additionalData.targetMeetId,
            additionalData.weightClass,
            additionalData.expectedTotal,
            additionalData.expectedSnatch,
            additionalData.expectedCJ,
            additionalData.bodyweight
        );

        if (tier2Result) {
            // Handle both object return (new) and string return (old)
            const verifiedLifterId = (typeof tier2Result === 'object' && tier2Result.lifterId) ? tier2Result.lifterId : tier2Result;
            const metadata = (typeof tier2Result === 'object') ? tier2Result.metadata : null;

            const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
            logger.logFinalResult(verifiedLifter, 'tier2_verified');
            console.log(`  ✅ Verified lifter: ${cleanName} (ID: ${verifiedLifterId})`);

            // Check if we can improve Tier 1 search using metadata (Tier 1.6 Enhanced Fallback)
            const isUnknownCategory = !additionalData.ageCategory || additionalData.ageCategory === '-' || additionalData.ageCategory === 'Unknown';
            if (metadata && metadata.gender && isUnknownCategory) {
                console.log(`  🔄 Tier 1.6 Enhanced: Metadata extracted from Tier 2 (Gender: ${metadata.gender})`);

                // Construct inferred category
                const inferredCategory = (metadata.gender === 'M') ? "Open Men's" : "Open Women's";
                console.log(`  🔄 Retrying Tier 1 with inferred category: "${inferredCategory}"...`);

                const tier1RetryResult = await runBase64UrlLookupProtocol(
                    cleanName,
                    [verifiedLifterId],
                    additionalData.targetMeetId,
                    additionalData.eventDate,
                    inferredCategory, // Use inferred category
                    additionalData.weightClass,
                    additionalData.bodyweight
                );

                if (tier1RetryResult) {
                    console.log(`  ✅ Tier 1.6 Success: Found athlete with inferred category`);
                    verifiedLifter.scrapedData = tier1RetryResult.scrapedData;
                }
            }

            return verifiedLifter;
        } else {
            // FALLBACK: If verification fails but we have at least one likely match, reuse the first one
            // This handles cases where duplicates already exist - we pick one (usually oldest) instead of creating a new one
            if (lifterIds.length >= 1) {
                const selectedLifter = existingLifters[0];
                logger.log('verification_soft_fail', {
                    message: `Verification failed but ${lifterIds.length} match(es) found - reusing existing record`,
                    lifter_id: selectedLifter.lifter_id,
                    candidates_count: lifterIds.length
                });
                console.log(`  ⚠️ Verification failed but reusing existing matching lifter: ${cleanName} (ID: ${selectedLifter.lifter_id})`);
                return selectedLifter;
            }

            // FALLBACK: Create new lifter if verification fails AND we don't have a clear single candidate
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

    // Multiple matches found - use two-tier verification to disambiguate
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

    // Tier 1: Base64 URL lookup protocol
    logger.log('tier1_verification', {
        message: `Starting Tier 1 verification for disambiguation`,
        candidates_count: lifterIds.length,
        verification_type: 'base64_url_lookup'
    });

    const base64Result = await runBase64UrlLookupProtocol(
        cleanName,
        lifterIds,
        additionalData.targetMeetId,
        additionalData.eventDate,
        additionalData.ageCategory,
        additionalData.weightClass,
        additionalData.bodyweight, // Pass bodyweight for Tier 1.6
        false, // isFallbackCheck
        additionalData.expectedTotal, // Pass expectedTotal
        additionalData.expectedSnatch,
        additionalData.expectedCJ
    );

    if (base64Result) {
        const verifiedLifter = existingLifters.find(l => l.lifter_id === base64Result.lifterId);
        logger.logFinalResult(verifiedLifter, 'tier1_disambiguation');
        console.log(`  ✅ Verified via Tier 1: ${cleanName} (ID: ${base64Result.lifterId})`);
        // Attach scraped data for enrichment
        verifiedLifter.scrapedData = base64Result.scrapedData;
        return verifiedLifter;
    }

    // Tier 2: Sport80 member URL verification (fallback)
    logger.log('tier2_verification', {
        message: `Starting Tier 2 verification for disambiguation`,
        candidates_count: lifterIds.length,
        verification_type: 'sport80_member_url'
    });

    const tier2Result = await runSport80MemberUrlVerification(
        cleanName,
        lifterIds,
        additionalData.targetMeetId,
        additionalData.weightClass,
        additionalData.expectedTotal,
        additionalData.expectedSnatch,
        additionalData.expectedCJ,
        additionalData.bodyweight
    );

    if (tier2Result) {
        // Handle both object return (new) and string return (old)
        const verifiedLifterId = (typeof tier2Result === 'object' && tier2Result.lifterId) ? tier2Result.lifterId : tier2Result;

        const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
        logger.logFinalResult(verifiedLifter, 'tier2_disambiguation');
        console.log(`  ✅ Verified via Tier 2: ${cleanName} (ID: ${verifiedLifterId})`);
        return verifiedLifter;
    }

    // FALLBACK: If we can't disambiguate, reused the first existing lifter record
    // This avoids creating duplicates when we have multiple unverified candidates
    // User preference: Reuse simplistic match over correct-but-duplicate new record
    if (existingLifters.length > 0) {
        const selectedLifter = existingLifters[0];
        logger.log('verification_soft_fail', {
            message: `Disambiguation failed but ${existingLifters.length} match(es) found - reusing first existing record`,
            lifter_id: selectedLifter.lifter_id,
            candidates_count: existingLifters.length,
            reason: 'disambiguation_fallback_reuse'
        });
        console.log(`  ⚠️ Disambiguation failed but reusing existing matching lifter: ${cleanName} (ID: ${selectedLifter.lifter_id})`);
        return selectedLifter;
    }

    // This should theoretically not be reached if lifterIds.length > 1, but safety fallback
    logger.log('fallback_create', {
        message: `Could not disambiguate and no existing lifters found (unexpected), creating new lifter record`,
        reason: 'disambiguation_failed_no_candidates'
    });
    console.log(`  ⚠️ Could not disambiguate lifter "${cleanName}" and no existing candidates - creating new record`);

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

    logger.logFinalResult(newLifter, 'disambiguation_fallback_create');
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
                // HELPER: Safely parse lift values to handle '0' correctly (don't convert to null)
                const parseLiftValue = (val, fieldName) => {
                    if (val === undefined || val === null) return null;
                    const str = String(val).trim();
                    // Fix: Check for 'null' string specifically, but NOT '0'
                    if (str === '' || str === '---' || str.toLowerCase() === 'null') return null;

                    // Debug log for Total field to trace issues
                    if (fieldName === 'Total' && (str === '0' || str === 0)) {
                        console.log(`  🐞 DEBUG: Parsing Total value: "${val}" -> "${str}"`);
                    }

                    // Try to parse as float to return actual number type to Supabase
                    // This ensures "0" string becomes 0 number, preventing any potential "empty string = null" coercion
                    const num = parseFloat(str);
                    if (!isNaN(num)) {
                        return num;
                    }

                    return str;
                };

                const lifterName = String(row?.Lifter || '').trim();

                if (!lifterName) {
                    console.log(`  ⚠️ Skipping row ${index + 1} - missing lifter name`);
                    errorCount++;
                    continue;
                }

                console.log(`\n  🔍 Processing athlete ${index + 1}/${validResults.length}: ${lifterName}`);

                // Find or create lifter with two-tier verification system
                // Pass additional data needed for Tier 1 verification
                const lifter = await findOrCreateLifter(lifterName, {
                    targetMeetId: meetId,
                    eventDate: row.Date?.trim() || null,
                    ageCategory: row['Age Category']?.trim() || null,
                    weightClass: row['Weight Class']?.trim() || null,
                    membership_number: row['Membership Number']?.trim() || null,
                    internal_id: row['Internal_ID'] ? parseInt(row['Internal_ID']) : null,
                    bodyweight: row['Body Weight (Kg)']?.toString().trim() || null,
                    expectedTotal: parseLiftValue(row.Total, 'Total'), // Check for Total match in Tier 1.5
                    expectedSnatch: parseLiftValue(row['Best Snatch'], 'BestSnatch'),
                    expectedCJ: parseLiftValue(row['Best C&J'], 'BestCJ')
                });

                // Create meet result with proper lifter_id
                // Apply scraped data from Tier 1 verification if available
                const resultData = {
                    meet_id: meetId,
                    lifter_id: lifter.lifter_id,
                    meet_name: row.Meet?.trim() || meetName,
                    date: row.Date?.trim() || null,
                    age_category: row['Age Category']?.trim() || null,
                    weight_class: row['Weight Class']?.trim() || 'Unknown',
                    lifter_name: lifterName,
                    body_weight_kg: row['Body Weight (Kg)']?.toString().trim() || null,
                    snatch_lift_1: parseLiftValue(row['Snatch Lift 1'], 'Snatch1'),
                    snatch_lift_2: parseLiftValue(row['Snatch Lift 2'], 'Snatch2'),
                    snatch_lift_3: parseLiftValue(row['Snatch Lift 3'], 'Snatch3'),
                    best_snatch: parseLiftValue(row['Best Snatch'], 'BestSnatch'),
                    cj_lift_1: parseLiftValue(row['C&J Lift 1'], 'CJ1'),
                    cj_lift_2: parseLiftValue(row['C&J Lift 2'], 'CJ2'),
                    cj_lift_3: parseLiftValue(row['C&J Lift 3'], 'CJ3'),
                    best_cj: parseLiftValue(row['Best C&J'], 'BestCJ'),
                    total: parseLiftValue(row.Total, 'Total'),
                    // Enrich with scraped data from Tier 1 if available
                    club_name: lifter.scrapedData?.club || row.Club?.toString().trim() || null,
                    wso: lifter.scrapedData?.wso || null,
                    competition_age: lifter.scrapedData?.lifterAge ? parseInt(lifter.scrapedData.lifterAge) : null,
                    gender: lifter.scrapedData?.gender || null,
                    national_rank: lifter.scrapedData?.nationalRank ? parseInt(lifter.scrapedData.nationalRank) : null
                };

                // Clean up any incomplete results logic removed per user request (update only)

                // --------------------------------------------------------------------------------
                // Check if this result would overwrite an existing one with different data
                const { data: existingConflict } = await supabase
                    .from('usaw_meet_results')
                    .select('result_id, total, body_weight_kg')
                    .eq('meet_id', meetId)
                    .eq('lifter_id', lifter.lifter_id)
                    .eq('weight_class', resultData.weight_class) // Constraint is (meet_id, lifter_id, weight_class)
                    .maybeSingle();

                // if (!existingConflict) console.log(`  🐞 No existing result found for lifter ${lifter.lifter_id}`);
                // if (existingConflict) console.log(`  🐞 Found existing result: Total=${existingConflict.total}`);

                if (existingConflict) {
                    // Helper to normalize totals for comparison (handle 0 vs null vs string mismatch)
                    const normDbTotal = (existingConflict.total === null || existingConflict.total === undefined) ? 'null' : parseFloat(existingConflict.total);
                    const normNewTotal = (resultData.total === null || resultData.total === undefined) ? 'null' : parseFloat(resultData.total);

                    // Strict collision check: Both must be numbers and different (tolerance 0.1)
                    const isTotalConflict = (typeof normDbTotal === 'number' && typeof normNewTotal === 'number' && Math.abs(normDbTotal - normNewTotal) > 0.1);

                    if (isTotalConflict) {
                        console.log(`  ⚠️ COLLISION DETECTED: '${lifterName}' (ID: ${lifter.lifter_id}) has existing result with Total ${normDbTotal}, new is ${normNewTotal}.`);
                        console.log(`  🔄 Attempting to find ALTERNATIVE existing lifter identity...`);

                        // 1. Find other candidates with same name
                        const { data: otherCandidates } = await supabase
                            .from('usaw_lifters')
                            .select('lifter_id, internal_id, membership_number')
                            .eq('athlete_name', lifterName)
                            .neq('lifter_id', lifter.lifter_id); // Exclude the one we collided with

                        let switchedToCandidate = false;

                        if (otherCandidates && otherCandidates.length > 0) {
                            console.log(`  🔎 Found ${otherCandidates.length} potential alternative candidate(s).`);

                            for (const candidate of otherCandidates) {
                                console.log(`    Checking candidate ID: ${candidate.lifter_id} (Internal: ${candidate.internal_id || 'None'})...`);

                                // Check if this candidate ALSO has a conflicting result in this meet
                                const { data: candConflict } = await supabase
                                    .from('usaw_meet_results')
                                    .select('result_id, total')
                                    .eq('meet_id', meetId)
                                    .eq('lifter_id', candidate.lifter_id)
                                    .eq('weight_class', resultData.weight_class)
                                    .maybeSingle();

                                if (candConflict) {
                                    const normCandTotal = (candConflict.total === null || candConflict.total === undefined) ? 'null' : parseFloat(candConflict.total);
                                    if (typeof normNewTotal === 'number' && typeof normCandTotal === 'number' && Math.abs(normCandTotal - normNewTotal) > 0.1) {
                                        console.log(`    ❌ Candidate ${candidate.lifter_id} ALSO has a conflicting result (Total: ${normCandTotal}). Skipping.`);
                                        continue;
                                    }
                                    // If match, we can merge/update this candidate. Ideally verify first.
                                }

                                // Verify participation if possible
                                if (candidate.internal_id) {
                                    // Run verification
                                    const verification = await verifyLifterParticipationInMeet(candidate.internal_id, meetId, lifterName, null, parseFloat(resultData.total));
                                    if (verification.verified) {
                                        console.log(`    ✅ Candidate ${candidate.lifter_id} VERIFIED via Sport80 history! Switching identity.`);
                                        resultData.lifter_id = candidate.lifter_id;
                                        // Also use their info for enrichment
                                        if (verification.metadata?.membershipNumber) {
                                            resultData.membership_number = verification.metadata.membershipNumber;
                                        }

                                        // --------------------------------------------------------------------------------
                                        // NEW: Run Tier 1 Verification to get full metadata (Club, WSO, etc.) for this candidate
                                        // --------------------------------------------------------------------------------
                                        console.log(`    🔄 runBase64UrlLookupProtocol for metadata enrichment on candidate...`);
                                        try {
                                            const tier1Data = await runBase64UrlLookupProtocol(
                                                lifterName,
                                                [candidate.lifter_id],
                                                meetId,
                                                row.Date || resultData.date,
                                                row['Age Category'] || resultData.age_category,
                                                row['Weight Class'] || resultData.weight_class,
                                                row['Body Weight (Kg)'] || resultData.body_weight_kg,
                                                false, // isFallbackCheck
                                                parseFloat(resultData.total) // expectedTotal
                                            );

                                            if (tier1Data && tier1Data.scrapedData) {
                                                console.log(`    ✅ Tier 1 Enrichment Successful for candidate ${candidate.lifter_id}`);
                                                // Enrich resultData
                                                if (tier1Data.scrapedData.club) resultData.club_name = tier1Data.scrapedData.club;
                                                if (tier1Data.scrapedData.wso) resultData.wso = tier1Data.scrapedData.wso;
                                                if (tier1Data.scrapedData.gender) resultData.gender = tier1Data.scrapedData.gender;
                                                if (tier1Data.scrapedData.lifterAge) resultData.competition_age = parseInt(tier1Data.scrapedData.lifterAge);
                                                if (tier1Data.scrapedData.nationalRank) resultData.national_rank = parseInt(tier1Data.scrapedData.nationalRank);
                                            } else {
                                                console.log(`    ℹ️  Tier 1 lookup returned no data (likely not in rankings for this specific class/date).`);
                                            }
                                        } catch (err) {
                                            console.log(`    ⚠️ Tier 1 Enrichment Failed: ${err.message}`);
                                        }
                                        // --------------------------------------------------------------------------------

                                        switchedToCandidate = true;
                                        break; // Found our guy
                                    } else {
                                        console.log(`    ⚠️ Candidate ${candidate.lifter_id} not found in meet history.`);
                                    }
                                } else {
                                    console.log(`    ⚠️ Candidate ${candidate.lifter_id} has no internal_id, cannot verify deeply. Skipping conservative match.`);
                                    // In theory we could assume it's him if he has no other result, but risky.
                                }
                            }
                        }

                        if (!switchedToCandidate) {
                            console.log(`  🔄 No suitable existing candidate found/verified. Branching Identity: Creating NEW lifter record...`);

                            // Create a BRAND NEW lifter record for this second person
                            const { data: splitLifter, error: splitError } = await supabase
                                .from('usaw_lifters')
                                .insert({
                                    athlete_name: lifterName,
                                    membership_number: row['Membership Number']?.trim() || null,
                                    internal_id: row['Internal_ID'] ? parseInt(row['Internal_ID']) : null
                                })
                                .select()
                                .single();

                            if (!splitError && splitLifter) {
                                console.log(`  ✅ Branching Successful: Created Lifter ID ${splitLifter.lifter_id} for the second '${lifterName}'`);
                                resultData.lifter_id = splitLifter.lifter_id;
                            } else {
                                console.error(`  ❌ Branching Failed: ${splitError?.message}`);
                            }
                        }
                    }
                }
                // --------------------------------------------------------------------------------

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
    findOrCreateLifter,
    runBase64UrlLookupProtocol
};
