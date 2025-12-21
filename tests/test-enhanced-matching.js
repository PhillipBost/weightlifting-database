/* eslint-disable no-console */
/**
 * Test script for enhanced findOrCreateLifter function
 * 
 * Tests the fixed internal_id matching logic with the Lindsey Powell case
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { findOrCreateLifterEnhanced } = require('../scripts/production/findOrCreateLifter-enhanced');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function testEnhancedMatching() {
    console.log('🧪 Testing Enhanced findOrCreateLifter Function');
    console.log('==============================================');
    
    try {
        // Test Case 1: Lindsey Powell with internal_id (should match existing)
        console.log('\n--- Test Case 1: Lindsey Powell with internal_id ---');
        const result1 = await findOrCreateLifterEnhanced(supabase, 'Lindsey Powell', {
            internal_id: 38394,
            targetMeetId: 2308
        });
        
        console.log('✅ Result 1:');
        console.log(`   Lifter ID: ${result1.result.lifter_id}`);
        console.log(`   Name: ${result1.result.athlete_name}`);
        console.log(`   Internal ID: ${result1.result.internal_id}`);
        console.log(`   Strategy: ${result1.log.steps.find(s => s.step === 'success')?.strategy || 'Unknown'}`);
        
        // Test Case 2: Lindsey Powell without internal_id (should find multiple and need disambiguation)
        console.log('\n--- Test Case 2: Lindsey Powell without internal_id ---');
        const result2 = await findOrCreateLifterEnhanced(supabase, 'Lindsey Powell', {
            targetMeetId: 2308
        });
        
        console.log('✅ Result 2:');
        console.log(`   Lifter ID: ${result2.result.lifter_id}`);
        console.log(`   Name: ${result2.result.athlete_name}`);
        console.log(`   Internal ID: ${result2.result.internal_id || 'null'}`);
        console.log(`   Strategy: ${result2.log.steps.find(s => s.step === 'success')?.strategy || 'Unknown'}`);
        
        // Test Case 3: Non-existent athlete (should create new)
        console.log('\n--- Test Case 3: Non-existent athlete ---');
        const result3 = await findOrCreateLifterEnhanced(supabase, 'Test Athlete XYZ123', {
            internal_id: 999999,
            targetMeetId: 2308
        });
        
        console.log('✅ Result 3:');
        console.log(`   Lifter ID: ${result3.result.lifter_id}`);
        console.log(`   Name: ${result3.result.athlete_name}`);
        console.log(`   Internal ID: ${result3.result.internal_id || 'null'}`);
        console.log(`   Strategy: ${result3.log.steps.find(s => s.step === 'success')?.strategy || 'Unknown'}`);
        
        // Clean up test record
        if (result3.result.athlete_name === 'Test Athlete XYZ123') {
            await supabase
                .from('usaw_lifters')
                .delete()
                .eq('lifter_id', result3.result.lifter_id);
            console.log('   🧹 Cleaned up test record');
        }
        
        console.log('\n🎉 All tests completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error);
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    testEnhancedMatching()
        .then(() => {
            console.log('\n🏁 Testing complete');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Testing failed:', error);
            process.exit(1);
        });
}

module.exports = {
    testEnhancedMatching
};