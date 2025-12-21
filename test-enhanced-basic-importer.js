/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Import the enhanced basic importer
const { findOrCreateLifter } = require('./scripts/production/database-importer.js');

async function testEnhancedBasicImporter() {
    console.log('🧪 Testing Enhanced Basic Importer with Kailee Bingman case...\n');

    // Test data for Kailee Bingman from meet 2357
    const testData = {
        lifterName: 'Kailee Bingman',
        additionalData: {
            targetMeetId: 2357,
            eventDate: '2017-01-14',
            ageCategory: 'Youth',
            weightClass: '58kg',
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
    console.log('🔍 Checking existing database records for "Kailee Bingman"...');
    
    const { data: existingLifters, error } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .eq('athlete_name', 'Kailee Bingman');

    if (error) {
        console.log(`❌ Error querying database: ${error.message}`);
        return;
    }

    console.log(`📊 Found ${existingLifters.length} existing records:`);
    existingLifters.forEach(lifter => {
        console.log(`  - ID: ${lifter.lifter_id}, Name: "${lifter.athlete_name}", Internal_ID: ${lifter.internal_id || 'null'}`);
    });
    console.log();

    // Test the enhanced basic importer
    console.log('🚀 Testing enhanced basic importer...\n');

    try {
        const result = await findOrCreateLifter(testData.lifterName, testData.additionalData);

        console.log('\n✅ Enhanced basic importer result:');
        console.log(`  Lifter ID: ${result.lifter_id}`);
        console.log(`  Name: "${result.athlete_name}"`);
        console.log(`  Internal ID: ${result.internal_id || 'null'}`);

        // Check if this is the correct existing athlete (ID 17340)
        if (result.lifter_id === 17340) {
            console.log('🎉 SUCCESS: Correctly matched to existing athlete ID 17340!');
            console.log('   The enhanced basic importer is working correctly.');
        } else if (existingLifters.some(l => l.lifter_id === result.lifter_id)) {
            console.log(`⚠️ PARTIAL SUCCESS: Matched to existing athlete but not the expected one (ID ${result.lifter_id})`);
        } else {
            console.log(`❌ FAILURE: Created new athlete record (ID ${result.lifter_id}) instead of using existing`);
            console.log('   This indicates the enhanced matching is not working properly.');
        }

    } catch (error) {
        console.log(`❌ Error in enhanced basic importer: ${error.message}`);
        console.log(error.stack);
    }
}

// Run the test
testEnhancedBasicImporter().catch(console.error);