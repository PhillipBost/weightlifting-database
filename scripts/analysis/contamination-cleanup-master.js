/**
 * CONTAMINATION CLEANUP MASTER SCRIPT
 * 
 * Purpose: Orchestrates the complete cleanup of contaminated lifter_id records
 * where single lifter_id values represent 2-5 distinct athletes.
 * 
 * CORE PROBLEM: lifter_id sometimes groups multiple distinct athletes together.
 * Each internal_id = unique USAW URL = unique athlete = requires own lifter_id
 * 
 * SOLUTION: Split contaminated records into individual athlete records with 
 * proper lifter_id assignments and meet result reassignments.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Import all cleanup scripts
const contaminationIdentifier = require('./contamination-identifier.js');
const comprehensiveDataScraper = require('../maintenance/comprehensive-data-scraper.js');
const meetResultsCollector = require('../maintenance/meet-results-collector.js');
const membershipMatcher = require('../maintenance/membership-matcher.js');
const databaseReconstructor = require('../maintenance/database-reconstructor.js');

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const LOG_FILE = path.join(LOGS_DIR, 'contamination-cleanup-master.log');
const SCRIPT_VERSION = '1.0.0';

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
    
    // Console output
    console.log(message);
    
    // File output
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Execute cleanup pipeline
async function executeCleanupPipeline() {
    const pipelineStart = Date.now();
    
    try {
        log('🚀 Starting contamination cleanup pipeline');
        log('=' .repeat(70));
        
        // STEP 1: Identify contaminated athletes
        log('\n📋 STEP 1: Running contamination-identifier.js');
        log('-'.repeat(50));
        const step1Start = Date.now();
        
        const contaminatedData = await contaminationIdentifier.main();
        
        const step1Time = Date.now() - step1Start;
        log(`✅ Step 1 completed in ${step1Time}ms`);
        log(`   Output: ${contaminatedData?.metadata?.contaminated_lifter_id_count || 'Unknown'} contaminated lifter_id values found`);
        
        // STEP 2: Scrape comprehensive athlete data
        log('\n🕷️  STEP 2: Running comprehensive-data-scraper.js');
        log('-'.repeat(50));
        const step2Start = Date.now();
        
        const scrapedData = await comprehensiveDataScraper.main();
        
        const step2Time = Date.now() - step2Start;
        log(`✅ Step 2 completed in ${step2Time}ms`);
        log(`   Output: ${scrapedData?.metadata?.internal_ids_processed || 'Unknown'} internal_ids processed`);
        
        // STEP 3: Collect meet results from database
        log('\n📊 STEP 3: Running meet-results-collector.js');
        log('-'.repeat(50));
        const step3Start = Date.now();
        
        const collectedData = await meetResultsCollector.main();
        
        const step3Time = Date.now() - step3Start;
        log(`✅ Step 3 completed in ${step3Time}ms`);
        log(`   Output: ${collectedData?.metadata?.statistics?.total_meet_results || 'Unknown'} meet results collected`);
        
        // STEP 4: Match results to correct athletes
        log('\n🔗 STEP 4: Running membership-matcher.js');
        log('-'.repeat(50));
        const step4Start = Date.now();
        
        const matchingData = await membershipMatcher.main();
        
        const step4Time = Date.now() - step4Start;
        log(`✅ Step 4 completed in ${step4Time}ms`);
        log(`   Output: ${matchingData?.metadata?.total_matches || 'Unknown'} successful matches`);
        
        // STEP 5: Reconstruct database
        log('\n🔧 STEP 5: Running database-reconstructor.js');
        log('-'.repeat(50));
        const step5Start = Date.now();
        
        const reconstructionData = await databaseReconstructor.main();
        
        const step5Time = Date.now() - step5Start;
        log(`✅ Step 5 completed in ${step5Time}ms`);
        log(`   Output: ${reconstructionData?.new_lifters_created?.length || 'Unknown'} new lifters created`);
        
        // Pipeline completion summary
        const totalPipelineTime = Date.now() - pipelineStart;
        log('\n' + '='.repeat(70));
        log('🎉 CONTAMINATION CLEANUP PIPELINE COMPLETE');
        log('='.repeat(70));
        log(`📊 Pipeline Statistics:`);
        log(`   Step 1 (Identification): ${step1Time}ms`);
        log(`   Step 2 (Scraping): ${step2Time}ms`);
        log(`   Step 3 (Collection): ${step3Time}ms`);
        log(`   Step 4 (Matching): ${step4Time}ms`);
        log(`   Step 5 (Reconstruction): ${step5Time}ms`);
        log(`   Total Pipeline Time: ${totalPipelineTime}ms`);
        log('');
        log('✨ All contaminated lifter_id records have been processed');
        log('📁 Check /output/ directory for all generated files');
        log('📝 Check /logs/ directory for detailed execution logs');
        
        return {
            success: true,
            total_time_ms: totalPipelineTime,
            steps: {
                step1_time_ms: step1Time,
                step2_time_ms: step2Time,
                step3_time_ms: step3Time,
                step4_time_ms: step4Time,
                step5_time_ms: step5Time
            }
        };
        
    } catch (error) {
        const totalPipelineTime = Date.now() - pipelineStart;
        log('\n' + '='.repeat(70));
        log('❌ PIPELINE FAILED');
        log('='.repeat(70));
        log(`Error: ${error.message}`);
        log(`Stack trace: ${error.stack}`);
        log(`Failed after: ${totalPipelineTime}ms`);
        
        return {
            success: false,
            error: error.message,
            total_time_ms: totalPipelineTime
        };
    }
}

// Main execution function
async function main() {
    const startTime = Date.now();
    
    try {
        // Setup
        ensureDirectories();
        log('🏗️  Initializing contamination cleanup master script');
        log(`📅 Started at: ${new Date().toISOString()}`);
        log(`📋 Script version: ${SCRIPT_VERSION}`);
        
        // Execute the complete pipeline
        const result = await executeCleanupPipeline();
        
        if (result.success) {
            log(`\n🎯 Master script completed successfully`);
            process.exit(0);
        } else {
            log(`\n💥 Master script failed: ${result.error}`);
            process.exit(1);
        }
        
    } catch (error) {
        const totalTime = Date.now() - startTime;
        log(`\n💥 Master script crashed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        log(`⏱️  Crashed after: ${totalTime}ms`);
        process.exit(1);
    }
}

// Export for potential use by other scripts
module.exports = { 
    main, 
    executeCleanupPipeline,
    ensureDirectories 
};

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}