/* eslint-disable no-console */
/**
 * Validation Test Script for Additional Known Athletes
 * 
 * This script tests the enhanced matching logic with multiple athletes who have internal_ids
 * to verify the fix works consistently across different cases and edge cases.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { findOrCreateLifterEnhanced } = require('../scripts/production/findOrCreateLifter-enhanced');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

/**
 * Find athletes with internal_ids for testing
 */
async function findTestCandidates() {
    console.log('\n=== FINDING TEST CANDIDATES ===');
    console.log('🔍 Searching for athletes with internal_ids for testing...');
    
    try {
        // Find athletes with internal_ids (excluding Lindsey Powell since we already tested her)
        const { data: candidates, error } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id, membership_number')
            .not('internal_id', 'is', null)
            .neq('athlete_name', 'Lindsey Powell')
            .limit(10);

        if (error) {
            console.log(`❌ Error finding candidates: ${error.message}`);
            return [];
        }

        console.log(`📊 Found ${candidates?.length || 0} potential test candidates:`);
        if (candidates && candidates.length > 0) {
            candidates.forEach((candidate, index) => {
                console.log(`  ${index + 1}. ${candidate.athlete_name} (ID: ${candidate.lifter_id}, Internal_ID: ${candidate.internal_id})`);
            });
        }

        return candidates || [];

    } catch (error) {
        console.log(`❌ Unexpected error: ${error.message}`);
        return [];
    }
}

/**
 * Test matching logic for a single athlete
 */
async function testSingleAthlete(athlete, testIndex) {
    console.log(`\n=== TEST ${testIndex}: ${athlete.athlete_name} ===`);
    console.log(`👤 Athlete: ${athlete.athlete_name}`);
    console.log(`🎯 Internal_ID: ${athlete.internal_id}`);
    console.log(`🆔 Expected Lifter_ID: ${athlete.lifter_id}`);
    
    const testResult = {
        athlete_name: athlete.athlete_name,
        internal_id: athlete.internal_id,
        expected_lifter_id: athlete.lifter_id,
        matching_succeeded: false,
        correct_match: false,
        no_duplicates_created: false,
        strategy_used: null,
        error: null
    };

    try {
        // Test the enhanced matching logic
        const additionalData = {
            internal_id: athlete.internal_id,
            targetMeetId: 9999, // Dummy meet ID for testing
            eventDate: '2024-01-01',
            ageCategory: 'Senior',
            weightClass: '81'
        };

        const startTime = Date.now();
        const matchingResult = await findOrCreateLifterEnhanced(supabase, athlete.athlete_name, additionalData);
        const duration = Date.now() - startTime;

        if (matchingResult && matchingResult.result) {
            const matchedLifter = matchingResult.result;
            testResult.matching_succeeded = true;
            
            console.log(`✅ MATCHING SUCCESS (${duration}ms):`);
            console.log(`   Matched Lifter ID: ${matchedLifter.lifter_id}`);
            console.log(`   Matched Name: "${matchedLifter.athlete_name}"`);
            console.log(`   Matched Internal ID: ${matchedLifter.internal_id}`);
            
            // Extract strategy from logs if available
            if (matchingResult.log && matchingResult.log.steps) {
                const successStep = matchingResult.log.steps.find(step => step.step === 'success');
                if (successStep && successStep.strategy) {
                    testResult.strategy_used = successStep.strategy;
                    console.log(`   Strategy Used: ${successStep.strategy}`);
                }
            }
            
            // Verify this is the correct match
            if (matchedLifter.lifter_id === athlete.lifter_id) {
                testResult.correct_match = true;
                console.log(`✅ CORRECT MATCH: Returned expected lifter_id ${athlete.lifter_id}`);
            } else {
                console.log(`⚠️ INCORRECT MATCH: Expected ${athlete.lifter_id}, got ${matchedLifter.lifter_id}`);
            }
            
            // Check for duplicates
            const duplicateCheck = await checkForDuplicates(athlete);
            testResult.no_duplicates_created = duplicateCheck;
            
            if (duplicateCheck) {
                console.log(`✅ NO DUPLICATES: No duplicate records detected`);
            } else {
                console.log(`⚠️ POTENTIAL DUPLICATES: Multiple records detected`);
            }
            
        } else {
            console.log(`❌ MATCHING FAILED: No result returned`);
            testResult.error = 'No result returned from matching function';
        }

    } catch (error) {
        console.log(`❌ MATCHING ERROR: ${error.message}`);
        testResult.error = error.message;
    }

    return testResult;
}

