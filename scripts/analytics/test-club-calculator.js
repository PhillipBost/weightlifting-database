#!/usr/bin/env node

/**
 * Test script for club analytics calculator
 * 
 * Tests the club analytics functions with a sample club
 * to ensure the implementation works correctly.
 */

const calculator = require('./club-weekly-calculator');

async function testClubCalculator() {
    console.log('🧪 Testing Club Analytics Calculator');
    console.log('====================================\n');

    // Test with a sample club name - we'll use the first club from the database
    try {
        const { createClient } = require('@supabase/supabase-js');
        require('dotenv').config();

        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

        // Get a sample club that likely has data
        console.log('🔍 Finding a club with recent activity...');
        const { data: sampleClubs, error } = await supabase
            .from('usaw_meet_results')
            .select('club_name')
            .not('club_name', 'is', null)
            .gte('date', '2022-01-01')  // Recent data
            .limit(5);

        if (error || !sampleClubs || sampleClubs.length === 0) {
            console.log('❌ Could not find sample clubs for testing');
            return;
        }

        // Get the first unique club name
        const uniqueClubs = [...new Set(sampleClubs.map(c => c.club_name))];
        const testClubName = uniqueClubs[0];

        console.log(`✅ Testing with club: "${testClubName}"\n`);

        // Test recent meets calculation
        console.log('1️⃣ Testing recent meets count...');
        const recentMeets = await calculator.calculateClubRecentMeets(testClubName);
        console.log(`   Result: ${recentMeets} recent meets\n`);

        // Test active lifters calculation
        console.log('2️⃣ Testing active lifters count...');
        const activeLifters = await calculator.calculateClubActiveLifters(testClubName);
        console.log(`   Result: ${activeLifters} active lifters\n`);

        // Test full metrics calculation
        console.log('3️⃣ Testing full metrics calculation...');
        const result = await calculator.calculateClubMetrics(testClubName);

        if (result.success) {
            console.log('✅ Full metrics calculation succeeded');
            console.log(`   Recent meets: ${result.metrics.recentMeetsCount}`);
            console.log(`   Active lifters: ${result.metrics.activeLiftersCount}`);
        } else {
            console.log('❌ Full metrics calculation failed:', result.error);
        }

        console.log('\n🔍 Verifying database update...');

        // Check if the club was updated in the database
        const { data: updatedClub, error: fetchError } = await supabase
            .from('usaw_clubs')
            .select('club_name, recent_meets_count, active_lifters_count, analytics_updated_at')
            .eq('club_name', testClubName)
            .single();

        if (fetchError) {
            console.log(`⚠️ Could not verify database update: ${fetchError.message}`);
        } else if (updatedClub) {
            console.log('✅ Database verification:');
            console.log(`   Club: "${updatedClub.club_name}"`);
            console.log(`   Recent meets: ${updatedClub.recent_meets_count}`);
            console.log(`   Active lifters: ${updatedClub.active_lifters_count}`);
            console.log(`   Last updated: ${updatedClub.analytics_updated_at}`);
        } else {
            console.log('⚠️ Club not found in clubs table - may need to be imported first');
        }

        console.log('\n🎉 Club analytics calculator test completed!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run the test if this script is executed directly
if (require.main === module) {
    testClubCalculator();
}