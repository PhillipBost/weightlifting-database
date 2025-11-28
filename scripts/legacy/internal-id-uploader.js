// Load environment variables from .env file
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const JSON_FILE = 'internal_ids.json';
const ERROR_LOG_FILE = '../../data/legacy/internal_id_upload_errors.csv';

// Timeout wrapper for database operations
function withTimeout(promise, timeoutMs = 30000) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Database operation timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

// ENHANCED: Load data with ALL fields preserved including uploadConflicts
function loadInternalIdsData() {
    if (!fs.existsSync(JSON_FILE)) {
        throw new Error(`JSON file not found: ${JSON_FILE}`);
    }

    try {
        const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
        console.log(`📖 Loaded internal IDs data:`);
        console.log(`   Athletes: ${Object.keys(data.athletes || {}).length}`);
        console.log(`   Failed IDs (retryable): ${data.failedIds?.length || 0}`);
        console.log(`   Permanently failed IDs: ${data.permanentlyFailedIds?.length || 0}`);
        console.log(`   Upload conflicts: ${data.uploadConflicts?.length || 0}`);
        console.log(`   Previously processed: ${Object.keys(data.processed || {}).length}`);

        return {
            athletes: data.athletes || {},
            failedIds: data.failedIds || [],
            permanentlyFailedIds: data.permanentlyFailedIds || [], // ✅ PRESERVE
            uploadConflicts: data.uploadConflicts || [], // ✅ NEW: Track conflicts
            lastProcessedId: data.lastProcessedId || 0,
            processed: data.processed || {}
        };
    } catch (error) {
        throw new Error(`Error reading JSON file: ${error.message}`);
    }
}

// ENHANCED: Save data with ALL fields preserved and conflict cleanup
function saveInternalIdsData(data) {
    try {
        // Ensure all arrays exist
        if (!data.permanentlyFailedIds) data.permanentlyFailedIds = [];
        if (!data.uploadConflicts) data.uploadConflicts = [];

        // Remove duplicates between failed and permanently failed
        data.failedIds = data.failedIds.filter(id => !data.permanentlyFailedIds.includes(id));

        // Remove duplicates in uploadConflicts
        const conflictIds = new Set();
        data.uploadConflicts = data.uploadConflicts.filter(conflict => {
            if (conflictIds.has(conflict.internalId)) {
                return false; // Duplicate
            }
            conflictIds.add(conflict.internalId);
            return true;
        });

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
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id, internal_id_2')
            .or(`internal_id.eq.${parseInt(internalId)},internal_id_2.eq.${parseInt(internalId)}`)
    );

    if (error) {
        throw new Error(`Error querying by internal_id: ${error.message}`);
    }

    // Return first match if any found
    return data && data.length > 0 ? data[0] : null;
}

async function findLifterByName(athleteName) {
    const { data, error } = await withTimeout(
        supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id, internal_id_2')
            .eq('athlete_name', athleteName)
    );

    if (error) {
        throw new Error(`Error querying by athlete_name: ${error.message}`);
    }

    // Return first match if any found
    return data && data.length > 0 ? data[0] : null;
}

