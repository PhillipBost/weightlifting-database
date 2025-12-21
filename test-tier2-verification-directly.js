const { verifyLifterParticipationInMeet } = require('./scripts/production/database-importer-custom.js');

async function testTier2VerificationDirectly() {
    console.log('🔍 Testing Tier 2 verification directly for Kailee Bingman...');
    
    try {
        const lifterInternalId = 38184; // Kailee's internal_id
        const targetMeetId = 2357; // Meet internal_id
        
        console.log(`Testing: lifterInternalId=${lifterInternalId}, targetMeetId=${targetMeetId}`);
        
        const result = await verifyLifterParticipationInMeet(lifterInternalId, targetMeetId);
        
        console.log('\\n🔍 DIRECT TEST RESULT:');
        if (result) {
            console.log('✅ Verification PASSED - Meet found in athlete history');
            console.log('❌ BUG CONFIRMED: Function works correctly but failed during actual import');
        } else {
            console.log('❌ Verification FAILED - Meet not found in athlete history');
            console.log('❓ Need to investigate Sport80 member page content');
        }
        
    } catch (error) {
        console.error('💥 Direct test failed:', error.message);
    }
}

testTier2VerificationDirectly();