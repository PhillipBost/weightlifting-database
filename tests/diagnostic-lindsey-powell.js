/* eslint-disable no-console */
/**
 * Diagnostic Test Script for Lindsey Powell Case
 * 
 * This script tests the current matching logic with the specific case of
 * Lindsey Powell (internal_id: 38394) and meet 2308 to identify where
 * the matching process fails.
 * 
 * Requirements: 4.1, 4.2
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

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
    ageCategory: null,
    weightClass: null
};

/**
 * Step 1: Query database for Lindsey Powell's existing record
 */
async function queryExistingRecord() {
    console.log('\n=== STEP 1: Query Existing Record ===');
    console.log(`🔍 Searching for: "${TEST_CASE.lifterName}"`);
    console.log(`🎯 Expected internal_id: ${TEST_CASE.internal_id}`);
    
    try {
        // Query by name
        const { data: nameResults, error: nameError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id, membership_number')
            .eq('athlete_name', TEST_CASE.lifterName);

        if (nameError) {
            console.log(`❌ Error querying by name: ${nameError.message}`);
            return null;
        }

        console.log(`📊 Found ${nameResults?.length || 0} records by name:`);
        if (nameResults && nameResults.length > 0) {
            nameResults.forEach((record, index) => {
                console.log(`  ${index + 1}. ID: ${record.lifter_id}, Name: "${record.athlete_name}", Internal_ID: ${record.internal_id || 'null'}`);
            });
        }

        // Query by internal_id
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
        }

        return {
            nameResults: nameResults || [],
            internalIdResults: internalIdResults || []
        };

    } catch (error) {
        console.log(`❌ Unexpected error: ${error.message}`);
        return null;
    }
}

/**
 * Step 2: Query meet 2308 data
 */
async function queryMeetData() {
    console.log('\n=== STEP 2: Query Meet Data ===');
    console.log(`🏋️ Searching for meet ID: ${TEST_CASE.targetMeetId}`);
    
    try {
        const { data: meetData, error: meetError } = await supabase
            .from('meets')
            .select('meet_id, meet_name, meet_date, location')
            .eq('meet_id', TEST_CASE.targetMeetId)
            .single();

        if (meetError) {
            console.log(`❌ Error querying meet: ${meetError.message}`);
            return null;
        }

        if (meetData) {
            console.log(`📅 Meet found: "${meetData.meet_name}"`);
            console.log(`📍 Date: ${meetData.meet_date}`);
            console.log(`📍 Location: ${meetData.location || 'Not specified'}`);
            
            // Update test case with meet date
            TEST_CASE.eventDate = meetData.meet_date;
            return meetData;
        } else {
            console.log(`❌ Meet ${TEST_CASE.targetMeetId} not found`);
            return null;
        }

    } catch (error) {
        console.log(`❌ Unexpected error: ${error.message}`);
        return null;
    }
}

/**
 * Step 3: Check existing meet results for Lindsey Powell
 */
async function queryExistingMeetResults() {
    console.log('\n=== STEP 3: Query Existing Meet Results ===');
    
    try {
        const { data: results, error } = await supabase
            .from('meet_results')
            .select(`
                result_id,
                lifter_id,
                meet_id,
                age_category,
                weight_class,
                usaw_lifters!inner(athlete_name, internal_id)
            `)
            .eq('meet_id', TEST_CASE.targetMeetId)
            .eq('usaw_lifters.athlete_name', TEST_CASE.lifterName);

        if (error) {
            console.log(`❌ Error querying meet results: ${error.message}`);
            return null;
        }

        console.log(`📊 Found ${results?.length || 0} existing results for "${TEST_CASE.lifterName}" in meet ${TEST_CASE.targetMeetId}:`);
        if (results && results.length > 0) {
            results.forEach((result, index) => {
                console.log(`  ${index + 1}. Result ID: ${result.result_id}, Lifter ID: ${result.lifter_id}`);
                console.log(`     Age Category: ${result.age_category}, Weight Class: ${result.weight_class}`);
                console.log(`     Athlete: ${result.usaw_lifters.athlete_name}, Internal_ID: ${result.usaw_lifters.internal_id}`);
            });
        }

        return results || [];

    } catch (error) {
        console.log(`❌ Unexpected error: ${error.message}`);
        return null;
    }
}

/**
 * Step 4: Simulate the current matching logic step by step
 */
