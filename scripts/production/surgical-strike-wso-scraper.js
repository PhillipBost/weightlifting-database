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
            return new Set(unresolvedList.map(r => r.result_id));
        } catch (error) {
            console.warn(`⚠️  Failed to load unresolved list: ${error.message}`);
            return new Set();
        }
    }
    console.log(`📋 No existing unresolved list found`);
    return new Set();
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
        .select('result_id, lifter_id, lifter_name, date, meet_id, gender, age_category, weight_class, competition_age, wso, club_name, total')
        .is('wso', null)
        .filter('total', 'gt', '0')  // Filter as text comparison since total is stored as text
        .not('age_category', 'is', null)
        .not('weight_class', 'is', null)
        .not('meet_id', 'is', null)
        .order('date', { ascending: false });

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

    // Filter out results in skip list
    const filtered = data.filter(r => !skipList.has(r.result_id));
    const skipped = data.length - filtered.length;

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

            return null; // Athlete not found
        }, lifterName);

        if (athleteData) {
            console.log(`   ✅ Found athlete date: ${athleteData.date}`);
            return athleteData.date;
        } else {
            console.log(`   ❌ Athlete "${lifterName}" not found in meet results`);
            return null;
        }

    } catch (error) {
        console.error(`   ❌ Error scraping athlete date: ${error.message}`);
        return null;
    }
}

// ========================================
// SCRAPING LOGIC
// ========================================

async function scrapeDivisionRankings(page, divisionName, divisionCode, startDate, endDate, lifterName) {
    try {
        const url = buildRankingsURL(divisionCode, startDate, endDate);

        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for page to fully populate (same as nightly scraper)
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Input athlete name into search field to filter results
        try {
            await page.waitForSelector('#search', { timeout: 5000 });
            // Clear the search field first
            await page.evaluate(() => {
                const searchInput = document.querySelector('#search');
                searchInput.value = '';
                searchInput.focus();
            });
            // Type the athlete name
            await page.type('#search', lifterName);
            // Wait for search filtering to complete
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (searchError) {
            console.log(`      ⚠️  Search field not found or failed, continuing with unfiltered results`);
        }

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
                return rows.map(row => {
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
            });

            allAthletes = allAthletes.concat(pageAthletes);

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
    const athleteDivisionCode = divisions[athleteDivisionName];

    if (!athleteDivisionCode) {
        console.log(`\n❌ Could not find division code for: ${athleteDivisionName}`);
        stats.unresolved++;
        return false;
    }

    console.log(`\n🏷️  Athlete's Division: ${athleteDivisionName} (code: ${athleteDivisionCode})`);

    // THREE-STEP FALLBACK STRATEGY
    let matchFound = false;
    let stepUsed = 0;
    let divisionsSearched = 0;

    // ========================================
    // STEP 1: Exact Division + Meet Date
    // ========================================
    console.log(`\n🔍 STEP 1: Exact Division + Meet Date`);
    const step1StartDate = addDays(meetDate, -2);
    const step1EndDate = addDays(meetDate, 2);
    console.log(`   Date Range: ${formatDate(step1StartDate)} to ${formatDate(step1EndDate)} (±2 days around meet date)`);

    const step1Url = buildRankingsURL(athleteDivisionCode, step1StartDate, step1EndDate);
    console.log(`   URL: ${step1Url}`);

    const step1Athletes = await scrapeDivisionRankings(page, athleteDivisionName, athleteDivisionCode, step1StartDate, step1EndDate, result.lifter_name);
    divisionsSearched++;
    console.log(`   Found ${step1Athletes.length} athletes`);

    for (const athlete of step1Athletes) {
        if (athlete.athleteName === result.lifter_name) {
            console.log(`\n   ✅ ✅ ✅ MATCH FOUND in STEP 1! ✅ ✅ ✅`);
            matchFound = await processMatch(result, athlete, athleteDivisionName, divisionsSearched, stats);
            stepUsed = 1;
            break;
        }
    }

    // ========================================
    // STEP 2: Exact Division + Athlete's Scraped Date (if available)
    // ========================================
    if (!matchFound && athleteSpecificDateStr) {
        console.log(`\n🔍 STEP 2: Exact Division + Athlete's Scraped Date`);
        const athleteDate = new Date(athleteSpecificDateStr);
        const step2StartDate = addDays(athleteDate, -2);
        const step2EndDate = addDays(athleteDate, 2);
        console.log(`   Date Range: ${formatDate(step2StartDate)} to ${formatDate(step2EndDate)} (±2 days around athlete date: ${athleteSpecificDateStr})`);

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
        console.log(`   Total Divisions to Search: ${totalDivisions} (smart-sorted, exact match first)`);

        for (const [divisionName, divisionCode] of sortedDivisions) {
            divisionsSearched++;

            console.log(`   [${divisionsSearched}/${totalDivisions}] Searching: ${divisionName}`);

            const url = buildRankingsURL(divisionCode, broadStartDate, broadEndDate);
            console.log(`      URL: ${url}`);

            const athletes = await scrapeDivisionRankings(page, divisionName, divisionCode, broadStartDate, broadEndDate, result.lifter_name);

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

        const unresolvedResults = [];

        // Process each incomplete result
        for (const result of incompleteResults) {
            stats.processed++;

            const matchFound = await findAndUpdateResult(page, result, divisions, stats);

            if (!matchFound) {
                // Add to unresolved list
                unresolvedResults.push({
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

        // Save unresolved list
        if (unresolvedResults.length > 0) {
            saveUnresolvedList(unresolvedResults);
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

        if (unresolvedResults.length > 0) {
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
