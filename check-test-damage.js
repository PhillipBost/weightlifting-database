#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function checkDamage() {
    console.log('🔍 Checking for damaged meets from test script...\n');
    
    // Check meets 3019 and 7142 that were affected by the test
    const damagedMeets = [3019, 7142];
    
    for (const meetId of damagedMeets) {
        console.log(`📊 Checking Meet ${meetId}:`);
        
        const { data: results, error } = await supabase
            .from('usaw_meet_results')
            .select('lifter_name, lifter_id, body_weight_kg, weight_class, date')
            .eq('meet_id', meetId)
            .order('lifter_name');
            
        if (error) {
            console.error(`❌ Error checking meet ${meetId}: ${error.message}`);
        } else {
            console.log(`   Results remaining: ${results.length}`);
            if (results.length > 0) {
                console.log(`   Date: ${results[0].date}`);
                console.log(`   Athletes:`);
                results.forEach((result, index) => {
                    console.log(`     ${index + 1}. ${result.lifter_name} (ID: ${result.lifter_id}) - ${result.body_weight_kg}kg, ${result.weight_class}`);
                });
            } else {
                console.log(`   ❌ COMPLETELY WIPED OUT - NO RESULTS REMAINING`);
            }
        }
        console.log('');
    }
    
    // Check if test meet 9999 was created and needs cleanup
    const { data: testResults, error: testError } = await supabase
        .from('usaw_meet_results')
        .select('*')
        .eq('meet_id', 9999);
        
    if (!testError && testResults && testResults.length > 0) {
        console.log(`⚠️ Test meet 9999 has ${testResults.length} results that should be cleaned up`);
    }
    
    // Check for any other meets that might have been affected
    console.log('🔍 Checking for any other recent deletions...');
    
    // Look for meets with very few results that might have been affected
    const { data: suspiciousMeets, error: suspiciousError } = await supabase
        .from('usaw_meet_results')
        .select('meet_id, count(*)')
        .in('meet_id', [3019, 7142])
        .group('meet_id');
        
    if (!suspiciousError && suspiciousMeets) {
        console.log('📊 Current result counts for affected meets:');
        suspiciousMeets.forEach(meet => {
            console.log(`   Meet ${meet.meet_id}: ${meet.count} results`);
        });
    }
}

checkDamage().catch(console.error);