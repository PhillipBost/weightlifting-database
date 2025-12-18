// Load environment variables from .env file
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// =================================================================
// SURGICAL STRIKE - SINGLE ATHLETE SCRAPER
// Targets all meet results for a specific athlete (by lifter_id)
// Re-scrapes biographical data from Sport80 division rankings
// =================================================================

const CONFIG = {
    // Target athlete
    LIFTER_ID: process.env.LIFTER_ID ? parseInt(process.env.LIFTER_ID) : 64401, // Default: Annjeanine Saetern
    
    // Scraping settings
    HEADLESS: process.env.HEADLESS !== 'false',
    DRY_RUN: process.env.DRY_RUN === 'true',
    DATE_WINDOW_DAYS: 5, // ±5 days around result date
    
    // Paths
    UPDATES_LOG_PATH: path.join(__dirname, `../../logs/surgical-strike-single-athlete-${new Date().toISOString().split('T')[0]}.csv`),
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

async function queryAthleteResults(lifterId) {
    console.log(`\n🔍 Querying database for athlete results...`);
    console.log(`   lifter_id: ${lifterId}`);
    
    // First, get the athlete's basic info
    const { data: athlete, error: athleteError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .eq('lifter_id', lifterId)
        .single();
    
    if (athleteError || !athlete) {
        throw new Error(`Failed to fetch athlete ${lifterId}: ${athleteError?.message || 'Not found'}`);
    }
    
    console.log(`\n👤 Athlete Info:`);
    console.log(`   Name: ${athlete.athlete_name}`);
    console.log(`   Internal ID: ${athlete.internal_id || 'N/A'}`);
    
    // Query all meet results for this athlete
    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, competition_age, wso, club_name, total, date, meet_name')
        .eq('lifter_id', lifterId)
        .filter('total', 'gt', '0')
        .not('age_category', 'is', null)
        .not('weight_class', 'is', null)
        .not('meet_id', 'is', null)
        .order('date', { ascending: true });
    
    if (error) {
        throw new Error(`Database query failed: ${error.message}`);
    }
    
    console.log(`\n   Found ${data.length} meet results`);
    
    if (data.length === 0) {
        return { athlete, results: [] };
    }
    
    console.log(`   Date range: ${data[0].date} to ${data[data.length - 1].date}`);
    
    // Get unique meet_ids to fetch correct dates from usaw_meets
    const meetIds = [...new Set(data.map(r => r.meet_id))];
    console.log(`   Fetching dates for ${meetIds.length} unique meets...`);
    
    // Query usaw_meets for the correct dates in batches
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
        date: meetDates.get(result.meet_id) || result.date
    })).sort((a, b) => {
        const dateA = new Date(a.date || '9999-12-31');
        const dateB = new Date(b.date || '9999-12-31');
        return dateA - dateB;
    });
    
    // Count missing biographical data
    const missingAge = resultsWithDates.filter(r => !r.competition_age).length;
    const missingWso = resultsWithDates.filter(r => !r.wso).length;
    const missingClub = resultsWithDates.filter(r => !r.club_name).length;
    
    console.log(`\n   Missing biographical data:`);
    console.log(`     competition_age: ${missingAge}/${resultsWithDates.length}`);
    console.log(`     wso: ${missingWso}/${resultsWithDates.length}`);
    console.log(`     club_name: ${missingClub}/${resultsWithDates.length}`);
    
    return { athlete, results: resultsWithDates };
}

// ========================================
// URL BUILDING
// ========================================

function buildRankingsURL(divisionCode, startDate, endDate) {
    const base = 'https://usaweightlifting.sport80.com/public/rankings/divisions';
    const start = formatDate(startDate);
    const end = formatDate(endDate);
    return `${base}/${divisionCode}?from=${start}&to=${end}`;
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
            const h1 = document.querySelector('h1');
            const h2 = document.querySelector('h2');
            const title = document.querySelector('.meet-title, .event-title, .competition-title');
            
            if (title) return title.textContent.trim();
            if (h1) return h1.textContent.trim();
            if (h2) return h2.textContent.trim();
            return 'Unknown Meet';
        });
        
        console.log(`   Meet: ${meetName}`);
        
        // Find the athlete's row and extract their date
        const athleteDate = await page.evaluate((targetName) => {
            const rows = document.querySelectorAll('tbody tr');
            
            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                
                // Find name column (usually first or second)
                for (let i = 0; i < Math.min(cells.length, 3); i++) {
                    const cellText = cells[i].textContent.trim();
                    
                    if (cellText === targetName) {
                        // Look for date column (usually labeled "Date" or similar)
                        const headers = Array.from(document.querySelectorAll('thead th'))
                            .map(th => th.textContent.trim().toLowerCase());
                        
                        const dateIndex = headers.findIndex(h => h.includes('date'));
                        
                        if (dateIndex !== -1 && cells[dateIndex]) {
                            return cells[dateIndex].textContent.trim();
                        }
                    }
                }
            }
            
            return null;
        }, lifterName);
        
        if (athleteDate) {
            console.log(`   ✅ Found athlete date: ${athleteDate}`);
            return athleteDate;
        } else {
            console.log(`   ⚠️  Athlete "${lifterName}" not found in results table`);
            return null;
        }
        
    } catch (error) {
        console.log(`   ⚠️  Error scraping athlete date: ${error.message}`);
        return null;
    }
}

