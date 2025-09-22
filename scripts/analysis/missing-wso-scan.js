/**
 * MISSING WSO SCAN SCRIPT
 * 
 * Purpose: Scans the meet_results table for records missing WSO (World Standing Order)
 * and attempts to fill the gaps using Sport80 reverse lookup.
 * 
 * This helps monitor and fix:
 * - Incomplete WSO data in meet results
 * - Missing World Standing Order rankings from scraping gaps
 * - Data quality issues in meet_results biographical fields
 * 
 * Usage:
 *   node missing-wso-scan.js
 *   node missing-wso-scan.js --show-details
 *   node missing-wso-scan.js --find-data
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// Validate environment variables
function validateEnvironment() {
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(varName => {
            console.error(`   - ${varName}`);
        });
        console.error('\nPlease ensure these environment variables are set before running the script.');
        process.exit(1);
    }
    
    console.log('✅ Environment variables validated');
}

// Validate environment before proceeding
validateEnvironment();

// Initialize Supabase client
let supabase;

// Initialize Supabase connection
function initializeSupabase() {
    try {
        supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SECRET_KEY
        );
        return supabase;
    } catch (error) {
        console.error('❌ Failed to initialize Supabase client:');
        console.error(`   ${error.message}`);
        process.exit(1);
    }
}

// Test Supabase connection
async function testSupabaseConnection() {
    console.log('🔍 Testing Supabase connection...');
    
    try {
        // Try a simple query to test connectivity
        const { data, error } = await supabase
            .from('meet_results')
            .select('result_id')
            .limit(1);
        
        if (error) {
            console.error('❌ Supabase connection test failed:');
            console.error(`   Error: ${error.message}`);
            console.error(`   Code: ${error.code || 'N/A'}`);
            console.error(`   Details: ${error.details || 'N/A'}`);
            console.error(`   Hint: ${error.hint || 'N/A'}`);
            throw new Error(`Supabase connection failed: ${error.message}`);
        }
        
        console.log('✅ Supabase connection successful');
        console.log(`   Database accessible, sample query returned ${data?.length || 0} records`);
        return true;
        
    } catch (error) {
        console.error('❌ Connection test failed with unexpected error:');
        console.error(`   ${error.message}`);
        throw error;
    }
}

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'missing_wso_scan_report.json');
const LOG_FILE = path.join(LOGS_DIR, 'missing-wso-scan.log');
const SCRIPT_VERSION = '1.0.0';

// Load division codes for base64 URL generation
let divisionCodes = {};
try {
    const divisionData = JSON.parse(fs.readFileSync('division_base64_codes.json', 'utf8'));
    divisionCodes = divisionData.division_codes || {};
    console.log(`Loaded ${Object.keys(divisionCodes).length} division codes for URL lookup`);
} catch (error) {
    console.log(`⚠️  Could not load division codes: ${error.message}`);
}

// Browser instance for USAW scraping
let browser = null;
let page = null;

// Cache for biographical lookups to avoid duplicate requests
const biographicalCache = new Map();

// Ensure directories exist
function ensureDirectories() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

// Logging utility
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    console.log(message);
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        showDetails: process.env.SHOW_DETAILS === 'true' || args.includes('--show-details'),
        findData: process.env.FIND_DATA === 'true' || args.includes('--find-data')
    };
    
    return options;
}

// Initialize browser for USAW scraping
async function initBrowser() {
    log('Initializing browser for WSO lookup...');
    
    browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    
    log('Browser initialized successfully');
}

// Build Sport80 URL with base64 encoded filters
function buildSport80URLWithCode(weightClassCode, competitionDate) {
    const filters = {
        date_range_start: competitionDate,
        date_range_end: competitionDate,
        weight_class: weightClassCode
    };

    const encodedFilters = btoa(JSON.stringify(filters));
    return `https://usaweightlifting.sport80.com/public/rankings/all?filters=${encodedFilters}`;
}

// Build Sport80 URL for reverse lookup
function buildSport80URL(division, competitionDate) {
    log(`    Building reverse lookup URL for: "${division}" on ${competitionDate}`);
    
    // Determine if date is before 2025-06-01 to decide on (Inactive) prefix
    const competitionDateObj = new Date(competitionDate);
    const cutoffDate = new Date('2025-06-01');
    const shouldUseInactive = competitionDateObj < cutoffDate;
    
    // Try exact matches - prioritizing inactive for old dates
    const divisionVariants = shouldUseInactive ? [
        `(Inactive) ${division}`,  // Priority for pre-2025
        division                   // Fallback
    ] : [
        division,                  // Priority for post-2025  
        `(Inactive) ${division}`   // Fallback
    ];
    
    // Try each variant for exact matches ONLY
    for (const variant of divisionVariants) {
        log(`    Checking division variant: "${variant}"`);
        if (divisionCodes[variant]) {
            log(`    Found exact division match: "${variant}" -> ${divisionCodes[variant]}`);
            return buildSport80URLWithCode(divisionCodes[variant], competitionDate);
        } else {
            log(`    No match for variant: "${variant}"`);
        }
    }
    
    log(`    No division match found for: "${division}"`);
    return null;
}

// Scrape biographical data from Sport80 reverse lookup
async function scrapeBiographicalData(url, targetAthleteName) {
    // Check cache first
    const cacheKey = `${url}_${targetAthleteName}`;
    if (biographicalCache.has(cacheKey)) {
        log(`    Using cached data for ${targetAthleteName}`);
        return biographicalCache.get(cacheKey);
    }

    try {
        log(`    Scraping biographical data from reverse lookup with pagination...`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        let allBiographicalData = [];
        let currentPage = 1;
        let hasNextPage = true;
        
        // Loop through all pages to find the athlete
        while (hasNextPage && currentPage <= 10) { // Limit to 10 pages max for safety
            log(`    Checking page ${currentPage} for ${targetAthleteName}`);
            
            // Scrape current page
            let biographicalData = await page.evaluate((athleteName) => {
                const results = [];
                
                // Look for table rows containing athlete data
                const rows = document.querySelectorAll('tr, .athlete-row, .result-row');
                
                for (const row of rows) {
                    const text = row.textContent;
                    
                    // Check if this row contains the target athlete's name
                    if (text.includes(athleteName)) {
                        // Try to extract structured data from table cells
                        const cells = row.querySelectorAll('td');
                        
                        if (cells.length >= 8) { // Expect enough columns for full athlete data
                            const athleteData = {
                                national_rank: cells[0]?.textContent?.trim() || null,
                                total: cells[2]?.textContent?.trim() || null,
                                athlete_name: cells[3]?.textContent?.trim() || null,
                                gender: cells[4]?.textContent?.trim() || null,
                                birth_year: cells[5]?.textContent?.trim() || null,
                                club_name: cells[6]?.textContent?.trim() || null,
                                membership_number: cells[7]?.textContent?.trim() || null,
                                level: cells[8]?.textContent?.trim() || null,
                                wso: cells[12]?.textContent?.trim() || null
                            };
                            
                            // Clean up and validate data
                            if (athleteData.birth_year) {
                                const year = parseInt(athleteData.birth_year);
                                athleteData.birth_year = (year >= 1900 && year <= 2020) ? year : null;
                            }
                            
                            if (athleteData.membership_number) {
                                const membership = parseInt(athleteData.membership_number);
                                athleteData.membership_number = (membership > 0) ? membership : null;
                            }
                            
                            if (athleteData.national_rank) {
                                const rank = parseInt(athleteData.national_rank);
                                athleteData.national_rank = (rank > 0) ? rank : null;
                            }
                            
                            // Only add if athlete name matches
                            if (athleteData.athlete_name && 
                                athleteData.athlete_name.includes(athleteName)) {
                                results.push(athleteData);
                            }
                        }
                    }
                }
                
                return results;
            }, targetAthleteName);
            
            // Add results from this page
            allBiographicalData.push(...biographicalData);
            
            // If we found matches on this page, we can stop searching
            if (biographicalData.length > 0) {
                log(`    ✅ Found ${biographicalData.length} biographical matches for ${targetAthleteName} on page ${currentPage}`);
                break;
            }
            
            // Check for next page button and click it
            try {
                // Multiple possible selectors for the next button
                const nextButtonSelectors = [
                    'i.mdi-chevron-right:last-of-type',  // Last chevron right icon
                    '.v-pagination__next:not(.v-pagination__next--disabled)',
                    '[aria-label*="next" i]',
                    'button[aria-label*="next" i]',
                    '.v-btn:has(i.mdi-chevron-right):last-of-type'
                ];
                
                let nextButton = null;
                let selectorUsed = '';
                
                // Try each selector until we find a clickable next button
                for (const selector of nextButtonSelectors) {
                    try {
                        const buttons = await page.$$(selector);
                        if (buttons.length > 0) {
                            // For chevron selectors, get the last one (usually "next")
                            const candidateButton = buttons[buttons.length - 1];
                            
                            // Check if button is enabled/clickable
                            const isClickable = await page.evaluate((btn) => {
                                const button = btn.closest('button');
                                if (!button) return false;
                                
                                return !button.disabled && 
                                       !button.classList.contains('v-btn--disabled') &&
                                       !button.classList.contains('disabled') &&
                                       button.getAttribute('disabled') === null;
                            }, candidateButton);
                            
                            if (isClickable) {
                                nextButton = candidateButton;
                                selectorUsed = selector;
                                break;
                            }
                        }
                    } catch (selectorError) {
                        // Continue to next selector
                        continue;
                    }
                }
                
                if (nextButton) {
                    log(`    Moving to page ${currentPage + 1} using selector: ${selectorUsed}...`);
                    
                    // Click the button (or its parent button element)
                    await page.evaluate((btn) => {
                        const button = btn.closest('button') || btn;
                        button.click();
                    }, nextButton);
                    
                    // Wait for page to load
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await page.waitForSelector('table', { timeout: 10000 });
                    
                    currentPage++;
                } else {
                    log(`    No clickable next page button found - stopping at page ${currentPage}`);
                    hasNextPage = false;
                }
            } catch (error) {
                log(`    Error navigating to next page: ${error.message} - stopping search`);
                hasNextPage = false;
            }
        }
        
        // Cache the result
        biographicalCache.set(cacheKey, allBiographicalData);
        
        if (allBiographicalData.length > 0) {
            log(`    Found ${allBiographicalData.length} total biographical matches for ${targetAthleteName} across ${currentPage} pages`);
            return allBiographicalData[0]; // Return the first/best match
        } else {
            log(`    No biographical data found for ${targetAthleteName} across ${currentPage} pages`);
            return null;
        }
        
    } catch (error) {
        log(`    Error scraping biographical data: ${error.message}`);
        return null;
    }
}

// Attempt to find biographical data for a meet result using reverse URL lookup
async function findBiographicalData(meetResult) {
    try {
        if (meetResult.age_category && meetResult.weight_class && meetResult.date) {
            const division = `${meetResult.age_category} ${meetResult.weight_class}`;
            const reverseUrl = buildSport80URL(division, meetResult.date);
            
            if (reverseUrl) {
                log(`    Trying reverse lookup for ${meetResult.lifter_name} in ${division} on ${meetResult.date}`);
                log(`    Generated URL: ${reverseUrl}`);
                const biographicalData = await scrapeBiographicalData(reverseUrl, meetResult.lifter_name);
                
                if (biographicalData) {
                    log(`    ✅ Found biographical data via reverse lookup`);
                    return {
                        biographical_data: biographicalData,
                        found_via: `Reverse lookup: ${division} on ${meetResult.date}`
                    };
                }
            }
        }
        
        log(`    No suitable data for reverse lookup - cannot find biographical data`);
        return null;
        
    } catch (error) {
        log(`    Error finding biographical data for ${meetResult.lifter_name}: ${error.message}`);
        return null;
    }
}

// Get meet results for WSO verification (ALL results, not just missing)
async function getAllWsoResults() {
    log('Scanning ALL meet results for WSO verification...');
    
    let allResults = [];
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
        const { data: batchData, error } = await supabase
            .from('meet_results')
            .select('result_id, lifter_id, lifter_name, date, age_category, weight_class, meet_name, wso, gender, birth_year, club_name, national_rank, competition_age, created_at, updated_at')
            .not('age_category', 'is', null)
            .not('weight_class', 'is', null)
            .not('lifter_name', 'is', null)
            .order('date', { ascending: false }) // Process recent meets first
            .range(start, start + batchSize - 1);
        
        if (error) {
            throw new Error(`Failed to fetch meet results for WSO verification: ${error.message}`);
        }
        
        if (batchData && batchData.length > 0) {
            allResults.push(...batchData);
            log(`  Batch ${Math.floor(start/batchSize) + 1}: Found ${batchData.length} results (Total: ${allResults.length})`);
            
            // Check if we got a full batch (indicates more records might exist)
            hasMore = batchData.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }
    
    log(`Found ${allResults.length} total meet results for WSO verification`);
    return allResults;
}

// Get total meet results count for statistics
async function getTotalMeetResultsCount() {
    try {
        log('Attempting to count total meet results...');
        
        const { count, error } = await supabase
            .from('meet_results')
            .select('result_id', { count: 'exact', head: true })
            .not('age_category', 'is', null)
            .not('weight_class', 'is', null);
        
        if (error) {
            log(`❌ Supabase count error: ${error.message}`);
            log(`   Error code: ${error.code || 'N/A'}`);
            log(`   Error details: ${error.details || 'N/A'}`);
            log(`   Error hint: ${error.hint || 'N/A'}`);
            throw new Error(`Failed to count total meet results: ${error.message} (code: ${error.code || 'unknown'})`);
        }
        
        if (count === null || count === undefined) {
            log('⚠️  Count returned null/undefined, using fallback method...');
            return await getTotalMeetResultsCountFallback();
        }
        
        log(`✅ Successfully counted ${count} total meet results`);
        return count;
        
    } catch (error) {
        log(`❌ Unexpected error in getTotalMeetResultsCount: ${error.message}`);
        log('   Attempting fallback counting method...');
        
        try {
            return await getTotalMeetResultsCountFallback();
        } catch (fallbackError) {
            log(`❌ Fallback count method also failed: ${fallbackError.message}`);
            throw new Error(`Both primary and fallback count methods failed. Primary: ${error.message}, Fallback: ${fallbackError.message}`);
        }
    }
}

// Fallback method to count meet results using alternative approach
async function getTotalMeetResultsCountFallback() {
    log('Using fallback method to count meet results...');
    
    // Try getting a small batch and checking if we can count at all
    const { data, error } = await supabase
        .from('meet_results')
        .select('result_id')
        .not('age_category', 'is', null)
        .not('weight_class', 'is', null)
        .limit(1);
    
    if (error) {
        throw new Error(`Fallback count failed - cannot access meet_results table: ${error.message}`);
    }
    
    if (!data || data.length === 0) {
        log('⚠️  No meet results found in database');
        return 0;
    }
    
    // If we can access the table, estimate count by using range queries
    log('✅ Table accessible, but exact count unavailable. Proceeding without total count...');
    return null; // Indicates we should proceed without total count
}

// Analyze missing WSO patterns
function analyzeMissingWsoPatterns(missingResults) {
    const patterns = {
        recent_results: 0,           // Created in last 30 days
        by_age_category: {},         // Count by age category
        by_weight_class: {},         // Count by weight class
        by_meet: {},                 // Count by meet
        by_creation_date: {}
    };
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    for (const result of missingResults) {
        // Check if recent
        const createdAt = new Date(result.created_at);
        if (createdAt > thirtyDaysAgo) {
            patterns.recent_results++;
        }
        
        // Group by age category
        const ageCategory = result.age_category || 'Unknown';
        patterns.by_age_category[ageCategory] = (patterns.by_age_category[ageCategory] || 0) + 1;
        
        // Group by weight class
        const weightClass = result.weight_class || 'Unknown';
        patterns.by_weight_class[weightClass] = (patterns.by_weight_class[weightClass] || 0) + 1;
        
        // Group by meet
        const meetName = result.meet_name || 'Unknown';
        patterns.by_meet[meetName] = (patterns.by_meet[meetName] || 0) + 1;
        
        // Group by creation date
        const dateKey = createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
        patterns.by_creation_date[dateKey] = (patterns.by_creation_date[dateKey] || 0) + 1;
    }
    
    return patterns;
}

// Main scan function
async function performWsoScan() {
    const startTime = Date.now();
    
    try {
        log('🔍 Starting missing WSO data scan');
        log('='.repeat(60));
        
        // Initialize Supabase client
        initializeSupabase();
        
        // Test Supabase connection first
        await testSupabaseConnection();
        
        // Parse options
        const options = parseArguments();
        if (options.showDetails) {
            log('📊 Running with detailed output enabled');
        }
        if (options.findData) {
            log('🔍 Running with WSO data lookup enabled');
        }
        
        // Get data - ALL results for verification
        const [allResults, totalResults] = await Promise.all([
            getAllWsoResults(),
            getTotalMeetResultsCount()
        ]);
        
        // Initialize browser if we need to verify WSO data
        let foundData = [];
        let dataUpdates = 0;
        let verifiedCorrect = 0;
        let correctedData = 0;
        let skippedCount = 0;
        let missingCount = allResults.filter(r => !r.wso).length;
        
        if (options.findData && allResults.length > 0) {
            await initBrowser();
            
            log('\n🔍 Verifying ALL WSO data using reverse URL lookup...');
            log(`   Processing ${allResults.length} total results`);
            log(`   ${missingCount} missing WSO, ${allResults.length - missingCount} have existing WSO`);
            
            // Process ALL results for verification
            const resultsToProcess = allResults;
            
            for (let i = 0; i < resultsToProcess.length; i++) {
                const result = resultsToProcess[i];
                log(`\n📋 [${i+1}/${resultsToProcess.length}] Processing ${result.lifter_name} (result_id: ${result.result_id})`);
                
                // Check if this result was recently updated (on or after 9/1/2025)
                const skipDate = new Date('2025-09-01');
                const updatedDate = result.updated_at ? new Date(result.updated_at) : new Date(result.created_at);
                
                if (updatedDate >= skipDate) {
                    log(`    ⏭️ Skipping - already updated on ${updatedDate.toISOString().split('T')[0]} (>= 2025-09-01)`);
                    skippedCount++;
                    continue;
                }
                
                const foundBiographicalData = await findBiographicalData(result);
                
                if (foundBiographicalData && foundBiographicalData.biographical_data) {
                    const bioData = foundBiographicalData.biographical_data;
                    const existingWso = result.wso;
                    const foundWso = bioData.wso;
                    
                    // Calculate competition age if we have birth year and competition date
                    let calculatedAge = null;
                    if (bioData.birth_year && result.date) {
                        const competitionYear = new Date(result.date).getFullYear();
                        calculatedAge = competitionYear - bioData.birth_year;
                        log(`    🎂 Calculated competition age: ${calculatedAge} (${competitionYear} - ${bioData.birth_year})`);
                    }
                    
                    log(`    💾 Existing WSO: ${existingWso || 'NULL'}`);
                    log(`    🌐 Found WSO: ${foundWso || 'NULL'}`);
                    log(`    👤 Current gender: ${result.gender || 'NULL'} → Found: ${bioData.gender || 'NULL'}`);
                    log(`    📅 Current birth year: ${result.birth_year || 'NULL'} → Found: ${bioData.birth_year || 'NULL'}`);
                    log(`    🏋️ Current club: ${result.club_name || 'NULL'} → Found: ${bioData.club_name || 'NULL'}`);
                    log(`    🏆 Current national rank: ${result.national_rank || 'NULL'} → Found: ${bioData.national_rank || 'NULL'}`);
                    log(`    🎯 Current competition age: ${result.competition_age || 'NULL'} → Calculated: ${calculatedAge || 'NULL'}`);
                    
                    // Build update object
                    const updateData = {
                        updated_at: new Date().toISOString()
                    };
                    
                    let updateReason = '';
                    
                    // WSO comparison logic
                    if (!existingWso && foundWso) {
                        // Missing WSO - add it
                        updateData.wso = foundWso;
                        updateReason = 'Added missing WSO';
                        log(`    ➕ Adding missing WSO: ${foundWso}`);
                    } else if (existingWso && foundWso && existingWso !== foundWso) {
                        // WSO mismatch - correct it
                        updateData.wso = foundWso;
                        updateReason = `Corrected WSO: ${existingWso} → ${foundWso}`;
                        correctedData++;
                        log(`    🔄 Correcting WSO: ${existingWso} → ${foundWso}`);
                    } else if (existingWso && foundWso && existingWso === foundWso) {
                        // WSO matches - verified correct
                        verifiedCorrect++;
                        log(`    ✅ WSO verified correct: ${existingWso}`);
                    } else if (existingWso && !foundWso) {
                        // Have WSO but couldn't verify - leave as is
                        log(`    ⚠️ Could not verify existing WSO: ${existingWso}`);
                    }
                    
                    // Update other biographical fields that are missing
                    if (!result.gender && bioData.gender) {
                        updateData.gender = bioData.gender;
                        log(`    👤 Adding gender: ${bioData.gender}`);
                    }
                    if (!result.birth_year && bioData.birth_year) {
                        updateData.birth_year = bioData.birth_year;
                        log(`    📅 Adding birth year: ${bioData.birth_year}`);
                    }
                    if (!result.club_name && bioData.club_name) {
                        updateData.club_name = bioData.club_name;
                        log(`    🏋️ Adding club: ${bioData.club_name}`);
                    }
                    if (!result.national_rank && bioData.national_rank) {
                        updateData.national_rank = bioData.national_rank;
                        log(`    🏆 Adding national rank: ${bioData.national_rank}`);
                    }
                    // Add competition age if calculated and missing
                    if (calculatedAge && !result.competition_age) {
                        updateData.competition_age = calculatedAge;
                        log(`    🎯 Adding competition age: ${calculatedAge}`);
                    }
                    
                    // Only update if we have at least one new piece of data
                    const fieldsToUpdate = Object.keys(updateData).filter(key => key !== 'updated_at');
                    if (fieldsToUpdate.length > 0) {
                        const { error } = await supabase
                            .from('meet_results')
                            .update(updateData)
                            .eq('result_id', result.result_id);
                        
                        if (error) {
                            log(`    ❌ Failed to update meet result: ${error.message}`);
                        } else {
                            log(`    ✅ Updated result_id ${result.result_id} with ${fieldsToUpdate.length} fields: ${fieldsToUpdate.join(', ')}`);
                            dataUpdates++;
                            foundData.push({
                                result_id: result.result_id,
                                lifter_name: result.lifter_name,
                                lifter_id: result.lifter_id,
                                updated_fields: fieldsToUpdate,
                                update_reason: updateReason,
                                existing_wso: existingWso,
                                found_wso: foundWso,
                                found_via: foundBiographicalData.found_via,
                                biographical_data: bioData
                            });
                        }
                    } else if (existingWso && foundWso && existingWso === foundWso) {
                        // Record verification even if no update needed
                        foundData.push({
                            result_id: result.result_id,
                            lifter_name: result.lifter_name,
                            lifter_id: result.lifter_id,
                            updated_fields: [],
                            update_reason: 'Verified correct',
                            existing_wso: existingWso,
                            found_wso: foundWso,
                            found_via: foundBiographicalData.found_via,
                            biographical_data: bioData
                        });
                    } else {
                        log(`    ℹ️  No updates needed for ${result.lifter_name}`);
                    }
                }
                
                // Rate limiting between results
                if (i < resultsToProcess.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
            
            // Close browser
            if (browser) {
                await browser.close();
                log('\nBrowser closed');
            }
        }
        
        // Calculate final statistics
        const finalMissingCount = allResults.filter(r => !r.wso).length;
        const missingPercentage = (totalResults && totalResults > 0) ? 
            ((finalMissingCount / totalResults) * 100).toFixed(2) + '%' : 
            (allResults.length > 0 ? ((finalMissingCount / allResults.length) * 100).toFixed(2) + '% (of processed)' : '0%');
        
        // Analyze patterns - focus on the missing ones for pattern analysis
        const missingResults = allResults.filter(r => !r.wso);
        const patterns = analyzeMissingWsoPatterns(missingResults);
        
        // Build report
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                script_name: 'missing-wso-scan',
                script_version: SCRIPT_VERSION,
                processing_time_ms: Date.now() - startTime,
                show_details: options.showDetails,
                find_data: options.findData
            },
            summary: {
                total_meet_results: totalResults,
                results_processed: allResults.length,
                missing_wso_count: finalMissingCount,
                missing_percentage: missingPercentage,
                wso_data_updates: dataUpdates,
                wso_verified_correct: verifiedCorrect,
                wso_corrections_made: correctedData,
                records_skipped: skippedCount,
                lookups_processed: options.findData ? (allResults.length - skippedCount) : 0
            },
            patterns: patterns,
            missing_wso_results: options.showDetails ? missingResults : missingResults.slice(0, 20), // Limit for GitHub Actions
            found_wso_data: foundData
        };
        
        // Save report
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
        log(`📄 Scan report saved to: ${OUTPUT_FILE}`);
        
        // Log summary
        log('\n' + '='.repeat(60));
        log('✅ WSO VERIFICATION AND UPDATE COMPLETE');
        log(`   Total meet results in database: ${totalResults ? totalResults.toLocaleString() : 'Unknown (count failed)'}`);
        log(`   Results processed: ${allResults.length.toLocaleString()}`);
        log(`   Records skipped (updated >= 2025-09-01): ${skippedCount.toLocaleString()}`);
        log(`   Records actually checked: ${(allResults.length - skippedCount).toLocaleString()}`);
        log(`   Missing WSO data: ${finalMissingCount.toLocaleString()} (${missingPercentage})`);
        log(`   WSO verified correct: ${verifiedCorrect.toLocaleString()}`);
        log(`   WSO corrections made: ${correctedData.toLocaleString()}`);
        log(`   Database updates: ${dataUpdates.toLocaleString()}`);
        log(`   Processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);
        
        // Show top missing categories
        log('\n📊 TOP MISSING WSO BY AGE CATEGORY:');
        const topAgeCategories = Object.entries(patterns.by_age_category)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5);
        topAgeCategories.forEach(([category, count]) => {
            log(`   ${category}: ${count}`);
        });
        
        log('\n📊 TOP MISSING WSO BY WEIGHT CLASS:');
        const topWeightClasses = Object.entries(patterns.by_weight_class)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5);
        topWeightClasses.forEach(([weightClass, count]) => {
            log(`   ${weightClass}: ${count}`);
        });
        
        if (options.findData) {
            log(`\n🔍 WSO VERIFICATION RESULTS:`);
            log(`   Total lookups attempted: ${(allResults.length - skippedCount).toLocaleString()}`);
            log(`   Records skipped (recently updated): ${skippedCount.toLocaleString()}`);
            log(`   Records updated: ${dataUpdates.toLocaleString()}`);
            log(`   WSO values verified correct: ${verifiedCorrect.toLocaleString()}`);
            log(`   WSO values corrected: ${correctedData.toLocaleString()}`);
            const checkedResults = allResults.length - skippedCount;
            const verificationRate = checkedResults > 0 ? (((verifiedCorrect + correctedData) / checkedResults) * 100).toFixed(1) : '0';
            log(`   Verification rate: ${verificationRate}%`);
        }
        
        if (finalMissingCount > 0) {
            log('\n📋 SAMPLE MISSING WSO RESULTS:');
            const sampleSize = Math.min(5, finalMissingCount);
            for (let i = 0; i < sampleSize; i++) {
                const result = missingResults[i];
                log(`   • ${result.lifter_name} (result_id: ${result.result_id}) - ${result.age_category} ${result.weight_class} on ${result.date}`);
            }
            
            if (finalMissingCount > sampleSize) {
                log(`   ... and ${finalMissingCount - sampleSize} more (see full report)`);
            }
        }
        
        if (foundData.length > 0) {
            log('\n✅ WSO DATA FOUND AND UPDATED:');
            foundData.slice(0, 10).forEach(found => { // Show first 10
                log(`   • ${found.lifter_name} (result_id: ${found.result_id}) -> updated ${found.updated_fields.join(', ')}`);
                log(`     Found via: ${found.found_via}`);
            });
            
            if (foundData.length > 10) {
                log(`   ... and ${foundData.length - 10} more updates`);
            }
        }
        
        // Determine exit code based on execution success vs data quality findings
        const executionSuccessful = true; // We successfully completed the scan
        const significantProgress = dataUpdates > 0 || verifiedCorrect > 0 || allResults.length > 500;

        // NEW: Check if remaining unassigned meets are legitimately unassignable (no addresses)
        log('\n🔍 Checking addressability of remaining unassigned meets...');
        
        // Query for meets without addresses (cannot be assigned WSOs)
        const { data: meetsWithoutAddresses, error: addressError } = await supabase
            .from('meets')
            .select('meet_id')
            .or('address.is.null,address.eq.')
            .limit(2000); // Safety limit

        const addresslessCount = meetsWithoutAddresses ? meetsWithoutAddresses.length : 0;
        
        if (addressError) {
            log(`⚠️  Could not verify addressless meets: ${addressError.message}`);
            log(`   Proceeding with conservative exit logic...`);
        } else {
            log(`📊 Found ${addresslessCount.toLocaleString()} meets without addresses (legitimately unassignable)`);
        }

        // Calculate potentially problematic unassigned meets
        const potentiallyAssignableUnassigned = Math.max(0, finalMissingCount - addresslessCount);
        
        log(`📊 Assignment Analysis:`);
        log(`   Total missing WSO assignments: ${finalMissingCount.toLocaleString()}`);
        log(`   Meets without addresses (expected): ${addresslessCount.toLocaleString()}`);
        log(`   Potentially problematic unassigned: ${potentiallyAssignableUnassigned.toLocaleString()}`);

        // Fail only if there are many potentially assignable meets that remain unassigned
        // AND we didn't make significant progress
        if (potentiallyAssignableUnassigned > 500 && !significantProgress) {
            log(`
❌ High number of potentially assignable meets remain unassigned (${potentiallyAssignableUnassigned}) with no significant processing progress`);
            log(`   This may indicate a systemic issue requiring investigation`);
            log(`   Note: ${addresslessCount} meets without addresses are expected to remain unassigned`);
            process.exit(1);
        }

        // Special case: if we couldn't check addresses, use more conservative threshold
        if (addressError && finalMissingCount > 2000 && !significantProgress) {
            log(`
⚠️  Could not verify addressless status, but ${finalMissingCount} unassigned meets with no progress may indicate issues`);
            process.exit(1);
        }

        log(`\n✅ WSO scan completed successfully`);
        log(`   Execution successful: ${executionSuccessful}`);
        log(`   Progress made: processed ${allResults.length} records, updated ${dataUpdates}, verified ${verifiedCorrect}`);

        return report;

    } catch (error) {
        log(`\n❌ Scan failed with execution error: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        log(`   This indicates a script execution failure, not just data quality issues`);
        process.exit(1);
    }
}

// Export for use by other scripts
module.exports = { 
    performWsoScan,
    getAllWsoResults,
    analyzeMissingWsoPatterns
};

// Run if called directly
if (require.main === module) {
    ensureDirectories();
    performWsoScan();
}