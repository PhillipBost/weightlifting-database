/**
 * FAILED SCRAPES UPLOADER
 * 
 * Purpose: Upload athletes from failed_scrapes directory who have been scraped 
 * but cannot be processed through normal pipeline due to zero totals/USAW limitations.
 * 
 * Key Features:
 * - Processes all athletes from failed_scrapes directory
 * - Creates new lifter_id records for contaminated athletes
 * - Uploads profile data even when scraping was incomplete
 * - Bypasses the 5-step contamination cleanup pipeline
 * - Handles athletes that consistently fail reverse lookups due to zero totals
 * - Moves processed files to separate directory after successful upload
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const FAILED_SCRAPES_DIR = './output/failed_scrapes';
const PROCESSED_SCRAPES_DIR = './output/processed_failed_scrapes';
const LOG_FILE = './logs/failed-scrapes-uploader.log';
const SCRIPT_VERSION = '1.0.0';

// Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Ensure directories exist
function ensureDirectories() {
    if (!fs.existsSync(PROCESSED_SCRAPES_DIR)) {
        fs.mkdirSync(PROCESSED_SCRAPES_DIR, { recursive: true });
    }

    const logsDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
}

// Logging utility
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    console.log(message);
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Move processed file to processed directory
function moveProcessedFile(filePath) {
    try {
        const fileName = path.basename(filePath);
        const newPath = path.join(PROCESSED_SCRAPES_DIR, fileName);

        // Add timestamp to avoid conflicts if file already exists
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const finalPath = newPath.replace('.json', `_processed_${timestamp}.json`);

        fs.renameSync(filePath, finalPath);
        log(`   📁 Moved to: ${path.relative('.', finalPath)}`);

    } catch (error) {
        log(`   ⚠️  Failed to move file: ${error.message}`);
    }
}

// Process a single failed scrapes file
async function processFailedScrapesFile(filePath) {
    try {
        const fileName = path.basename(filePath);
        log(`📄 Processing file: ${fileName}`);

        const fileContent = fs.readFileSync(filePath, 'utf8');
        const scrapedData = JSON.parse(fileContent);

        if (!scrapedData.data || !Array.isArray(scrapedData.data)) {
            log(`⚠️  Invalid file format: ${fileName}`);
            return { processed: 0, errors: 0, shouldMove: false };
        }

        let processed = 0;
        let errors = 0;

        // Process each athlete in the file
        for (const athlete of scrapedData.data) {
            try {
                await processFailedAthlete(athlete, fileName);
                processed++;
            } catch (error) {
                log(`❌ Error processing athlete ${athlete.internal_id}: ${error.message}`);
                errors++;
            }
        }

        // Move file if at least some athletes were processed successfully
        const shouldMove = processed > 0;
        if (shouldMove) {
            moveProcessedFile(filePath);
        }

        return { processed, errors, shouldMove };

    } catch (error) {
        log(`💥 Failed to process file ${filePath}: ${error.message}`);
        return { processed: 0, errors: 1, shouldMove: false };
    }
}

// Process a single failed athlete
async function processFailedAthlete(athlete, sourceFile) {
    const { internal_id, athlete_name, profile_data, contaminated_lifter_id, needs_new_lifter_id } = athlete;

    log(`👤 Processing athlete: ${athlete_name} (internal_id: ${internal_id})`);

    // Check if this internal_id already exists in database
    const { data: existing, error: checkError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, internal_id')
        .eq('internal_id', internal_id)
        .single();

    if (checkError && checkError.code !== 'PGRST116') {
        throw new Error(`Database check failed: ${checkError.message}`);
    }

    if (existing) {
        log(`   ✅ Already exists with lifter_id: ${existing.lifter_id}`);
        return existing.lifter_id;
    }

    // Prepare lifter data
    const lifterData = {
        athlete_name: athlete_name,
        internal_id: internal_id,
        membership_number: profile_data?.membership_number ? parseInt(profile_data.membership_number) : null,
        gender: profile_data?.gender || null,
        club_name: profile_data?.club_name || null,
        wso: profile_data?.wso || null,
        birth_year: profile_data?.birth_year || null,
        national_rank: profile_data?.national_rank ? parseInt(profile_data.national_rank) : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    // Insert new lifter record
    const { data: newLifter, error: insertError } = await supabase
        .from('usaw_lifters')
        .insert([lifterData])
        .select('lifter_id')
        .single();

    if (insertError) {
        throw new Error(`Failed to insert lifter: ${insertError.message}`);
    }

    log(`   ✨ Created new lifter_id: ${newLifter.lifter_id}`);

    // If this athlete needs a new lifter_id (was contaminated), update any existing meet results
    if (needs_new_lifter_id && contaminated_lifter_id) {
        await updateMeetResultsForAthlete(contaminated_lifter_id, newLifter.lifter_id, athlete_name, internal_id);
    }

    return newLifter.lifter_id;
}

// Update meet results for decontaminated athletes
async function updateMeetResultsForAthlete(oldLifterIr, newLifterID, athleteName, internalId) {
    try {
        log(`   🔄 Updating meet results from lifter_id ${oldLifterIr} to ${newLifterID}`);

        // Find meet results that match this athlete's name and should be reassigned
        const { data: meetResults, error: selectError } = await supabase
            .from('usaw_meet_results')
            .select('result_id, lifter_name, meet_name, date')
            .eq('lifter_id', oldLifterIr)
            .ilike('lifter_name', athleteName);

        if (selectError) {
            log(`   ⚠️  Error finding meet results: ${selectError.message}`);
            return;
        }

        if (!meetResults || meetResults.length === 0) {
            log(`   📝 No meet results found to reassign`);
            return;
        }

        // Update the results to point to new lifter_id
        const resultIds = meetResults.map(r => r.result_id);
        const { error: updateError } = await supabase
            .from('usaw_meet_results')
            .update({ lifter_id: newLifterID })
            .in('result_id', resultIds);

        if (updateError) {
            log(`   ❌ Error updating meet results: ${updateError.message}`);
            return;
        }

        log(`   ✅ Reassigned ${meetResults.length} meet results to new lifter_id`);

    } catch (error) {
        log(`   💥 Error in meet results update: ${error.message}`);
    }
}

// Main processing function
async function processAllFailedScrapes() {
    const startTime = Date.now();

    try {
        // Setup directories
        ensureDirectories();

        log('🚀 Starting Failed Scrapes Uploader');
        log('='.repeat(60));
        log(`📅 Started at: ${new Date().toISOString()}`);
        log(`📋 Script version: ${SCRIPT_VERSION}`);

        // Check if failed_scrapes directory exists
        if (!fs.existsSync(FAILED_SCRAPES_DIR)) {
            throw new Error(`Failed scrapes directory not found: ${FAILED_SCRAPES_DIR}`);
        }

        // Get all JSON files from failed_scrapes directory
        const files = fs.readdirSync(FAILED_SCRAPES_DIR)
            .filter(file => file.endsWith('.json'))
            .map(file => path.join(FAILED_SCRAPES_DIR, file));

        log(`📁 Found ${files.length} failed scrape files`);

        if (files.length === 0) {
            log('✨ No failed scrape files to process');
            return { success: true, totalProcessed: 0, totalErrors: 0, filesMoved: 0 };
        }

        let totalProcessed = 0;
        let totalErrors = 0;
        let filesProcessed = 0;
        let filesMoved = 0;

        // Process each file
        for (const filePath of files) {
            const result = await processFailedScrapesFile(filePath);
            totalProcessed += result.processed;
            totalErrors += result.errors;
            filesProcessed++;

            if (result.shouldMove) {
                filesMoved++;
            }

            if (filesProcessed % 50 === 0) {
                log(`📊 Progress: ${filesProcessed}/${files.length} files processed`);
            }
        }

        const totalTime = Date.now() - startTime;

        log('\n' + '='.repeat(60));
        log('🎉 FAILED SCRAPES UPLOAD COMPLETE');
        log('='.repeat(60));
        log(`📊 Final Statistics:`);
        log(`   Files processed: ${filesProcessed}`);
        log(`   Files moved to processed: ${filesMoved}`);
        log(`   Files remaining in failed_scrapes: ${filesProcessed - filesMoved}`);
        log(`   Athletes processed: ${totalProcessed}`);
        log(`   Errors: ${totalErrors}`);
        log(`   Total time: ${totalTime}ms`);
        log(`   Average per file: ${Math.round(totalTime / filesProcessed)}ms`);

        return {
            success: true,
            filesProcessed,
            filesMoved,
            totalProcessed,
            totalErrors,
            totalTimeMs: totalTime
        };

    } catch (error) {
        const totalTime = Date.now() - startTime;
        log('\n' + '='.repeat(60));
        log('❌ FAILED SCRAPES UPLOAD FAILED');
        log('='.repeat(60));
        log(`Error: ${error.message}`);
        log(`Stack: ${error.stack}`);
        log(`Failed after: ${totalTime}ms`);

        return {
            success: false,
            error: error.message,
            totalTimeMs: totalTime
        };
    }
}

// Export for use by other scripts
module.exports = {
    processAllFailedScrapes,
    processFailedScrapesFile,
    processFailedAthlete
};

// Run if called directly
if (require.main === module) {
    processAllFailedScrapes()
        .then(result => {
            if (result.success) {
                log('✨ Script completed successfully');
                process.exit(0);
            } else {
                log(`💥 Script failed: ${result.error}`);
                process.exit(1);
            }
        })
        .catch(error => {
            log(`💥 Unhandled error: ${error.message}`);
            process.exit(1);
        });
}