// ========================================
// SCRAPING LOGIC
// ========================================

async function scrapeDivisionRankingsWithSplitting(page, divisionName, divisionCode, startDate, endDate, lifterName, depth = 0) {
    const MAX_DEPTH = 5;
    const INDENT = '  '.repeat(depth);
    
    if (depth > MAX_DEPTH) {
        console.log(`${INDENT}⚠️  Max recursion depth reached, stopping split`);
        return [];
    }
    
    try {
        const athletes = await scrapeDivisionRankings(page, divisionName, divisionCode, startDate, endDate, lifterName);
        return athletes;
        
    } catch (error) {
        if (error.message.includes('Dataset too large') || error.message.includes('timeout')) {
            console.log(`${INDENT}⚠️  Dataset too large, splitting date range...`);
            
            const start = new Date(startDate);
            const end = new Date(endDate);
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            
            if (daysDiff <= 1) {
                console.log(`${INDENT}⚠️  Cannot split further (${daysDiff} days), giving up`);
                return [];
            }
            
            const midDate = new Date(start.getTime() + (end - start) / 2);
            
            console.log(`${INDENT}   Splitting into 2 chunks:`);
            console.log(`${INDENT}   1. ${formatDate(start)} to ${formatDate(midDate)}`);
            console.log(`${INDENT}   2. ${formatDate(addDays(midDate, 1))} to ${formatDate(end)}`);
            
            const chunk1 = await scrapeDivisionRankingsWithSplitting(page, divisionName, divisionCode, start, midDate, lifterName, depth + 1);
            const chunk2 = await scrapeDivisionRankingsWithSplitting(page, divisionName, divisionCode, addDays(midDate, 1), end, lifterName, depth + 1);
            
            return [...chunk1, ...chunk2];
        } else {
            throw error;
        }
    }
}

