#!/usr/bin/env node

/**
 * Test Internal ID Preservation Fix
 * 
 * Tests that when Tier 1.5 extracts an internal_id but fails to disambiguate,
 * the internal_id is properly preserved for fallback lifter creation.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Import the fixed importer
const { findOrCreateLifter } = require('./scripts/production/database-importer-custom-extreme-fix');

async function testInternalIdPreservation() {
    console.log('🧪 Testing Internal ID Preservation Fix');
    console.log('=====================================');
    
    try {
        // Test case: Felix Burch scenario where Tier 1.5 extracts internal_id 
        // but fails to disambiguate due to multiple existing lifters
        
        console.log('\n📋 Test Case: Felix Burch Internal ID Preservation');
        console.log('Expected: Tier 1.5 extracts internal_id 68151, fails to disambiguate,');
        console.log('          but preserves internal_id for new lifter creation');
        
        // Check current Felix Burch lifters before test
        const { data: existingLifters, error: queryError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('athlete_name', 'Felix Burch')
            .order('lifter_id', { ascending: false });
            
        if (queryError) {
            throw new Error(`Query error: ${queryError.message}`);
        }
        
        console.log(`\n📊 Current Felix Burch lifters: ${existingLifters.length}`);
        existingLifters.forEach(lifter => {
            console.log(`  - ID ${lifter.lifter_id}: internal_id = ${lifter.internal_id || 'null'}`);
        });
        
        // Simulate the scenario that caused the bug
        const additionalData = {
            targetMeetId: 7142, // 2025 UMWF World Championships
            eventDate: '2025-09-05',
            ageCategory: 'Open Men\'s', // Fixed: correct format with apostrophe
            weightClass: '94kg',
            bodyweight: '93.5'
            // Note: No internal_id provided initially - will be extracted by Tier 1.5
        };
        
        console.log('\n🔍 Calling findOrCreateLifter with Felix Burch...');
        console.log('Expected flow:');
        console.log('1. Multiple existing lifters found');
        console.log('2. Tier 1 verification runs and extracts internal_id 68151');
        console.log('3. Tier 1 fails to disambiguate (multiple candidates)');
        console.log('4. Tier 2 verification runs but finds no matches');
        console.log('5. NEW: internal_id 68151 should be preserved for new lifter');
        
        const result = await findOrCreateLifter('Felix Burch', additionalData);
        
        console.log('\n✅ Result:');
        console.log(`  - Lifter ID: ${result.lifter_id}`);
        console.log(`  - Athlete Name: ${result.athlete_name}`);
        console.log(`  - Internal ID: ${result.internal_id || 'null'}`);
        
        // Verify the fix worked
        if (result.internal_id === 68151) {
            console.log('\n🎉 SUCCESS: Internal ID preservation fix is working!');
            console.log('   The extracted internal_id 68151 was properly preserved');
            console.log('   and assigned to the new lifter record.');
        } else if (result.internal_id) {
            console.log(`\n⚠️  PARTIAL SUCCESS: New lifter has internal_id ${result.internal_id}`);
            console.log('   But it may not be the expected 68151 from Tier 1.5 extraction');
        } else {
            console.log('\n❌ FAILURE: New lifter created without internal_id');
            console.log('   The internal_id preservation fix did not work as expected');
        }
        
        // Check if this is a new lifter (higher ID than existing ones)
        const maxExistingId = Math.max(...existingLifters.map(l => l.lifter_id));
        if (result.lifter_id > maxExistingId) {
            console.log(`\n📝 Confirmed: This is a new lifter (ID ${result.lifter_id} > ${maxExistingId})`);
        } else {
            console.log(`\n📝 Note: This matched an existing lifter (ID ${result.lifter_id})`);
        }
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testInternalIdPreservation().catch(error => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { testInternalIdPreservation };