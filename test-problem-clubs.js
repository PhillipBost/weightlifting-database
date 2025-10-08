const { createClient } = require('@supabase/supabase-js');
const { assignWSOGeography, findStateByCoordinates, extractStateFromAddress } = require('./scripts/geographic/wso-assignment-engine');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function testProblemClubs() {
    const problemClubs = [
        'DEUCE Weightlifting',
        'Zion Barbell',
        'Nevada Barbell',
        'Big Pull Barbell'
    ];

    console.log('Testing problem clubs:\n');

    for (const clubName of problemClubs) {
        const { data } = await supabase
            .from('clubs')
            .select('*')
            .eq('club_name', clubName)
            .single();

        if (!data) {
            console.log(`❌ ${clubName} not found\n`);
            continue;
        }

        console.log(`🔍 ${clubName}`);
        console.log(`   Address: ${data.address}`);
        console.log(`   Coordinates: ${data.latitude}, ${data.longitude}`);
        console.log(`   Current WSO: ${data.wso_geography}`);

        // Test what coordinates say
        if (data.latitude && data.longitude) {
            const coordState = findStateByCoordinates(
                parseFloat(data.latitude),
                parseFloat(data.longitude)
            );
            console.log(`   ✅ Coordinates say: ${coordState}`);
        }

        // Test what address parsing says
        if (data.address) {
            const addressState = extractStateFromAddress(data.address);
            console.log(`   ⚠️  Address parsing says: ${addressState}`);
        }

        // Test full assignment logic
        const assignment = await assignWSOGeography(data, supabase, {
            includeHistoricalData: false,
            logDetails: false
        });

        console.log(`   📊 Assignment result:`);
        console.log(`      WSO: ${assignment.assigned_wso}`);
        console.log(`      Method: ${assignment.assignment_method}`);
        console.log(`      Confidence: ${(assignment.confidence * 100).toFixed(0)}%`);
        console.log(`      Reasoning: ${assignment.details.reasoning.join('; ')}`);
        console.log('');
    }
}

testProblemClubs();
