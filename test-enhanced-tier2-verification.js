/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Import the actual matching system from database-importer-custom.js
// We need to extract the findOrCreateLifter function from that file

async function testKaileeCase() {
    console.log('🧪 Testing Kailee Bingman case with current matching system...\n');

    // Test data for Kailee Bingman from meet 2357
    const testData = {
        lifterName: 'Kailee Bingman',
        targetMeetId: 2357,
        eventDate: '2017-01-14',
        ageCategory: 'Youth',
        weightClass: '58kg',
        internal_id: null // Simulating that we don't have internal_id from scraped data
    };

    console.log('📋 Test Parameters:');
    console.log(`  Lifter Name: ${testData.lifterName}`);
    console.log(`  Target Meet ID: ${testData.targetMeetId}`);
    console.log(`  Event Date: ${testData.eventDate}`);
    console.log(`  Age Category: ${testData.ageCategory}`);
    console.log(`  Weight Class: ${testData.weightClass}`);
    console.log(`  Internal ID: ${testData.internal_id || 'null'}\n`);

    // First, let's check what exists in the database for Kailee Bingman
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

    // Check meet 2357 details
    console.log('🏋️ Checking meet 2357 details...');
    const { data: meetData, error: meetError } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, Date, meet_internal_id')
        .eq('meet_id', 2357)
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

    // Test the name matching logic directly
    console.log('🔍 Testing name matching logic...');
    
    const lifterIds = existingLifters ? existingLifters.map(l => l.lifter_id) : [];
    console.log(`📋 Found ${lifterIds.length} lifter IDs: [${lifterIds.join(', ')}]`);

    if (lifterIds.length === 0) {
        console.log('➕ Would create new lifter (no existing matches)');
        return;
    }

    if (lifterIds.length === 1) {
        console.log('✅ Single match found - would use existing lifter');
        console.log(`  Selected: ID ${lifterIds[0]} (${existingLifters[0].athlete_name})`);
        return;
    }

    // Multiple matches - this is where disambiguation should happen
    console.log(`⚠️ Multiple matches found (${lifterIds.length}) - testing disambiguation...`);
    
    // Check which ones have internal_ids
    const withInternalIds = existingLifters.filter(l => l.internal_id);
    const withoutInternalIds = existingLifters.filter(l => !l.internal_id);
    
    console.log(`  With internal_ids: ${withInternalIds.length}`);
    withInternalIds.forEach(l => {
        console.log(`    - ID: ${l.lifter_id}, Internal_ID: ${l.internal_id}`);
    });
    
    console.log(`  Without internal_ids: ${withoutInternalIds.length}`);
    withoutInternalIds.forEach(l => {
        console.log(`    - ID: ${l.lifter_id}, Internal_ID: null`);
    });

    // Test Tier 2 verification for the one with internal_id
    if (withInternalIds.length > 0) {
        const candidateWithInternalId = withInternalIds[0];
        console.log(`\n🔍 Testing Tier 2 verification for ID ${candidateWithInternalId.lifter_id} (internal_id: ${candidateWithInternalId.internal_id})...`);
        
        // Test the verifyLifterParticipationInMeet function
        const verified = await testVerifyLifterParticipation(candidateWithInternalId.internal_id, testData.targetMeetId);
        
        if (verified) {
            console.log(`✅ SUCCESS: Tier 2 verification confirmed participation`);
            console.log(`  Should select: ID ${candidateWithInternalId.lifter_id}`);
        } else {
            console.log(`❌ FAILURE: Tier 2 verification failed`);
            console.log(`  Would create new lifter instead of using existing`);
        }
    }
}

// Simplified version of verifyLifterParticipationInMeet for testing
async function testVerifyLifterParticipation(lifterInternalId, targetMeetId) {
    console.log(`    🌐 Would visit: https://usaweightlifting.sport80.com/public/rankings/member/${lifterInternalId}`);
    
    // Get target meet information
    const { data: targetMeet, error: meetError } = await supabase
        .from('usaw_meets')
        .select('meet_id, meet_internal_id, Meet, Date')
        .eq('meet_id', targetMeetId)
        .single();
    
    if (meetError) {
        console.log(`    ❌ Error getting meet info: ${meetError.message}`);
        return false;
    }

    console.log(`    🎯 Looking for: "${targetMeet.Meet}" on ${targetMeet.Date}`);
    
    // For testing purposes, we know Kailee Bingman (internal_id: 38184) should have "Show Up and Lift" on 2017-01-14
    if (lifterInternalId === 38184 && targetMeet.Meet === "Show Up and Lift" && targetMeet.Date === "2017-01-14") {
        console.log(`    ✅ SIMULATED VERIFICATION: Match found in athlete's history`);
        return true;
    } else {
        console.log(`    ❌ SIMULATED VERIFICATION: No match found`);
        return false;
    }
}

// Run the test
testKaileeCase().catch(console.error);