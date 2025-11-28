const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function fixSpecificErrors() {
    console.log('🔧 Fixing specific assignment errors...');

    try {
        // Fix West Virginia clubs incorrectly assigned to DMV
        console.log('1. Fixing West Virginia clubs in DMV:');
        const { data: dmvClubs } = await supabase
            .from('usaw_clubs')
            .select('club_name, address, wso_geography')
            .eq('wso_geography', 'DMV');

        const wvInDMV = dmvClubs.filter(club =>
            club.address && club.address.toLowerCase().includes('west virginia')
        );

        for (const club of wvInDMV) {
            console.log(`  Fixing: ${club.club_name}`);
            const { error } = await supabase
                .from('usaw_clubs')
                .update({ wso_geography: 'Pennsylvania-West Virginia' })
                .eq('club_name', club.club_name);

            if (error) {
                console.error(`    Error: ${error.message}`);
            } else {
                console.log(`    ✅ Moved to Pennsylvania-West Virginia`);
            }
        }

        // Fix Texas club incorrectly assigned to Georgia
        console.log('\\n2. Fixing Texas club in Georgia:');
        const { data: georgiaClubs } = await supabase
            .from('usaw_clubs')
            .select('club_name, address, wso_geography')
            .eq('wso_geography', 'Georgia');

        const txInGA = georgiaClubs.filter(club =>
            club.address && club.address.toLowerCase().includes('texas')
        );

        for (const club of txInGA) {
            console.log(`  Fixing: ${club.club_name}`);
            console.log(`    Address: ${club.address}`);
            const { error } = await supabase
                .from('usaw_clubs')
                .update({ wso_geography: 'Texas-Oklahoma' })
                .eq('club_name', club.club_name);

            if (error) {
                console.error(`    Error: ${error.message}`);
            } else {
                console.log(`    ✅ Moved to Texas-Oklahoma`);
            }
        }

        console.log('\\n✅ Specific fixes complete');

        // Verify the fixes
        console.log('\\n🔍 Verifying fixes:');

        const { data: newDMV } = await supabase
            .from('usaw_clubs')
            .select('club_name, address')
            .eq('wso_geography', 'DMV');
        const wvStillInDMV = newDMV.filter(club =>
            club.address && club.address.toLowerCase().includes('west virginia')
        );
        console.log(`West Virginia clubs still in DMV: ${wvStillInDMV.length}`);

        const { data: newGA } = await supabase
            .from('usaw_clubs')
            .select('club_name, address')
            .eq('wso_geography', 'Georgia');
        const txStillInGA = newGA.filter(club =>
            club.address && club.address.toLowerCase().includes('texas')
        );
        console.log(`Texas clubs still in Georgia: ${txStillInGA.length}`);

    } catch (error) {
        console.error('Error:', error.message);
    }
}

fixSpecificErrors();