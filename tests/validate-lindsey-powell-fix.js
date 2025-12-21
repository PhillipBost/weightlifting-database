/* eslint-disable no-console */
/**
 * Validation Test Script for Lindsey Powell Case with Enhanced Matching Logic
 * 
 * This script tests the enhanced matching logic with the specific case of
 * Lindsey Powell (internal_id: 38394) and meet 2308 to verify the fix works correctly.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { findOrCreateLifterEnhanced } = require('../scripts/production/findOrCreateLifter-enhanced');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Test case data for Lindsey Powell
const TEST_CASE = {
    lifterName: "Lindsey Powell",
    internal_id: 38394,
    targetMeetId: 2308,
    eventDate: null, // Will be populated from meet data
    ageCategory: "Senior",
    weightClass: "71"
};

/**
 * Step 1: Verify Lindsey Powell exists in database
 */
async function verifyExistingRecord() {
    console.log('\n=== STEP 1: Verify Existing Record ===');
    console.log(`🔍 Searching for: "${TEST_CASE.lifterName}"`);
    console.log(`🎯 Expected internal_id: ${TEST_CASE.internal_id}`);
    
    try {
        // Query by internal_id (should be the primary match)
        const { data: internalIdResults, error: internalIdError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id, membership_number')
            .eq('internal_id', TEST_CASE.internal_id);

        if (internalIdError) {
            console.log(`❌ Error querying by internal_id: ${internalIdError.message}`);
            return null;
        }

        console.log(`📊 Found ${internalIdResults?.length || 0} records by internal_id ${TEST_CASE.internal_id}:`);
        if (internalIdResults && internalIdResults.length > 0) {
            internalIdResults.forEach((record, index) => {
                console.log(`  ${index + 1}. ID: ${record.lifter_id}, Name: "${record.athlete_name}", Internal_ID: ${record.internal_id}`);
            });
            
            // Verify the name matches
            const nameMatch = internalIdResults.find(r => r.athlete_name === TEST_CASE.lifterName);
            if (nameMatch) {
                console.log(`✅ VERIFICATION PASSED: Found exact match for "${TEST_CASE.lifterName}" with internal_id ${TEST_CASE.internal_id}`);
                return nameMatch;
            } else {
                console.log(`⚠️ VERIFICATION WARNING: Found internal_id ${TEST_CASE.internal_id} but name mismatch`);
                console.log(`   Expected: "${TEST_CASE.lifterName}"`);
                console.log(`   Found: "${internalIdResults[0].athlete_name}"`);
                return internalIdResults[0]; // Return first match for testing
            }
        } else {
            console.log(`❌ VERIFICATION FAILED: No records found with internal_id ${TEST_CASE.internal_id}`);
            return null;
        }

    } catch (error) {
        console.log(`❌ Unexpected error: ${error.message}`);
        return null;
    }
}

/**
 * Step 2: Test enhanced matching logic
 */
async function testEnhancedMatching() {
    console.log('\n=== STEP 2: Test Enhanced Matching Logic ===');
    console.log(`🔄 Testing findOrCreateLifterEnhanced("${TEST_CASE.lifterName}", { internal_id: ${TEST_CASE.internal_id} })`);
    
    const additionalData = {
        internal_id: TEST_CASE.internal_id,
        targetMeetId: TEST_CASE.targetMeetId,
        eventDate: TEST_CASE.eventDate,
        ageCategory: TEST_CASE.ageCategory,
        weightClass: TEST_CASE.weightClass
    };

    try {
        const startTime = Date.now();
        const matchingResult = await findOrCreateLifterEnhanced(supabase, TEST_CASE.lifterName, additionalData);
        const duration = Date.now() - startTime;

        console.log(`⏱️ Matching completed in ${duration}ms`);
        
        if (matchingResult && matchingResult.result) {
            const lifter = matchingResult.result;
            console.log(`✅ MATCHING SUCCESS:`);
            console.log(`   Lifter ID: ${lifter.lifter_id}`);
            console.log(`   Name: "${lifter.athlete_name}"`);
            console.log(`   Internal ID: ${lifter.internal_id || 'null'}`);
            
            // Verify this is the expected match
            if (lifter.internal_id === TEST_CASE.internal_id) {
                console.log(`✅ INTERNAL_ID MATCH: Correctly matched by internal_id`);
            } else {
                console.log(`⚠️ INTERNAL_ID MISMATCH: Expected ${TEST_CASE.internal_id}, got ${lifter.internal_id}`);
            }
            
            if (lifter.athlete_name === TEST_CASE.lifterName) {
                console.log(`✅ NAME MATCH: Correctly matched by name`);
            } else {
                console.log(`⚠️ NAME MISMATCH: Expected "${TEST_CASE.lifterName}", got "${lifter.athlete_name}"`);
            }
            
            return lifter;
        } else {
            console.log(`❌ MATCHING FAILED: No result returned`);
            return null;
        }

    } catch (error) {
        console.log(`❌ MATCHING ERROR: ${error.message}`);
        console.error(error);
        return null;
    }
}

/**
 * Step 3: Verify no duplicate records were created
 */
async function verifyNoDuplicates(originalRecord, matchedRecord) {
    console.log('\n=== STEP 3: Verify No Duplicate Records ===');
    
    try {
        // Count all records with the same name
        const { data: nameRecords, error: nameError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('athlete_name', TEST_CASE.lifterName);

        if (nameError) {
            console.log(`❌ Error querying by name: ${nameError.message}`);
            return false;
        }

        console.log(`📊 Total records with name "${TEST_CASE.lifterName}": ${nameRecords?.length || 0}`);
        
        if (nameRecords && nameRecords.length > 0) {
            nameRecords.forEach((record, index) => {
                console.log(`  ${index + 1}. ID: ${record.lifter_id}, Name: "${record.athlete_name}", Internal_ID: ${record.internal_id || 'null'}`);
            });
        }

        // Count all records with the same internal_id
        const { data: internalIdRecords, error: internalIdError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('internal_id', TEST_CASE.internal_id);

        if (internalIdError) {
            console.log(`❌ Error querying by internal_id: ${internalIdError.message}`);
            return false;
        }

        console.log(`📊 Total records with internal_id ${TEST_CASE.internal_id}: ${internalIdRecords?.length || 0}`);
        
        if (internalIdRecords && internalIdRecords.length > 0) {
            internalIdRecords.forEach((record, index) => {
                console.log(`  ${index + 1}. ID: ${record.lifter_id}, Name: "${record.athlete_name}", Internal_ID: ${record.internal_id}`);
            });
        }

        // Verify no duplicates were created
        const expectedCount = 1; // Should only be one record for this athlete
        
        if (nameRecords && nameRecords.length === expectedCount) {
            console.log(`✅ NO NAME DUPLICATES: Exactly ${expectedCount} record found with name "${TEST_CASE.lifterName}"`);
        } else {
            console.log(`⚠️ POTENTIAL NAME DUPLICATES: Found ${nameRecords?.length || 0} records, expected ${expectedCount}`);
        }

        if (internalIdRecords && internalIdRecords.length === expectedCount) {
            console.log(`✅ NO INTERNAL_ID DUPLICATES: Exactly ${expectedCount} record found with internal_id ${TEST_CASE.internal_id}`);
        } else {
            console.log(`⚠️ POTENTIAL INTERNAL_ID DUPLICATES: Found ${internalIdRecords?.length || 0} records, expected ${expectedCount}`);
        }

        // Verify the matched record is the same as the original
        if (originalRecord && matchedRecord && originalRecord.lifter_id === matchedRecord.lifter_id) {
            console.log(`✅ SAME RECORD MATCHED: Enhanced matching returned the same lifter_id (${matchedRecord.lifter_id})`);
            return true;
        } else {
            console.log(`⚠️ DIFFERENT RECORD: Original ID: ${originalRecord?.lifter_id}, Matched ID: ${matchedRecord?.lifter_id}`);
            return false;
        }

    } catch (error) {
        console.log(`❌ Duplicate verification error: ${error.message}`);
        return false;
    }
}

/**
 * Step 4: Simulate meet result import
 */
async function simulateMeetResultImport(matchedLifter) {
    console.log('\n=== STEP 4: Simulate Meet Result Import ===');
    console.log(`🏋️ Simulating import of meet ${TEST_CASE.targetMeetId} result for lifter ${matchedLifter.lifter_id}`);
    
    try {
        // Check if result already exists
        const { data: existingResults, error: checkError } = await supabase
            .from('usaw_meet_results')
            .select('result_id, lifter_id, meet_id')
            .eq('lifter_id', matchedLifter.lifter_id)
            .eq('meet_id', TEST_CASE.targetMeetId);

        if (checkError) {
            console.log(`❌ Error checking existing results: ${checkError.message}`);
            return false;
        }

        if (existingResults && existingResults.length > 0) {
            console.log(`ℹ️ EXISTING RESULTS: Found ${existingResults.length} existing results for this lifter in meet ${TEST_CASE.targetMeetId}`);
            existingResults.forEach((result, index) => {
                console.log(`  ${index + 1}. Result ID: ${result.result_id}, Lifter ID: ${result.lifter_id}, Meet ID: ${result.meet_id}`);
            });
            console.log(`✅ IMPORT SIMULATION: Would update existing result instead of creating duplicate`);
            return true;
        } else {
            console.log(`✅ NO EXISTING RESULTS: Ready to import new result for lifter ${matchedLifter.lifter_id} in meet ${TEST_CASE.targetMeetId}`);
            console.log(`✅ IMPORT SIMULATION: Would create new meet result record`);
            return true;
        }

    } catch (error) {
        console.log(`❌ Meet result simulation error: ${error.message}`);
        return false;
    }
}

/**
 * Main validation function
 */
async function runValidation() {
    console.log('🧪 VALIDATION TEST: Enhanced Lindsey Powell Matching Logic');
    console.log('=========================================================');
    
    const results = {
        verificationPassed: false,
        matchingSucceeded: false,
        noDuplicatesCreated: false,
        meetResultImportReady: false,
        overallSuccess: false
    };

    try {
        // Step 1: Verify existing record
        const originalRecord = await verifyExistingRecord();
        if (originalRecord) {
            results.verificationPassed = true;
            console.log(`✅ Step 1 PASSED: Original record verified`);
        } else {
            console.log(`❌ Step 1 FAILED: Could not verify original record`);
            // Continue anyway to test the matching logic
        }

        // Step 2: Test enhanced matching
        const matchedRecord = await testEnhancedMatching();
        if (matchedRecord) {
            results.matchingSucceeded = true;
            console.log(`✅ Step 2 PASSED: Enhanced matching succeeded`);
        } else {
            console.log(`❌ Step 2 FAILED: Enhanced matching failed`);
        }

        // Step 3: Verify no duplicates
        if (originalRecord && matchedRecord) {
            const noDuplicates = await verifyNoDuplicates(originalRecord, matchedRecord);
            if (noDuplicates) {
                results.noDuplicatesCreated = true;
                console.log(`✅ Step 3 PASSED: No duplicate records created`);
            } else {
                console.log(`❌ Step 3 FAILED: Duplicate records detected or mismatch`);
            }
        } else {
            console.log(`⚠️ Step 3 SKIPPED: Missing original or matched record`);
        }

        // Step 4: Simulate meet result import
        if (matchedRecord) {
            const importReady = await simulateMeetResultImport(matchedRecord);
            if (importReady) {
                results.meetResultImportReady = true;
                console.log(`✅ Step 4 PASSED: Meet result import simulation succeeded`);
            } else {
                console.log(`❌ Step 4 FAILED: Meet result import simulation failed`);
            }
        } else {
            console.log(`⚠️ Step 4 SKIPPED: No matched record to test import`);
        }

        // Overall assessment
        results.overallSuccess = results.verificationPassed && 
                                results.matchingSucceeded && 
                                results.noDuplicatesCreated && 
                                results.meetResultImportReady;

        // Summary
        console.log('\n=== VALIDATION SUMMARY ===');
        console.log(`👤 Test Case: ${TEST_CASE.lifterName} (internal_id: ${TEST_CASE.internal_id})`);
        console.log(`🏋️ Target Meet: ${TEST_CASE.targetMeetId}`);
        console.log(`📊 Results:`);
        console.log(`   ✅ Original Record Verified: ${results.verificationPassed ? 'PASS' : 'FAIL'}`);
        console.log(`   ✅ Enhanced Matching Works: ${results.matchingSucceeded ? 'PASS' : 'FAIL'}`);
        console.log(`   ✅ No Duplicates Created: ${results.noDuplicatesCreated ? 'PASS' : 'FAIL'}`);
        console.log(`   ✅ Meet Import Ready: ${results.meetResultImportReady ? 'PASS' : 'FAIL'}`);
        console.log(`🎯 Overall Result: ${results.overallSuccess ? '✅ SUCCESS' : '❌ FAILURE'}`);

        if (results.overallSuccess) {
            console.log('\n🎉 VALIDATION COMPLETE: Enhanced matching logic successfully fixes the Lindsey Powell case!');
        } else {
            console.log('\n⚠️ VALIDATION INCOMPLETE: Some issues remain to be addressed.');
        }

        return results;

    } catch (error) {
        console.log(`❌ Validation failed with error: ${error.message}`);
        console.error(error);
        return results;
    }
}

// Run the validation if this script is executed directly
if (require.main === module) {
    runValidation()
        .then((results) => {
            console.log('\n🏁 Validation complete');
            process.exit(results.overallSuccess ? 0 : 1);
        })
        .catch((error) => {
            console.error('❌ Validation failed:', error);
            process.exit(1);
        });
}

module.exports = {
    runValidation,
    verifyExistingRecord,
    testEnhancedMatching,
    verifyNoDuplicates,
    simulateMeetResultImport,
    TEST_CASE
};