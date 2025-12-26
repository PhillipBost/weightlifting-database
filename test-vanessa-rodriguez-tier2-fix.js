#!/usr/bin/env node

/**
 * Test Vanessa Rodriguez Tier 2 Verification Fix
 * 
 * Tests the fixed date matching logic for Tier 2 verification
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Import the fixed verification function
const { verifyLifterParticipationInMeet } = require('./scripts/production/database-importer-custom-extreme-fix');

async function testVanessaRodriguezTier2Fix() {
    console.log('🧪 Testing Vanessa Rodriguez Tier 2 Verification Fix');
    console.log('==================================================');
    
    try {
        // Test case: Vanessa Rodriguez (internal_id: 59745) in meet 7142
        const lifterInternalId = 59745;
        const targetMeetId = 7142;
        
        console.log('\n📋 Test Case: Vanessa Rodriguez Tier 2 Verification');
        console.log(`Lifter Internal ID: ${lifterInternalId}`);
        console.log(`Target Meet ID: ${targetMeetId}`);
        
        console.log('\nExpected behavior:');
        console.log('- Database date: 2025-12-07');
        console.log('- Sport80 date: 2025-12-06');
        console.log('- Difference: 1 day (within ±5 day tolerance)');
        console.log('- Should VERIFY successfully');
        
        console.log('\n🔍 Running Tier 2 verification...');
        
        const result = await verifyLifterParticipationInMeet(lifterInternalId, targetMeetId);
        
        console.log('\n✅ Result:');
        console.log(`Verification result: ${result ? 'VERIFIED ✅' : 'NOT VERIFIED ❌'}`);
        
        if (result) {
            console.log('\n🎉 SUCCESS: Tier 2 verification fix is working!');
            console.log('   The ±5 day date tolerance correctly matched the meet');
            console.log('   despite the 1-day difference between database and Sport80');
        } else {
            console.log('\n❌ FAILURE: Tier 2 verification still not working');
            console.log('   The date matching logic may need further investigation');
        }
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testVanessaRodriguezTier2Fix().catch(error => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { testVanessaRodriguezTier2Fix };