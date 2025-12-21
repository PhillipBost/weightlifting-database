const { findOrCreateLifterEnhanced } = require('./scripts/production/database-importer-custom.js');

async function testCompleteKaileeMatching() {
    console.log('🔍 Testing complete enhanced matching for Kailee Bingman...');
    
    try {
        // Simulate the exact scenario from the import
        const lifterName = "Kailee Bingman";
        const additionalData = {
            targetMeetId: 2357,
            // Add other data that would be available during import
            gender: 'F',
            ageCategory: 'Open Women',
            weightClass: '69 kg'
        };
        
        console.log(`Testing enhanced matching for: "${lifterName}"`);
        console.log(`Target meet: ${additionalData.targetMeetId}`);
        
        const result = await findOrCreateLifterEnhanced(lifterName, additionalData);
        
        console.log('\\n🔍 COMPLETE MATCHING TEST RESULT:');
        if (result) {
            console.log(`✅ SUCCESS: Matched to lifter_id ${result.lifter_id}`);
            console.log(`   Name: ${result.athlete_name}`);
            
            // Check if this is the correct existing athlete (ID 17340)
            if (result.lifter_id === 17340) {
                console.log(`🎉 PERFECT: Correctly matched to existing athlete (ID 17340)`);
                console.log(`🔧 BUG FIXED: Enhanced matching now works correctly`);
            } else if (result.lifter_id === 200587) {
                console.log(`❌ STILL BROKEN: Matched to fallback record (ID 200587)`);
                console.log(`🔧 NEEDS MORE WORK: Enhanced matching still has issues`);
            } else {
                console.log(`❓ UNEXPECTED: Matched to different athlete (ID ${result.lifter_id})`);
            }
        } else {
            console.log(`❌ FAILED: No match found, would create new record`);
        }
        
    } catch (error) {
        console.error('💥 Complete matching test failed:', error.message);
    }
}

testCompleteKaileeMatching();