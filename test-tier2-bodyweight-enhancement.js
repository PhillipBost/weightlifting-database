/**
 * Test Enhanced Tier 2 Verification with Bodyweight/Total Matching
 * 
 * This test verifies that the enhanced verifyLifterParticipationInMeet function
 * correctly handles the new return format and parameter passing.
 */

require('dotenv').config();
const { verifyLifterParticipationInMeet } = require('./scripts/production/database-importer-custom-extreme-fix');

async function testEnhancedTier2() {
    console.log('🧪 Testing Enhanced Tier 2 Verification Function\n');

    // Test case: Basic functionality test with safe meet ID
    const testCase = {
        name: 'Enhanced Function Test',
        internal_id: 59745, // Known athlete
        meet_id: 2357, // Safe meet ID for testing
        expected_bodyweight: null, // No specific expectations for this test
        expected_total: null
    };

    console.log(`=== ${testCase.name} ===`);
    console.log(`Internal ID: ${testCase.internal_id}`);
    console.log(`Meet ID: ${testCase.meet_id}`);
    console.log(`Expected BW: ${testCase.expected_bodyweight || 'none'}`);
    console.log(`Expected Total: ${testCase.expected_total || 'none'}`);

    try {
        const result = await verifyLifterParticipationInMeet(
            testCase.internal_id,
            testCase.meet_id,
            testCase.expected_bodyweight,
            testCase.expected_total
        );

        console.log('\n📊 Verification Result:');
        console.log(`  Type: ${typeof result}`);
        
        if (typeof result === 'object' && result !== null) {
            console.log(`  Verified: ${result.verified}`);
            console.log(`  Meet Found: ${result.meetFound}`);
            console.log(`  Performance Match: ${result.performanceMatch}`);
            console.log(`  Reason: ${result.reason || 'success'}`);

            if (result.performanceDetails) {
                const details = result.performanceDetails;
                console.log('\n🏋️  Performance Details Available:');
                console.log(`  Sport80 Bodyweight: ${details.sport80Bodyweight}`);
                console.log(`  Sport80 Total: ${details.sport80Total}`);
                console.log(`  Bodyweight Match: ${details.bodyweightMatch}`);
                console.log(`  Total Match: ${details.totalMatch}`);
            }

            console.log('\n✅ ENHANCED FUNCTION WORKING - Returns object with detailed results');
        } else if (typeof result === 'boolean') {
            console.log(`  Boolean Result: ${result}`);
            console.log('\n⚠️  OLD FORMAT - Function still returns boolean instead of object');
        } else {
            console.log(`  Unexpected Result Type: ${typeof result}`);
            console.log(`  Value: ${result}`);
            console.log('\n❌ UNEXPECTED RESULT FORMAT');
        }

    } catch (error) {
        console.log('\n❌ TEST ERROR:', error.message);
        console.log('Stack:', error.stack);
    }

    console.log('\n' + '='.repeat(60));
}

// Run the test
if (require.main === module) {
    testEnhancedTier2()
        .then(() => {
            console.log('\n🎉 Enhanced Tier 2 function test completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testEnhancedTier2 };