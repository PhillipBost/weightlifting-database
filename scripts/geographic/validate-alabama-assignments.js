const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function validateAlabamaAssignments() {
    console.log('🔍 Validating Alabama WSO assignments...');

    try {
        // Get all clubs assigned to Alabama
        const { data: alabamaClubs, error } = await supabase
            .from('usaw_clubs')
            .select('club_name, address, wso_geography')
            .eq('wso_geography', 'Alabama');

        if (error) throw error;

        console.log(`\\nFound ${alabamaClubs.length} clubs assigned to Alabama WSO:`);

        alabamaClubs.forEach((club, index) => {
            console.log(`${index + 1}. ${club.club_name}`);
            console.log(`   Address: ${club.address || 'No address'}`);
            console.log(`   WSO: ${club.wso_geography}`);
            console.log('');
        });

        // Also check for any clubs that might be incorrectly assigned to other WSOs 
        // but have Alabama in their address
        console.log('\\n🔍 Checking for potential Alabama clubs assigned elsewhere...');

        const { data: allClubs, error: allError } = await supabase
            .from('usaw_clubs')
            .select('club_name, address, wso_geography')
            .not('wso_geography', 'eq', 'Alabama')
            .not('wso_geography', 'is', null);

        if (allError) throw allError;

        const potentialAlabama = allClubs.filter(club =>
            club.address && club.address.toLowerCase().includes('alabama')
        );

        if (potentialAlabama.length > 0) {
            console.log(`Found ${potentialAlabama.length} potential Alabama clubs assigned elsewhere:`);
            potentialAlabama.forEach((club, index) => {
                console.log(`${index + 1}. ${club.club_name}`);
                console.log(`   Address: ${club.address}`);
                console.log(`   Current WSO: ${club.wso_geography}`);
                console.log('');
            });
        } else {
            console.log('✅ No Alabama clubs found assigned to other WSOs');
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

validateAlabamaAssignments();