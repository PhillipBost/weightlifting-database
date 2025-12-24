/**
 * Debug the Molly Raines upsert issue
 * Check what data is being sent to the upsert and why it's not inserting
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function debugMollyRainesUpsert() {
    console.log('🔍 Debugging Molly Raines upsert issue');
    console.log('=' .repeat(50));
    
    try {
        // 1. Check current database state
        console.log('\n📋 Step 1: Current database state');
        
        const { data: currentResults, error: currentError } = await supabase
            .from('usaw_meet_results')
            .select('result_id, meet_id, lifter_id, lifter_name, weight_class, body_weight_kg, total')
            .eq('meet_id', 3019)
            .eq('lifter_id', 25409);
            
        if (currentError) {
            console.log('❌ Error getting current results:', currentError.message);
        } else {
            console.log(`📊 Found ${currentResults.length} existing result(s) for Molly Raines (lifter_id 25409) in meet 3019:`);
            currentResults.forEach((result, index) => {
                console.log(`   ${index + 1}. Result ID: ${result.result_id}`);
                console.log(`      Weight Class: "${result.weight_class}"`);
                console.log(`      Body Weight: ${result.body_weight_kg}kg`);
                console.log(`      Total: ${result.total}`);
                console.log('');
            });
        }
        
        // 2. Simulate the missing data that should be inserted
        console.log('\n📋 Step 2: Missing data that should be inserted');
        
        const missingMollyData = {
            meet_id: 3019,
            lifter_id: 25409,
            meet_name: 'Belmont Barbell Open',
            date: '2018-03-03',
            age_category: "Women's 13 Under Age Group",
            weight_class: '48kg',  // This is the missing one
            lifter_name: 'Molly Raines',
            body_weight_kg: '47',
            total: '79'
        };
        
        console.log('📊 Missing data to insert:');
        console.log(`   Weight Class: "${missingMollyData.weight_class}"`);
        console.log(`   Body Weight: ${missingMollyData.body_weight_kg}kg`);
        console.log(`   Total: ${missingMollyData.total}`);
        
        // 3. Test the upsert operation
        console.log('\n📋 Step 3: Testing upsert operation');
        
        console.log('🧪 Attempting upsert with new constraint...');
        const { data: upsertData, error: upsertError } = await supabase
            .from('usaw_meet_results')
            .upsert(missingMollyData, {
                onConflict: 'meet_id, lifter_id, weight_class',
                ignoreDuplicates: false
            })
            .select();
            
        if (upsertError) {
            console.log('❌ Upsert failed:', upsertError.message);
            console.log('   Error code:', upsertError.code);
            console.log('   Error details:', upsertError.details);
        } else {
            console.log('✅ Upsert succeeded!');
            console.log('📊 Upsert result:', upsertData);
        }
        
        // 4. Check database state after upsert
        console.log('\n📋 Step 4: Database state after upsert');
        
        const { data: afterResults, error: afterError } = await supabase
            .from('usaw_meet_results')
            .select('result_id, meet_id, lifter_id, lifter_name, weight_class, body_weight_kg, total')
            .eq('meet_id', 3019)
            .eq('lifter_id', 25409)
            .order('weight_class');
            
        if (afterError) {
            console.log('❌ Error getting after results:', afterError.message);
        } else {
            console.log(`📊 Found ${afterResults.length} result(s) after upsert:`);
            afterResults.forEach((result, index) => {
                console.log(`   ${index + 1}. Result ID: ${result.result_id}`);
                console.log(`      Weight Class: "${result.weight_class}"`);
                console.log(`      Body Weight: ${result.body_weight_kg}kg`);
                console.log(`      Total: ${result.total}`);
                console.log('');
            });
            
            if (afterResults.length > currentResults.length) {
                console.log('🎉 SUCCESS: New record was inserted!');
            } else {
                console.log('⚠️ No new record inserted - existing record may have been updated');
            }
        }
        
    } catch (error) {
        console.error(`❌ Debug failed: ${error.message}`);
        console.error(error.stack);
    }
}

debugMollyRainesUpsert().catch(console.error);