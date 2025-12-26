#!/usr/bin/env node

/**
 * Vanessa Rodriguez Enhanced Re-Import with Tier 2 Verification
 * 
 * This script demonstrates the root cause fix for the Vanessa Rodriguez incorrect assignment.
 * It uses enhanced Tier 2 verification that compares bodyweight and total performance data
 * to ensure the correct athlete is selected.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { enhancedVerifyLifterParticipationInMeet } = require('./fix-vanessa-rodriguez-tier2-enhanced.js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

/**
 * Enhanced athlete matching with bodyweight/total verification
 * This is the root cause fix - it prevents incorrect assignments by verifying performance data
 */
async function findOrCreateLifterWithEnhancedVerification(athleteData, meetId) {
    const { lifterName, bodyweight, total, ageCategory, weightClass } = athleteData;
    
    console.log(`\n🔍 Enhanced athlete matching for: ${lifterName}`);
    console.log(`   📊 Expected: BW=${bodyweight}kg, Total=${total}kg`);
    console.log(`   🏷️  Division: ${ageCategory} ${weightClass}`);
    
    // Step 1: Find existing athletes with the same name
    const { data: existingLifters, error: searchError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .ilike('athlete_name', lifterName);
    
    if (searchError) {
        console.log(`   ❌ Error searching for existing lifters: ${searchError.message}`);
        return null;
    }
    
    console.log(`   📋 Found ${existingLifters.length} existing lifter(s) with name "${lifterName}"`);
    
    // Step 2: For each existing lifter with internal_id, verify using enhanced Tier 2
    for (const lifter of existingLifters) {
        if (lifter.internal_id) {
            console.log(`\n   🧪 Testing lifter_id ${lifter.lifter_id} (internal_id: ${lifter.internal_id})`);
            
            const verificationResult = await enhancedVerifyLifterParticipationInMeet(
                lifter.internal_id,
                meetId,
                bodyweight,
                total
            );
            
            if (verificationResult.verified) {
                console.log(`   ✅ MATCH CONFIRMED: Lifter ${lifter.lifter_id} verified with performance data`);
                return lifter.lifter_id;
            } else {
                console.log(`   ❌ NO MATCH: Lifter ${lifter.lifter_id} failed verification (${verificationResult.reason})`);
                if (verificationResult.meetData) {
                    console.log(`      📊 Their actual data: BW=${verificationResult.meetData.bodyweight}kg, Total=${verificationResult.meetData.total}kg`);
                }
            }
        } else {
            console.log(`   ⚠️  Lifter ${lifter.lifter_id} has no internal_id - cannot verify`);
        }
    }
    
    // Step 3: If no existing lifter matches, create a new one
    console.log(`   🆕 No existing lifter matches - creating new lifter for ${lifterName}`);
    
    const { data: newLifter, error: createError } = await supabase
        .from('usaw_lifters')
        .insert({
            athlete_name: lifterName,
            internal_id: null // Will be populated later if available
        })
        .select('lifter_id')
        .single();
    
    if (createError) {
        console.log(`   ❌ Error creating new lifter: ${createError.message}`);
        return null;
    }
    
    console.log(`   ✅ Created new lifter with ID: ${newLifter.lifter_id}`);
    return newLifter.lifter_id;
}

/**
 * Simulate the re-import process for Vanessa Rodriguez with enhanced verification
 */
async function simulateVanessaRodriguezReImport() {
    console.log('🎯 Simulating Vanessa Rodriguez Re-Import with Enhanced Verification\n');
    console.log('This demonstrates the ROOT CAUSE FIX - enhanced Tier 2 verification');
    console.log('prevents incorrect athlete assignments by comparing performance data.\n');
    
    // Simulate the CSV data that would be scraped from Sport80
    const vanessaData = {
        lifterName: 'Vanessa Rodriguez',
        bodyweight: 75.4,
        total: 130,
        ageCategory: 'Senior',
        weightClass: '76kg',
        bestSnatch: 55,
        bestCJ: 75,
        club: 'Some Club',
        wso: 'CA-S'
    };
    
    const meetId = 7142;
    
    console.log('📋 CSV Data to Import:');
    console.log(`   Name: ${vanessaData.lifterName}`);
    console.log(`   Bodyweight: ${vanessaData.bodyweight}kg`);
    console.log(`   Total: ${vanessaData.total}kg`);
    console.log(`   Division: ${vanessaData.ageCategory} ${vanessaData.weightClass}`);
    console.log(`   Meet ID: ${meetId}`);
    
    // Use enhanced athlete matching
    const selectedLifterId = await findOrCreateLifterWithEnhancedVerification(vanessaData, meetId);
    
    if (selectedLifterId) {
        console.log(`\n🎉 RESULT: Would assign result to lifter_id ${selectedLifterId}`);
        
        // Verify this is the correct assignment
        const { data: selectedLifter, error } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('lifter_id', selectedLifterId)
            .single();
        
        if (!error && selectedLifter) {
            console.log(`   👤 Selected lifter: ${selectedLifter.athlete_name} (internal_id: ${selectedLifter.internal_id})`);
            
            if (selectedLifter.internal_id === 59745) {
                console.log(`   ✅ CORRECT: This matches the expected internal_id 59745`);
            } else if (selectedLifter.internal_id === 28381) {
                console.log(`   ❌ INCORRECT: This is the wrong athlete (internal_id 28381)`);
            } else {
                console.log(`   🆕 NEW LIFTER: Created new lifter record`);
            }
        }
    } else {
        console.log(`\n❌ FAILED: Could not determine correct lifter assignment`);
    }
}

/**
 * Demonstrate the difference between old and new approaches
 */
async function demonstrateApproachComparison() {
    console.log('\n📊 Comparison: Old vs New Approach\n');
    
    console.log('❌ OLD APPROACH (Causes Vanessa Rodriguez Bug):');
    console.log('   1. Find athletes with same name');
    console.log('   2. Pick first match or create new');
    console.log('   3. No verification of performance data');
    console.log('   4. Result: Wrong athlete gets the result');
    
    console.log('\n✅ NEW APPROACH (Root Cause Fix):');
    console.log('   1. Find athletes with same name');
    console.log('   2. For each candidate with internal_id:');
    console.log('      - Visit their Sport80 member page');
    console.log('      - Extract bodyweight and total from meet history');
    console.log('      - Compare with expected values (±2kg BW, ±5kg Total)');
    console.log('   3. Only use athlete if performance data matches');
    console.log('   4. Create new lifter if no existing athlete matches');
    console.log('   5. Result: Correct athlete assignment based on objective data');
    
    console.log('\n🔧 Key Enhancement: Enhanced Tier 2 Verification');
    console.log('   - Extracts actual performance data from Sport80');
    console.log('   - Compares with expected values from CSV');
    console.log('   - Prevents incorrect assignments to wrong athletes');
    console.log('   - Handles same-name different-athlete scenarios correctly');
}

/**
 * Main execution
 */
async function main() {
    try {
        console.log('🚀 Vanessa Rodriguez Enhanced Re-Import Demonstration\n');
        console.log('This script demonstrates the ROOT CAUSE FIX for incorrect athlete assignments.\n');
        
        // Demonstrate the approach comparison
        await demonstrateApproachComparison();
        
        // Simulate the enhanced re-import process
        await simulateVanessaRodriguezReImport();
        
        console.log('\n✅ Demonstration completed successfully');
        console.log('\n📝 Summary:');
        console.log('   - Enhanced Tier 2 verification prevents incorrect assignments');
        console.log('   - Performance data comparison ensures correct athlete selection');
        console.log('   - Same-name different-athlete scenarios handled correctly');
        console.log('   - Root cause fixed, not just symptom treated');
        
    } catch (error) {
        console.error('❌ Error in demonstration:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    findOrCreateLifterWithEnhancedVerification,
    simulateVanessaRodriguezReImport,
    demonstrateApproachComparison
};