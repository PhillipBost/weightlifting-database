// Load environment variables from .env file
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const JSON_FILE = 'internal_ids.json';
const ERROR_LOG_FILE = 'internal_id_upload_errors.csv';

// Timeout wrapper for database operations
function withTimeout(promise, timeoutMs = 30000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Database operation timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

// Load data from JSON file
function loadInternalIdsData() {
    if (!fs.existsSync(JSON_FILE)) {
        throw new Error(`JSON file not found: ${JSON_FILE}`);
    }
    
    try {
        const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
        console.log(`📖 Loaded internal IDs data:`);
        console.log(`   Athletes: ${Object.keys(data.athletes || {}).length}`);
        console.log(`   Failed IDs: ${data.failedIds?.length || 0}`);
        console.log(`   Previously processed: ${Object.keys(data.processed || {}).length}`);
        
        return {
            athletes: data.athletes || {},
            failedIds: data.failedIds || [],
            lastProcessedId: data.lastProcessedId || 0,
            processed: data.processed || {}
        };
    } catch (error) {
        throw new Error(`Error reading JSON file: ${error.message}`);
    }
}

// Save updated data back to JSON file
function saveInternalIdsData(data) {
    try {
        fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`❌ Error saving JSON file: ${error.message}`);
        return false;
    }
}

// Create error logger
function createErrorLogger() {
    // Create error file with headers if it doesn't exist
    if (!fs.existsSync(ERROR_LOG_FILE)) {
        const headers = [
            'timestamp',
            'internal_id', 
            'athlete_name',
            'error_type',
            'existing_name',
            'existing_internal_id',
            'description'
        ];
        fs.writeFileSync(ERROR_LOG_FILE, headers.join(',') + '\n');
    }
    
    return {
        logError: (internalId, athleteName, errorType, existingName = '', existingInternalId = '', description = '') => {
            const timestamp = new Date().toISOString();
            const row = [
                timestamp,
                escapeCSV(internalId),
                escapeCSV(athleteName),
                errorType,
                escapeCSV(existingName),
                escapeCSV(existingInternalId),
                escapeCSV(description)
            ];
            fs.appendFileSync(ERROR_LOG_FILE, row.join(',') + '\n');
        }
    };
}

