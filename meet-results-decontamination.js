/**
 * MEET RESULTS DECONTAMINATION SCRIPT
 * 
 * Purpose: Fixes Type 2 contamination where multiple distinct athletes' 
 * meet results are incorrectly assigned to a single lifter_id/internal_id.
 * 
 * Process:
 * 1. Scrapes each athlete's USAW member URL to get their correct meet list
 * 2. Compares with database results currently assigned to their lifter_id
 * 3. Reassigns meet results to the correct lifter_ids based on USAW data
 * 
 * Usage:
 *   node meet-results-decontamination.js
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
const REPORT_FILE = path.join(OUTPUT_DIR, 'meet_results_decontamination_report.json');
const LOG_FILE = path.join(LOGS_DIR, 'meet-results-decontamination.log');
const SCRIPT_VERSION = '1.0.0';
const REQUEST_DELAY = 2000; // 2 seconds between requests

// Load athletes to process from detection results or command line
async function loadAthletesToProcess() {
    const DETECTION_FILE = './output/type2_contamination_detection.json';
    
    // Check for command line athlete names
    const targetAthletes = process.env.TARGET_ATHLETES;
    if (targetAthletes) {
        log(`Using command line target athletes: ${targetAthletes}`);
        const athleteNames = targetAthletes.split(',').map(name => name.trim());
        return await loadAthletesByNames(athleteNames);
    }
    
    // Try to load from detection results
    if (fs.existsSync(DETECTION_FILE)) {
        log(`Loading athletes from detection results: ${DETECTION_FILE}`);
        const detectionData = JSON.parse(fs.readFileSync(DETECTION_FILE, 'utf8'));
        
        if (detectionData.contaminated_athletes && detectionData.contaminated_athletes.length > 0) {
            return await loadAthletesFromDetection(detectionData.contaminated_athletes);
        } else {
            log('No contaminated athletes found in detection results');
            return [];
        }
    }
    
    // Fallback to Paul Smith test case
    log('No detection results or target athletes specified - using Paul Smith test case');
    return [
        {
            lifter_id: 199252,
            athlete_name: 'Paul Smith',
            membership_number: 116344,
            internal_id: 422,
            usaw_url: 'https://usaweightlifting.sport80.com/public/rankings/member/422'
        },
        {
            lifter_id: 600,
            athlete_name: 'Paul Smith', 
            membership_number: 160878,
            internal_id: 35801,
            usaw_url: 'https://usaweightlifting.sport80.com/public/rankings/member/35801'
        },
        {
            lifter_id: 199253,
            athlete_name: 'Paul Smith',
            membership_number: 153747,
            internal_id: 1552,
            usaw_url: 'https://usaweightlifting.sport80.com/public/rankings/member/1552'
        }
    ];
}

// Load athletes from detection results
async function loadAthletesFromDetection(contaminatedAthletes) {
    const athletes = [];
    
    for (const detected of contaminatedAthletes) {
        // Get the lifter record from database to build the processing object
        const { data: lifter, error } = await supabase
            .from('lifters')
            .select('lifter_id, athlete_name, membership_number, internal_id')
            .eq('lifter_id', detected.lifter_id)
            .single();
        
        if (error) {
            log(`⚠️  Could not load lifter_id ${detected.lifter_id}: ${error.message}`);
            continue;
        }
        
        if (!lifter.internal_id) {
            log(`⚠️  Skipping lifter_id ${detected.lifter_id} - no internal_id`);
            continue;
        }
        
        athletes.push({
            lifter_id: lifter.lifter_id,
            athlete_name: lifter.athlete_name,
            membership_number: lifter.membership_number,
            internal_id: lifter.internal_id,
            usaw_url: `https://usaweightlifting.sport80.com/public/rankings/member/${lifter.internal_id}`,
            confidence_score: detected.confidence_score,
            contamination_indicators: detected.contamination_indicators
        });
    }
    
    log(`Loaded ${athletes.length} athletes from detection results`);
    return athletes;
}

// Load athletes by names (for command line targeting)
async function loadAthletesByNames(athleteNames) {
    const athletes = [];
    
    for (const name of athleteNames) {
        const { data: lifters, error } = await supabase
            .from('lifters')
            .select('lifter_id, athlete_name, membership_number, internal_id')
            .eq('athlete_name', name)
            .not('internal_id', 'is', null);
        
        if (error) {
            log(`⚠️  Error loading athletes named "${name}": ${error.message}`);
            continue;
        }
        
        if (lifters.length === 0) {
            log(`⚠️  No athletes found with name "${name}"`);
            continue;
        }
        
        for (const lifter of lifters) {
            athletes.push({
                lifter_id: lifter.lifter_id,
                athlete_name: lifter.athlete_name,
                membership_number: lifter.membership_number,
                internal_id: lifter.internal_id,
                usaw_url: `https://usaweightlifting.sport80.com/public/rankings/member/${lifter.internal_id}`
            });
        }
        
        log(`Found ${lifters.length} lifter_ids for "${name}"`);
    }
    
    log(`Loaded ${athletes.length} total athletes from names`);
    return athletes;
}

// Browser instance
let browser = null;
let page = null;

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

// Initialize browser
async function initBrowser() {
    log('Initializing browser...');
    
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

// Scrape meet results from USAW member URL with pagination support
async function scrapeUSAWMeetResults(athlete) {
    log(`Scraping USAW results for ${athlete.athlete_name} (${athlete.membership_number}) from ${athlete.usaw_url}`);
    
    try {
        await page.goto(athlete.usaw_url, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        await page.waitForSelector('body', { timeout: 10000 });
        
        let allCompetitions = [];
        let currentPage = 1;
        let hasNextPage = true;
        
        // Loop through all pages
        while (hasNextPage) {
            log(`  Scraping page ${currentPage} for ${athlete.athlete_name}`);
            
            // Wait a moment for page to load
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Scrape current page
            const pageCompetitions = await page.evaluate(() => {
                const competitions = [];
                
                try {
                    const tables = document.querySelectorAll('table');
                    
                    if (tables.length === 0) {
                        console.log('No tables found on page');
                        return competitions;
                    }
                    
                    // Process the main results table
                    const resultsTable = tables[0];
                    const rows = resultsTable.querySelectorAll('tr');
                    
                    console.log(`Found ${rows.length} rows in results table`);
                    
                    // Skip header row (index 0), process data rows
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const cells = row.querySelectorAll('td');
                        
                        if (cells.length >= 10) {
                            const competition = {
                                meet_name: cells[0]?.textContent?.trim() || null,
                                date: cells[1]?.textContent?.trim() || null,
                                division: cells[2]?.textContent?.trim() || null,
                                lifter_name: cells[3]?.textContent?.trim() || null,
                                body_weight_kg: cells[4]?.textContent?.trim() || null,
                                snatch_1: cells[5]?.textContent?.trim() || null,
                                snatch_2: cells[6]?.textContent?.trim() || null,
                                snatch_3: cells[7]?.textContent?.trim() || null,
                                cj_1: cells[8]?.textContent?.trim() || null,
                                cj_2: cells[9]?.textContent?.trim() || null,
                                cj_3: cells[10]?.textContent?.trim() || null,
                                best_snatch: cells[11]?.textContent?.trim() || null,
                                best_cj: cells[12]?.textContent?.trim() || null,
                                total: cells[13]?.textContent?.trim() || null
                            };
                            
                            // Only add if we have essential data
                            if (competition.meet_name && competition.date) {
                                competitions.push(competition);
                                console.log(`Added competition: ${competition.meet_name} on ${competition.date}`);
                            }
                        }
                    }
                    
                } catch (error) {
                    console.log('Competition scraping failed:', error.message);
                }
                
                console.log(`Total competitions scraped on this page: ${competitions.length}`);
                return competitions;
            });
            
            // Add this page's competitions to total
            allCompetitions.push(...pageCompetitions);
            log(`    Page ${currentPage}: Found ${pageCompetitions.length} competitions (Total: ${allCompetitions.length})`);
            
            // Check for next page button and click it
            try {
                // Find ALL chevron-right buttons and determine which is the actual "next" button
                const allChevronButtons = await page.$$('i.mdi-chevron-right');
                log(`    Found ${allChevronButtons.length} chevron-right icons on page`);
                
                let nextButton = null;
                
                // Look for the rightmost/last chevron-right (usually the "next" button)
                if (allChevronButtons.length > 0) {
                    // Try the last chevron-right button (usually "next")
                    nextButton = allChevronButtons[allChevronButtons.length - 1];
                }
                
                // Alternative: look for pagination-specific selectors
                if (!nextButton) {
                    const paginationSelectors = [
                        '.v-pagination .v-btn:last-child i.mdi-chevron-right',
                        '[role="navigation"] i.mdi-chevron-right:last-of-type',
                        '.pagination-next i.mdi-chevron-right'
                    ];
                    
                    for (const selector of paginationSelectors) {
                        nextButton = await page.$(selector);
                        if (nextButton) {
                            log(`    Found pagination next button using: ${selector}`);
                            break;
                        }
                    }
                }
                
                if (nextButton) {
                    // Check if the button is clickable
                    const buttonInfo = await page.evaluate((button) => {
                        const actualButton = button.closest('button');
                        if (!actualButton) return { clickable: false, reason: 'No button element found' };
                        
                        const isDisabled = actualButton.disabled || 
                                         actualButton.classList.contains('v-btn--disabled') ||
                                         actualButton.getAttribute('disabled') !== null ||
                                         actualButton.classList.contains('disabled');
                        
                        // Additional check - see if this button has next-like attributes
                        const ariaLabel = actualButton.getAttribute('aria-label') || '';
                        const title = actualButton.getAttribute('title') || '';
                        const isLikelyNext = ariaLabel.toLowerCase().includes('next') || 
                                           title.toLowerCase().includes('next') ||
                                           actualButton.textContent.toLowerCase().includes('next');
                        
                        return {
                            clickable: !isDisabled,
                            disabled: isDisabled,
                            classes: actualButton.className,
                            ariaLabel: ariaLabel,
                            isLikelyNext: isLikelyNext,
                            reason: isDisabled ? 'Button is disabled' : 'Button is enabled'
                        };
                    }, nextButton);
                    
                    log(`    Button status: ${buttonInfo.reason} (likely next: ${buttonInfo.isLikelyNext})`);
                    
                    if (buttonInfo.clickable) {
                        log(`    Clicking next page button...`);
                        
                        // Click the actual button element
                        await page.evaluate((button) => {
                            const actualButton = button.closest('button');
                            if (actualButton) actualButton.click();
                        }, nextButton);
                        
                        currentPage++;
                        
                        // Wait for new page to load
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        
                        // Wait for the table to update
                        await page.waitForSelector('table', { timeout: 5000 });
                    } else {
                        log(`    ${buttonInfo.reason} - reached last page`);
                        hasNextPage = false;
                    }
                } else {
                    log(`    No next page button found - reached last page`);
                    hasNextPage = false;
                }
            } catch (error) {
                log(`    Error navigating to next page: ${error.message}`);
                hasNextPage = false;
            }
            
            // Safety check to prevent infinite loops
            if (currentPage > 20) {
                log(`    Safety limit reached - stopping at page ${currentPage}`);
                hasNextPage = false;
            }
        }
        
        log(`  Complete: Found ${allCompetitions.length} total competitions across ${currentPage} pages for ${athlete.athlete_name} (${athlete.membership_number})`);
        return allCompetitions;
        
    } catch (error) {
        log(`  Error scraping USAW for ${athlete.athlete_name}: ${error.message}`);
        return [];
    }
}

// Get meet results from database for a lifter_id
async function getDatabaseMeetResults(lifter_id) {
    log(`Fetching database results for lifter_id ${lifter_id}`);
    
    const { data: results, error } = await supabase
        .from('meet_results')
        .select('*')
        .eq('lifter_id', lifter_id)
        .order('date', { ascending: false });
    
    if (error) {
        throw new Error(`Failed to fetch meet results for lifter_id ${lifter_id}: ${error.message}`);
    }
    
    log(`  Found ${results.length} results in database for lifter_id ${lifter_id}`);
    return results;
}

// Compare USAW results with database results to find matches
function compareMeetResults(usawResults, dbResults, athlete) {
    log(`Comparing results for ${athlete.athlete_name} (${athlete.membership_number})`);
    
    const matches = [];
    const orphans = [];
    
    // Create a map of USAW results for quick lookup
    const usawResultsMap = new Map();
    usawResults.forEach(result => {
        // Create a key based on meet name and date for matching
        const key = `${result.meet_name}_${result.date}`.toLowerCase().replace(/[^a-z0-9]/g, '');
        usawResultsMap.set(key, result);
    });
    
    // Check each database result against USAW results
    dbResults.forEach(dbResult => {
        const dbKey = `${dbResult.meet_name}_${dbResult.date}`.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        if (usawResultsMap.has(dbKey)) {
            // This result belongs to this athlete
            matches.push({
                result_id: dbResult.result_id,
                meet_name: dbResult.meet_name,
                date: dbResult.date,
                action: 'KEEP',
                reason: 'Found on USAW member page'
            });
        } else {
            // This result does NOT belong to this athlete
            orphans.push({
                result_id: dbResult.result_id,
                meet_name: dbResult.meet_name,
                date: dbResult.date,
                lifter_name: dbResult.lifter_name,
                current_lifter_id: dbResult.lifter_id,
                action: 'REASSIGN',
                reason: 'NOT found on USAW member page - belongs to different athlete'
            });
        }
    });
    
    log(`  Results for ${athlete.athlete_name} (${athlete.membership_number}): ${matches.length} correct, ${orphans.length} orphaned`);
    
    return { matches, orphans };
}

// Reassign orphaned results to correct lifter_ids using cached USAW data
async function reassignOrphanResults(orphans, groupUsawData, athleteGroup, currentAthleteId) {
    log(`Reassigning ${orphans.length} orphaned results`);
    
    const reassignments = [];
    const unassigned = [];
    
    for (const orphan of orphans) {
        let reassigned = false;
        
        // Try to match with other athletes in the group based on the meet
        for (const [athleteKey, usawResults] of Object.entries(groupUsawData)) {
            // Find the athlete object for this cache key
            const athlete = athleteGroup.find(a => `${a.lifter_id}_${a.membership_number}` === athleteKey);
            
            if (!athlete || athlete.lifter_id === currentAthleteId) continue; // Skip current assignment
            
            const usawKey = `${orphan.meet_name}_${orphan.date}`.toLowerCase().replace(/[^a-z0-9]/g, '');
            const hasMatch = usawResults.some(result => {
                const resultKey = `${result.meet_name}_${result.date}`.toLowerCase().replace(/[^a-z0-9]/g, '');
                return resultKey === usawKey;
            });
            
            if (hasMatch) {
                log(`    Reassigning result ${orphan.result_id} from lifter_id ${orphan.current_lifter_id} to ${athlete.lifter_id}`);
                
                // Update the database
                const { error } = await supabase
                    .from('meet_results')
                    .update({ lifter_id: athlete.lifter_id })
                    .eq('result_id', orphan.result_id);
                
                if (error) {
                    log(`    ❌ Failed to reassign result ${orphan.result_id}: ${error.message}`);
                } else {
                    reassignments.push({
                        result_id: orphan.result_id,
                        meet_name: orphan.meet_name,
                        date: orphan.date,
                        from_lifter_id: orphan.current_lifter_id,
                        to_lifter_id: athlete.lifter_id,
                        to_athlete: `${athlete.athlete_name} (${athlete.membership_number})`
                    });
                    reassigned = true;
                    break;
                }
            }
        }
        
        if (!reassigned) {
            log(`    ⚠️  Could not reassign result ${orphan.result_id} - no matching athlete found`);
            unassigned.push(orphan);
        }
    }
    
    return { reassignments, unassigned };
}

// Save individual athlete completion file
function saveAthleteCompletionFile(athleteReport) {
    const safeFileName = athleteReport.athlete_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const membershipSuffix = athleteReport.membership_number ? `_${athleteReport.membership_number}` : '';
    const fileName = `type2_cleanup_${safeFileName}${membershipSuffix}_${athleteReport.lifter_id}.json`;
    const filePath = path.join(OUTPUT_DIR, 'type2_completions', fileName);
    
    // Ensure completions directory exists
    const completionsDir = path.dirname(filePath);
    if (!fs.existsSync(completionsDir)) {
        fs.mkdirSync(completionsDir, { recursive: true });
    }
    
    const completionData = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_name: 'meet-results-decontamination',
            script_version: SCRIPT_VERSION,
            lifter_id: athleteReport.lifter_id,
            athlete_name: athleteReport.athlete_name,
            membership_number: athleteReport.membership_number
        },
        athlete_report: athleteReport,
        status: 'COMPLETED'
    };
    
    fs.writeFileSync(filePath, JSON.stringify(completionData, null, 2));
    log(`✅ Completion file saved: ${filePath}`);
    
    return filePath;
}

// Check if athlete was already processed
function isAthleteAlreadyProcessed(athlete) {
    const safeFileName = athlete.athlete_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const membershipSuffix = athlete.membership_number ? `_${athlete.membership_number}` : '';
    const fileName = `type2_cleanup_${safeFileName}${membershipSuffix}_${athlete.lifter_id}.json`;
    const filePath = path.join(OUTPUT_DIR, 'type2_completions', fileName);
    
    return fs.existsSync(filePath);
}

// Process all athletes with incremental completion
async function processAllAthletes() {
    log('Starting Type 2 contamination cleanup');
    
    const overallStartTime = Date.now();
    const report = {
        started_at: new Date().toISOString(),
        athletes_processed: [],
        total_reassignments: 0,
        unassigned_results: [],
        summary: {}
    };
    
    try {
        // Load athletes to process
        const athletesToProcess = await loadAthletesToProcess();
        
        if (athletesToProcess.length === 0) {
            log('No athletes to process');
            return report;
        }
        
        log(`Found ${athletesToProcess.length} athletes to process`);
        
        // Initialize browser
        await initBrowser();
        
        // Group athletes by name for proper Type 2 contamination cleanup
        const athleteGroups = {};
        athletesToProcess.forEach(athlete => {
            if (!athleteGroups[athlete.athlete_name]) {
                athleteGroups[athlete.athlete_name] = [];
            }
            athleteGroups[athlete.athlete_name].push(athlete);
        });
        
        log(`Grouped ${athletesToProcess.length} athletes into ${Object.keys(athleteGroups).length} athlete name groups`);
        
        // Process each athlete GROUP with full completion
        let groupIndex = 0;
        for (const [athleteName, athleteGroup] of Object.entries(athleteGroups)) {
            groupIndex++;
            const groupStartTime = Date.now();
            
            log(`\n${'='.repeat(80)}`);
            log(`🏋️  PROCESSING ATHLETE GROUP ${groupIndex}/${Object.keys(athleteGroups).length}`);
            log(`    Name: ${athleteName}`);
            log(`    Athletes in group: ${athleteGroup.length}`);
            athleteGroup.forEach((athlete, idx) => {
                log(`      ${idx + 1}. Lifter ID ${athlete.lifter_id} (membership: ${athlete.membership_number}, internal_id: ${athlete.internal_id})`);
            });
            log(`${'='.repeat(80)}`);
            
            // Check if this athlete group was already processed
            const allProcessed = athleteGroup.every(athlete => isAthleteAlreadyProcessed(athlete));
            if (allProcessed) {
                log(`⏭️  Skipping ${athleteName} group - all athletes already completed`);
                continue;
            }
            
            // STEP 1: Scrape USAW results for ALL athletes in this group
            log(`\n🔍 Step 1: Scraping USAW results for all ${athleteName} athletes...`);
            const groupUsawData = {};
            
            for (const athlete of athleteGroup) {
                log(`   Scraping ${athlete.athlete_name} (membership: ${athlete.membership_number}, internal_id: ${athlete.internal_id})`);
                const usawResults = await scrapeUSAWMeetResults(athlete);
                const cacheKey = `${athlete.lifter_id}_${athlete.membership_number}`;
                groupUsawData[cacheKey] = usawResults;
                log(`     Found ${usawResults.length} competitions on USAW`);
                
                // Rate limiting between scrapes
                await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
            }
            
            // STEP 2: Process each athlete in the group for reassignments
            const groupReports = [];
            
            for (const athlete of athleteGroup) {
                log(`\n📊 Processing lifter_id ${athlete.lifter_id} (${athlete.athlete_name})...`);
                
                const athleteReport = {
                    lifter_id: athlete.lifter_id,
                    athlete_name: athlete.athlete_name,
                    membership_number: athlete.membership_number,
                    internal_id: athlete.internal_id,
                    usaw_results_count: 0,
                    db_results_count: 0,
                    correct_results: 0,
                    orphaned_results: 0,
                    reassignments: [],
                    errors: [],
                    processing_time_ms: 0,
                    confidence_score: athlete.confidence_score || null,
                    contamination_indicators: athlete.contamination_indicators || []
                };
                
                try {
                    const athleteStartTime = Date.now();
                    
                    // Get cached USAW results
                    const cacheKey = `${athlete.lifter_id}_${athlete.membership_number}`;
                    const usawResults = groupUsawData[cacheKey] || [];
                    athleteReport.usaw_results_count = usawResults.length;
                    
                    // Get database results for this lifter_id
                    const dbResults = await getDatabaseMeetResults(athlete.lifter_id);
                    athleteReport.db_results_count = dbResults.length;
                    log(`     Database: ${dbResults.length} results, USAW: ${usawResults.length} competitions`);
                    
                    // Compare and identify orphans
                    const { matches, orphans } = compareMeetResults(usawResults, dbResults, athlete);
                    athleteReport.correct_results = matches.length;
                    athleteReport.orphaned_results = orphans.length;
                    log(`     ${matches.length} correct results, ${orphans.length} orphaned results`);
                    
                    // Reassign orphaned results using group USAW data
                    if (orphans.length > 0) {
                        log(`     Reassigning ${orphans.length} orphaned results within group...`);
                        const { reassignments, unassigned } = await reassignOrphanResults(orphans, groupUsawData, athleteGroup, athlete.lifter_id);
                        athleteReport.reassignments = reassignments;
                        report.total_reassignments += reassignments.length;
                        report.unassigned_results.push(...unassigned);
                        log(`     ✅ Reassigned ${reassignments.length} results, ${unassigned.length} unassigned`);
                    }
                    
                    athleteReport.processing_time_ms = Date.now() - athleteStartTime;
                    
                } catch (error) {
                    log(`     ❌ Error processing lifter_id ${athlete.lifter_id}: ${error.message}`);
                    athleteReport.errors.push(error.message);
                }
                
                groupReports.push(athleteReport);
                report.athletes_processed.push(athleteReport);
            }
            
            // STEP 3: Save completion files for all athletes in group
            log(`\n💾 Saving completion files for ${athleteName} group...`);
            for (const athleteReport of groupReports) {
                saveAthleteCompletionFile(athleteReport);
            }
            
            const groupProcessingTime = Date.now() - groupStartTime;
            const totalReassignments = groupReports.reduce((sum, r) => sum + r.reassignments.length, 0);
            
            log(`\n🎉 ATHLETE GROUP COMPLETED: ${athleteName}`);
            log(`   Athletes processed: ${groupReports.length}`);
            log(`   Total reassignments: ${totalReassignments}`);
            log(`   Group processing time: ${groupProcessingTime}ms`);
            
            // Rate limiting between groups
            if (groupIndex < Object.keys(athleteGroups).length) {
                log(`\n⏱️  Rate limiting: waiting ${REQUEST_DELAY}ms before next athlete group...`);
                await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
            }
        }
        
        // Generate summary
        report.summary = {
            athletes_processed: report.athletes_processed.length,
            total_reassignments: report.total_reassignments,
            unassigned_results: report.unassigned_results.length,
            success: report.athletes_processed.every(a => a.errors.length === 0)
        };
        
        report.completed_at = new Date().toISOString();
        
        return report;
        
    } catch (error) {
        log(`Critical error during processing: ${error.message}`);
        report.critical_error = error.message;
        report.completed_at = new Date().toISOString();
        return report;
        
    } finally {
        if (browser) {
            await browser.close();
            log('Browser closed');
        }
    }
}

// Save decontamination report
function saveReport(report) {
    const fullReport = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_name: 'meet-results-decontamination',
            script_version: SCRIPT_VERSION,
            contamination_type: 'Type 2 - Meet Results Contamination'
        },
        report: report
    };
    
    fs.writeFileSync(REPORT_FILE, JSON.stringify(fullReport, null, 2));
    log(`Decontamination report saved to: ${REPORT_FILE}`);
}

// Main execution function
async function main() {
    const startTime = Date.now();
    
    try {
        ensureDirectories();
        log('🧹 Starting Meet Results Decontamination (Type 2)');
        log(`📋 Fixing Type 2 contamination - multiple athletes' results under single lifter_ids`);
        log('='.repeat(60));
        
        // Process all athletes
        const report = await processAllAthletes();
        
        // Save report
        saveReport(report);
        
        // Final summary
        const processingTime = Date.now() - startTime;
        log('\n' + '='.repeat(60));
        log('✅ MEET RESULTS DECONTAMINATION COMPLETE');
        log(`   Athletes processed: ${report.summary?.athletes_processed || 0}`);
        log(`   Results reassigned: ${report.summary?.total_reassignments || 0}`);
        log(`   Unassigned results: ${report.summary?.unassigned_results || 0}`);
        log(`   Processing time: ${processingTime}ms`);
        
        if (report.summary?.success) {
            log('\n🎉 Type 2 contamination cleanup completed successfully!');
            log('📝 Check the report file for detailed results');
        } else {
            log('\n⚠️ Some errors occurred during processing - check the report');
        }
        
        return report;
        
    } catch (error) {
        log(`\n❌ Process failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Export for potential use by other scripts
module.exports = { 
    main,
    processAllAthletes,
    scrapeUSAWMeetResults,
    compareMeetResults
};

// Run if called directly
if (require.main === module) {
    main();
}