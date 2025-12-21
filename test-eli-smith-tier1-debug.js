/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Import the enhanced matching system
const { findOrCreateLifter } = require('./scripts/production/database-importer-custom.js');

async function testEliSmithTier1Debug() {
    console.log('🧪 Testing Eli Smith Tier 1 Disambiguation Debug...\n');

    // Test data for Eli Smith from meet 2359 (based on the log you provided)
    const testData = {
        lifterName: 'Eli Smith',
        additionalData: {
            targetMeetId: 2359,
            eventDate: '2017-01-14', // From the log: "Date Range: 2017-01-08 to 2017-01-18"
            ageCategory: 'Open Men\'s', // From the log: "Division: Open Men's 69 kg"
            weightClass: '69 kg',
            membership_number: null,
            internal_id: null // Simulating that we don't have internal_id from scraped data
        }
    };

    console.log('📋 Test Parameters:');
    console.log(`  Lifter Name: ${testData.lifterName}`);
    console.log(`  Target Meet ID: ${testData.additionalData.targetMeetId}`);
    console.log(`  Event Date: ${testData.additionalData.eventDate}`);
    console.log(`  Age Category: ${testData.additionalData.ageCategory}`);
    console.log(`  Weight Class: ${testData.additionalData.weightClass}\n`);

    // Check existing records first
    console.log('🔍 Checking existing database records for "Eli Smith"...');
    
    const { data: existingLifters, error } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .eq('athlete_name', 'Eli Smith');

    if (error) {
        console.log(`❌ Error querying database: ${error.message}`);
        return;
    }

    console.log(`📊 Found ${existingLifters.length} existing records:`);
    existingLifters.forEach(lifter => {
        console.log(`  - ID: ${lifter.lifter_id}, Name: "${lifter.athlete_name}", Internal_ID: ${lifter.internal_id || 'null'}`);
    });
    console.log();

    // Check meet 2359 details
    console.log('🏋️ Checking meet 2359 details...');
    const { data: meetData, error: meetError } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, Date, meet_internal_id')
        .eq('meet_id', 2359)
        .single();

    if (meetError) {
        console.log(`❌ Error getting meet data: ${meetError.message}`);
        return;
    }

    console.log(`📅 Meet Details:`);
    console.log(`  Meet ID: ${meetData.meet_id}`);
    console.log(`  Meet Name: "${meetData.Meet}"`);
    console.log(`  Date: ${meetData.Date}`);
    console.log(`  Internal ID: ${meetData.meet_internal_id || 'null'}\n`);

    // Test the enhanced matching system with debugging
    console.log('🚀 Testing enhanced matching system with Tier 1 debugging...\n');

    try {
        const result = await findOrCreateLifter(testData.lifterName, testData.additionalData);

        console.log('\n✅ Enhanced matching result:');
        console.log(`  Lifter ID: ${result.lifter_id}`);
        console.log(`  Name: "${result.athlete_name}"`);
        console.log(`  Internal ID: ${result.internal_id || 'null'}`);

        // Based on your log, the expected result should be ID 14590 with internal_id 41494
        if (result.lifter_id === 14590) {
            console.log('🎉 SUCCESS: Correctly matched to expected athlete ID 14590!');
            
            // Check if Tier 1 was used (should have been based on your analysis)
            if (result.internal_id === 41494) {
                console.log('✅ TIER 1 SUCCESS: Should have been disambiguated via Tier 1 with internal_id 41494');
            } else {
                console.log('⚠️ TIER 1 ISSUE: Result is correct but internal_id doesn\'t match expected 41494');
            }
        } else if (existingLifters.some(l => l.lifter_id === result.lifter_id)) {
            console.log(`⚠️ PARTIAL SUCCESS: Matched to existing athlete but not the expected one (ID ${result.lifter_id})`);
        } else {
            console.log(`❌ FAILURE: Created new athlete record (ID ${result.lifter_id}) instead of using existing`);
        }

    } catch (error) {
        console.log(`❌ Error in enhanced matching: ${error.message}`);
        console.log(error.stack);
    }
}

// Run the test
testEliSmithTier1Debug().catch(console.error);