// CSV escape utility
function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Database query functions
async function findLifterByInternalId(internalId) {
    const { data, error } = await withTimeout(
        supabase
            .from('lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('internal_id', parseInt(internalId))
            .maybeSingle()
    );
    
    if (error) {
        throw new Error(`Error querying by internal_id: ${error.message}`);
    }
    
    return data;
}

async function findLifterByName(athleteName) {
    const { data, error } = await withTimeout(
        supabase
            .from('lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('athlete_name', athleteName)
            .maybeSingle()
    );
    
    if (error) {
        throw new Error(`Error querying by athlete_name: ${error.message}`);
    }
    
    return data;
}

async function createNewLifter(internalId, athleteName) {
    const { data, error } = await withTimeout(
        supabase
            .from('lifters')
            .insert({
                athlete_name: athleteName,
                internal_id: parseInt(internalId),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .select('lifter_id')
            .single()
    );
    
    if (error) {
        throw new Error(`Error creating new lifter: ${error.message}`);
    }
    
    return data;
}

async function updateLifterInternalId(lifterId, internalId) {
    const { error } = await withTimeout(
        supabase
            .from('lifters')
            .update({
                internal_id: parseInt(internalId),
                updated_at: new Date().toISOString()
            })
            .eq('lifter_id', lifterId)
    );
    
    if (error) {
        throw new Error(`Error updating lifter internal_id: ${error.message}`);
    }
}

// Main processing function for a single athlete
async function processAthlete(internalId, athleteName, errorLogger) {
    console.log(`\n🔍 Processing: ${athleteName} (Internal ID: ${internalId})`);
    
    try {
        // Query by internal_id first
        const lifterByInternalId = await findLifterByInternalId(internalId);
        
        // Query by athlete_name
        const lifterByName = await findLifterByName(athleteName);
        
        // Case 1: Perfect match - both queries return the same lifter
        if (lifterByInternalId && lifterByName && 
            lifterByInternalId.lifter_id === lifterByName.lifter_id) {
            console.log(`  ✅ Perfect match found - skipping (lifter_id: ${lifterByInternalId.lifter_id})`);
            return { action: 'SKIPPED', success: true };
        }
        
        // Case 2: No existing records - create new lifter
        if (!lifterByInternalId && !lifterByName) {
            const newLifter = await createNewLifter(internalId, athleteName);
            console.log(`  ➕ Created new lifter (lifter_id: ${newLifter.lifter_id})`);
            return { action: 'CREATED', success: true, lifterId: newLifter.lifter_id };
        }
        
        // Case 3: Internal ID exists but with different name - MISMATCH
        if (lifterByInternalId && lifterByInternalId.athlete_name !== athleteName) {
            const errorMsg = `Internal ID ${internalId} exists with different name`;
            console.log(`  ❌ NAME_MISMATCH: Expected "${athleteName}", found "${lifterByInternalId.athlete_name}"`);
            errorLogger.logError(
                internalId,
                athleteName,
                'NAME_MISMATCH',
                lifterByInternalId.athlete_name,
                internalId,
                errorMsg
            );
            return { action: 'ERROR', success: false, errorType: 'NAME_MISMATCH' };
        }
        
        // Case 4: Name exists but with different internal_id - MISMATCH  
        if (lifterByName && lifterByName.internal_id && 
            lifterByName.internal_id !== parseInt(internalId)) {
            const errorMsg = `Athlete "${athleteName}" exists with different internal_id`;
            console.log(`  ❌ INTERNAL_ID_MISMATCH: Expected "${internalId}", found "${lifterByName.internal_id}"`);
            errorLogger.logError(
                internalId,
                athleteName,
                'INTERNAL_ID_MISMATCH',
                athleteName,
                lifterByName.internal_id,
                errorMsg
            );
            return { action: 'ERROR', success: false, errorType: 'INTERNAL_ID_MISMATCH' };
        }
        
        // Case 5: Name exists but internal_id is null - UPDATE
        if (lifterByName && !lifterByName.internal_id) {
            await updateLifterInternalId(lifterByName.lifter_id, internalId);
            console.log(`  🔄 Updated lifter with internal_id (lifter_id: ${lifterByName.lifter_id})`);
            return { action: 'UPDATED', success: true, lifterId: lifterByName.lifter_id };
        }
        
        // Case 6: Internal ID exists but name is null - UPDATE NAME
        if (lifterByInternalId && !lifterByInternalId.athlete_name) {
            const { error } = await withTimeout(
                supabase
                    .from('lifters')
                    .update({
                        athlete_name: athleteName,
                        updated_at: new Date().toISOString()
                    })
                    .eq('lifter_id', lifterByInternalId.lifter_id)
            );
            
            if (error) {
                throw new Error(`Error updating lifter name: ${error.message}`);
            }
            
            console.log(`  🔄 Updated lifter with athlete_name (lifter_id: ${lifterByInternalId.lifter_id})`);
            return { action: 'UPDATED', success: true, lifterId: lifterByInternalId.lifter_id };
        }
        
        // Should not reach here, but handle unexpected cases
        const errorMsg = `Unexpected case: lifterByInternalId=${!!lifterByInternalId}, lifterByName=${!!lifterByName}`;
        console.log(`  ❌ UNEXPECTED_CASE: ${errorMsg}`);
        errorLogger.logError(internalId, athleteName, 'UNEXPECTED_CASE', '', '', errorMsg);
        return { action: 'ERROR', success: false, errorType: 'UNEXPECTED_CASE' };
        
    } catch (error) {
        console.log(`  ❌ DATABASE_ERROR: ${error.message}`);
        errorLogger.logError(internalId, athleteName, 'DATABASE_ERROR', '', '', error.message);
        return { action: 'ERROR', success: false, errorType: 'DATABASE_ERROR' };
    }
}

// Main execution function
async function main() {
    console.log('🏋️ Internal ID to Supabase Uploader Started');
    console.log('============================================');
    console.log(`🕐 Start time: ${new Date().toLocaleString()}`);
    
    try {
        // Test Supabase connection
        console.log('\n🔗 Testing Supabase connection...');
        
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
            throw new Error('Missing Supabase environment variables (SUPABASE_URL, SUPABASE_ANON_KEY)');
        }
        
        const { data: testData, error: testError } = await withTimeout(
            supabase
                .from('lifters')
                .select('lifter_id')
                .limit(1)
        );
        
        if (testError) {
            throw new Error(`Supabase connection failed: ${testError.message}`);
        }
        console.log('✅ Supabase connection successful');
        
        // Load data
        console.log('\n📖 Loading internal IDs data...');
        const data = loadInternalIdsData();
        
        // Create error logger
        const errorLogger = createErrorLogger();
        
        // Find unprocessed athletes
        const allInternalIds = Object.keys(data.athletes);
        const unprocessedIds = allInternalIds.filter(id => !data.processed[id]);
        
        console.log(`\n📊 Processing Summary:`);
        console.log(`   Total athletes in JSON: ${allInternalIds.length}`);
        console.log(`   Previously processed: ${allInternalIds.length - unprocessedIds.length}`);
        console.log(`   To process tonight: ${unprocessedIds.length}`);
        
        if (unprocessedIds.length === 0) {
            console.log('\n🎉 All athletes already processed - nothing to upload!');
            return;
        }
        
        // Process each unprocessed athlete
        console.log(`\n🚀 Processing ${unprocessedIds.length} unprocessed athletes...`);
        
        let stats = {
            created: 0,
            updated: 0,
            skipped: 0,
            errors: 0
        };
        
        for (let i = 0; i < unprocessedIds.length; i++) {
            const internalId = unprocessedIds[i];
            const athleteName = data.athletes[internalId];
            
            console.log(`\n[${i + 1}/${unprocessedIds.length}] Processing ${athleteName}...`);
            
            const result = await processAthlete(internalId, athleteName, errorLogger);
            
            // Update stats
            if (result.action === 'CREATED') stats.created++;
            else if (result.action === 'UPDATED') stats.updated++;
            else if (result.action === 'SKIPPED') stats.skipped++;
            else if (result.action === 'ERROR') stats.errors++;
            
            // Mark as processed if successful
            if (result.success) {
                data.processed[internalId] = true;
                
                // Save progress every 10 athletes
                if ((i + 1) % 10 === 0) {
                    const saved = saveInternalIdsData(data);
                    if (saved) {
                        console.log(`  💾 Progress saved (${i + 1}/${unprocessedIds.length})`);
                    }
                }
            }
            
            // Small delay between operations to be respectful
            if (i < unprocessedIds.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Final save
        const finalSaved = saveInternalIdsData(data);
        if (!finalSaved) {
            console.error('❌ Warning: Failed to save final progress to JSON file');
        }
        
        // Summary report
        console.log('\n🎉 Internal ID Upload Completed!');
        console.log('================================');
        console.log(`📊 Results Summary:`);
        console.log(`   ➕ Created: ${stats.created} new lifters`);
        console.log(`   🔄 Updated: ${stats.updated} existing lifters`);
        console.log(`   ⏭️ Skipped: ${stats.skipped} already correct`);
        console.log(`   ❌ Errors: ${stats.errors} failed`);
        console.log(`   📁 Total processed: ${stats.created + stats.updated + stats.skipped}`);
        
        if (stats.errors > 0) {
            console.log(`\n⚠️ ${stats.errors} errors logged to: ${ERROR_LOG_FILE}`);
        }
        
        console.log(`\n🕐 End time: ${new Date().toLocaleString()}`);
        console.log(`💾 Progress saved to: ${JSON_FILE}`);
        
        // Exit with appropriate code for GitHub Actions
        if (stats.errors > 0) {
            console.log('\n⚠️ Completed with errors - check error log');
            process.exit(1);
        } else {
            console.log('\n✅ Completed successfully with no errors');
            process.exit(0);
        }
        
    } catch (error) {
        console.error('\n💥 Fatal error occurred:', error.message);
        console.error('🚨 Upload failed - no progress saved');
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { main };