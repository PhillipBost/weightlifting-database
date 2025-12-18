// Load environment variables from .env file
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// =================================================================
// SURGICAL STRIKE WSO SCRAPER
// Targets meet results missing WSO data
// Exhaustively searches all gender-relevant divisions with ±5 day window
// =================================================================

const CONFIG = {
    // Environment configuration
    START_DATE: process.env.START_DATE || null,  // YYYY-MM-DD
    END_DATE: process.env.END_DATE || null,      // YYYY-MM-DD
    GENDER_FILTER: process.env.GENDER_FILTER || null, // 'M' or 'F'
    MAX_RESULTS: process.env.MAX_RESULTS ? parseInt(process.env.MAX_RESULTS) : null,
    DRY_RUN: process.env.DRY_RUN === 'true',

    // Scraping settings
    HEADLESS: true,
    DATE_WINDOW_DAYS: 5, // ±5 days around result date

    // Paths
    UNRESOLVED_PATH: path.join(__dirname, '../../logs/surgical-strike-wso-unresolved.json'),
    UPDATES_LOG_PATH: path.join(__dirname, `../../logs/surgical-strike-wso-updates-${new Date().toISOString().split('T')[0]}.csv`),
    DIVISION_CODES_PATH: path.join(__dirname, '../../division_base64_codes.json')
};

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// ========================================
// UTILITY FUNCTIONS
// ========================================

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

// ========================================
// SKIP LIST MANAGEMENT
// ========================================

function loadUnresolvedList() {
    if (fs.existsSync(CONFIG.UNRESOLVED_PATH)) {
        try {
            const data = fs.readFileSync(CONFIG.UNRESOLVED_PATH, 'utf8');
            const unresolvedList = JSON.parse(data);
            console.log(`📋 Loaded ${unresolvedList.length} unresolved results from skip list`);
            console.log(`   File: ${CONFIG.UNRESOLVED_PATH}`);
            return new Set(unresolvedList.map(r => r.result_id));
        } catch (error) {
            console.warn(`⚠️  Failed to load unresolved list: ${error.message}`);
            return new Set();
        }
    }
    console.log(`📋 No existing unresolved list found`);
    console.log(`   Expected path: ${CONFIG.UNRESOLVED_PATH}`);
    return new Set();
}

function saveUnresolvedResult(unresolvedResult) {
    if (CONFIG.DRY_RUN) return; // Don't save in dry run mode

    ensureDirectoryExists(path.dirname(CONFIG.UNRESOLVED_PATH));

    // Load existing
    let existing = [];
    if (fs.existsSync(CONFIG.UNRESOLVED_PATH)) {
        try {
            existing = JSON.parse(fs.readFileSync(CONFIG.UNRESOLVED_PATH, 'utf8'));
        } catch (error) {
            console.warn(`⚠️  Failed to load existing unresolved list: ${error.message}`);
        }
    }

    // Check if this result is already in the list
    const existingIds = new Set(existing.map(r => r.result_id));
    if (existingIds.has(unresolvedResult.result_id)) {
        return; // Already saved
    }

    // Add the new result
    existing.push(unresolvedResult);

    fs.writeFileSync(CONFIG.UNRESOLVED_PATH, JSON.stringify(existing, null, 2));
    console.log(`💾 Saved unresolved result ${unresolvedResult.result_id} to skip list (total: ${existing.length})`);
}

function saveUnresolvedList(unresolvedResults) {
    ensureDirectoryExists(path.dirname(CONFIG.UNRESOLVED_PATH));

    // Load existing and merge with new
    let existing = [];
    if (fs.existsSync(CONFIG.UNRESOLVED_PATH)) {
        try {
            existing = JSON.parse(fs.readFileSync(CONFIG.UNRESOLVED_PATH, 'utf8'));
        } catch (error) {
            console.warn(`⚠️  Failed to load existing unresolved list: ${error.message}`);
        }
    }

    // Merge: keep existing, add new ones
    const existingIds = new Set(existing.map(r => r.result_id));
    const newEntries = unresolvedResults.filter(r => !existingIds.has(r.result_id));
    const merged = [...existing, ...newEntries];

    fs.writeFileSync(CONFIG.UNRESOLVED_PATH, JSON.stringify(merged, null, 2));
    console.log(`💾 Saved ${newEntries.length} new unresolved results to skip list (total: ${merged.length})`);
}

// ========================================
// DIVISION FILTERING
// ========================================

function getDivisionGender(divisionName) {
    if (!divisionName) return null;

    const lower = divisionName.toLowerCase();

    // Check women first (contains "women" substring)
    if (lower.includes("women")) {
        return 'F';
    }
    // Then check men (but exclude women's divisions)
    else if (lower.includes("men") && !lower.includes("women")) {
        return 'M';
    }

    return null;
}

function loadAndFilterDivisions(targetGender) {
    console.log(`\n📖 Loading division codes...`);

    if (!fs.existsSync(CONFIG.DIVISION_CODES_PATH)) {
        throw new Error(`Division codes file not found: ${CONFIG.DIVISION_CODES_PATH}`);
    }

    const divisionData = JSON.parse(fs.readFileSync(CONFIG.DIVISION_CODES_PATH, 'utf8'));
    const allDivisions = divisionData.division_codes;

    console.log(`   Total divisions in file: ${Object.keys(allDivisions).length}`);

    if (!targetGender) {
        console.log(`   No gender filter applied - using all divisions`);
        return allDivisions;
    }

    // Filter by gender
    const filtered = {};
    for (const [divisionName, code] of Object.entries(allDivisions)) {
        const gender = getDivisionGender(divisionName);
        if (gender === targetGender) {
            filtered[divisionName] = code;
        }
    }

    const genderLabel = targetGender === 'M' ? "Men's" : "Women's";
    console.log(`   Filtered to ${Object.keys(filtered).length} ${genderLabel} divisions`);

    return filtered;
}

// ========================================
// DATABASE QUERIES
// ========================================