async function scrapeDivisionRankings(page, divisionName, divisionCode, startDate, endDate, lifterName) {
    try {
        const url = buildRankingsURL(divisionCode, startDate, endDate);
        
        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });
        
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const initialStats = await page.evaluate(() => {
            const totalText = document.querySelector('.v-data-footer__pagination')?.textContent || '';
            const match = totalText.match(/of (\d+)/);
            const totalResults = match ? parseInt(match[1]) : null;
            const rowCount = document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
            
            return { totalResults, rowCount };
        });
        
        console.log(`      Initial results: ${initialStats.totalResults || initialStats.rowCount} total`);
        
        if (initialStats.totalResults > 5000) {
            throw new Error('Dataset too large - will split');
        }
        
        // Apply name filter
        if (lifterName) {
            console.log(`      Filtering for: "${lifterName}"`);
            
            await page.waitForSelector('input[placeholder="Search"]', { timeout: 5000 });
            await page.click('input[placeholder="Search"]');
            await page.keyboard.type(lifterName, { delay: 50 });
            
            const checkInterval = 200;
            const maxIterations = 200;
            const stabilityChecks = 10;
            
            let previousCount = initialStats.rowCount;
            let stableCount = 0;
            
            for (let i = 0; i < maxIterations; i++) {
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                
                const currentCount = await page.evaluate(() => {
                    return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
                });
                
                if (currentCount === previousCount) {
                    stableCount++;
                    if (stableCount >= stabilityChecks) {
                        break;
                    }
                } else {
                    stableCount = 0;
                    previousCount = currentCount;
                }
            }
            
            const finalStatus = await page.evaluate(() => {
                const rowCount = document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
                const text = document.querySelector('.v-data-table__wrapper')?.textContent || '';
                const isEmptyState = text.toLowerCase().includes('no data') || 
                                   text.toLowerCase().includes('please select');
                
                return { rowCount, isEmptyState };
            });
            
            if (finalStatus.isEmptyState) {
                console.log(`      ℹ️  No results found for athlete "${lifterName}" (0 matches)`);
                return [];
            }
            
            console.log(`      Extracting from ${finalStatus.rowCount} table row(s)...`);
        }
        
        // Extract athletes
        let allAthletes = [];
        let hasMorePages = true;
        let currentPage = 1;
        
        while (hasMorePages) {
            const pageAthletes = await page.evaluate(() => {
                const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                    .map(th => th.textContent.trim().toLowerCase());
                
                const nameIndex = headers.findIndex(h => h === 'name' || h === 'athlete');
                const clubIndex = headers.findIndex(h => h === 'club');
                const wsoIndex = headers.findIndex(h => h === 'wso');
                const ageIndex = headers.findIndex(h => h === 'age');
                const dateIndex = headers.findIndex(h => h === 'date');
                
                const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                const athletes = [];
                
                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    
                    const athlete = {
                        athleteName: nameIndex !== -1 && cells[nameIndex] ? cells[nameIndex].textContent.trim() : null,
                        club: clubIndex !== -1 && cells[clubIndex] ? cells[clubIndex].textContent.trim() : null,
                        wso: wsoIndex !== -1 && cells[wsoIndex] ? cells[wsoIndex].textContent.trim() : null,
                        lifterAge: ageIndex !== -1 && cells[ageIndex] ? cells[ageIndex].textContent.trim() : null,
                        liftDate: dateIndex !== -1 && cells[dateIndex] ? cells[dateIndex].textContent.trim() : null
                    };
                    
                    if (athlete.athleteName) {
                        athletes.push(athlete);
                    }
                }
                
                return athletes;
            });
            
            allAthletes.push(...pageAthletes);
            
            // Check for next page
            const nextButtonExists = await page.evaluate(() => {
                const nextButton = document.querySelector('.v-data-footer__pagination button[aria-label="Next page"]:not([disabled])');
                return !!nextButton;
            });
            
            if (nextButtonExists && currentPage < 100) {
                await page.click('.v-data-footer__pagination button[aria-label="Next page"]');
                await new Promise(resolve => setTimeout(resolve, 1500));
                currentPage++;
            } else {
                hasMorePages = false;
            }
        }
        
        return allAthletes;
        
    } catch (error) {
        if (error.message.includes('timeout') || error.message.includes('Dataset too large')) {
            throw error;
        }
        console.log(`      ⚠️  Error scraping division: ${error.message}`);
        return [];
    }
}

// ========================================
// MATCHING AND UPDATING
// ========================================

function smartSortDivisions(divisions, result) {
    const targetDivision = `${result.age_category} ${result.weight_class}`;
    
    const entries = Object.entries(divisions);
    
    entries.sort((a, b) => {
        const [nameA] = a;
        const [nameB] = b;
        
        const matchA = nameA === targetDivision;
        const matchB = nameB === targetDivision;
        
        if (matchA && !matchB) return -1;
        if (!matchA && matchB) return 1;
        
        return nameA.localeCompare(nameB);
    });
    
    return entries;
}