async function simulateMatchingLogic(existingRecords) {
    console.log('\n=== STEP 4: Simulate Current Matching Logic ===');
    console.log(`🔄 Simulating findOrCreateLifter("${TEST_CASE.lifterName}", { internal_id: ${TEST_CASE.internal_id} })`);
    
    const additionalData = {
        internal_id: TEST_CASE.internal_id,
        targetMeetId: TEST_CASE.targetMeetId,
        eventDate: TEST_CASE.eventDate,
        ageCategory: TEST_CASE.ageCategory,
        weightClass: TEST_CASE.weightClass
    };

    // Step 4.1: Priority 1 - Internal_ID matching
    console.log('\n--- Priority 1: Internal_ID Matching ---');
    if (additionalData.internal_id) {
        console.log(`🎯 Checking internal_id: ${additionalData.internal_id}`);
        
        const { data: internalIdLifters, error: internalIdError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('internal_id', additionalData.internal_id);

        if (internalIdError) {
            console.log(`⚠️ Error checking internal_id: ${internalIdError.message}`);
        } else if (internalIdLifters && internalIdLifters.length > 1) {
            console.log(`❌ DUPLICATE DETECTION: Found ${internalIdLifters.length} lifters with internal_id ${additionalData.internal_id}`);
            console.log(`📋 Duplicate lifters: ${internalIdLifters.map(l => `${l.athlete_name} (ID: ${l.lifter_id})`).join(', ')}`);
            
            const nameMatch = internalIdLifters.find(l => l.athlete_name === TEST_CASE.lifterName);
            if (nameMatch) {
                console.log(`✅ MATCH FOUND: Using name-matching duplicate: ${TEST_CASE.lifterName} (ID: ${nameMatch.lifter_id})`);
                return { success: true, lifter: nameMatch, strategy: 'internal_id_with_name_disambiguation' };
            } else {
                console.log(`⚠️ No name match among duplicates - would continue with name-based matching`);
            }
        } else if (internalIdLifters && internalIdLifters.length === 1) {
            const existingLifter = internalIdLifters[0];
            
            if (existingLifter.athlete_name === TEST_CASE.lifterName) {
                console.log(`✅ MATCH FOUND: Exact match by internal_id: ${TEST_CASE.lifterName} (ID: ${existingLifter.lifter_id})`);
                return { success: true, lifter: existingLifter, strategy: 'internal_id_exact_match' };
            } else {
                console.log(`⚠️ Internal_id conflict: ID ${additionalData.internal_id} exists for "${existingLifter.athlete_name}" but current name is "${TEST_CASE.lifterName}"`);
                console.log(`⚠️ Would continue with name-based matching as fallback`);
            }
        } else {
            console.log(`❌ No lifters found with internal_id ${additionalData.internal_id}`);
        }
    } else {
        console.log(`⚠️ No internal_id provided - skipping internal_id matching`);
    }

    // Step 4.2: Name-based matching
    console.log('\n--- Step 2: Name-based Matching ---');
    const { data: existingLifters, error: findError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .eq('athlete_name', TEST_CASE.lifterName);

    if (findError) {
        console.log(`❌ Error finding lifter by name: ${findError.message}`);
        return { success: false, error: findError.message };
    }

    const lifterIds = existingLifters ? existingLifters.map(l => l.lifter_id) : [];
    console.log(`📊 Found ${lifterIds.length} existing lifters with name "${TEST_CASE.lifterName}"`);

    if (lifterIds.length === 0) {
        console.log(`➕ Would create new lifter: ${TEST_CASE.lifterName}`);
        return { success: true, lifter: null, strategy: 'create_new' };
    }

    if (lifterIds.length === 1) {
        const existingLifter = existingLifters[0];
        console.log(`✅ MATCH FOUND: Single existing lifter: ${TEST_CASE.lifterName} (ID: ${existingLifter.lifter_id})`);
        
        // Check for internal_id enrichment opportunity
        if (additionalData.internal_id && !existingLifter.internal_id) {
            console.log(`🔄 Would enrich lifter ${TEST_CASE.lifterName} with internal_id: ${additionalData.internal_id}`);
        } else if (additionalData.internal_id && existingLifter.internal_id && existingLifter.internal_id !== additionalData.internal_id) {
            console.log(`⚠️ Internal_id mismatch: existing=${existingLifter.internal_id}, new=${additionalData.internal_id}`);
        }
        
        return { success: true, lifter: existingLifter, strategy: 'single_name_match' };
    }

    // Multiple matches - would need disambiguation
    console.log(`⚠️ Found ${lifterIds.length} existing lifters - would need disambiguation via two-tier verification`);
    
    // Check if internal_id can disambiguate
    if (additionalData.internal_id) {
        const internalIdMatch = existingLifters.find(l => l.internal_id === additionalData.internal_id);
        if (internalIdMatch) {
            console.log(`✅ MATCH FOUND: Disambiguated via internal_id: ${TEST_CASE.lifterName} (ID: ${internalIdMatch.lifter_id})`);
            return { success: true, lifter: internalIdMatch, strategy: 'internal_id_disambiguation' };
        }
    }

    console.log(`⚠️ Would proceed to two-tier verification for disambiguation`);
    return { success: false, lifter: null, strategy: 'needs_disambiguation' };
}

/**
 * Main diagnostic function
 */
async function runDiagnostic() {
    console.log('🔬 DIAGNOSTIC TEST: Lindsey Powell Matching Logic');
    console.log('================================================');
    
    try {
        // Step 1: Query existing records
        const existingRecords = await queryExistingRecord();
        if (!existingRecords) {
            console.log('❌ Failed to query existing records - aborting diagnostic');
            return;
        }

        // Step 2: Query meet data
        const meetData = await queryMeetData();
        if (!meetData) {
            console.log('❌ Failed to query meet data - continuing with limited info');
        }

        // Step 3: Check existing meet results
        const existingResults = await queryExistingMeetResults();

        // Step 4: Simulate matching logic
        const matchingResult = await simulateMatchingLogic(existingRecords);

        // Summary
        console.log('\n=== DIAGNOSTIC SUMMARY ===');
        console.log(`👤 Test Case: ${TEST_CASE.lifterName} (internal_id: ${TEST_CASE.internal_id})`);
        console.log(`🏋️ Target Meet: ${TEST_CASE.targetMeetId}`);
        console.log(`📊 Name-based records found: ${existingRecords.nameResults.length}`);
        console.log(`📊 Internal_id-based records found: ${existingRecords.internalIdResults.length}`);
        console.log(`📊 Existing meet results: ${existingResults?.length || 0}`);
        
        if (matchingResult.success) {
            console.log(`✅ Matching Result: SUCCESS`);
            console.log(`🎯 Strategy: ${matchingResult.strategy}`);
            if (matchingResult.lifter) {
                console.log(`👤 Matched Lifter: ${matchingResult.lifter.athlete_name} (ID: ${matchingResult.lifter.lifter_id})`);
            } else {
                console.log(`➕ Action: Would create new lifter`);
            }
        } else {
            console.log(`❌ Matching Result: FAILED`);
            console.log(`🎯 Strategy: ${matchingResult.strategy}`);
            if (matchingResult.error) {
                console.log(`❌ Error: ${matchingResult.error}`);
            }
        }

        // Identify potential issues
        console.log('\n=== POTENTIAL ISSUES IDENTIFIED ===');
        
        if (existingRecords.nameResults.length === 0 && existingRecords.internalIdResults.length === 0) {
            console.log('❌ ISSUE: No existing records found - athlete may not exist in database');
        }
        
        if (existingRecords.nameResults.length > 0 && existingRecords.internalIdResults.length === 0) {
            console.log('⚠️ ISSUE: Athlete exists by name but not by internal_id - possible missing internal_id');
        }
        
        if (existingRecords.nameResults.length === 0 && existingRecords.internalIdResults.length > 0) {
            console.log('⚠️ ISSUE: Athlete exists by internal_id but not by name - possible name mismatch');
        }
        
        if (existingRecords.nameResults.length > 1) {
            console.log('⚠️ ISSUE: Multiple athletes with same name - disambiguation required');
        }
        
        if (existingRecords.internalIdResults.length > 1) {
            console.log('❌ ISSUE: Multiple athletes with same internal_id - data integrity problem');
        }
        
        if (existingResults && existingResults.length > 0) {
            console.log('ℹ️ INFO: Athlete already has results in target meet - possible duplicate import attempt');
        }

    } catch (error) {
        console.log(`❌ Diagnostic failed with error: ${error.message}`);
        console.error(error);
    }
}

// Run the diagnostic if this script is executed directly
if (require.main === module) {
    runDiagnostic()
        .then(() => {
            console.log('\n🏁 Diagnostic complete');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Diagnostic failed:', error);
            process.exit(1);
        });
}

module.exports = {
    runDiagnostic,
    queryExistingRecord,
    queryMeetData,
    queryExistingMeetResults,
    simulateMatchingLogic,
    TEST_CASE
};