/**
 * Test Tier 1 Fix for New Athletes
 * 
 * This test verifies that the fix allows Tier 1 verification to run for new athletes
 * who don't exist in the database, extracting their internal_id and metadata.
 */

require('dotenv').config();
const { findOrCreateLifter } = require('./scripts/production/database-importer-custom-extreme-fix');

async function testTier1FixForNewAthletes() {
    console.log('🧪 Testing Tier 1 Fix for New Athletes\n');

    // Test case: A new athlete with valid division data that should trigger Tier 1
    const testCase = {
        name: 'Test New Athlete Tier1 Fix',
        targetMeetId: 7145, // Recent meet
        eventDate: '2025-12-13',
        ageCategory: 'Open Men\'s',
        weightClass: '110+kg',
        bodyweight: '122.5',
        total: '188'
    };

    console.log(`=== Testing New Athlete: ${testCase.name} ===`);
    console.log(`Meet ID: ${testCase.targetMeetId}`);
    console.log(`Date: ${testCase.eventDate}`);
    console.log(`Division: ${testCase.ageCategory} ${testCase.weightClass}`);
    console.log(`Expected BW: ${testCase.bodyweight}kg`);
    console.log(`Expected Total: ${testCase.total}kg`);
    console.log('\n🔍 Looking for Tier 1 verification logs...\n');

    try {
        const result = await findOrCreateLifter(testCase.name, {
            targetMeetId: testCase.targetMeetId,
            eventDate: testCase.eventDate,
            ageCategory: testCase.ageCategory,
            weightClass: testCase.weightClass,
            bodyweight: testCase.bodyweight,
            total: testCase.total,
            membership_number: null,
            internal_id: null
        });

        console.log('\n📊 Result:');
        console.log(`  Lifter ID: ${result.lifter_id}`);
        console.log(`  Name: ${result.athlete_name}`);
        console.log(`  Internal ID: ${result.internal_id || 'Not extracted'}`);
        console.log(`  Has Scraped Data: ${result.scrapedData ? 'Yes' : 'No'}`);

        if (result.scrapedData) {
            console.log('\n🏋️  Scraped Data from Tier 1:');
            console.log(`  Club: ${result.scrapedData.club || 'N/A'}`);
            console.log(`  WSO: ${result.scrapedData.wso || 'N/A'}`);
            console.log(`  Age: ${result.scrapedData.lifterAge || 'N/A'}`);
            console.log(`  National Rank: ${result.scrapedData.nationalRank || 'N/A'}`);
            console.log(`  Internal ID: ${result.scrapedData.internalId || 'N/A'}`);
        }

        // Check if Tier 1 was executed (should see in logs above)
        console.log('\n✅ Test completed');
        console.log('📝 Check logs above for:');
        console.log('   - "attempting Tier 1 verification for: [name]"');
        console.log('   - "Tier 1: Base64 URL Lookup Protocol"');
        console.log('   - Base64 URL generation and scraping');

        if (result.internal_id) {
            console.log('\n🎉 SUCCESS: Internal ID was extracted via Tier 1!');
        } else {
            console.log('\n⚠️  No internal_id extracted - check if athlete exists in division rankings');
        }

    } catch (error) {
        console.log('\n❌ TEST ERROR:', error.message);
    }
}

// Run the test
if (require.main === module) {
    testTier1FixForNewAthletes()
        .then(() => {
            console.log('\n🎉 Tier 1 fix test completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testTier1FixForNewAthletes };