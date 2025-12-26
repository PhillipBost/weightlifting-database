#!/usr/bin/env node

/**
 * Identify Vanessa Rodriguez Incorrect Result in Meet 7142
 * 
 * This script identifies the specific result that was incorrectly assigned
 * to lifter_id 4199 (internal_id 28381) with BW=75.4kg, Total=130kg
 * that should be deleted before re-importing with correct assignment.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function identifyIncorrectResult() {
    console.log('🔍 Identifying Vanessa Rodriguez Incorrect Result in Meet 7142');
    console.log('==============================================================');
    
    try {
        // 1. Find the specific incorrect result based on task description
        console.log('\n📋 Step 1: Finding the incorrect result...');
        console.log('   Looking for: lifter_id 4199, BW=75.4kg, Total=130kg');
        
        const { data: incorrectResult, error: resultError } = await supabase
            .from('usaw_meet_results')
            .select(`
                result_id,
                lifter_id,
                lifter_name,
                body_weight_kg,
                total_kg,
                age_category,
                weight_class,
                club_name,
                wso,
                competition_age,
                gender,
                date
            `)
            .eq('meet_id', 7142)
            .eq('lifter_id', 4199)
            .eq('body_weight_kg', 75.4)
            .eq('total_kg', 130);
            
        if (resultError) {
            throw new Error(`Error querying meet results: ${resultError.message}`);
        }
        
        if (incorrectResult.length === 0) {
            console.log('❌ No result found matching the specific criteria');
            console.log('   This may mean the result has already been deleted or the criteria are incorrect');
            
            // Check for any Vanessa Rodriguez results in meet 7142
            const { data: allVanessaResults, error: allError } = await supabase
                .from('usaw_meet_results')
                .select('result_id, lifter_id, lifter_name, body_weight_kg, total_kg')
                .eq('meet_id', 7142)
                .eq('lifter_name', 'Vanessa Rodriguez');
                
            if (allError) {
                throw new Error(`Error querying all Vanessa results: ${allError.message}`);
            }
            
            console.log(`\n📊 All Vanessa Rodriguez results in meet 7142 (${allVanessaResults.length} found):`);
            allVanessaResults.forEach(result => {
                console.log(`   Result ID: ${result.result_id}, Lifter ID: ${result.lifter_id}, BW: ${result.body_weight_kg}kg, Total: ${result.total_kg}kg`);
            });
            
            return;
        }
        
        console.log(`✅ Found ${incorrectResult.length} result(s) matching the criteria:`);
        incorrectResult.forEach((result, index) => {
            console.log(`\n  ${index + 1}. INCORRECT RESULT TO DELETE:`);
            console.log(`     Result ID: ${result.result_id}`);
            console.log(`     Lifter ID: ${result.lifter_id}`);
            console.log(`     Lifter Name: ${result.lifter_name}`);
            console.log(`     Body Weight: ${result.body_weight_kg}kg`);
            console.log(`     Total: ${result.total_kg}kg`);
            console.log(`     Division: ${result.age_category} ${result.weight_class}`);
            console.log(`     Club: ${result.club_name || 'Unknown'}`);
            console.log(`     WSO: ${result.wso || 'Unknown'}`);
            console.log(`     Date: ${result.date}`);
        });
        
        // 2. Verify the lifter details for lifter_id 4199
        console.log('\n📋 Step 2: Verifying lifter details for lifter_id 4199...');
        
        const { data: lifterDetails, error: lifterError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id, membership_number')
            .eq('lifter_id', 4199);
            
        if (lifterError) {
            throw new Error(`Error querying lifter details: ${lifterError.message}`);
        }
        
        if (lifterDetails.length === 0) {
            console.log('❌ No lifter found with lifter_id 4199');
        } else {
            const lifter = lifterDetails[0];
            console.log(`📊 Lifter ID 4199 details:`);
            console.log(`   Name: ${lifter.athlete_name}`);
            console.log(`   Internal ID: ${lifter.internal_id || 'null'}`);
            console.log(`   Membership: ${lifter.membership_number || 'null'}`);
            
            // Verify internal_id matches expected 28381
            if (lifter.internal_id === 28381) {
                console.log('✅ Internal ID matches expected value (28381)');
            } else {
                console.log(`⚠️  Internal ID mismatch: expected 28381, found ${lifter.internal_id}`);
            }
        }
        
        // 3. Check for the correct target lifter (internal_id 59745)
        console.log('\n📋 Step 3: Checking for correct target lifter (internal_id 59745)...');
        
        const { data: correctLifter, error: correctError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id, membership_number')
            .eq('internal_id', 59745);
            
        if (correctError) {
            throw new Error(`Error querying correct lifter: ${correctError.message}`);
        }
        
        if (correctLifter.length === 0) {
            console.log('❌ No lifter found with internal_id 59745');
            console.log('   This lifter may need to be created during re-import');
        } else {
            const lifter = correctLifter[0];
            console.log(`📊 Correct target lifter (internal_id 59745):`);
            console.log(`   Lifter ID: ${lifter.lifter_id}`);
            console.log(`   Name: ${lifter.athlete_name}`);
            console.log(`   Internal ID: ${lifter.internal_id}`);
            console.log(`   Membership: ${lifter.membership_number || 'null'}`);
        }
        
        // 4. Generate deletion command for manual execution
        console.log('\n📋 Step 4: Deletion Command for Manual Execution');
        console.log('===============================================');
        
        if (incorrectResult.length > 0) {
            const result = incorrectResult[0];
            console.log('\n🎯 SQL COMMAND TO DELETE INCORRECT RESULT:');
            console.log(`DELETE FROM usaw_meet_results WHERE result_id = ${result.result_id};`);
            console.log(`-- This deletes: Vanessa Rodriguez, BW=${result.body_weight_kg}kg, Total=${result.total_kg}kg, assigned to lifter_id ${result.lifter_id}`);
            
            console.log('\n📝 VERIFICATION QUERY (run after deletion):');
            console.log(`SELECT COUNT(*) FROM usaw_meet_results WHERE result_id = ${result.result_id};`);
            console.log('-- Should return 0 if deletion was successful');
            
            console.log('\n📊 SUMMARY:');
            console.log(`   ❌ INCORRECT: Result ID ${result.result_id} assigned to lifter_id ${result.lifter_id} (internal_id 28381)`);
            console.log(`   ✅ CORRECT: Should be assigned to lifter with internal_id 59745`);
            console.log(`   📋 ACTION: Delete result_id ${result.result_id}, then re-import to assign correctly`);
        }
        
    } catch (error) {
        console.error('\n❌ Identification failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the identification
if (require.main === module) {
    identifyIncorrectResult().catch(error => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { identifyIncorrectResult };