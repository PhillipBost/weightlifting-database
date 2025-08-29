/**
 * MISSING MEMBERSHIP NUMBER SCAN SCRIPT
 * 
 * Purpose: Scans the lifters table for records missing membership numbers
 * to identify potential data quality issues or incomplete cleanup.
 * 
 * This helps monitor:
 * - New lifter_ids created by contamination cleanup that need membership assignment
 * - Data quality issues in the lifters table
 * - Impact of contamination cleanup processes
 * 
 * Usage:
 *   node missing-membership-scan.js
 *   node missing-membership-scan.js --show-details
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'missing_membership_scan_report.json');
const LOG_FILE = path.join(LOGS_DIR, 'missing-membership-scan.log');
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

// Cache for membership lookups to avoid duplicate requests
const membershipCache = new Map();

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
        findMemberships: process.env.FIND_MEMBERSHIPS === 'true' || args.includes('--find-memberships')
    };
    
    return options;
}

// Initialize browser for USAW scraping
async function initBrowser() {
    log('Initializing browser for membership lookup...');
    
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
    log(`    Available divisions: ${Object.keys(divisionCodes).length} total`);
    return null;
}

// Scrape biographical data from Sport80 reverse lookup
async function scrapeBiographicalData(url, targetAthleteName) {
    // Check cache first
    const cacheKey = `${url}_${targetAthleteName}`;
    if (membershipCache.has(cacheKey)) {
        log(`    Using cached data for ${targetAthleteName}`);
        return membershipCache.get(cacheKey);
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
                                athlete_name: cells[3]?.textContent?.trim() || null,
                                total: cells[2]?.textContent?.trim() || null,
                                gender: cells[4]?.textContent?.trim() || null,
                                age: cells[5]?.textContent?.trim() || null,
                                club_name: cells[6]?.textContent?.trim() || null,
                                membership_number: cells[7]?.textContent?.trim() || null,
                                wso: cells[12]?.textContent?.trim() || ''
                            };
                            
                            // Only add if athlete name matches and has membership number
                            if (athleteData.athlete_name && 
                                athleteData.athlete_name.includes(athleteName) && 
                                athleteData.membership_number) {
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
        membershipCache.set(cacheKey, allBiographicalData);
        
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


// Attempt to find membership number for a lifter using reverse URL lookup only
async function findMembershipNumber(lifter) {
    try {
        // Try reverse lookup using recent meet results
        const { data: recentResults, error } = await supabase
            .from('meet_results')
            .select('meet_name, date, age_category, weight_class')
            .eq('lifter_id', lifter.lifter_id)
            .not('age_category', 'is', null)
            .not('weight_class', 'is', null)
            .order('date', { ascending: false })
            .limit(5);
        
        if (!error && recentResults && recentResults.length > 0) {
            log(`    Found ${recentResults.length} recent meet results - trying reverse lookup`);
            
            // Try to find membership using recent results
            for (const result of recentResults) {
                const division = `${result.age_category} ${result.weight_class}`;
                const reverseUrl = buildSport80URL(division, result.date);
                
                if (reverseUrl) {
                    log(`    Trying reverse lookup for ${lifter.athlete_name} in ${division} on ${result.date}`);
                    log(`    Generated URL: ${reverseUrl}`);
                    const biographicalData = await scrapeBiographicalData(reverseUrl, lifter.athlete_name);
                    
                    if (biographicalData && biographicalData.membership_number) {
                        log(`    ✅ Found membership number ${biographicalData.membership_number} via reverse lookup`);
                        return {
                            membership_number: parseInt(biographicalData.membership_number),
                            found_via: `Reverse lookup: ${division} on ${result.date}`,
                            biographical_data: biographicalData
                        };
                    }
                    
                    // Rate limiting
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        
        // If no meet results found, we cannot proceed
        if (!recentResults || recentResults.length === 0) {
            log(`    No suitable meet results found for reverse lookup - cannot find membership number`);
        }
        
        log(`    No membership number found for ${lifter.athlete_name} using either method`);
        return null;
        
    } catch (error) {
        log(`    Error finding membership for ${lifter.athlete_name}: ${error.message}`);
        return null;
    }
}

// Get lifters missing membership numbers
async function getMissingMembershipLifters() {
    log('Scanning for lifters missing membership numbers...');
    
    let allMissingLifters = [];
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
        const { data: batchData, error } = await supabase
            .from('lifters')
            .select('lifter_id, athlete_name, internal_id, internal_id_2, internal_id_3, internal_id_4, internal_id_5, internal_id_6, internal_id_7, internal_id_8, created_at, updated_at')
            .is('membership_number', null)
            .not('internal_id', 'is', null) // Only include lifters that have internal_ids
            .order('created_at', { ascending: false })
            .range(start, start + batchSize - 1);
        
        if (error) {
            throw new Error(`Failed to fetch lifters missing membership numbers: ${error.message}`);
        }
        
        if (batchData && batchData.length > 0) {
            allMissingLifters.push(...batchData);
            log(`  Batch ${Math.floor(start/batchSize) + 1}: Found ${batchData.length} lifters (Total: ${allMissingLifters.length})`);
            
            // Check if we got a full batch (indicates more records might exist)
            hasMore = batchData.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }
    
    log(`Found ${allMissingLifters.length} total lifters missing membership numbers`);
    return allMissingLifters;
}

// Get total lifter count for statistics
async function getTotalLifterCount() {
    const { count, error } = await supabase
        .from('lifters')
        .select('lifter_id', { count: 'exact', head: true })
        .not('internal_id', 'is', null);
    
    if (error) {
        throw new Error(`Failed to count total lifters: ${error.message}`);
    }
    
    return count;
}

// Get lifters with membership numbers for statistics
async function getLiftersWithMembershipCount() {
    const { count, error } = await supabase
        .from('lifters')
        .select('lifter_id', { count: 'exact', head: true })
        .not('membership_number', 'is', null)
        .not('internal_id', 'is', null);
    
    if (error) {
        throw new Error(`Failed to count lifters with membership numbers: ${error.message}`);
    }
    
    return count;
}

// Analyze missing membership patterns
function analyzeMissingMembershipPatterns(missingLifters) {
    const patterns = {
        recent_lifters: 0,           // Created in last 30 days
        contamination_cleanup: 0,    // Lifter_ids in 196xxx-199xxx range (likely from cleanup)
        single_internal_id: 0,       // Have only one internal_id
        multiple_internal_ids: 0,    // Have multiple internal_ids (Type 1 contamination)
        by_creation_date: {}
    };
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    for (const lifter of missingLifters) {
        // Check if recent
        const createdAt = new Date(lifter.created_at);
        if (createdAt > thirtyDaysAgo) {
            patterns.recent_lifters++;
        }
        
        // Check if likely from contamination cleanup
        if (lifter.lifter_id >= 196000) {
            patterns.contamination_cleanup++;
        }
        
        // Count internal_ids
        const internalIds = [
            lifter.internal_id,
            lifter.internal_id_2,
            lifter.internal_id_3,
            lifter.internal_id_4,
            lifter.internal_id_5,
            lifter.internal_id_6,
            lifter.internal_id_7,
            lifter.internal_id_8
        ].filter(Boolean);
        
        if (internalIds.length === 1) {
            patterns.single_internal_id++;
        } else {
            patterns.multiple_internal_ids++;
        }
        
        // Group by creation date
        const dateKey = createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
        patterns.by_creation_date[dateKey] = (patterns.by_creation_date[dateKey] || 0) + 1;
    }
    
    return patterns;
}

// Main scan function
async function performMissingScan() {
    const startTime = Date.now();
    
    try {
        log('🔍 Starting missing membership number scan');
        log('='.repeat(60));
        
        // Parse options
        const options = parseArguments();
        if (options.showDetails) {
            log('📊 Running with detailed output enabled');
        }
        if (options.findMemberships) {
            log('🔍 Running with membership lookup enabled');
        }
        
        // Get data
        const [missingLifters, totalLifters, liftersWithMembership] = await Promise.all([
            getMissingMembershipLifters(),
            getTotalLifterCount(),
            getLiftersWithMembershipCount()
        ]);
        
        // Initialize browser if we need to find memberships
        let foundMemberships = [];
        let membershipUpdates = 0;
        if (options.findMemberships && missingLifters.length > 0) {
            await initBrowser();
            
            log('\n🔍 Attempting to find membership numbers using reverse URL lookup...');
            
            // Process a limited number of lifters to avoid overwhelming the system
            const maxLookups = missingLifters.length; // Process all missing lifters
            const liftersToProcess = missingLifters.slice(0, maxLookups);
            
            for (let i = 0; i < liftersToProcess.length; i++) {
                const lifter = liftersToProcess[i];
                log(`\n📋 [${i+1}/${liftersToProcess.length}] Processing ${lifter.athlete_name} (lifter_id: ${lifter.lifter_id})`);
                
                const foundData = await findMembershipNumber(lifter);
                
                if (foundData && foundData.membership_number) {
                    // Check if this membership number is already assigned to another lifter
                    const { data: existingLifter, error: checkError } = await supabase
                        .from('lifters')
                        .select('lifter_id, athlete_name')
                        .eq('membership_number', foundData.membership_number)
                        .single();
                    
                    if (checkError && checkError.code !== 'PGRST116') {
                        log(`    ❌ Error checking existing membership number: ${checkError.message}`);
                        continue;
                    }
                    
                    if (existingLifter) {
                        log(`    ⚠️  Membership ${foundData.membership_number} already assigned to ${existingLifter.athlete_name} (lifter_id: ${existingLifter.lifter_id})`);
                        log(`    🔄 REASSIGNING: Moving membership from lifter_id ${existingLifter.lifter_id} to lifter_id ${lifter.lifter_id} (internal_id ${lifter.internal_id} is source of truth)`);
                        
                        // Clear the incorrect assignment
                        const { error: clearError } = await supabase
                            .from('lifters')
                            .update({ membership_number: null, updated_at: new Date().toISOString() })
                            .eq('lifter_id', existingLifter.lifter_id);
                        
                        if (clearError) {
                            log(`    ❌ Failed to clear incorrect assignment: ${clearError.message}`);
                            continue;
                        } else {
                            log(`    ✅ Cleared membership from lifter_id ${existingLifter.lifter_id}`);
                        }
                    }
                    
                    // Safe to update - membership number is not already in use
                    const { error } = await supabase
                        .from('lifters')
                        .update({ 
                            membership_number: foundData.membership_number,
                            updated_at: new Date().toISOString()
                        })
                        .eq('lifter_id', lifter.lifter_id);
                    
                    if (error) {
                        log(`    ❌ Failed to update membership number: ${error.message}`);
                    } else {
                        log(`    ✅ Updated lifter_id ${lifter.lifter_id} with membership ${foundData.membership_number}`);
                        membershipUpdates++;
                        foundMemberships.push({
                            lifter_id: lifter.lifter_id,
                            athlete_name: lifter.athlete_name,
                            membership_number: foundData.membership_number,
                            found_via: foundData.found_via,
                            biographical_data: foundData.biographical_data
                        });
                    }
                }
                
                // Rate limiting between athletes
                if (i < liftersToProcess.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
            
            // Close browser
            if (browser) {
                await browser.close();
                log('\nBrowser closed');
            }
        }
        
        // Calculate statistics
        const missingCount = missingLifters.length;
        const missingPercentage = totalLifters > 0 ? ((missingCount / totalLifters) * 100).toFixed(2) + '%' : '0%';
        
        // Analyze patterns
        const patterns = analyzeMissingMembershipPatterns(missingLifters);
        
        // Build report
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                script_name: 'missing-membership-scan',
                script_version: SCRIPT_VERSION,
                processing_time_ms: Date.now() - startTime,
                show_details: options.showDetails,
                find_memberships: options.findMemberships
            },
            summary: {
                total_lifters: totalLifters,
                has_membership_count: liftersWithMembership,
                missing_membership_count: missingCount,
                missing_percentage: missingPercentage,
                memberships_found: membershipUpdates,
                memberships_processed: options.findMemberships ? missingLifters.length : 0
            },
            patterns: patterns,
            missing_membership_athletes: options.showDetails ? missingLifters : missingLifters.slice(0, 20), // Limit for GitHub Actions
            found_memberships: foundMemberships
        };
        
        // Save report
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
        log(`📄 Scan report saved to: ${OUTPUT_FILE}`);
        
        // Log summary
        log('\n' + '='.repeat(60));
        log('✅ MISSING MEMBERSHIP SCAN COMPLETE');
        log(`   Total lifters: ${totalLifters}`);
        log(`   Have membership: ${liftersWithMembership}`);
        log(`   Missing membership: ${missingCount} (${missingPercentage})`);
        log(`   Recent lifters (30 days): ${patterns.recent_lifters}`);
        log(`   Likely from cleanup: ${patterns.contamination_cleanup}`);
        log(`   Single internal_id: ${patterns.single_internal_id}`);
        log(`   Multiple internal_ids: ${patterns.multiple_internal_ids}`);
        log(`   Processing time: ${Date.now() - startTime}ms`);
        
        if (options.findMemberships) {
            log(`   Membership lookups attempted: ${missingLifters.length}`);
            log(`   Membership numbers found and updated: ${membershipUpdates}`);
        }
        
        if (missingCount > 0) {
            log('\n📋 SAMPLE MISSING MEMBERSHIP ATHLETES:');
            const sampleSize = Math.min(5, missingCount);
            for (let i = 0; i < sampleSize; i++) {
                const lifter = missingLifters[i];
                const internalIds = [lifter.internal_id, lifter.internal_id_2, lifter.internal_id_3].filter(Boolean);
                log(`   • ${lifter.athlete_name} (lifter_id: ${lifter.lifter_id}, internal_ids: ${internalIds.join(', ')})`);
            }
            
            if (missingCount > sampleSize) {
                log(`   ... and ${missingCount - sampleSize} more (see full report)`);
            }
        }
        
        if (foundMemberships.length > 0) {
            log('\n✅ MEMBERSHIP NUMBERS FOUND AND UPDATED:');
            foundMemberships.forEach(found => {
                log(`   • ${found.athlete_name} (lifter_id: ${found.lifter_id}) -> membership ${found.membership_number}`);
                log(`     Found via: ${found.found_via}`);
            });
        }
        
        return report;
        
    } catch (error) {
        log(`\n❌ Scan failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Export for use by other scripts
module.exports = { 
    performMissingScan,
    getMissingMembershipLifters,
    analyzeMissingMembershipPatterns
};

// Run if called directly
if (require.main === module) {
    ensureDirectories();
    performMissingScan();
}