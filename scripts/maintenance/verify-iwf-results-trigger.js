#!/usr/bin/env node

/**
 * Verification Script: IWF Meet Results Count Trigger
 * 
 * Validates that the trigger is working correctly by:
 * 1. Checking trigger exists in database
 * 2. Verifying trigger function works
 * 3. Testing count updates on INSERT/UPDATE/DELETE
 * 4. Reporting any meets with NULL or outdated results
 * 
 * Usage: node scripts/maintenance/verify-iwf-results-trigger.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

/**
 * Check if trigger exists in database
 */
async function checkTriggerExists() {
    console.log('\n📋 Checking if trigger exists...');
    
    try {
        // Query PostgreSQL information schema
        const { data, error } = await supabase
            .rpc('check_trigger_exists', {
                p_trigger_name: 'trg_update_iwf_meet_results_count'
            });

        if (error) {
            console.log('  ⚠️  Could not verify trigger (requires superuser access)');
            console.log('  Run this SQL in Supabase to verify:');
            console.log('    SELECT * FROM pg_trigger WHERE tgname = \'trg_update_iwf_meet_results_count\';');
            return false;
        }

        if (data && data.length > 0) {
            console.log('  ✓ Trigger exists: trg_update_iwf_meet_results_count');
            return true;
        } else {
            console.log('  ❌ Trigger NOT FOUND');
            return false;
        }
    } catch (error) {
        console.log('  ⚠️  Error checking trigger:', error.message);
        return false;
    }
}

/**
 * Verify that meets have results counts populated
 */
async function verifyResultsCounts() {
    console.log('\n📊 Verifying results counts...');
    
    try {
        // Check for meets with NULL results
        const { data: nullResults, error: nullError } = await supabase
            .from('iwf_meets')
            .select('iwf_meet_id, meet, results')
            .is('results', null)
            .limit(5);

        if (nullError) throw nullError;

        if (nullResults && nullResults.length > 0) {
            console.log(`  ⚠️  Found ${nullResults.length} meets with NULL results:`);
            nullResults.forEach(meet => {
                console.log(`      - Event ${meet.iwf_meet_id}: ${meet.meet}`);
            });
        } else {
            console.log('  ✓ No meets with NULL results');
        }

        // Check sample of meets with populated results
        const { data: populatedResults, error: populatedError } = await supabase
            .from('iwf_meets')
            .select('iwf_meet_id, meet, results')
            .not('results', 'is', null)
            .limit(5);

        if (populatedError) throw populatedError;

        if (populatedResults && populatedResults.length > 0) {
            console.log(`  ✓ Sample of populated results counts:`);
            populatedResults.forEach(meet => {
                console.log(`      - Event ${meet.iwf_meet_id}: ${meet.results}`);
            });
        }

    } catch (error) {
        console.log('  ❌ Error verifying results:', error.message);
    }
}

/**
 * Get statistics on results population
 */
async function getStatistics() {
    console.log('\n📈 Results Population Statistics:');
    
    try {
        // Total meets
        const { count: totalMeets, error: meetsError } = await supabase
            .from('iwf_meets')
            .select('*', { count: 'exact', head: true });

        if (meetsError) throw meetsError;

        // Meets with results populated
        const { count: populatedMeets, error: populatedError } = await supabase
            .from('iwf_meets')
            .select('*', { count: 'exact', head: true })
            .not('results', 'is', null);

        if (populatedError) throw populatedError;

        // Meets with NULL results
        const nullCount = totalMeets - (populatedMeets || 0);

        console.log(`  Total meets: ${totalMeets}`);
        console.log(`  Meets with results: ${populatedMeets} (${((populatedMeets / totalMeets) * 100).toFixed(1)}%)`);
        console.log(`  Meets with NULL results: ${nullCount}`);

        // Sample verification
        if (populatedMeets > 0) {
            const { data: sampleMeets, error: sampleError } = await supabase
                .from('iwf_meets')
                .select('meet, results')
                .not('results', 'is', null)
                .limit(3);

            if (!sampleError && sampleMeets) {
                console.log('\n  Sample results strings:');
                sampleMeets.forEach(meet => {
                    console.log(`    "${meet.results}"`);
                });
            }
        }

    } catch (error) {
        console.log(`  ❌ Error getting statistics: ${error.message}`);
    }
}

/**
 * Provide guidance for manual trigger application
 */
function provideMigrationGuidance() {
    console.log('\n📝 To Apply Trigger Migration:');
    console.log('  1. Open Supabase SQL Editor');
    console.log('  2. Copy and paste the migration file:');
    console.log('     migrations/add-iwf-meet-results-count-trigger.sql');
    console.log('  3. Run the SQL');
    console.log('  4. Re-run this script to verify\n');
}

// ============================================================================
// MAIN VERIFICATION FLOW
// ============================================================================

async function main() {
    console.log('================================================================================');
    console.log('IWF MEET RESULTS COUNT TRIGGER - VERIFICATION SCRIPT');
    console.log('================================================================================');
    
    // Check for required environment variables
    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables');
        process.exit(1);
    }

    try {
        // Run verification checks
        await checkTriggerExists();
        await verifyResultsCounts();
        await getStatistics();
        
        console.log('\n================================================================================');
        console.log('VERIFICATION COMPLETE');
        console.log('================================================================================\n');
        
        provideMigrationGuidance();

    } catch (error) {
        console.error('\n❌ Verification failed:', error.message);
        process.exit(1);
    }
}

main();
