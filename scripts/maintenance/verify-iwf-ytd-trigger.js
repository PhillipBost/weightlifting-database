/**
 * Verify IWF YTD Trigger Status
 *
 * Diagnostic script to check:
 * 1. If trigger exists on database
 * 2. If trigger function is registered
 * 3. Current state of YTD fields in sample records
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Use IWF-specific credentials (separate database from USAW)
const supabaseUrl = process.env.SUPABASE_IWF_URL;
const supabaseKey = process.env.SUPABASE_IWF_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing IWF Supabase credentials');
    console.error('   Required: SUPABASE_IWF_URL and SUPABASE_IWF_SECRET_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyTrigger() {
    console.log('================================================================================');
    console.log('IWF YTD TRIGGER VERIFICATION');
    console.log('================================================================================\n');

    // 1. Check if trigger exists
    console.log('1. Checking for trigger registration...');
    console.log('   ℹ️  Cannot directly query triggers via Supabase client');
    console.log('   → Will infer trigger status from data inspection\n');

    // 2. Check sample records for YTD data
    console.log('2. Checking sample records for YTD values...');
    const { data: sampleRecords, error: sampleError } = await supabase
        .from('iwf_meet_results')
        .select('*')
        .gte('date', '2025-01-01')
        .order('date', { ascending: true })
        .limit(5);

    if (sampleError) {
        console.log(`   ❌ Error querying records: ${sampleError.message}\n`);
    } else if (!sampleRecords || sampleRecords.length === 0) {
        console.log('   ℹ️  No records found for 2025\n');
    } else {
        console.log(`   Found ${sampleRecords.length} records\n`);

        // First, show the columns that exist
        if (sampleRecords.length > 0) {
            console.log(`   Table columns found: ${Object.keys(sampleRecords[0]).join(', ')}\n`);
        }

        let nullCount = 0;
        let populatedCount = 0;

        sampleRecords.forEach(record => {
            const hasYTD = record.best_snatch_ytd !== null || record.best_cj_ytd !== null || record.best_total_ytd !== null;

            if (hasYTD) {
                populatedCount++;
                console.log(`   ✅ ${record.lifter_name} (${record.date})`);
                console.log(`      Lifts: ${record.best_snatch}/${record.best_cj}/${record.total}`);
                console.log(`      YTD:   ${record.best_snatch_ytd}/${record.best_cj_ytd}/${record.best_total_ytd}\n`);
            } else {
                nullCount++;
                console.log(`   ❌ ${record.lifter_name} (${record.date})`);
                console.log(`      Lifts: ${record.best_snatch}/${record.best_cj}/${record.total}`);
                console.log(`      YTD:   NULL/NULL/NULL\n`);
            }
        });

        console.log(`   Summary: ${populatedCount} with YTD, ${nullCount} without YTD\n`);
    }

    // 3. Check for lifters with multiple results (should have YTD)
    console.log('3. Checking lifters with multiple 2025 results...');
    const { data: multiResults, error: multiError } = await supabase
        .from('iwf_meet_results')
        .select('db_lifter_id, lifter_name, date, best_snatch, best_snatch_ytd, best_cj, best_cj_ytd, total, best_total_ytd')
        .gte('date', '2025-01-01')
        .order('db_lifter_id', { ascending: true })
        .order('date', { ascending: true })
        .limit(50);

    if (multiError) {
        console.log(`   ❌ Error: ${multiError.message}\n`);
    } else if (multiResults && multiResults.length > 0) {
        // Group by lifter
        const lifterGroups = {};
        multiResults.forEach(r => {
            if (!lifterGroups[r.db_lifter_id]) {
                lifterGroups[r.db_lifter_id] = [];
            }
            lifterGroups[r.db_lifter_id].push(r);
        });

        const multiLifters = Object.values(lifterGroups).filter(group => group.length > 1);

        if (multiLifters.length === 0) {
            console.log('   ℹ️  No lifters with multiple 2025 results yet\n');
        } else {
            console.log(`   Found ${multiLifters.length} lifters with multiple results:\n`);

            multiLifters.slice(0, 3).forEach(group => {
                console.log(`   Lifter: ${group[0].lifter_name}`);
                group.forEach((r, i) => {
                    console.log(`      Meet ${i + 1} (${r.date}): ${r.best_snatch}/${r.best_cj}/${r.total} → YTD: ${r.best_snatch_ytd}/${r.best_cj_ytd}/${r.best_total_ytd}`);
                });
                console.log('');
            });
        }
    }

    console.log('================================================================================');
    console.log('DIAGNOSIS SUMMARY');
    console.log('================================================================================');

    if (sampleRecords && sampleRecords.length > 0 && nullCount > 0) {
        console.log('❌ ISSUE: YTD fields are NULL');
        console.log('');
        console.log('POSSIBLE CAUSES:');
        console.log('1. Trigger not applied to database yet');
        console.log('2. Trigger applied AFTER records were inserted');
        console.log('3. Trigger has error and fails silently (EXCEPTION WHEN OTHERS)');
        console.log('4. Trigger logic issue (result_id comparison fails on INSERT)');
        console.log('');
        console.log('NEXT STEPS:');
        console.log('1. Apply trigger using Supabase SQL Editor');
        console.log('   File: migrations/update-iwf-ytd-trigger-include-current.sql');
        console.log('2. Run backfill script: node scripts/maintenance/backfill-iwf-ytd.js');
        console.log('3. Test with new import: node scripts/production/iwf-main.js --event-id 661 --year 2025 --limit 10');
    } else if (sampleRecords && sampleRecords.length > 0 && nullCount === 0) {
        console.log('✅ Everything looks good!');
        console.log('   YTD fields are populated correctly');
    } else {
        console.log('ℹ️  No 2025 records found to verify');
    }

    console.log('================================================================================');
}

verifyTrigger()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