async function queryIncompleteResults(skipList) {
    console.log(`\n🔍 Querying database for results missing WSO...`);

    let query = supabase
        .from('usaw_meet_results')
        .select('result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, competition_age, wso, club_name, total')
        .is('wso', null)
        .filter('total', 'gt', '0')  // Filter as text comparison since total is stored as text
        .not('age_category', 'is', null)
        .not('weight_class', 'is', null)
        .not('meet_id', 'is', null);

    // Apply date filters
    if (CONFIG.START_DATE) {
        query = query.gte('date', CONFIG.START_DATE);
        console.log(`   Filtering: date >= ${CONFIG.START_DATE}`);
    }
    if (CONFIG.END_DATE) {
        query = query.lte('date', CONFIG.END_DATE);
        console.log(`   Filtering: date <= ${CONFIG.END_DATE}`);
    }

    // Apply gender filter (only if specified, allow NULL genders through otherwise)
    if (CONFIG.GENDER_FILTER) {
        query = query.eq('gender', CONFIG.GENDER_FILTER);
        const genderLabel = CONFIG.GENDER_FILTER === 'M' ? 'Male' : 'Female';
        console.log(`   Filtering: gender = ${genderLabel}`);
    } else {
        console.log(`   No gender filter - including results with NULL gender`);
    }

    // Apply result limit
    if (CONFIG.MAX_RESULTS) {
        query = query.limit(CONFIG.MAX_RESULTS);
        console.log(`   Limiting to ${CONFIG.MAX_RESULTS} results`);
    }

    const { data, error } = await query;

    if (error) {
        throw new Error(`Database query failed: ${error.message}`);
    }

    console.log(`   Found ${data.length} results missing WSO`);

    // Get unique meet_ids to fetch correct dates from usaw_meets
    const meetIds = [...new Set(data.map(r => r.meet_id))];
    console.log(`   Fetching dates for ${meetIds.length} unique meets...`);

    // Query usaw_meets for the correct dates in batches (to avoid URI too long error)
    const BATCH_SIZE = 100;
    const allMeets = [];

    for (let i = 0; i < meetIds.length; i += BATCH_SIZE) {
        const batch = meetIds.slice(i, i + BATCH_SIZE);
        const { data: meets, error: meetsError } = await supabase
            .from('usaw_meets')
            .select('meet_id, Date')
            .in('meet_id', batch);

        if (meetsError) {
            throw new Error(`Failed to fetch meet dates (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${meetsError.message}`);
        }

        allMeets.push(...meets);
    }

    console.log(`   Fetched ${allMeets.length} meet dates`);

    // Create a map of meet_id -> date
    const meetDates = new Map(allMeets.map(m => [m.meet_id, m.Date]));

    // Add correct meet dates to results and sort by date
    const resultsWithDates = data.map(result => ({
        ...result,
        date: meetDates.get(result.meet_id) || null
    })).sort((a, b) => {
        // Sort by date ascending (oldest first)
        const dateA = new Date(a.date || '9999-12-31');
        const dateB = new Date(b.date || '9999-12-31');
        return dateA - dateB;
    });

    // Filter out results in skip list
    const filtered = resultsWithDates.filter(r => !skipList.has(r.result_id));
    const skipped = resultsWithDates.length - filtered.length;

    if (skipped > 0) {
        console.log(`   Skipped ${skipped} results from unresolved list`);
    }
    console.log(`   Processing ${filtered.length} results`);

    return filtered;
}

// ========================================
// URL BUILDING
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

// ========================================
// ATHLETE DATE SCRAPING
// ========================================

async function scrapeAthleteSpecificDate(page, meetId, lifterName) {
    try {
        const url = `https://usaweightlifting.sport80.com/public/rankings/results/${meetId}`;

        console.log(`\n📅 Scraping athlete date from official results: ${url}`);

        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for page to populate
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Get meet name from the page
        const meetName = await page.evaluate(() => {
            // Try to find meet name in various common locations
            const h1 = document.querySelector('h1');
            const h2 = document.querySelector('h2');
            const title = document.querySelector('.meet-title, .event-title, .competition-title');
            
            if (title) return title.textContent.trim();
            if (h1) return h1.textContent.trim();
            if (h2) return h2.textContent.trim();
            return 'Unknown Meet';
        });

        console.log(`   Meet: ${meetName}`);

        // Search through all pages for the athlete
        let hasMorePages = true;
        let currentPage = 1;

        while (hasMorePages) {
            const athleteData = await page.evaluate((targetName) => {
                // Dynamic Column Mapping - similar to division scraper
                const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                    .map(th => th.textContent.trim().toLowerCase());

                // Map athlete name and date columns
                const athleteNameIdx = headers.findIndex(h =>
                    h.includes('athlete') || h.includes('lifter') || h.includes('name')
                );
                const dateIdx = headers.findIndex(h => h.includes('date'));

                // Fallback indices if headers not found
                const nameIdx = athleteNameIdx !== -1 ? athleteNameIdx : 1; // Usually column 1
                const dateColIdx = dateIdx !== -1 ? dateIdx : 3; // Usually column 3

                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));

                for (const row of rows) {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length > Math.max(nameIdx, dateColIdx)) {
                        const athleteName = cells[nameIdx]?.textContent?.trim() || '';
                        const athleteDate = cells[dateColIdx]?.textContent?.trim() || '';

                        if (athleteName === targetName && athleteDate) {
                            return {
                                name: athleteName,
                                date: athleteDate
                            };
                        }
                    }
                }

                return null; // Athlete not found on this page
            }, lifterName);

            if (athleteData) {
                console.log(`   ✅ Found athlete date: ${athleteData.date} (page ${currentPage})`);
                return athleteData.date;
            }

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

        console.log(`   ❌ Athlete "${lifterName}" not found in meet results (searched ${currentPage} page${currentPage > 1 ? 's' : ''})`);
        return null;

    } catch (error) {
        console.error(`   ❌ Error scraping athlete date: ${error.message}`);
        return null;
    }
}

// ========================================
// SCRAPING LOGIC
// ========================================

/**
 * Scrape division rankings with automatic date-range splitting if the dataset is too large
 * When the website crashes due to too much data, this function splits the date range
 * and tries smaller chunks, prioritizing earlier dates.
 */
