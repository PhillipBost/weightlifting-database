#!/usr/bin/env node
/**
 * Verify IWF Database Import
 * Quick script to check what was imported for Event 661
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseIWF = createClient(
    process.env.SUPABASE_IWF_URL,
    process.env.SUPABASE_IWF_SECRET_KEY
);

async function verifyImport() {
    console.log('\n='.repeat(80));
    console.log('IWF DATABASE VERIFICATION - Event 661');
    console.log('='.repeat(80));

    // Check meet record
    const { data: meets, error: meetError } = await supabaseIWF
        .from('iwf_meets')
        .select('db_meet_id, event_id, meet, date')
        .eq('event_id', '661');

    if (meetError) {
        console.error('Error querying meets:', meetError);
        return;
    }

    console.log('\n📋 MEET RECORD:');
    if (meets && meets.length > 0) {
        console.log(`  ✓ Meet ID: ${meets[0].db_meet_id}`);
        console.log(`  ✓ Event ID: ${meets[0].event_id}`);
        console.log(`  ✓ Name: ${meets[0].meet}`);
        console.log(`  ✓ Date: ${meets[0].date}`);
    } else {
        console.log('  ✗ No meet record found');
        return;
    }

    const meetId = meets[0].db_meet_id;

    // Count lifters
    const { count: lifterCount, error: lifterError } = await supabaseIWF
        .from('iwf_lifters')
        .select('*', { count: 'exact', head: true });

    if (!lifterError) {
        console.log(`\n👥 LIFTERS: ${lifterCount} total athletes in database`);
    }

    // Count results for this meet
    const { count: resultCount, error: resultError } = await supabaseIWF
        .from('iwf_meet_results')
        .select('*', { count: 'exact', head: true })
        .eq('iwf_meet_id', meetId);

    if (!resultError) {
        console.log(`\n🏋️  RESULTS FOR EVENT 661: ${resultCount} competition results`);
    }

    // Get sample results with analytics
    const { data: sampleResults, error: sampleError } = await supabaseIWF
        .from('iwf_meet_results')
        .select('lifter_name, weight_class, best_snatch, best_cj, total, snatch_successful_attempts, cj_successful_attempts, qpoints, bounce_back_snatch_2, bounce_back_cj_2')
        .eq('iwf_meet_id', meetId)
        .limit(3);

    if (!sampleError && sampleResults) {
        console.log(`\n📊 SAMPLE RESULTS (with analytics):`);
        sampleResults.forEach((result, i) => {
            console.log(`\n  ${i + 1}. ${result.lifter_name} (${result.weight_class})`);
            console.log(`     Lifts: ${result.best_snatch}/${result.best_cj}/${result.total}`);
            console.log(`     Successful: Sn ${result.snatch_successful_attempts}/3, CJ ${result.cj_successful_attempts}/3`);
            console.log(`     Q-Score: ${result.qpoints}`);
            console.log(`     Bounce-back: Sn2=${result.bounce_back_snatch_2}, CJ2=${result.bounce_back_cj_2}`);
        });
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Verification complete\n');
}

verifyImport().catch(console.error);