/**
 * Check for duplicate records for an athlete
 */
async function checkForDuplicates(athlete) {
    try {
        // Count records by name
        const { data: nameRecords, error: nameError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('athlete_name', athlete.athlete_name);

        if (nameError) {
            console.log(`   ⚠️ Error checking name duplicates: ${nameError.message}`);
            return false;
        }

        // Count records by internal_id
        const { data: internalIdRecords, error: internalIdError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('internal_id', athlete.internal_id);

        if (internalIdError) {
            console.log(`   ⚠️ Error checking internal_id duplicates: ${internalIdError.message}`);
            return false;
        }

        const nameCount = nameRecords?.length || 0;
        const internalIdCount = internalIdRecords?.length || 0;

        console.log(`   📊 Records by name: ${nameCount}, by internal_id: ${internalIdCount}`);

        // For this test, we expect exactly 1 record by internal_id
        // Name duplicates are acceptable (different athletes with same name)
        return internalIdCount === 1;

    } catch (error) {
        console.log(`   ⚠️ Duplicate check error: ${error.message}`);
        return false;
    }
}

/**
 * Test edge cases
 */
async function testEdgeCases() {
    console.log('\n=== EDGE CASE TESTS ===');
    
    const edgeCases = [
        {
            name: 'Name Variation Test',
            description: 'Test with slight name variation',
            testName: 'John Smith',
            originalName: 'John Smith',
            internal_id: 99999, // Non-existent internal_id
            expectedBehavior: 'Should create new record or match by name'
        },
        {
            name: 'Missing Internal_ID Test',
            description: 'Test with null internal_id',
            testName: 'Test Athlete',
            originalName: 'Test Athlete',
            internal_id: null,
            expectedBehavior: 'Should use name-based matching'
        },
        {
            name: 'Empty Name Test',
            description: 'Test with empty name',
            testName: '',
            originalName: '',
            internal_id: 12345,
            expectedBehavior: 'Should throw error for invalid name'
        }
    ];

    const edgeResults = [];

    for (let i = 0; i < edgeCases.length; i++) {
        const testCase = edgeCases[i];
        console.log(`\n--- Edge Case ${i + 1}: ${testCase.name} ---`);
        console.log(`📝 Description: ${testCase.description}`);
        console.log(`🎯 Expected: ${testCase.expectedBehavior}`);

        const result = {
            name: testCase.name,
            success: false,
            error: null,
            behavior: null
        };

        try {
            if (testCase.testName === '') {
                // Test empty name - should throw error
                try {
                    await findOrCreateLifterEnhanced(supabase, testCase.testName, { internal_id: testCase.internal_id });
                    console.log(`❌ UNEXPECTED: Empty name should have thrown error`);
                    result.behavior = 'No error thrown for empty name';
                } catch (error) {
                    console.log(`✅ EXPECTED: Empty name threw error: ${error.message}`);
                    result.success = true;
                    result.behavior = 'Correctly rejected empty name';
                }
            } else {
                const matchingResult = await findOrCreateLifterEnhanced(supabase, testCase.testName, { 
                    internal_id: testCase.internal_id 
                });
                
                if (matchingResult && matchingResult.result) {
                    console.log(`✅ HANDLED: Created/matched lifter ID ${matchingResult.result.lifter_id}`);
                    result.success = true;
                    result.behavior = 'Successfully handled edge case';
                } else {
                    console.log(`❌ FAILED: No result returned`);
                    result.behavior = 'No result returned';
                }
            }
        } catch (error) {
            console.log(`⚠️ ERROR: ${error.message}`);
            result.error = error.message;
            result.behavior = 'Threw error';
        }

        edgeResults.push(result);
    }

    return edgeResults;
}

/**
 * Main validation function
 */
async function runAdditionalValidation() {
    console.log('🧪 VALIDATION TEST: Additional Known Athletes');
    console.log('============================================');
    
    const overallResults = {
        candidates_found: 0,
        tests_run: 0,
        tests_passed: 0,
        edge_cases_run: 0,
        edge_cases_passed: 0,
        overall_success: false
    };

    try {
        // Step 1: Find test candidates
        const candidates = await findTestCandidates();
        overallResults.candidates_found = candidates.length;

        if (candidates.length === 0) {
            console.log('⚠️ No test candidates found - skipping athlete tests');
        } else {
            // Step 2: Test each candidate (limit to 5 for reasonable test time)
            const testCandidates = candidates.slice(0, 5);
            console.log(`\n🧪 Testing ${testCandidates.length} athletes...`);

            const testResults = [];
            for (let i = 0; i < testCandidates.length; i++) {
                const result = await testSingleAthlete(testCandidates[i], i + 1);
                testResults.push(result);
                overallResults.tests_run++;
                
                if (result.matching_succeeded && result.correct_match && result.no_duplicates_created) {
                    overallResults.tests_passed++;
                }
            }

            // Summary of athlete tests
            console.log(`\n=== ATHLETE TEST SUMMARY ===`);
            testResults.forEach((result, index) => {
                const status = (result.matching_succeeded && result.correct_match && result.no_duplicates_created) ? '✅ PASS' : '❌ FAIL';
                console.log(`${index + 1}. ${result.athlete_name}: ${status}`);
                if (result.strategy_used) {
                    console.log(`   Strategy: ${result.strategy_used}`);
                }
                if (result.error) {
                    console.log(`   Error: ${result.error}`);
                }
            });
        }

        // Step 3: Test edge cases
        console.log(`\n🧪 Testing edge cases...`);
        const edgeResults = await testEdgeCases();
        overallResults.edge_cases_run = edgeResults.length;
        overallResults.edge_cases_passed = edgeResults.filter(r => r.success).length;

        // Summary of edge case tests
        console.log(`\n=== EDGE CASE SUMMARY ===`);
        edgeResults.forEach((result, index) => {
            const status = result.success ? '✅ PASS' : '❌ FAIL';
            console.log(`${index + 1}. ${result.name}: ${status}`);
            if (result.behavior) {
                console.log(`   Behavior: ${result.behavior}`);
            }
            if (result.error) {
                console.log(`   Error: ${result.error}`);
            }
        });

        // Overall assessment
        const athleteTestsSuccess = overallResults.tests_run === 0 || 
                                   (overallResults.tests_passed / overallResults.tests_run) >= 0.8; // 80% pass rate
        const edgeTestsSuccess = (overallResults.edge_cases_passed / overallResults.edge_cases_run) >= 0.8; // 80% pass rate
        
        overallResults.overall_success = athleteTestsSuccess && edgeTestsSuccess;

        // Final summary
        console.log('\n=== OVERALL VALIDATION SUMMARY ===');
        console.log(`📊 Test Candidates Found: ${overallResults.candidates_found}`);
        console.log(`📊 Athlete Tests: ${overallResults.tests_passed}/${overallResults.tests_run} passed`);
        console.log(`📊 Edge Case Tests: ${overallResults.edge_cases_passed}/${overallResults.edge_cases_run} passed`);
        console.log(`🎯 Overall Result: ${overallResults.overall_success ? '✅ SUCCESS' : '❌ FAILURE'}`);

        if (overallResults.overall_success) {
            console.log('\n🎉 VALIDATION COMPLETE: Enhanced matching logic works consistently across different athletes and edge cases!');
        } else {
            console.log('\n⚠️ VALIDATION INCOMPLETE: Some issues detected that need attention.');
        }

        return overallResults;

    } catch (error) {
        console.log(`❌ Validation failed with error: ${error.message}`);
        console.error(error);
        return overallResults;
    }
}

// Run the validation if this script is executed directly
if (require.main === module) {
    runAdditionalValidation()
        .then((results) => {
            console.log('\n🏁 Additional validation complete');
            process.exit(results.overall_success ? 0 : 1);
        })
        .catch((error) => {
            console.error('❌ Additional validation failed:', error);
            process.exit(1);
        });
}

module.exports = {
    runAdditionalValidation,
    findTestCandidates,
    testSingleAthlete,
    checkForDuplicates,
    testEdgeCases
};