async function createNewLifter(internalId, athleteName) {
    const { data, error } = await withTimeout(
        supabase
            .from('usaw_lifters')
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
    // First get current internal IDs
    const { data: current, error: fetchError } = await withTimeout(
        supabase
            .from('usaw_lifters')
            .select('internal_id, internal_id_2')
            .eq('lifter_id', lifterId)
            .single()
    );

    if (fetchError) {
        throw new Error(`Error fetching current internal IDs: ${fetchError.message}`);
    }

    const newId = parseInt(internalId);
    let updateData = { updated_at: new Date().toISOString() };

    // Determine where to put the new internal ID
    if (!current.internal_id) {
        updateData.internal_id = newId;
        console.log(`  📝 Adding as primary internal_id`);
    } else if (!current.internal_id_2) {
        updateData.internal_id_2 = newId;
        console.log(`  📝 Adding as secondary internal_id_2 (primary: ${current.internal_id})`);
    } else {
        throw new Error(`Lifter already has two internal IDs: ${current.internal_id} and ${current.internal_id_2}`);
    }

    const { error } = await withTimeout(
        supabase
            .from('usaw_lifters')
            .update(updateData)
            .eq('lifter_id', lifterId)
    );

    if (error) {
        throw new Error(`Error updating lifter internal_id: ${error.message}`);
    }
}

// SMART: Enhanced processing function with conflict detection and permanent skipping
async function processAthlete(internalId, athleteName, errorLogger, data) {
    console.log(`\n🔍 Processing: ${athleteName} (Internal ID: ${internalId})`);

    // ✅ SMART: Check if this is a known conflict first
    const knownConflict = data.uploadConflicts.find(c => c.internalId === parseInt(internalId));
    if (knownConflict) {
        console.log(`   ↷ Skipping known conflict: ${knownConflict.reason}`);
        return {
            success: true, // Don't retry
            action: 'SKIPPED',
            reason: 'Known conflict - permanently skipped'
        };
    }

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

        // Case 3: Internal ID exists but with different name - PERMANENT CONFLICT
        if (lifterByInternalId && lifterByInternalId.athlete_name !== athleteName) {
            const conflict = {
                internalId: parseInt(internalId),
                scrapedName: athleteName,
                existingName: lifterByInternalId.athlete_name,
                reason: `Internal ID ${internalId} already assigned to "${lifterByInternalId.athlete_name}"`,
                conflictType: 'INTERNAL_ID_TAKEN',
                detectedAt: new Date().toISOString()
            };

            // Add to permanent conflicts list
            data.uploadConflicts.push(conflict);

            console.log(`  ❌ PERMANENT CONFLICT: Internal ID ${internalId} already belongs to "${lifterByInternalId.athlete_name}"`);
            console.log(`  📝 Added to permanent conflicts - will not retry`);

            // Log to CSV for record keeping (but don't retry)
            errorLogger.logError(
                internalId,
                athleteName,
                'PERMANENT_CONFLICT',
                lifterByInternalId.athlete_name,
                internalId,
                'Internal ID conflict - permanently skipped'
            );

            return {
                success: true, // Don't retry
                action: 'CONFLICT',
                reason: 'Permanent conflict logged'
            };
        }

        // Case 4: Name exists but with different internal_id - CHECK FOR SECOND ID SLOT
        if (lifterByName && lifterByName.internal_id &&
            lifterByName.internal_id !== parseInt(internalId)) {

            // Check if internal_id_2 is available
            if (!lifterByName.internal_id_2) {
                // Add as second internal ID
                await updateLifterInternalId(lifterByName.lifter_id, internalId);
                console.log(`  🔄 Added as secondary internal_id_2 (primary: ${lifterByName.internal_id})`);
                return { action: 'UPDATED', success: true, lifterId: lifterByName.lifter_id };
            } else {
                // Both slots filled - now it's a real conflict
                const conflict = {
                    internalId: parseInt(internalId),
                    scrapedName: athleteName,
                    existingInternalId: lifterByName.internal_id,
                    existingInternalId2: lifterByName.internal_id_2,
                    reason: `Athlete "${athleteName}" already has two internal_ids: ${lifterByName.internal_id} and ${lifterByName.internal_id_2}`,
                    conflictType: 'NAME_HAS_TWO_IDS',
                    detectedAt: new Date().toISOString()
                };

                data.uploadConflicts.push(conflict);

                console.log(`  ❌ PERMANENT CONFLICT: "${athleteName}" already has two internal_ids: ${lifterByName.internal_id} and ${lifterByName.internal_id_2}`);
                console.log(`  📝 Added to permanent conflicts - will not retry`);

                errorLogger.logError(
                    internalId,
                    athleteName,
                    'PERMANENT_CONFLICT',
                    athleteName,
                    `${lifterByName.internal_id}, ${lifterByName.internal_id_2}`,
                    'Name has two internal_ids - permanently skipped'
                );

                return {
                    success: true, // Don't retry
                    action: 'CONFLICT',
                    reason: 'Permanent conflict logged'
                };
            }
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
                    .from('usaw_lifters')
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

        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
            throw new Error('Missing Supabase environment variables (SUPABASE_URL, SUPABASE_SECRET_KEY)');
        }

        const { data: testData, error: testError } = await withTimeout(
            supabase
                .from('usaw_lifters')
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

        const debugAllIds = Object.keys(data.athletes);
        const debugProcessedIds = Object.keys(data.processed);
        const debugConflictIds = data.uploadConflicts.map(c => c.internalId.toString());

        // Create error logger
        const errorLogger = createErrorLogger();

        // Find unprocessed athletes (excluding known conflicts)
        const allInternalIds = Object.keys(data.athletes);
        const processedIds = Object.keys(data.processed).filter(id => data.processed[id] === true);
        const conflictIds = data.uploadConflicts.map(c => c.internalId.toString());

        // Debug: Check if ID 1 is being found
        console.log(`🔍 Debug: ID 1 processed status: ${data.processed['1']}`);
        console.log(`🔍 Debug: ID 1 exists in athletes: ${!!data.athletes['1']}`);
        console.log(`🔍 Debug: Is ID "1" in processedIds? ${debugProcessedIds.includes('1')}`);
        console.log(`🔍 Debug: Is ID "1" in conflictIds? ${debugConflictIds.includes('1')}`);

        const unprocessedIds = allInternalIds
            .filter(id => !processedIds.includes(id) && !conflictIds.includes(id))
            .sort((a, b) => parseInt(a) - parseInt(b));

        console.log(`\n📊 Processing Summary:`);
        console.log(`   Total athletes in JSON: ${allInternalIds.length}`);
        console.log(`   Previously processed: ${processedIds.length}`);
        console.log(`   Known conflicts (permanently skipped): ${conflictIds.length}`);
        console.log(`   To process tonight: ${unprocessedIds.length}`);

        if (unprocessedIds.length === 0) {
            console.log('\n🎉 All athletes already processed - nothing to upload!');
            console.log('\n📝 Conflict Summary:');
            data.uploadConflicts.forEach(conflict => {
                console.log(`   • ID ${conflict.internalId}: ${conflict.reason}`);
            });
            return;
        }

        // Process each unprocessed athlete
        console.log(`\n🚀 Processing ${unprocessedIds.length} unprocessed athletes...`);

        let stats = {
            created: 0,
            updated: 0,
            skipped: 0,
            conflicts: 0,
            errors: 0
        };

        for (let i = 0; i < unprocessedIds.length; i++) {
            const internalId = unprocessedIds[i];
            const athleteName = data.athletes[internalId];

            console.log(`\n[${i + 1}/${unprocessedIds.length}] Processing ${athleteName}...`);

            const result = await processAthlete(internalId, athleteName, errorLogger, data);

            // Update stats
            if (result.action === 'CREATED') stats.created++;
            else if (result.action === 'UPDATED') stats.updated++;
            else if (result.action === 'SKIPPED') stats.skipped++;
            else if (result.action === 'CONFLICT') stats.conflicts++;
            else if (result.action === 'ERROR') stats.errors++;

            // Mark as processed if successful (including conflicts)
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

        // Enhanced summary report
        console.log('\n🎉 Internal ID Upload Completed!');
        console.log('================================');
        console.log(`📊 Results Summary:`);
        console.log(`   ➕ Created: ${stats.created} new lifters`);
        console.log(`   🔄 Updated: ${stats.updated} existing lifters`);
        console.log(`   ⭐ Skipped: ${stats.skipped} already correct`);
        console.log(`   ⚠️ Conflicts: ${stats.conflicts} permanently skipped`);
        console.log(`   ❌ Errors: ${stats.errors} failed`);
        console.log(`   📊 Total processed: ${stats.created + stats.updated + stats.skipped + stats.conflicts}`);

        if (stats.conflicts > 0) {
            console.log(`\n📝 New Conflicts (permanently skipped):`);
            const newConflicts = data.uploadConflicts.slice(-stats.conflicts);
            newConflicts.forEach(conflict => {
                console.log(`   • ID ${conflict.internalId}: ${conflict.reason}`);
            });
        }

        if (stats.errors > 0) {
            console.log(`\n⚠️ ${stats.errors} errors logged to: ${ERROR_LOG_FILE}`);
        }

        console.log(`\n🕐 End time: ${new Date().toLocaleString()}`);
        console.log(`💾 Progress saved to: ${JSON_FILE}`);
        console.log(`📁 Total permanent conflicts: ${data.uploadConflicts.length}`);

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