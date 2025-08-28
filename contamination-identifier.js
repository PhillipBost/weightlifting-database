/**
 * CONTAMINATION IDENTIFIER
 * 
 * Purpose: Identifies contaminated lifter records where single lifter_id 
 * represents multiple distinct athletes (internal_id_2 through internal_id_5 not null)
 * 
 * Usage:
 *   node contamination-identifier.js                           // Find all contaminated athletes
 *   node contamination-identifier.js --athlete "Michael Anderson"  // Find specific athlete
 *   node contamination-identifier.js --limit 10               // Limit results for testing
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const SUCCESSFUL_SCRAPES_DIR = path.join(OUTPUT_DIR, 'successful_scrapes');
const FAILED_SCRAPES_DIR = path.join(OUTPUT_DIR, 'failed_scrapes');
const PROCESSED_FAILED_SCRAPES_DIR = path.join(OUTPUT_DIR, 'processed_failed_scrapes');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'contaminated_athletes.json');
const LOG_FILE = path.join(LOGS_DIR, 'contamination-identifier.log');
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

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        athlete: null,
        limit: null
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--athlete':
                options.athlete = args[i + 1];
                i++; // Skip next argument
                break;
            case '--limit':
                options.limit = parseInt(args[i + 1]);
                i++; // Skip next argument
                break;
        }
    }
    
    return options;
}

// Test database connection
async function testConnection() {
    log('Testing database connection...');
    
    const { data, error } = await supabase
        .from('lifters')
        .select('lifter_id')
        .limit(1);
    
    if (error) {
        throw new Error(`Database connection failed: ${error.message}`);
    }
    
    log('✅ Database connection successful');
}

// Get list of already processed athlete names to skip
function getProcessedAthleteNames() {
    const processedNames = new Set();
    const checkDirectories = [SUCCESSFUL_SCRAPES_DIR, FAILED_SCRAPES_DIR, PROCESSED_FAILED_SCRAPES_DIR];
    
    log('Checking for already processed athletes to skip...');
    
    checkDirectories.forEach(dir => {
        if (!fs.existsSync(dir)) return;
        
        try {
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
            
            files.forEach(fileName => {
                try {
                    const filePath = path.join(dir, fileName);
                    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    
                    if (fileData.metadata && fileData.metadata.athlete_name) {
                        processedNames.add(fileData.metadata.athlete_name);
                    }
                } catch (error) {
                    log(`⚠️  Could not read processed file ${fileName}: ${error.message}`);
                }
            });
            
            log(`  Found ${files.length} processed files in ${path.basename(dir)}/`);
        } catch (error) {
            log(`⚠️  Could not read directory ${dir}: ${error.message}`);
        }
    });
    
    log(`📋 Found ${processedNames.size} athletes to skip (already processed)`);
    return processedNames;
}

// Find contaminated athletes
async function findContaminatedAthletes(options) {
    log('Querying for contaminated athletes...');
    
    // Get list of processed athletes to skip
    const processedNames = getProcessedAthleteNames();
    
    let allAthletes = [];
    let from = 0;
    const pageSize = 1000;
    let totalSkipped = 0;
    
    while (true) {
        log(`Fetching contaminated athletes ${from + 1} to ${from + pageSize}...`);
        
        let query = supabase
            .from('lifters')
            .select('lifter_id, athlete_name, internal_id, internal_id_2, internal_id_3, internal_id_4, internal_id_5')
            .or('internal_id_2.not.is.null,internal_id_3.not.is.null,internal_id_4.not.is.null,internal_id_5.not.is.null')
            .range(from, from + pageSize - 1);
        
        // Add filters based on options
        if (options.athlete) {
            query = query.eq('athlete_name', options.athlete);
            if (from === 0) log(`🔍 Filtering for specific athlete: ${options.athlete}`);
        }
        
        const { data: athletes, error } = await query;
        
        if (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }
        
        // Filter out already processed athletes (unless specific athlete requested)
        const filteredAthletes = options.athlete ? athletes : athletes.filter(athlete => {
            if (processedNames.has(athlete.athlete_name)) {
                totalSkipped++;
                return false;
            }
            return true;
        });
        
        allAthletes.push(...filteredAthletes);
        
        const skippedThisBatch = athletes.length - filteredAthletes.length;
        log(`  Retrieved ${athletes.length} contaminated athletes, skipped ${skippedThisBatch} already processed (Total: ${allAthletes.length}, Total skipped: ${totalSkipped})`);
        
        // Break if we got fewer than pageSize records (no more pages)
        if (athletes.length < pageSize) break;
        
        // Break if we've reached the user-specified limit
        if (options.limit && allAthletes.length >= options.limit) {
            allAthletes = allAthletes.slice(0, options.limit);
            log(`🔒 Limiting results to requested: ${options.limit} records`);
            break;
        }
        
        from += pageSize;
    }
    
    log(`✅ Found ${allAthletes.length} contaminated athlete records to process`);
    log(`📋 Skipped ${totalSkipped} athletes (already processed)`);
    
    return allAthletes;
}

// Process and structure contaminated athletes data
function processContaminatedData(athletes) {
    log('Processing contaminated athlete data...');
    
    const processedData = athletes.map(athlete => {
        // Collect all internal_ids for this athlete
        const internal_ids = [];
        
        if (athlete.internal_id) internal_ids.push(athlete.internal_id);
        if (athlete.internal_id_2) internal_ids.push(athlete.internal_id_2);
        if (athlete.internal_id_3) internal_ids.push(athlete.internal_id_3);
        if (athlete.internal_id_4) internal_ids.push(athlete.internal_id_4);
        if (athlete.internal_id_5) internal_ids.push(athlete.internal_id_5);
        
        return {
            lifter_id: athlete.lifter_id,
            athlete_name: athlete.athlete_name,
            contamination_level: internal_ids.length,
            internal_ids: internal_ids,
            individual_athletes: internal_ids.map(id => ({
                internal_id: id,
                usaw_url: `https://usaweightlifting.sport80.com/public/rankings/member/${id}`,
                needs_scraping: true,
                needs_new_lifter_id: id !== athlete.internal_id // First internal_id keeps current lifter_id
            }))
        };
    });
    
    // Sort by contamination level (highest first) for prioritization
    processedData.sort((a, b) => b.contamination_level - a.contamination_level);
    
    // Log summary statistics
    const stats = {
        total_contaminated_lifter_id_values: processedData.length,
        total_individual_athletes: processedData.reduce((sum, lifterRecord) => sum + lifterRecord.contamination_level, 0),
        contamination_breakdown: {}
    };
    
    processedData.forEach(lifterRecord => {
        const level = lifterRecord.contamination_level;
        stats.contamination_breakdown[level] = (stats.contamination_breakdown[level] || 0) + 1;
    });
    
    log('📊 Contamination Statistics:');
    log(`   Total contaminated lifter_id values: ${stats.total_contaminated_lifter_id_values}`);
    log(`   Total individual athletes: ${stats.total_individual_athletes}`);
    log(`   Contamination breakdown:`);
    Object.entries(stats.contamination_breakdown).forEach(([level, count]) => {
        log(`      ${level} athletes per lifter_id value: ${count} contaminated lifter_id values`);
    });
    
    return { processedData, stats };
}

// Save results to JSON file
function saveResults(processedData, stats, processingTimeMs) {
    log('Saving results to output file...');
    
    const output = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_name: 'contamination-identifier',
            script_version: SCRIPT_VERSION,
            contaminated_lifter_id_count: processedData.length,
            processing_time_ms: processingTimeMs,
            statistics: stats
        },
        data: processedData
    };
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    log(`✅ Results saved to: ${OUTPUT_FILE}`);
    
    return output;
}

// Main execution function
async function main() {
    const startTime = Date.now();
    
    try {
        // Setup
        ensureDirectories();
        log('🚀 Starting contamination identification process');
        
        // Parse command line options
        const options = parseArguments();
        if (options.athlete) log(`🎯 Target athlete: ${options.athlete}`);
        if (options.limit) log(`📊 Result limit: ${options.limit}`);
        
        // Test database connection
        await testConnection();
        
        // Find contaminated athletes
        const athletes = await findContaminatedAthletes(options);
        
        if (athletes.length === 0) {
            log('ℹ️ No contaminated athletes found');
            return;
        }
        
        // Process the data
        const { processedData, stats } = processContaminatedData(athletes);
        
        // Save results
        const processingTime = Date.now() - startTime;
        const output = saveResults(processedData, stats, processingTime);
        
        log(`✅ Process completed successfully in ${processingTime}ms`);
        log(`📄 Next step: Run comprehensive-data-scraper.js with this output`);
        
        // Return data for potential use by master script
        return output;
        
    } catch (error) {
        log(`❌ Process failed: ${error.message}`);
        log(`📍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Export for use by master script
module.exports = { main, findContaminatedAthletes, processContaminatedData };

// Run if called directly
if (require.main === module) {
    main();
}