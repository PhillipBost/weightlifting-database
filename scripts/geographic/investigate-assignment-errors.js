const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function investigateAssignmentErrors() {
    console.log('🔍 Investigating specific assignment errors...');

    try {
        // Check West Virginia clubs assigned to DMV
        console.log('1. West Virginia clubs incorrectly assigned to DMV:');
        const { data: dmvClubs } = await supabase
            .from('usaw_clubs')
            .select('club_name, address, wso_geography')
            .eq('wso_geography', 'DMV');

        const wvInDMV = dmvClubs.filter(club =>
            club.address && club.address.toLowerCase().includes('west virginia')
        );

        console.log(`Found ${wvInDMV.length} West Virginia clubs in DMV:`);
        wvInDMV.forEach(club => {
            console.log(`  - ${club.club_name}`);
            console.log(`    ${club.address}`);
        });

        // Check Texas clubs assigned to Georgia
        console.log('\n2. Texas clubs incorrectly assigned to Georgia:');
        const { data: georgiaClubs } = await supabase
            .from('usaw_clubs')
            .select('club_name, address, wso_geography')
            .eq('wso_geography', 'Georgia');

        const txInGA = georgiaClubs.filter(club =>
            club.address && club.address.toLowerCase().includes('texas')
        );

        console.log(`Found ${txInGA.length} Texas clubs in Georgia:`);
        txInGA.forEach(club => {
            console.log(`  - ${club.club_name}`);
            console.log(`    ${club.address}`);
        });

        // Check what WSO West Virginia should actually be assigned to
        console.log('\n3. Checking WSO mapping for West Virginia:');
        const { data: wsoInfo } = await supabase
            .from('usaw_wso_information')
            .select('name, states')
            .contains('states', ['West Virginia']);

        console.log('West Virginia should be assigned to:', wsoInfo?.[0]?.name || 'NOT FOUND');

        // Check if there are any other obvious misassignments
        console.log('\n4. Looking for other potential state mismatches...');

        const stateChecks = [
            { wso: 'Georgia', wrongStates: ['florida', 'alabama', 'south carolina', 'north carolina'] },
            { wso: 'Florida', wrongStates: ['georgia', 'alabama'] },
            { wso: 'Alabama', wrongStates: ['georgia', 'florida', 'tennessee'] },
            { wso: 'Texas-Oklahoma', wrongStates: ['louisiana', 'arkansas', 'new mexico'] }
        ];

        for (const check of stateChecks) {
            const { data: clubs } = await supabase
                .from('usaw_clubs')
                .select('club_name, address, wso_geography')
                .eq('wso_geography', check.wso);

            for (const wrongState of check.wrongStates) {
                const mismatched = clubs.filter(club =>
                    club.address && club.address.toLowerCase().includes(wrongState)
                );

                if (mismatched.length > 0) {
                    console.log(`\n${check.wso} has ${mismatched.length} clubs from ${wrongState}:`);
                    mismatched.slice(0, 3).forEach(club => {
                        console.log(`  - ${club.club_name}: ${club.address}`);
                    });
                }
            }
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

investigateAssignmentErrors();