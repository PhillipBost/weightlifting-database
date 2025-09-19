/**
 * FIND ORPHAN MEET RESULTS SCRIPT
 * 
 * Purpose: Identifies meet results that exist in the database but are not
 * linked to any athlete profile (likely bombed out results that USAW
 * doesn't make searchable on athlete profiles).
 * 
 * Usage:
 *   node find-orphan-meet-results.js
 *   node find-orphan-meet-results.js --meet-id 7011
 *   node find-orphan-meet-results.js --athlete "Brian Le"
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Browser instance
let browser = null;
let page = null;

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        meetId: null,
        athleteName: null
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--meet-id':
                options.meetId = args[i + 1];
                i++;
                break;
            case '--athlete':
                options.athleteName = args[i + 1];
                i++;
                break;
        }
    }
    
    return options;
}

// Extract meet internal_id from Sport80 URL
function extractMeetInternalId(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }
    
    const match = url.match(/\/rankings\/results\/(\d+)/);
    return match ? parseInt(match[1]) : null;
}

// Initialize browser for scraping
async function initBrowser() {
    if (!browser) {
        console.log('🌐 Initializing browser...');
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
    }
}

// Scrape actual results from Sport80 meet page
async function scrapeActualMeetResults(meetUrl) {
    console.log(`🕷️  Scraping actual results from: ${meetUrl}`);
    
    await initBrowser();
    
    try {
        await page.goto(meetUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        await page.waitForSelector('body', { timeout: 10000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Scrape all results from the page
        const actualResults = await page.evaluate(() => {
            const results = [];
            
            // Look for table rows containing results
            const rows = document.querySelectorAll('table tr');
            
            for (let i = 1; i < rows.length; i++) { // Skip header row
                const row = rows[i];
                const cells = row.querySelectorAll('td');
                
                if (cells.length >= 10) { // Ensure we have enough columns
                    const result = {
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
                        total: cells[13]?.textContent?.trim() || null,
                        division: cells[2]?.textContent?.trim() || null
                    };
                    
                    // Only add if we have a lifter name
                    if (result.lifter_name) {
                        results.push(result);
                    }
                }
            }
            
            return results;
        });
        
        console.log(`📊 Scraped ${actualResults.length} results from Sport80`);
        return actualResults;
        
    } catch (error) {
        console.error(`❌ Error scraping meet results: ${error.message}`);
        return [];
    }
}

// Close browser
async function closeBrowser() {
    if (browser) {
        await browser.close();
        browser = null;
        page = null;
    }
}

// Get meet results for a specific meet internal_id
async function getMeetResultsForMeet(meetInternalId) {
    console.log(`🔍 Getting meet results for meet internal_id ${meetInternalId}...`);
    
    // First, find the meet_id for this internal_id
    const { data: meetInfo, error: meetError } = await supabase
        .from('meets')
        .select('meet_id, Meet, Date, URL')
        .eq('meet_internal_id', meetInternalId)
        .single();
    
    if (meetError) {
        throw new Error(`Failed to find meet with internal_id ${meetInternalId}: ${meetError.message}`);
    }
    
    console.log(`📅 Found meet: "${meetInfo.Meet}" on ${meetInfo.Date}`);
    console.log(`🔗 URL: ${meetInfo.URL}`);
    
    // Get all results for this meet from database
    const { data: dbResults, error: resultsError } = await supabase
        .from('meet_results')
        .select('*')
        .eq('meet_id', meetInfo.meet_id)
        .order('lifter_name');
    
    if (resultsError) {
        throw new Error(`Failed to get meet results: ${resultsError.message}`);
    }
    
    console.log(`📊 Found ${dbResults.length} results in database`);
    
    // Also scrape actual results from Sport80
    const actualResults = await scrapeActualMeetResults(meetInfo.URL);
    
    // Compare database vs actual results
    console.log('\n🔍 COMPARING DATABASE VS ACTUAL RESULTS:');
    console.log(`📊 Database results: ${dbResults.length}`);
    console.log(`🕷️  Actual Sport80 results: ${actualResults.length}`);
    
    if (dbResults.length !== actualResults.length) {
        console.log(`⚠️  MISMATCH: ${actualResults.length - dbResults.length} results missing from database!`);
        
        // Find missing athletes
        const dbNames = new Set(dbResults.map(r => r.lifter_name.toLowerCase()));
        const missingAthletes = actualResults.filter(r => 
            !dbNames.has(r.lifter_name.toLowerCase())
        );
        
        if (missingAthletes.length > 0) {
            console.log('\n👻 MISSING ATHLETES (in Sport80 but not in database):');
            missingAthletes.forEach((athlete, index) => {
                const total = athlete.total === '0' ? 'Bombed' : athlete.total;
                console.log(`   ${index + 1}. ${athlete.lifter_name} - Total: ${total} (Division: ${athlete.division})`);
            });
        }
        
        // Find extra athletes (shouldn't happen)
        const actualNames = new Set(actualResults.map(r => r.lifter_name.toLowerCase()));
        const extraAthletes = dbResults.filter(r => 
            !actualNames.has(r.lifter_name.toLowerCase())
        );
        
        if (extraAthletes.length > 0) {
            console.log('\n🤔 EXTRA ATHLETES (in database but not in Sport80):');
            extraAthletes.forEach((athlete, index) => {
                const total = athlete.total === '0' ? 'Bombed' : athlete.total;
                console.log(`   ${index + 1}. ${athlete.lifter_name} - Total: ${total}`);
            });
        }
    } else {
        console.log('✅ Counts match - no missing results');
    }
    
    return { meetInfo, dbResults, actualResults };
}

// Check if results are orphaned (not findable on athlete profiles)
async function checkForOrphanResults(results, meetInternalId) {
    console.log(`\n🔍 Checking if results are orphaned (not linked to athlete profiles)...`);
    
    let orphanResults = [];
    let linkedResults = [];
    let errorResults = [];
    
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        console.log(`\n📋 [${i+1}/${results.length}] Checking ${result.lifter_name}...`);
        
        try {
            // Try to find this athlete in the lifters table
            const { data: athlete, error: athleteError } = await supabase
                .from('lifters')
                .select('lifter_id, athlete_name, internal_id')
                .eq('lifter_id', result.lifter_id)
                .single();
            
            if (athleteError) {
                console.log(`   ❌ No lifter found for lifter_id ${result.lifter_id}`);
                errorResults.push({
                    ...result,
                    issue: `No lifter found for lifter_id ${result.lifter_id}`
                });
                continue;
            }
            
            console.log(`   ✅ Found lifter: ${athlete.athlete_name} (internal_id: ${athlete.internal_id})`);
            
            // If athlete has internal_id, check if this meet appears on their profile
            if (athlete.internal_id) {
                // We would need to scrape their profile to check, but for now
                // we'll assume athletes with internal_ids are properly linked
                linkedResults.push({
                    ...result,
                    athlete: athlete
                });
                console.log(`   🔗 Linked: Has internal_id ${athlete.internal_id}`);
            } else {
                // No internal_id means this athlete is not scrapeable/findable
                orphanResults.push({
                    ...result,
                    athlete: athlete
                });
                console.log(`   👻 Potential orphan: No internal_id`);
            }
            
        } catch (error) {
            console.log(`   ❌ Error checking ${result.lifter_name}: ${error.message}`);
            errorResults.push({
                ...result,
                issue: error.message
            });
        }
    }
    
    return { orphanResults, linkedResults, errorResults };
}

// Analyze specific athlete across all meets
async function analyzeAthleteAcrossMeets(athleteName) {
    console.log(`🔍 Analyzing all meet results for "${athleteName}"...`);
    
    // Get all meet results for this athlete name
    const { data: results, error } = await supabase
        .from('meet_results')
        .select('*')
        .ilike('lifter_name', `%${athleteName}%`)
        .order('date');
    
    if (error) {
        throw new Error(`Failed to get results for ${athleteName}: ${error.message}`);
    }
    
    console.log(`📊 Found ${results.length} total results for "${athleteName}"`);
    
    // Group by lifter_id
    const byLifterId = {};
    results.forEach(result => {
        if (!byLifterId[result.lifter_id]) {
            byLifterId[result.lifter_id] = [];
        }
        byLifterId[result.lifter_id].push(result);
    });
    
    console.log(`👤 Results span ${Object.keys(byLifterId).length} different lifter_ids`);
    
    // Check each lifter_id
    for (const [lifterId, lifterResults] of Object.entries(byLifterId)) {
        console.log(`\n📋 Lifter ID ${lifterId} (${lifterResults.length} results):`);
        
        // Get lifter info
        const { data: lifter, error: lifterError } = await supabase
            .from('lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('lifter_id', parseInt(lifterId))
            .single();
        
        if (lifterError) {
            console.log(`   ❌ No lifter record found`);
            continue;
        }
        
        console.log(`   ✅ Lifter: ${lifter.athlete_name}`);
        console.log(`   🔗 Internal ID: ${lifter.internal_id || 'None'}`);
        console.log(`   📅 Date range: ${lifterResults[0].date} to ${lifterResults[lifterResults.length-1].date}`);
        
        // Show sample results
        lifterResults.slice(0, 3).forEach(result => {
            const total = result.total || 'Bombed';
            console.log(`      • ${result.date}: ${result.meet_name} - Total: ${total}`);
        });
        
        if (lifterResults.length > 3) {
            console.log(`      ... and ${lifterResults.length - 3} more`);
        }
    }
    
    return { results, byLifterId };
}

// Main execution function
async function main() {
    try {
        const options = parseArguments();
        
        console.log('🔍 ORPHAN MEET RESULTS ANALYSIS');
        console.log('='.repeat(60));
        
        // Test database connection
        const { error: testError } = await supabase.from('meets').select('meet_id').limit(1);
        if (testError) {
            throw new Error(`Database connection failed: ${testError.message}`);
        }
        console.log('✅ Database connection successful\n');
        
        if (options.athleteName) {
            // Analyze specific athlete across all meets
            await analyzeAthleteAcrossMeets(options.athleteName);
            
        } else if (options.meetId) {
            // Analyze specific meet for orphan results
            const meetInternalId = parseInt(options.meetId);
            const { meetInfo, dbResults, actualResults } = await getMeetResultsForMeet(meetInternalId);
            
            // Only analyze database results for orphans if we have them
            if (dbResults.length > 0) {
                const analysis = await checkForOrphanResults(dbResults, meetInternalId);
                
                console.log('\n' + '='.repeat(60));
                console.log('📊 ORPHAN ANALYSIS RESULTS (DATABASE ONLY)');
                console.log('='.repeat(60));
                console.log(`🔗 Linked results (have internal_id): ${analysis.linkedResults.length}`);
                console.log(`👻 Potential orphan results: ${analysis.orphanResults.length}`);
                console.log(`❌ Error results: ${analysis.errorResults.length}`);
                
                if (analysis.orphanResults.length > 0) {
                    console.log('\n👻 POTENTIAL ORPHAN RESULTS:');
                    analysis.orphanResults.forEach(result => {
                        const total = result.total || 'Bombed';
                        console.log(`   • ${result.lifter_name} - Total: ${total} (lifter_id: ${result.lifter_id})`);
                    });
                }
            }
            
        } else {
            console.log('Please specify either --meet-id or --athlete option');
            console.log('Examples:');
            console.log('  node find-orphan-meet-results.js --meet-id 7011');
            console.log('  node find-orphan-meet-results.js --athlete "Brian Le"');
        }
        
    } catch (error) {
        console.error(`\n❌ Analysis failed: ${error.message}`);
        console.error(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    } finally {
        // Always close browser
        await closeBrowser();
    }
}

// Export for potential use by other scripts
module.exports = { 
    getMeetResultsForMeet,
    checkForOrphanResults,
    analyzeAthleteAcrossMeets,
    main 
};

// Run if called directly
if (require.main === module) {
    main();
}