async function findAndUpdateResult(page, result, divisions, stats) {
    const resultDate = new Date(result.date);
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🎯 Processing result_id ${result.result_id}: ${result.lifter_name}`);
    console.log(`${'='.repeat(70)}`);
    
    console.log(`\n📊 CURRENT DATA:`);
    console.log(`   Lifter ID: ${result.lifter_id}`);
    console.log(`   Lifter Name: ${result.lifter_name}`);
    console.log(`   Meet: ${result.meet_name}`);
    console.log(`   Meet Date: ${result.date}`);
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
    
    const activeDivisionCutoff = new Date('2025-06-01');
    const useActiveDivisions = resultDate >= activeDivisionCutoff;
    
    for (const [divName, code] of Object.entries(divisions)) {
        if (divName === athleteDivisionName) {
            athleteDivisionCode = code;
            break;
        }
    }
    
    if (!athleteDivisionCode) {
        console.log(`\n❌ Division "${athleteDivisionName}" not found in division codes`);
        stats.unresolved++;
        return false;
    }
    
    console.log(`\n🔍 SEARCH STRATEGY:`);
    console.log(`   Target Division: ${athleteDivisionName}`);
    console.log(`   Division Status: ${useActiveDivisions ? 'Active' : 'Inactive (pre-June 2025)'}`);
    
    const sortedDivisions = smartSortDivisions(divisions, result);
    
    let matchFound = false;
    let stepUsed = 0;
    let divisionsSearched = 0;
    
    // STEP 1: Exact Division + Meet Date ±5 days
    console.log(`\n🔍 STEP 1: Exact Division + Meet Date ±5 days`);
    const step1StartDate = addDays(meetDate, -CONFIG.DATE_WINDOW_DAYS);
    const step1EndDate = addDays(meetDate, CONFIG.DATE_WINDOW_DAYS);
    console.log(`   Division: ${athleteDivisionName}`);
    console.log(`   Date Range: ${formatDate(step1StartDate)} to ${formatDate(step1EndDate)}`);
    
    const step1Url = buildRankingsURL(athleteDivisionCode, step1StartDate, step1EndDate);
    console.log(`   URL: ${step1Url}`);
    
    const step1Athletes = await scrapeDivisionRankingsWithSplitting(page, athleteDivisionName, athleteDivisionCode, step1StartDate, step1EndDate, result.lifter_name);
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
    
    // STEP 2: Exact Division + Athlete's Scraped Date (if available)
    if (!matchFound && athleteSpecificDateStr) {
        console.log(`\n🔍 STEP 2: Exact Division + Athlete's Scraped Date`);
        const athleteDate = new Date(athleteSpecificDateStr);
        const step2StartDate = addDays(athleteDate, -CONFIG.DATE_WINDOW_DAYS);
        const step2EndDate = addDays(athleteDate, CONFIG.DATE_WINDOW_DAYS);
        console.log(`   Division: ${athleteDivisionName}`);
        console.log(`   Date Range: ${formatDate(step2StartDate)} to ${formatDate(step2EndDate)}`);
        
        const step2Url = buildRankingsURL(athleteDivisionCode, step2StartDate, step2EndDate);
        console.log(`   URL: ${step2Url}`);
        
        const step2Athletes = await scrapeDivisionRankingsWithSplitting(page, athleteDivisionName, athleteDivisionCode, step2StartDate, step2EndDate, result.lifter_name);
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
    
    // STEP 3: Broad search across all divisions (±30 days)
    if (!matchFound) {
        console.log(`\n🔍 STEP 3: Broad Search - Checking first matching division with ±30 day window`);
        const broadStartDate = addDays(meetDate, -30);
        const broadEndDate = addDays(meetDate, 30);
        console.log(`   Date Range: ${formatDate(broadStartDate)} to ${formatDate(broadEndDate)}`);
        
        const divisionsToSearch = sortedDivisions.slice(0, 1);
        
        for (const [divisionName, divisionCode] of divisionsToSearch) {
            divisionsSearched++;
            
            console.log(`   Searching: ${divisionName}`);
            const url = buildRankingsURL(divisionCode, broadStartDate, broadEndDate);
            console.log(`   URL: ${url}`);
            
            const athletes = await scrapeDivisionRankingsWithSplitting(page, divisionName, divisionCode, broadStartDate, broadEndDate, result.lifter_name);
            
            console.log(`      Found ${athletes.length} athletes in this division`);
            
            for (const athlete of athletes) {
                if (athlete.athleteName === result.lifter_name) {
                    console.log(`\n   ✅ ✅ ✅ MATCH FOUND in STEP 3! ✅ ✅ ✅`);
                    matchFound = await processMatch(result, athlete, divisionName, divisionsSearched, stats);
                    stepUsed = 3;
                    break;
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

async function processMatch(result, athlete, divisionName, divisionsSearched, stats) {
    const athleteDate = new Date(athlete.liftDate);
    const meetDate = new Date(result.date);
    const daysDiff = Math.abs((athleteDate - meetDate) / (1000 * 60 * 60 * 24));
    
    console.log(`      Division: ${divisionName}`);
    console.log(`      Athlete: ${athlete.athleteName}`);
    console.log(`      Athlete date: ${athlete.liftDate} (${daysDiff.toFixed(1)} days difference from meet date)`);
    console.log(`      WSO: ${athlete.wso || 'N/A'}, Club: ${athlete.club || 'N/A'}, Age: ${athlete.lifterAge || 'N/A'}`);
    console.log(`      Divisions searched before match: ${divisionsSearched}\n`);
    
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
    
    if (Object.keys(updateData).length === 0) {
        console.log(`      ℹ️  No new data to update (all fields already populated)`);
        stats.skipped++;
        return true;
    }
    
    console.log(`      📝 Will update:`, updateData);
    
    if (CONFIG.DRY_RUN) {
        console.log(`      🔍 DRY RUN - No database update performed`);
        stats.updated++;
        logUpdate(result, updateData, divisionName, divisionsSearched);
        return true;
    }
    
    // Update database
    updateData.updated_at = new Date().toISOString();
    
    const { error } = await supabase
        .from('usaw_meet_results')
        .update(updateData)
        .eq('result_id', result.result_id);
    
    if (error) {
        console.log(`      ❌ Database update failed: ${error.message}`);
        stats.errors++;
        return false;
    }
    
    console.log(`      ✅ Database updated successfully`);
    stats.updated++;
    logUpdate(result, updateData, divisionName, divisionsSearched);
    
    return true;
}

function logUpdate(result, updateData, divisionName, divisionsSearched) {
    ensureDirectoryExists(path.dirname(CONFIG.UPDATES_LOG_PATH));
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        result_id: result.result_id,
        lifter_id: result.lifter_id,
        lifter_name: result.lifter_name,
        meet_name: result.meet_name,
        date: result.date,
        division: divisionName,
        divisions_searched: divisionsSearched,
        ...updateData
    };
    
    const isNewFile = !fs.existsSync(CONFIG.UPDATES_LOG_PATH);
    
    if (isNewFile) {
        const headers = Object.keys(logEntry).map(escapeCSV).join(',');
        fs.writeFileSync(CONFIG.UPDATES_LOG_PATH, headers + '\n');
    }
    
    const values = Object.values(logEntry).map(escapeCSV).join(',');
    fs.appendFileSync(CONFIG.UPDATES_LOG_PATH, values + '\n');
}

// ========================================
// MAIN EXECUTION
// ========================================

async function main() {
    const startTime = Date.now();
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🎯 SURGICAL STRIKE - SINGLE ATHLETE SCRAPER`);
    console.log(`${'='.repeat(70)}`);
    console.log(`\nConfiguration:`);
    console.log(`   Lifter ID: ${CONFIG.LIFTER_ID}`);
    console.log(`   Dry Run: ${CONFIG.DRY_RUN ? 'YES' : 'NO'}`);
    console.log(`   Headless: ${CONFIG.HEADLESS ? 'YES' : 'NO'}`);
    
    const stats = {
        processed: 0,
        updated: 0,
        skipped: 0,
        unresolved: 0,
        errors: 0
    };
    
    try {
        // Query athlete results
        const { athlete, results } = await queryAthleteResults(CONFIG.LIFTER_ID);
        
        if (results.length === 0) {
            console.log(`\n✅ No results to process!`);
            return;
        }
        
        // Load divisions based on athlete's gender
        const divisions = loadAndFilterDivisions(athlete.gender);
        
        if (Object.keys(divisions).length === 0) {
            console.log(`\n❌ No divisions available for gender: ${athlete.gender || 'NULL'}`);
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
        console.log(`🔄 Processing ${results.length} results for ${athlete.athlete_name}`);
        console.log(`${'='.repeat(70)}`);
        
        // Process each result
        for (const result of results) {
            stats.processed++;
            
            await findAndUpdateResult(page, result, divisions, stats);
            
            // Progress update every 5 results
            if (stats.processed % 5 === 0) {
                console.log(`\n📊 Progress: ${stats.processed}/${results.length} results processed`);
                console.log(`   Updated: ${stats.updated}, Skipped: ${stats.skipped}, Unresolved: ${stats.unresolved}, Errors: ${stats.errors}`);
            }
        }
        
        // Close browser
        await browser.close();
        
        // Final summary
        const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
        
        console.log(`\n${'='.repeat(70)}`);
        console.log(`✅ SCRAPING COMPLETE`);
        console.log(`${'='.repeat(70)}`);
        console.log(`\n📊 Final Statistics:`);
        console.log(`   Total Processed: ${stats.processed}`);
        console.log(`   Updated: ${stats.updated}`);
        console.log(`   Skipped (no new data): ${stats.skipped}`);
        console.log(`   Unresolved: ${stats.unresolved}`);
        console.log(`   Errors: ${stats.errors}`);
        console.log(`   Duration: ${duration} minutes`);
        
        if (stats.updated > 0) {
            console.log(`\n📝 Updates logged to: ${CONFIG.UPDATES_LOG_PATH}`);
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
