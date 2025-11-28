const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function fixDelawareAssignment() {
    console.log('🔧 Fixing Delaware assignment...');

    // Delaware clubs should be assigned to Maryland WSO
    const { data: delawareClubs, error } = await supabase
        .from('usaw_clubs')
        .select('club_name, address')
        .eq('wso_geography', 'Delaware');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${delawareClubs.length} club(s) incorrectly assigned to "Delaware"`);

    for (const club of delawareClubs) {
        console.log(`Reassigning: ${club.club_name}`);
        console.log(`Address: ${club.address}`);

        // Update to Maryland WSO
        const { error: updateError } = await supabase
            .from('usaw_clubs')
            .update({ wso_geography: 'Maryland' })
            .eq('club_name', club.club_name);

        if (updateError) {
            console.error(`Failed to update ${club.club_name}:`, updateError);
        } else {
            console.log(`✅ Reassigned to Maryland WSO`);
        }
        console.log('');
    }

    console.log('Delaware assignment fix complete.');
}

fixDelawareAssignment();