async function scrapeDivisionRankingsWithSplitting(page, divisionName, divisionCode, startDate, endDate, lifterName, depth = 0) {
    const maxDepth = 3; // Maximum split depth (splits into 2^3 = 8 chunks max)
    const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    
    try {
        // Try scraping with the current date range
        const athletes = await scrapeDivisionRankings(page, divisionName, divisionCode, startDate, endDate, lifterName);
        
        // Check if we got suspiciously few results for a large date range
        // ONLY check when NOT filtering by name (if filtering by name, 0 results is legitimate)
        // If the range is > 365 days and we got 0 athletes WITHOUT name filtering, the API likely crashed
        if (!lifterName && athletes.length === 0 && daysDiff > 365 && depth < maxDepth) {
            console.log(`      ⚠️ 0 athletes in ${daysDiff}-day range - likely API failure. Splitting...`);
            throw new Error('Suspected API failure - empty results on large range');
        }
        
        return athletes;
    } catch (error) {
        // If we hit max depth or the date range is too small to split, return empty
        if (depth >= maxDepth || daysDiff <= 1) {
            console.log(`      ⚠️ Failed to load data (depth ${depth}, ${daysDiff} days). Skipping this range.`);
            return [];
        }
        
        // Split the date range in half
        console.log(`      📅 Splitting ${daysDiff}-day range into smaller chunks...`);
        const midpoint = new Date((startDate.getTime() + endDate.getTime()) / 2);
        
        const earlierUrl = buildRankingsURL(divisionCode, startDate, midpoint);
        const laterUrl = buildRankingsURL(divisionCode, midpoint, endDate);
        
        console.log(`      Earlier: ${formatDate(startDate)} to ${formatDate(midpoint)}`);
        console.log(`         URL: ${earlierUrl}`);
        console.log(`      Later: ${formatDate(midpoint)} to ${formatDate(endDate)}`);
        console.log(`         URL: ${laterUrl}`);
        
        // Try earlier period first (most important - prioritize early dates)
        const earlierAthletes = await scrapeDivisionRankingsWithSplitting(
            page, divisionName, divisionCode, startDate, midpoint, lifterName, depth + 1
        );
        
        // If we found the athlete in the earlier period, STOP - don't search later periods
        // This ensures we get the EARLIEST match
        if (lifterName && earlierAthletes.length > 0) {
            console.log(`      ✅ Found athlete in earlier period - skipping later period`);
            return earlierAthletes;
        }
        
        // Only try later period if athlete NOT found in earlier period
        const laterAthletes = await scrapeDivisionRankingsWithSplitting(
            page, divisionName, divisionCode, midpoint, endDate, lifterName, depth + 1
        );
        
        // When NOT filtering by name, combine all results
        if (!lifterName) {
            const allAthletes = [...earlierAthletes, ...laterAthletes];
            const seen = new Set();
            return allAthletes.filter(athlete => {
                const key = `${athlete.athleteName}-${athlete.liftDate}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
        
        // When filtering by name, return whichever period found the athlete
        return laterAthletes; // Earlier was empty, so return later results
    }
}

async function scrapeDivisionRankings(page, divisionName, divisionCode, startDate, endDate, lifterName) {
    try {
        const url = buildRankingsURL(divisionCode, startDate, endDate);

        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for table to actually load (wait for rows to appear)
        // If this fails, it likely means the dataset is too large and the API crashed
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        // Give Vue.js time to finish rendering
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get initial results count before filtering
        const initialStats = await page.evaluate(() => {
            const totalText = document.querySelector('.v-data-footer__pagination')?.textContent || '';
            const match = totalText.match(/of (\d+)/);
            const totalResults = match ? parseInt(match[1]) : null;
            const visibleRows = document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
            return { totalResults, visibleRows };
        });
        
        if (initialStats.totalResults) {
            console.log(`      Loaded ${initialStats.totalResults} total results (${initialStats.visibleRows} visible on page 1)`);
        }

        // Input athlete name into search field to filter results
        try {
            await page.waitForSelector('.v-text-field input', { timeout: 5000 });
            // Clear the search field first
            await page.evaluate(() => {
                const searchInput = document.querySelector('.v-text-field input');
                searchInput.value = '';
                searchInput.focus();
            });
            // Type the athlete name
            await page.type('.v-text-field input', lifterName);
            
            // Wait for Vue.js filtering by detecting row count changes
            console.log(`      Filtering for athlete: "${lifterName}"...`);
            
            const initialRowCount = await page.evaluate(() => {
                return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
            });
            
            const checkInterval = 200; // Check every 200ms for responsiveness
            const maxIterations = 200; // 40 second timeout (handles slow networks)
            const stabilityChecks = 10; // Must be stable for 2s (10 × 200ms)
            
            let firstChangeDetected = false;
            let previousCount = initialRowCount;
            let stableCount = 0;
            let iterationOfFirstChange = null;
            
            for (let i = 0; i < maxIterations; i++) {
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                
                const currentCount = await page.evaluate(() => {
                    return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
                });
                
                // Detect when filtering changes the row count
                if (!firstChangeDetected && currentCount !== initialRowCount) {
                    firstChangeDetected = true;
                    iterationOfFirstChange = i;
                    console.log(`      Filtering detected at ${((i + 1) * checkInterval / 1000).toFixed(1)}s (${initialRowCount} → ${currentCount} rows)`);
                }
                
                // Once changed, watch for stability
                if (firstChangeDetected) {
                    if (currentCount === previousCount) {
                        stableCount++;
                        if (stableCount >= stabilityChecks) {
                            const totalTime = ((i + 1) * checkInterval / 1000).toFixed(1);
                            console.log(`      Table stable after ${totalTime}s`);
                            break;
                        }
                    } else {
                        stableCount = 0;
                    }
                }
                
                previousCount = currentCount;
            }
            
            // Give extra buffer for rendering
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (searchError) {
            console.log(`      ⚠️  Search field not found or failed, continuing with unfiltered results`);
        }

        // Verify search filter is still applied before extraction
        const searchStatus = await page.evaluate(() => {
            const searchInput = document.querySelector('.v-text-field input');
            return {
                exists: !!searchInput,
                value: searchInput?.value || '',
                rowCount: document.querySelectorAll('.v-data-table__wrapper tbody tr').length
            };
        });
        
        console.log(`      Search field value: "${searchStatus.value}" (${searchStatus.rowCount} rows visible)`);
        
        // If search was cleared, re-apply it
        if (lifterName && searchStatus.exists && searchStatus.value !== lifterName) {
            console.log(`      ⚠️ Search was cleared! Re-applying filter...`);
            await page.evaluate((name) => {
                const searchInput = document.querySelector('.v-text-field input');
                searchInput.value = name;
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            }, lifterName);
            
            // Wait for filter to apply again
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Check final row count before extraction
        const finalStatus = await page.evaluate(() => {
            const rowCount = document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
            const firstRow = document.querySelector('.v-data-table__wrapper tbody tr');
            let isEmptyState = false;
            
            if (firstRow && rowCount === 1) {
                const firstCell = firstRow.querySelector('td');
                const text = firstCell?.textContent?.trim() || '';
                isEmptyState = text.toLowerCase().includes('please select');
            }
            
            return { rowCount, isEmptyState };
        });
        
        if (finalStatus.isEmptyState) {
            console.log(`      ℹ️  No results found for athlete "${lifterName}" in this division/date range (0 matches)`);
            return [];
        }
        
        console.log(`      Extracting from ${finalStatus.rowCount} table row(s)...`);

        // Extract athletes from results (EXACT SAME LOGIC as nightly-division-scraper.js)
        let allAthletes = [];
        let hasMorePages = true;
        let currentPage = 1;

        while (hasMorePages) {
            const pageAthletes = await page.evaluate(() => {
                // Dynamic Column Mapping
                const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                    .map(th => th.textContent.trim().toLowerCase());

                // Map required fields to column indices
                // Prefer an explicit "lifter age" column; avoid "age category" contamination
                const lifterAgeIdx = (() => {
                    const lifterAge = headers.findIndex(h => h.includes('lifter') && h.includes('age'));
                    if (lifterAge !== -1) return lifterAge;

                    const compAge = headers.findIndex(h => h.includes('comp') && h.includes('age') && !h.includes('category'));
                    if (compAge !== -1) return compAge;

                    const ageOnly = headers.findIndex(h => h.includes('age') && !h.includes('category'));
                    return ageOnly; // may be -1 if no usable age column exists
                })();

                const colMap = {
                    nationalRank: headers.findIndex(h => h.includes('rank')),
                    athleteName: headers.findIndex(h => h.includes('athlete') || h.includes('lifter') && !h.includes('age')),
                    total: headers.findIndex(h => h.includes('total')),
                    gender: headers.findIndex(h => h.includes('gender')),
                    lifterAge: lifterAgeIdx,
                    club: headers.findIndex(h => h.includes('club') || h.includes('team')),
                    membershipId: headers.findIndex(h => h.includes('member') || h.includes('id')),
                    liftDate: headers.findIndex(h => h.includes('date')),
                    wso: headers.findIndex(h => h.includes('wso') || h.includes('lws') || h.includes('state'))
                };

                // Fallback to hardcoded indices if headers aren't found (backward compatibility)
                if (colMap.athleteName === -1) colMap.athleteName = 3;
                if (colMap.total === -1) colMap.total = 2;
                if (colMap.gender === -1) colMap.gender = 4;
                if (colMap.club === -1) colMap.club = 6;
                if (colMap.membershipId === -1) colMap.membershipId = 7;
                if (colMap.liftDate === -1) colMap.liftDate = 9;
                if (colMap.wso === -1) colMap.wso = 12;
                if (colMap.nationalRank === -1) colMap.nationalRank = 0;

                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                
                // Debug: Return raw row data for troubleshooting
                const debugInfo = {
                    rowCount: rows.length,
                    headers: headers,
                    colMap: colMap,
                    firstRowCells: rows.length > 0 ? Array.from(rows[0].querySelectorAll('td')).map(c => c.textContent?.trim() || '') : []
                };
                
                const athletes = rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const cellTexts = cells.map(cell => cell.textContent?.trim() || '');

                    if (cellTexts.length < 5) return null; // Basic validation

                    const rawAge = colMap.lifterAge > -1 ? cellTexts[colMap.lifterAge] : '';
                    const numericAge = rawAge.match(/\d{1,3}/)?.[0] || '';

                    return {
                        athleteName: colMap.athleteName > -1 ? cellTexts[colMap.athleteName] : '',
                        lifterAge: numericAge,
                        club: colMap.club > -1 ? cellTexts[colMap.club] : '',
                        liftDate: colMap.liftDate > -1 ? cellTexts[colMap.liftDate] : '',
                        wso: colMap.wso > -1 ? cellTexts[colMap.wso] : '',
                        gender: colMap.gender > -1 ? cellTexts[colMap.gender] : ''
                    };
                }).filter(a => a && a.athleteName);
                
                return { athletes, debugInfo };
            });

            // Log debug info if extraction failed but rows exist
            if (pageAthletes.athletes.length === 0 && pageAthletes.debugInfo.rowCount > 0) {
                const debug = pageAthletes.debugInfo;
                console.log(`      ⚠️ Extraction found ${debug.rowCount} row(s) but 0 athletes with names`);
                console.log(`      Headers: ${debug.headers.join(', ')}`);
                console.log(`      Athlete name column index: ${debug.colMap.athleteName}`);
                console.log(`      First row data: ${JSON.stringify(debug.firstRowCells)}`);
            }

            allAthletes = allAthletes.concat(pageAthletes.athletes);

            if (pageAthletes.athletes.length > 0) {
                console.log(`      Page ${currentPage}: Extracted ${pageAthletes.athletes.length} athlete(s)`);
            }

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

        return allAthletes;

    } catch (error) {
        // Re-throw timeout and network errors so the splitting function can handle them
        // These indicate the dataset is too large or the API is struggling
        if (error.message.includes('timeout') || 
            error.message.includes('Navigation') ||
            error.message.includes('net::ERR') ||
            error.message.includes('ERR_FAILED') ||
            error.message.includes('empty state') ||
            error.message.includes('API likely failed')) {
            console.error(`      ⚠️ Dataset too large or API failed: ${error.message}`);
            throw error; // Let the splitting function handle this
        }
        
        // For other errors, log and return empty
        console.error(`      ❌ Error scraping division: ${error.message}`);
        return [];
    }
}

// ========================================
// MATCHING AND UPDATING
// ========================================

function extractWeightValue(weightClass) {
    // Extract numeric value from weight class (e.g., "88kg" -> 88, "110+kg" -> 110)
    const match = weightClass.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

function getGenderFromAgeCategory(ageCategory) {
    // Infer gender from age category
    const lower = ageCategory.toLowerCase();
    if (lower.includes("women")) return 'F';
    if (lower.includes("men") && !lower.includes("women")) return 'M';
    return null;
}

function smartSortDivisions(divisions, result) {
    // Construct expected division name from age_category and weight_class
    const expectedDivision = `${result.age_category} ${result.weight_class}`;
    const expectedInactive = `(Inactive) ${expectedDivision}`;

    // Extract context clues
    const targetWeight = extractWeightValue(result.weight_class);
    const inferredGender = result.gender || getGenderFromAgeCategory(result.age_category);

    const divisionEntries = Object.entries(divisions);

    // Categorize divisions
    const exactMatch = [];
    const inactiveMatch = [];
    const sameGenderSameAge = [];
    const sameGenderNearWeight = [];
    const sameGender = [];
    const oppositeGender = [];

    for (const [name, code] of divisionEntries) {
        // Skip exact matches (handled separately)
        if (name === expectedDivision) {
            exactMatch.push([name, code]);
            continue;
        }
        if (name === expectedInactive) {
            inactiveMatch.push([name, code]);
            continue;
        }

        // Determine division gender
        const divisionGender = getDivisionGender(name);

        // Categorize by gender
        if (divisionGender === inferredGender) {
            // Same gender - further categorize

            // Check if same age category
            const divisionAgeCategory = name.replace(/\s+\d+\+?\s*kg$/i, '').trim();
            const resultAgeCategory = result.age_category.trim();

            if (divisionAgeCategory === resultAgeCategory) {
                sameGenderSameAge.push([name, code]);
            } else {
                // Check weight proximity
                const divisionWeight = extractWeightValue(name);
                const weightDiff = Math.abs(divisionWeight - targetWeight);

                if (weightDiff <= 15) { // Within 15kg
                    sameGenderNearWeight.push([name, code, weightDiff]);
                } else {
                    sameGender.push([name, code]);
                }
            }
        } else {
            oppositeGender.push([name, code]);
        }
    }

    // Sort near-weight divisions by weight proximity
    sameGenderNearWeight.sort((a, b) => a[2] - b[2]);
    const sortedNearWeight = sameGenderNearWeight.map(([name, code]) => [name, code]);

    // Combine in priority order
    return [
        ...exactMatch,
        ...inactiveMatch,
        ...sameGenderSameAge,
        ...sortedNearWeight,
        ...sameGender,
        ...oppositeGender
    ];
}

async function findAndUpdateResult(page, result, divisions, stats) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🎯 Processing result_id ${result.result_id}: ${result.lifter_name}`);
    console.log(`${'='.repeat(70)}`);

    // Display what we know
    console.log(`\n📊 CURRENT DATA:`);
    console.log(`   Lifter ID: ${result.lifter_id}`);
    console.log(`   Lifter Name: ${result.lifter_name}`);
    console.log(`   Meet Date: ${result.date}`);
    console.log(`   Meet ID: ${result.meet_id}`);
    console.log(`   Gender: ${result.gender === 'M' ? 'Male' : result.gender === 'F' ? 'Female' : result.gender || '❌ MISSING'}`);
    console.log(`   Age Category: ${result.age_category}`);
    console.log(`   Weight Class: ${result.weight_class}`);
    console.log(`   Total: ${result.total}kg`);
    console.log(`   Competition Age: ${result.competition_age || '❌ MISSING'}`);
    console.log(`   WSO: ${result.wso || '❌ MISSING'}`);
    console.log(`   Club: ${result.club_name || '❌ MISSING'}`);

    // First, scrape the athlete's specific date from the official results page
    const athleteSpecificDateStr = await scrapeAthleteSpecificDate(page, result.meet_id, result.lifter_name);
    const meetDate = new Date(result.date);

    if (athleteSpecificDateStr) {
        console.log(`\n📅 Athlete-specific date: ${athleteSpecificDateStr}`);
    }
    console.log(`📅 Meet date on file: ${result.date}`);

    // Find the athlete's specific division
    const athleteDivisionName = `${result.age_category} ${result.weight_class}`;
    let athleteDivisionCode;
    
    // Determine if division is active or inactive based on meet date (already declared above)
    const activeDivisionCutoff = new Date('2025-06-01');
    const isActiveDivision = meetDate >= activeDivisionCutoff;
    
    if (isActiveDivision) {
        // June 1, 2025 or later - use active division
        athleteDivisionCode = divisions[athleteDivisionName];
    } else {
        // Before June 1, 2025 - use inactive division
        const inactiveName = `(Inactive) ${athleteDivisionName}`;
        athleteDivisionCode = divisions[inactiveName];
        if (athleteDivisionCode) {
            console.log(`\n🏷️  Athlete's Division: ${inactiveName} (code: ${athleteDivisionCode}) [Pre-June 2025]`);
        }
    }
    
    // If still not found, try the opposite
    if (!athleteDivisionCode) {
        if (isActiveDivision) {
            const inactiveName = `(Inactive) ${athleteDivisionName}`;
            athleteDivisionCode = divisions[inactiveName];
        } else {
            athleteDivisionCode = divisions[athleteDivisionName];
        }
    }
    
    if (athleteDivisionCode && isActiveDivision) {
        console.log(`\n🏷️  Athlete's Division: ${athleteDivisionName} (code: ${athleteDivisionCode})`);
    }

    if (!athleteDivisionCode) {
        console.log(`\n❌ Could not find division code for: ${athleteDivisionName}`);
        stats.unresolved++;

        // Save unresolved result immediately
        saveUnresolvedResult({
            result_id: result.result_id,
            lifter_name: result.lifter_name,
            date: result.date,
            gender: result.gender,
            age_category: result.age_category,
            weight_class: result.weight_class,
            timestamp: new Date().toISOString(),
            divisions_searched: Object.keys(divisions).length
        });

        return false;
    }

    // THREE-STEP FALLBACK STRATEGY
    let matchFound = false;
    let stepUsed = 0;
    let divisionsSearched = 0;

    // ========================================
    // STEP 1: Exact Division + Meet Date
    // ========================================
    console.log(`\n🔍 STEP 1: Exact Division + Meet Date`);
    const step1StartDate = addDays(meetDate, -5);
    const step1EndDate = addDays(meetDate, 5);
    console.log(`   Date Range: ${formatDate(step1StartDate)} to ${formatDate(step1EndDate)} (±5 days around meet date)`);

    const step1Url = buildRankingsURL(athleteDivisionCode, step1StartDate, step1EndDate);
    console.log(`   URL: ${step1Url}`);

    // Scrape without name filter to get all athletes
    const step1Athletes = await scrapeDivisionRankingsWithSplitting(page, athleteDivisionName, athleteDivisionCode, step1StartDate, step1EndDate, null);
    divisionsSearched++;
    console.log(`   Found ${step1Athletes.length} athletes`);

    // Check for multi-athlete updates
    const step1Matches = await findAthleteMatchesInScrapedData(step1Athletes, result, step1StartDate, step1EndDate);
    if (step1Matches.length > 0) {
        console.log(`\n   📊 Processing ${step1Matches.length} additional athletes from this division...`);
        await batchUpdateAthletes(step1Matches, athleteDivisionName, divisionsSearched, stats);
    }

    // Check if target athlete was found
    const targetAthlete = step1Athletes.find(a => a.athleteName === result.lifter_name);
    if (targetAthlete) {
        console.log(`\n   ✅ ✅ ✅ MATCH FOUND in STEP 1! ✅ ✅ ✅`);
        matchFound = await processMatch(result, targetAthlete, athleteDivisionName, divisionsSearched, stats);
        stepUsed = 1;
    }

    // ========================================
    // STEP 2: Exact Division + Athlete's Scraped Date (if available)
    // ========================================
    if (!matchFound && athleteSpecificDateStr) {
        console.log(`\n🔍 STEP 2: Exact Division + Athlete's Scraped Date`);
        const athleteDate = new Date(athleteSpecificDateStr);
        const step2StartDate = addDays(athleteDate, -5);
        const step2EndDate = addDays(athleteDate, 5);
        console.log(`   Date Range: ${formatDate(step2StartDate)} to ${formatDate(step2EndDate)} (±5 days around athlete date: ${athleteSpecificDateStr})`);

        const step2Url = buildRankingsURL(athleteDivisionCode, step2StartDate, step2EndDate);
        console.log(`   URL: ${step2Url}`);

        const step2Athletes = await scrapeDivisionRankings(page, athleteDivisionName, athleteDivisionCode, step2StartDate, step2EndDate, result.lifter_name);
        divisionsSearched++;
        console.log(`   Found ${step2Athletes.length} athletes`);

        for (const athlete of step2Athletes) {
            if (athlete.athleteName === result.lifter_name) {
                console.log(`\n   ✅ ✅ ✅ MATCH FOUND in STEP 2! ✅ ✅ ✅`);
                matchFound = await processMatch(result, athlete, athleteDivisionName, divisionsSearched, stats);
                stepUsed = 2;
                break;
            }
        }
    } else if (!matchFound && !athleteSpecificDateStr) {
        console.log(`\n⏭️  STEP 2: Skipped (no athlete-specific date found)`);
    }

    // ========================================
    // STEP 3: Broad Search + Name Filter (Fallback)
    // ========================================
    if (!matchFound) {
        console.log(`\n🔍 STEP 3: Broad Search + Name Filter (Fallback)`);

        // Create date range that spans from athlete date through meet date ±5 days each side
        let broadStartDate, broadEndDate;
        if (athleteSpecificDateStr) {
            const athleteDate = new Date(athleteSpecificDateStr);
            const dateMin = new Date(Math.min(athleteDate.getTime(), meetDate.getTime()));
            const dateMax = new Date(Math.max(athleteDate.getTime(), meetDate.getTime()));

            broadStartDate = addDays(dateMin, -CONFIG.DATE_WINDOW_DAYS);
            broadEndDate = addDays(dateMax, CONFIG.DATE_WINDOW_DAYS);
        } else {
            broadStartDate = addDays(meetDate, -CONFIG.DATE_WINDOW_DAYS);
            broadEndDate = addDays(meetDate, CONFIG.DATE_WINDOW_DAYS);
        }

        console.log(`   Date Range: ${formatDate(broadStartDate)} to ${formatDate(broadEndDate)} (spanning dates ±${CONFIG.DATE_WINDOW_DAYS} days)`);
        console.log(`   Searching across prioritized divisions with name filtering`);

        // Smart sort: prioritize divisions matching age_category + weight_class
        const sortedDivisions = smartSortDivisions(divisions, result);
        const totalDivisions = sortedDivisions.length;
        console.log(`   Total Divisions to Search: 1 (exact match only)`);

        // Only search first division (exact match)
        const divisionsToSearch = sortedDivisions.slice(0, 1);

        for (const [divisionName, divisionCode] of divisionsToSearch) {
            divisionsSearched++;

            console.log(`   Searching: ${divisionName}`);

            const url = buildRankingsURL(divisionCode, broadStartDate, broadEndDate);
            console.log(`      URL: ${url}`);

            // Use splitting function to handle large datasets
            const athletes = await scrapeDivisionRankingsWithSplitting(page, divisionName, divisionCode, broadStartDate, broadEndDate, result.lifter_name);

            console.log(`      Found ${athletes.length} athletes in this division`);

            // Look for exact name match
            for (const athlete of athletes) {
                if (athlete.athleteName === result.lifter_name) {
                    // Check if athlete's date falls within our search range
                    const athleteDate = new Date(athlete.liftDate);

                    if (athleteDate >= broadStartDate && athleteDate <= broadEndDate) {
                        console.log(`\n   ✅ ✅ ✅ MATCH FOUND in STEP 3! ✅ ✅ ✅`);
                        console.log(`      Division: ${divisionName}`);
                        console.log(`      Athlete: ${athlete.athleteName}`);
                        console.log(`      Athlete date: ${athlete.liftDate} (within search range)`);
                        console.log(`      WSO: ${athlete.wso}, Club: ${athlete.club}, Age: ${athlete.lifterAge}`);
                        console.log(`      Divisions searched before match: ${divisionsSearched}/${totalDivisions}\n`);

                        matchFound = await processMatch(result, athlete, divisionName, divisionsSearched, stats);
                        stepUsed = 3;
                        break;
                    }
                }
            }

            if (matchFound) break;
        }
    }

    if (!matchFound) {
        console.log(`\n   ❌ No match found after all search steps (${divisionsSearched} divisions total)`);
        stats.unresolved++;
        return false;
    }

    console.log(`\n🏆 Match found using Step ${stepUsed} after searching ${divisionsSearched} division(s)`);
    return true;
}

// Helper function to process a successful match
async function processMatch(result, athlete, divisionName, divisionsSearched, stats) {
    // Build update data (only null fields)
    const updateData = {};
    if (!result.competition_age && athlete.lifterAge) {
        updateData.competition_age = parseInt(athlete.lifterAge);
    }
    if (!result.wso && athlete.wso) {
        updateData.wso = athlete.wso;
    }
    if (!result.club_name && athlete.club) {
        updateData.club_name = athlete.club;
    }
    // Update gender if it was NULL and we found it in scraped data
    if (!result.gender && athlete.gender) {
        updateData.gender = athlete.gender;
    }

    if (Object.keys(updateData).length === 0) {
        console.log(`      No new data to update`);
        stats.skipped++;
        return true; // Match found but nothing to update
    }

    // Log update
    logUpdate(result, updateData, divisionName, divisionsSearched);

    // Apply update if not dry run
    if (!CONFIG.DRY_RUN) {
        const { error } = await supabase
            .from('usaw_meet_results')
            .update(updateData)
            .eq('result_id', result.result_id);

        if (error) {
            console.error(`      ❌ Database update failed: ${error.message}`);
            stats.errors++;
            return false;
        }

        console.log(`      ✅ Database updated successfully`);
        stats.updated++;
    } else {
        console.log(`      🔍 DRY RUN - would update with:`, updateData);
        stats.updated++;
    }

    return true;
}

async function findAthleteMatchesInScrapedData(allAthletes, targetResult, startDate, endDate) {
    console.log(`🔍 Checking ${allAthletes.length} athletes from scraped data for missing data...`);

    if (allAthletes.length === 0) {
        return [];
    }

    // Get athlete names to query
    const athleteNames = allAthletes.map(a => a.athleteName).filter(name => name);

    if (athleteNames.length === 0) {
        return [];
    }

    // Query database for athletes missing ANY data within date range
    let query = supabase
        .from('usaw_meet_results')
        .select('result_id, lifter_id, lifter_name, wso, club_name, competition_age, gender, total')
        .in('lifter_name', athleteNames)
        .gte('date', formatDate(startDate))
        .lte('date', formatDate(endDate));

    // Apply additional filters to match the original result
    if (targetResult.age_category) {
        query = query.eq('age_category', targetResult.age_category);
    }
    if (targetResult.weight_class) {
        query = query.eq('weight_class', targetResult.weight_class);
    }

    const { data: potentialResults, error } = await query;

    if (error) {
        console.warn(`⚠️  Failed to query for missing athletes: ${error.message}`);
        return [];
    }

    console.log(`   Found ${potentialResults.length} potential matches within date range`);

    // Match scraped athletes with database results and check for missing data
    const matches = [];
    for (const dbResult of potentialResults) {
        const scrapedAthlete = allAthletes.find(a => 
            a.athleteName.toLowerCase() === dbResult.lifter_name.toLowerCase()
        );

        if (scrapedAthlete) {
            // Check if scraped data provides ANY new information
            const hasNewData = (
                (!dbResult.competition_age && scrapedAthlete.lifterAge) ||
                (!dbResult.club_name && scrapedAthlete.club) ||
                (!dbResult.wso && scrapedAthlete.wso) ||
                (!dbResult.gender && scrapedAthlete.gender) ||
                (!dbResult.total && scrapedAthlete.total)
            );

            if (hasNewData) {
                matches.push({
                    dbResult,
                    scrapedData: scrapedAthlete
                });
            }
        }
    }

    console.log(`   ${matches.length} athletes have new data to update`);
    return matches;
}

async function batchUpdateAthletes(matches, divisionName, divisionsSearched, stats) {
    for (const { dbResult, scrapedData } of matches) {
        try {
            // Build update data for ALL missing fields
            const updateData = {};
            if (!dbResult.competition_age && scrapedData.lifterAge) {
                updateData.competition_age = parseInt(scrapedData.lifterAge);
            }
            if (!dbResult.club_name && scrapedData.club) {
                updateData.club_name = scrapedData.club;
            }
            if (!dbResult.wso && scrapedData.wso) {
                updateData.wso = scrapedData.wso;
            }
            if (!dbResult.gender && scrapedData.gender) {
                updateData.gender = scrapedData.gender;
            }
            if (!dbResult.total && scrapedData.total) {
                updateData.total = scrapedData.total;
            }

            if (Object.keys(updateData).length === 0) {
                stats.skipped++;
                continue;
            }

            // Log update
            logUpdate(dbResult, updateData, divisionName, divisionsSearched);

            // Apply update if not dry run
            if (!CONFIG.DRY_RUN) {
                const { error } = await supabase
                    .from('usaw_meet_results')
                    .update(updateData)
                    .eq('result_id', dbResult.result_id);

                if (error) {
                    console.error(`   ❌ Failed to update ${dbResult.lifter_name}: ${error.message}`);
                    stats.errors++;
                } else {
                    console.log(`   ✅ Updated: ${dbResult.lifter_name} (${Object.keys(updateData).join(', ')})`);
                    stats.updated++;
                }
            } else {
                console.log(`   🔍 DRY RUN: Would update ${dbResult.lifter_name} with:`, updateData);
                stats.updated++;
            }

        } catch (error) {
            console.error(`   ❌ Error updating ${dbResult.lifter_name}: ${error.message}`);
            stats.errors++;
        }
    }
}

function logUpdate(result, updateData, divisionName, divisionsSearched) {
    ensureDirectoryExists(path.dirname(CONFIG.UPDATES_LOG_PATH));

    // Initialize CSV if doesn't exist
    if (!fs.existsSync(CONFIG.UPDATES_LOG_PATH)) {
        const headers = [
            'timestamp',
            'result_id',
            'lifter_name',
            'date',
            'division_matched',
            'divisions_searched',
            'competition_age_before',
            'competition_age_after',
            'wso_before',
            'wso_after',
            'club_name_before',
            'club_name_after',
            'dry_run'
        ];
        fs.writeFileSync(CONFIG.UPDATES_LOG_PATH, headers.join(',') + '\n');
    }

    const row = [
        new Date().toISOString(),
        result.result_id,
        escapeCSV(result.lifter_name),
        result.date,
        escapeCSV(divisionName),
        divisionsSearched,
        result.competition_age || '',
        updateData.competition_age || result.competition_age || '',
        escapeCSV(result.wso || ''),
        escapeCSV(updateData.wso || result.wso || ''),
        escapeCSV(result.club_name || ''),
        escapeCSV(updateData.club_name || result.club_name || ''),
        CONFIG.DRY_RUN
    ];

    fs.appendFileSync(CONFIG.UPDATES_LOG_PATH, row.join(',') + '\n');
}

// ========================================
// MAIN EXECUTION
// ========================================

async function main() {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🎯 SURGICAL STRIKE WSO SCRAPER`);
    console.log(`${'='.repeat(70)}`);

    // Display configuration
    console.log(`\n⚙️  Configuration:`);
    console.log(`   Date Range: ${CONFIG.START_DATE || 'ALL'} to ${CONFIG.END_DATE || 'ALL'}`);
    console.log(`   Gender Filter: ${CONFIG.GENDER_FILTER ? (CONFIG.GENDER_FILTER === 'M' ? 'Male' : 'Female') : 'ALL'}`);
    console.log(`   Max Results: ${CONFIG.MAX_RESULTS || 'UNLIMITED'}`);
    console.log(`   Date Window: ±${CONFIG.DATE_WINDOW_DAYS} days`);
    console.log(`   Mode: ${CONFIG.DRY_RUN ? '🔍 DRY RUN (preview only)' : '✅ LIVE (will update database)'}`);

    const stats = {
        processed: 0,
        updated: 0,
        skipped: 0,
        unresolved: 0,
        errors: 0
    };

    try {
        // Load skip list
        const skipList = loadUnresolvedList();

        // Query incomplete results
        const incompleteResults = await queryIncompleteResults(skipList);

        if (incompleteResults.length === 0) {
            console.log(`\n✅ No results missing WSO to process!`);
            return;
        }

        // Load and filter divisions
        const divisions = loadAndFilterDivisions(CONFIG.GENDER_FILTER);

        if (Object.keys(divisions).length === 0) {
            console.log(`\n❌ No divisions available for gender filter: ${CONFIG.GENDER_FILTER}`);
            return;
        }

        // Launch browser
        console.log(`\n🚀 Launching browser...`);
        const browser = await puppeteer.launch({
            headless: CONFIG.HEADLESS,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        console.log(`\n${'='.repeat(70)}`);
        console.log(`🔄 Processing ${incompleteResults.length} results missing WSO`);
        console.log(`${'='.repeat(70)}`);

        // Process each incomplete result
        for (const result of incompleteResults) {
            stats.processed++;

            const matchFound = await findAndUpdateResult(page, result, divisions, stats);

            // If no match found, save as unresolved result
            if (!matchFound) {
                saveUnresolvedResult({
                    result_id: result.result_id,
                    lifter_name: result.lifter_name,
                    date: result.date,
                    gender: result.gender,
                    age_category: result.age_category,
                    weight_class: result.weight_class,
                    timestamp: new Date().toISOString(),
                    divisions_searched: Object.keys(divisions).length
                });
            }

            // Progress update every 5 results
            if (stats.processed % 5 === 0) {
                console.log(`\n📊 Progress: ${stats.processed}/${incompleteResults.length} results processed`);
                console.log(`   Updated: ${stats.updated}, Skipped: ${stats.skipped}, Unresolved: ${stats.unresolved}, Errors: ${stats.errors}`);
            }
        }

        // Close browser
        await browser.close();

        // Display final summary
        console.log(`\n${'='.repeat(70)}`);
        console.log(`📊 FINAL SUMMARY`);
        console.log(`${'='.repeat(70)}`);
        console.log(`   Total Processed: ${stats.processed}`);
        console.log(`   Successfully Updated: ${stats.updated}`);
        console.log(`   Skipped (no new data): ${stats.skipped}`);
        console.log(`   Unresolved (no match): ${stats.unresolved}`);
        console.log(`   Errors: ${stats.errors}`);
        console.log(`   Mode: ${CONFIG.DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

        if (!CONFIG.DRY_RUN && stats.updated > 0) {
            console.log(`\n✅ Updates logged to: ${CONFIG.UPDATES_LOG_PATH}`);
        }

        if (stats.unresolved > 0) {
            console.log(`\n📋 Unresolved results logged to: ${CONFIG.UNRESOLVED_PATH}`);
        }

    } catch (error) {
        console.error(`\n❌ Fatal error: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { main };
