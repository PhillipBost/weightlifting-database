const { searchRankingsForAthlete } = require('./scripts/production/searchSport80ForLifter-enhanced');

/**
 * Test the targeted approach to extract Eli Smith's internal_id
 * This should solve the "one-way street" problem by only clicking on Eli Smith's row
 */

async function testTargetedEliSmithExtraction() {
    console.log('🎯 Testing targeted internal_id extraction for Eli Smith...');
    
    try {
        // Search parameters for the division where Eli Smith appears
        const searchParams = {
            division: 'CA-South',
            ageCategory: 'Senior', 
            weightClass: '109',
            gender: 'Male',
            startDate: new Date('2024-10-01'),
            endDate: new Date('2024-12-31')
        };

        const options = {
            headless: false, // Show browser for debugging
            verbose: true,   // Detailed logging
            timeout: 30000
        };

        console.log('🔍 Searching for Eli Smith with targeted approach...');
        console.log('📊 Search parameters:', searchParams);
        
        const internalId = await searchRankingsForAthlete('Eli Smith', searchParams, options);
        
        if (internalId) {
            console.log(`\n🎉 SUCCESS: Found Eli Smith's internal_id: ${internalId}`);
            console.log(`✅ Targeted approach successfully extracted internal_id without breaking other rows`);
            
            return {
                success: true,
                athleteName: 'Eli Smith',
                internalId: internalId,
                method: 'targeted_click'
            };
        } else {
            console.log(`\n❌ FAILURE: Could not find Eli Smith's internal_id`);
            console.log(`❓ Possible reasons:`);
            console.log(`   - Eli Smith not in the specified division/date range`);
            console.log(`   - Name spelling different than expected`);
            console.log(`   - Row not clickable for some reason`);
            
            return {
                success: false,
                athleteName: 'Eli Smith',
                internalId: null,
                method: 'targeted_click'
            };
        }
        
    } catch (error) {
        console.error('\n💥 Test failed with error:', error.message);
        return {
            success: false,
            athleteName: 'Eli Smith',
            internalId: null,
            error: error.message,
            method: 'targeted_click'
        };
    }
}

// Also test with a different athlete to verify the approach works generally
async function testTargetedApproachWithMultipleAthletes() {
    console.log('\n🔍 Testing targeted approach with multiple athletes...');
    
    const testAthletes = [
        'Eli Smith',
        'Harrison Lucas',  // Should be on page 2 or 3
        'Max Baron'        // Should be on page 2 or 3
    ];
    
    const searchParams = {
        division: 'CA-South',
        ageCategory: 'Senior',
        weightClass: '109', 
        gender: 'Male',
        startDate: new Date('2024-10-01'),
        endDate: new Date('2024-12-31')
    };

    const options = {
        headless: false,
        verbose: true,
        timeout: 30000
    };

    const results = [];
    
    for (const athleteName of testAthletes) {
        console.log(`\n🎯 Testing: ${athleteName}`);
        
        try {
            const internalId = await searchRankingsForAthlete(athleteName, searchParams, options);
            
            results.push({
                athleteName,
                internalId,
                success: !!internalId
            });
            
            if (internalId) {
                console.log(`✅ ${athleteName}: internal_id ${internalId}`);
            } else {
                console.log(`❌ ${athleteName}: not found`);
            }
            
        } catch (error) {
            console.error(`💥 ${athleteName}: error - ${error.message}`);
            results.push({
                athleteName,
                internalId: null,
                success: false,
                error: error.message
            });
        }
    }
    
    console.log('\n📊 SUMMARY:');
    results.forEach(result => {
        const status = result.success ? '✅' : '❌';
        console.log(`   ${status} ${result.athleteName}: ${result.internalId || 'not found'}`);
    });
    
    const successCount = results.filter(r => r.success).length;
    console.log(`\n🎯 Success rate: ${successCount}/${results.length} athletes found`);
    
    return results;
}

// Run the tests
if (require.main === module) {
    (async () => {
        try {
            // Test 1: Targeted Eli Smith extraction
            const eliResult = await testTargetedEliSmithExtraction();
            
            // Test 2: Multiple athletes to verify approach
            const multipleResults = await testTargetedApproachWithMultipleAthletes();
            
            console.log('\n🏁 ALL TESTS COMPLETED');
            console.log(`Eli Smith result: ${eliResult.success ? 'SUCCESS' : 'FAILED'}`);
            console.log(`Multiple athletes: ${multipleResults.filter(r => r.success).length}/${multipleResults.length} found`);
            
            process.exit(0);
        } catch (error) {
            console.error('\n💥 Test suite failed:', error);
            process.exit(1);
        }
    })();
}

module.exports = {
    testTargetedEliSmithExtraction,
    testTargetedApproachWithMultipleAthletes
};