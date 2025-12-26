#!/usr/bin/env node

/**
 * Investigate Vanessa Rodriguez Issue in Meet 7142
 * 
 * Analyzes the Vanessa Rodriguez results in meet 7142 to identify
 * which result was attributed to the wrong athlete and needs to be removed.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function investigateVanessaRodriguez() {
    console.log('🔍 Investigating Vanessa Rodriguez Issue in Meet 7142');
    console.log('====================================================');
    
    try {
        // 1. Find all Vanessa Rodriguez results in meet 7142
        console.log('\n📋 Step 1: Finding Vanessa Rodriguez results in meet 7142...');
        
        const { data: meetResults, error: meetError } = await supabase
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
                gender
            `)
            .eq('meet_id', 7142)
            .eq('lifter_name', 'Vanessa Rodriguez')
            .order('result_id');
            
        if (meetError) {
            throw new Error(`Error querying meet results: ${meetError.message}`);
        }
        
        console.log(`📊 Found ${meetResults.length} Vanessa Rodriguez result(s) in meet 7142:`);
        meetResults.forEach((result, index) => {
            console.log(`\n  ${index + 1}. Result ID: ${result.result_id}`);
            console.log(`     Lifter ID: ${result.lifter_id}`);
            console.log(`     Body Weight: ${result.body_weight_kg}kg`);
            console.log(`     Total: ${result.total_kg}kg`);
            console.log(`     Division: ${result.age_category} ${result.weight_class}`);
            console.log(`     Club: ${result.club_name || 'Unknown'}`);
            console.log(`     WSO: ${result.wso || 'Unknown'}`);
            console.log(`     Age: ${result.competition_age || 'Unknown'}`);
            console.log(`     Gender: ${result.gender || 'Unknown'}`);
        });
        
        // 2. Get lifter details for each result
        console.log('\n📋 Step 2: Getting lifter details for each result...');
        
        const lifterIds = [...new Set(meetResults.map(r => r.lifter_id))];
        
        const { data: lifters, error: lifterError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id, membership_number')
            .in('lifter_id', lifterIds);
            
        if (lifterError) {
            throw new Error(`Error querying lifters: ${lifterError.message}`);
        }
        
        console.log(`\n📊 Lifter details:`);
        lifters.forEach(lifter => {
            console.log(`\n  Lifter ID ${lifter.lifter_id}:`);
            console.log(`    Name: ${lifter.athlete_name}`);
            console.log(`    Internal ID: ${lifter.internal_id || 'null'}`);
            console.log(`    Membership: ${lifter.membership_number || 'null'}`);
        });
        
        // 3. Check for other Vanessa Rodriguez results in other meets
        console.log('\n📋 Step 3: Checking other Vanessa Rodriguez results...');
        
        const { data: otherResults, error: otherError } = await supabase
            .from('usaw_meet_results')
            .select(`
                result_id,
                meet_id,
                lifter_id,
                lifter_name,
                body_weight_kg,
                total_kg,
                age_category,
                weight_class,
                date
            `)
            .eq('lifter_name', 'Vanessa Rodriguez')
            .neq('meet_id', 7142)
            .order('date', { ascending: false })
            .limit(10);
            
        if (otherError) {
            throw new Error(`Error querying other results: ${otherError.message}`);
        }
        
        console.log(`\n📊 Recent Vanessa Rodriguez results in other meets:`);
        otherResults.forEach(result => {
            console.log(`\n  Meet ${result.meet_id} (${result.date}):`);
            console.log(`    Result ID: ${result.result_id}`);
            console.log(`    Lifter ID: ${result.lifter_id}`);
            console.log(`    Body Weight: ${result.body_weight_kg}kg`);
            console.log(`    Total: ${result.total_kg}kg`);
            console.log(`    Division: ${result.age_category} ${result.weight_class}`);
        });
        
        // 4. Analysis and recommendations
        console.log('\n📋 Step 4: Analysis and Recommendations');
        console.log('=====================================');
        
        if (meetResults.length === 0) {
            console.log('❌ No Vanessa Rodriguez results found in meet 7142');
            console.log('   This suggests the missing result hasn\'t been imported yet');
        } else if (meetResults.length === 1) {
            const result = meetResults[0];
            console.log('📝 Found 1 existing Vanessa Rodriguez result in meet 7142');
            console.log(`   Body Weight: ${result.body_weight_kg}kg, Total: ${result.total_kg}kg`);
            console.log('   The missing result (BW: 73.45kg, Total: 147kg) is different');
            console.log('   This confirms there are 2 different Vanessa Rodriguez athletes');
            
            // Check if the existing result matches the expected missing one
            if (result.body_weight_kg === 73.45 && result.total_kg === 147) {
                console.log('✅ The existing result matches the missing one - no action needed');
            } else {
                console.log('\n🎯 RECOMMENDATION:');
                console.log('   The existing result appears to be correctly attributed');
                console.log('   The missing result (BW: 73.45kg, Total: 147kg) needs a new lifter');
                console.log('   No deletion required - let the import create a new lifter');
            }
        } else {
            console.log(`⚠️  Found ${meetResults.length} Vanessa Rodriguez results in meet 7142`);
            console.log('   This suggests there may be duplicate or incorrect attributions');
            
            // Look for the result that matches the missing one
            const matchingResult = meetResults.find(r => 
                r.body_weight_kg === 73.45 && r.total_kg === 147
            );
            
            if (matchingResult) {
                console.log('\n✅ Found existing result that matches the missing one:');
                console.log(`   Result ID: ${matchingResult.result_id}`);
                console.log('   No deletion needed - this result already exists');
            } else {
                console.log('\n🎯 ANALYSIS NEEDED:');
                console.log('   None of the existing results match the missing one');
                console.log('   Review the results above to identify which one is incorrect');
            }
        }
        
        // 5. Generate SQL for deletion if needed
        if (meetResults.length > 0) {
            console.log('\n📋 Step 5: SQL Commands for Investigation/Deletion');
            console.log('================================================');
            
            console.log('\n-- Query to see all Vanessa Rodriguez results in meet 7142:');
            console.log(`SELECT result_id, lifter_id, lifter_name, body_weight_kg, total_kg, age_category, weight_class, club_name`);
            console.log(`FROM usaw_meet_results`);
            console.log(`WHERE meet_id = 7142 AND lifter_name = 'Vanessa Rodriguez'`);
            console.log(`ORDER BY result_id;`);
            
            console.log('\n-- If you need to delete a specific result, use:');
            meetResults.forEach(result => {
                console.log(`-- DELETE FROM usaw_meet_results WHERE result_id = ${result.result_id}; -- BW: ${result.body_weight_kg}kg, Total: ${result.total_kg}kg`);
            });
            
            console.log('\n-- Query to verify lifter details:');
            lifterIds.forEach(lifterId => {
                console.log(`-- SELECT * FROM usaw_lifters WHERE lifter_id = ${lifterId};`);
            });
        }
        
    } catch (error) {
        console.error('\n❌ Investigation failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the investigation
if (require.main === module) {
    investigateVanessaRodriguez().catch(error => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { investigateVanessaRodriguez };