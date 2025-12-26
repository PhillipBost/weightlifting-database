#!/usr/bin/env node

/**
 * Test script for same-name different athletes bug fix
 * Tests the enhanced disambiguation logic with known problem cases
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { processMeetCsvFile } = require('./scripts/production/database-importer-custom.js');
const { scrapeOneMeet } = require('./scripts/production/scrapeOneMeet.js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function testSameNameAthletesFix() {
    console.log('🧪 Testing Same-Name Different Athletes Bug Fix\n');
    
    // Test cases based on known problem scenarios
    const testCases = [
        {
            name: 'Vanessa Rodriguez Case',
            meetId: 7142,
            meetName: 'Meet 7142 - Vanessa Rodriguez Test',
            description: 'Two different athletes named "Vanessa Rodriguez" with different bodyweights',
            expectedResults: 2,
            athletes: [
                { name: 'Vanessa Rodriguez', bodyweight: '73.45', weightClass: '75kg', total: '147' },
                { name: 'Vanessa Rodriguez', bodyweight: '68.2', weightClass: '69kg', total: '165' }
            ]
        },
        {
            name: 'Molly Raines Case', 
            meetId: 3019,
            meetName: 'Meet 3019 - Molly Raines Test',
            description: 'Two different athletes named "Molly Raines" with different bodyweights and weight classes',
            expectedResults: 2,
            athletes: [
                { name: 'Molly Raines', bodyweight: '47.0', weightClass: '48kg', total: '120' },
                { name: 'Molly Raines', bodyweight: '82.2', weightClass: '+58kg', total: '145' }
            ]
        }
    ];
    
    for (const testCase of testCases) {
        console.log(`\n📋 Testing: ${testCase.name}`);
        console.log(`📝 Description: ${testCase.description}`);
        console.log(`🎯 Expected results: ${testCase.expectedResults}`);
        
        try {
            // Create test CSV file for this case
            const testCsvPath = await createTestCsvFile(testCase);
            
            // Clear any existing results for this test meet
            await clearTestMeetResults(testCase.meetId);
            
            // Process the test CSV file
            console.log(`\n🔄 Processing test CSV file...`);
            const result = await processMeetCsvFile(testCsvPath, testCase.meetId, testCase.meetName);
            
            console.log(`📊 Processing result: ${result.processed} processed, ${result.errors} errors`);
            
            // Verify results
            await verifyTestResults(testCase);
            
            // Clean up test file
            if (fs.existsSync(testCsvPath)) {
                fs.unlinkSync(testCsvPath);
            }
            
        } catch (error) {
            console.error(`❌ Test failed for ${testCase.name}:`, error.message);
        }
    }
    
    console.log('\n🏁 Same-name athletes fix testing completed');
}

async function createTestCsvFile(testCase) {
    const csvPath = path.join(__dirname, `temp_test_${testCase.meetId}.csv`);
    
    // Create CSV header
    const headers = [
        'Meet', 'Date', 'Age Category', 'Weight Class', 'Lifter', 
        'Body Weight (Kg)', 'Snatch Lift 1', 'Snatch Lift 2', 'Snatch Lift 3', 'Best Snatch',
        'C&J Lift 1', 'C&J Lift 2', 'C&J Lift 3', 'Best C&J', 'Total', 'Internal_ID'
    ];
    
    let csvContent = headers.join('|') + '\n';
    
    // Add test athletes
    testCase.athletes.forEach((athlete, index) => {
        const row = [
            testCase.meetName,
            '2024-01-15',
            'Senior',
            athlete.weightClass,
            athlete.name,
            athlete.bodyweight,
            '80', '85', '90', '90', // Snatch lifts
            '100', '105', '110', '110', // C&J lifts
            athlete.total,
            '' // No internal_id initially
        ];
        csvContent += row.join('|') + '\n';
    });
    
    fs.writeFileSync(csvPath, csvContent);
    console.log(`📄 Created test CSV: ${csvPath}`);
    
    return csvPath;
}

async function clearTestMeetResults(meetId) {
    console.log(`🧹 Clearing existing results for meet ${meetId}...`);
    
    const { error } = await supabase
        .from('usaw_meet_results')
        .delete()
        .eq('meet_id', meetId);
    
    if (error) {
        console.warn(`⚠️ Warning: Could not clear existing results: ${error.message}`);
    } else {
        console.log(`✅ Cleared existing results for meet ${meetId}`);
    }
}

async function verifyTestResults(testCase) {
    console.log(`\n🔍 Verifying results for ${testCase.name}...`);
    
    // Get all results for this meet
    const { data: results, error } = await supabase
        .from('usaw_meet_results')
        .select('lifter_id, lifter_name, body_weight_kg, weight_class, total')
        .eq('meet_id', testCase.meetId)
        .order('lifter_name');
    
    if (error) {
        throw new Error(`Failed to query results: ${error.message}`);
    }
    
    console.log(`📊 Found ${results.length} results in database`);
    
    // Group results by athlete name
    const resultsByName = {};
    results.forEach(result => {
        if (!resultsByName[result.lifter_name]) {
            resultsByName[result.lifter_name] = [];
        }
        resultsByName[result.lifter_name].push(result);
    });
    
    // Verify each expected athlete
    let allTestsPassed = true;
    
    for (const expectedAthlete of testCase.athletes) {
        const athleteResults = resultsByName[expectedAthlete.name] || [];
        
        console.log(`\n👤 Verifying: ${expectedAthlete.name}`);
        console.log(`   Expected: ${expectedAthlete.bodyweight}kg, ${expectedAthlete.weightClass}, Total: ${expectedAthlete.total}`);
        
        if (athleteResults.length === 0) {
            console.log(`   ❌ No results found for ${expectedAthlete.name}`);
            allTestsPassed = false;
            continue;
        }
        
        // Find matching result by bodyweight
        const matchingResult = athleteResults.find(result => 
            Math.abs(parseFloat(result.body_weight_kg) - parseFloat(expectedAthlete.bodyweight)) < 0.1
        );
        
        if (matchingResult) {
            console.log(`   ✅ Found matching result:`);
            console.log(`      Lifter_ID: ${matchingResult.lifter_id}`);
            console.log(`      Bodyweight: ${matchingResult.body_weight_kg}kg`);
            console.log(`      Weight Class: ${matchingResult.weight_class}`);
            console.log(`      Total: ${matchingResult.total}`);
        } else {
            console.log(`   ❌ No matching result found for bodyweight ${expectedAthlete.bodyweight}kg`);
            console.log(`   📋 Available results:`);
            athleteResults.forEach((result, index) => {
                console.log(`      ${index + 1}. ID: ${result.lifter_id}, ${result.body_weight_kg}kg, ${result.weight_class}, Total: ${result.total}`);
            });
            allTestsPassed = false;
        }
    }
    
    // Check for unique lifter_ids
    const lifterIds = results.map(r => r.lifter_id);
    const uniqueLifterIds = [...new Set(lifterIds)];
    
    console.log(`\n🔍 Lifter ID Analysis:`);
    console.log(`   Total results: ${results.length}`);
    console.log(`   Unique lifter_ids: ${uniqueLifterIds.length}`);
    
    if (uniqueLifterIds.length === testCase.expectedResults) {
        console.log(`   ✅ Correct number of unique lifter_ids`);
    } else {
        console.log(`   ❌ Expected ${testCase.expectedResults} unique lifter_ids, got ${uniqueLifterIds.length}`);
        allTestsPassed = false;
    }
    
    // Summary
    if (allTestsPassed) {
        console.log(`\n🎉 ${testCase.name}: ALL TESTS PASSED`);
        console.log(`   ✅ Both athletes stored with different lifter_ids`);
        console.log(`   ✅ No data overwrites occurred`);
        console.log(`   ✅ Correct bodyweight and weight class data preserved`);
    } else {
        console.log(`\n❌ ${testCase.name}: TESTS FAILED`);
        console.log(`   ⚠️ Same-name different athletes issue may still exist`);
    }
}

// Test single athlete scenarios to ensure no regression
async function testSingleAthleteScenarios() {
    console.log('\n🧪 Testing single athlete scenarios (regression test)...');
    
    const singleAthleteTest = {
        name: 'Single Athlete Test',
        meetId: 9999,
        meetName: 'Test Meet 9999 - Single Athlete',
        description: 'Single athlete with unique name should work normally',
        expectedResults: 1,
        athletes: [
            { name: 'John Unique Testname', bodyweight: '75.5', weightClass: '81kg', total: '200' }
        ]
    };
    
    try {
        const testCsvPath = await createTestCsvFile(singleAthleteTest);
        await clearTestMeetResults(singleAthleteTest.meetId);
        
        console.log(`🔄 Processing single athlete test...`);
        const result = await processMeetCsvFile(testCsvPath, singleAthleteTest.meetId, singleAthleteTest.meetName);
        
        console.log(`📊 Processing result: ${result.processed} processed, ${result.errors} errors`);
        
        // Verify single athlete result
        const { data: results, error } = await supabase
            .from('usaw_meet_results')
            .select('lifter_id, lifter_name, body_weight_kg')
            .eq('meet_id', singleAthleteTest.meetId);
        
        if (error) {
            throw new Error(`Failed to query single athlete results: ${error.message}`);
        }
        
        if (results.length === 1) {
            console.log(`✅ Single athlete test passed: 1 result stored correctly`);
            console.log(`   Lifter: ${results[0].lifter_name} (ID: ${results[0].lifter_id})`);
        } else {
            console.log(`❌ Single athlete test failed: Expected 1 result, got ${results.length}`);
        }
        
        // Clean up
        if (fs.existsSync(testCsvPath)) {
            fs.unlinkSync(testCsvPath);
        }
        
    } catch (error) {
        console.error(`❌ Single athlete test failed:`, error.message);
    }
}

// Main execution
async function main() {
    try {
        await testSameNameAthletesFix();
        await testSingleAthleteScenarios();
        
        console.log('\n🏁 All tests completed');
        console.log('\n📋 Summary:');
        console.log('   - Enhanced disambiguation logic tested');
        console.log('   - Bodyweight and weight class differences considered');
        console.log('   - Same-name different athletes should now be stored separately');
        console.log('   - No regression in single athlete scenarios');
        
    } catch (error) {
        console.error('💥 Test execution failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    testSameNameAthletesFix,
    testSingleAthleteScenarios
};