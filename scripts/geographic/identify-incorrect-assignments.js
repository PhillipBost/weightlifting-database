const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function identifyIncorrectAssignments() {
    console.log('🔍 Identifying all incorrect club WSO assignments...');

    try {
        // Get valid WSO names from wso_information table
        const { data: validWSOs, error: wsoError } = await supabase
            .from('usaw_wso_information')
            .select('name');

        if (wsoError) throw wsoError;

        const validWSONames = validWSOs.map(wso => wso.name);
        console.log(`Valid WSO regions (${validWSONames.length}):`, validWSONames.sort());

        // Get all current club assignments
        const { data: clubs, error: clubError } = await supabase
            .from('usaw_clubs')
            .select('club_name, address, wso_geography')
            .not('wso_geography', 'is', null);

        if (clubError) throw clubError;

        console.log(`\nChecking ${clubs.length} assigned clubs...`);

        // Group by WSO assignment
        const assignments = {};
        clubs.forEach(club => {
            if (!assignments[club.wso_geography]) {
                assignments[club.wso_geography] = [];
            }
            assignments[club.wso_geography].push(club);
        });

        const invalidAssignments = {};
        const validAssignments = {};

        Object.entries(assignments).forEach(([wso, clubList]) => {
            if (validWSONames.includes(wso)) {
                validAssignments[wso] = clubList;
            } else {
                invalidAssignments[wso] = clubList;
            }
        });

        console.log(`\n✅ Valid assignments: ${Object.keys(validAssignments).length} WSOs`);
        console.log(`❌ Invalid assignments: ${Object.keys(invalidAssignments).length} WSOs`);

        if (Object.keys(invalidAssignments).length > 0) {
            console.log('\n🚨 INVALID WSO ASSIGNMENTS:');
            let totalInvalid = 0;

            Object.entries(invalidAssignments).forEach(([invalidWSO, clubList]) => {
                console.log(`\n"${invalidWSO}" (${clubList.length} clubs):`);
                totalInvalid += clubList.length;

                clubList.slice(0, 5).forEach(club => {
                    console.log(`  - ${club.club_name}`);
                    console.log(`    ${club.address || 'No address'}`);
                });

                if (clubList.length > 5) {
                    console.log(`    ... and ${clubList.length - 5} more clubs`);
                }
            });

            console.log(`\n🔥 TOTAL CLUBS WITH INVALID ASSIGNMENTS: ${totalInvalid}`);
            console.log('\nInvalid WSO names that need fixing:');
            Object.keys(invalidAssignments).forEach(invalidWSO => {
                console.log(`  - "${invalidWSO}"`);
            });
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

identifyIncorrectAssignments();