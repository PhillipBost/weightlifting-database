const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function fixMeetWVAssignments() {
    console.log('🔧 Fixing West Virginia meets incorrectly assigned to DMV...');

    try {
        // Get West Virginia meets in DMV
        const { data: dmvMeets } = await supabase
            .from('usaw_meets')
            .select('meet_id, Meet, address, wso_geography')
            .eq('wso_geography', 'DMV');

        const wvMeets = dmvMeets.filter(meet =>
            meet.address && meet.address.toLowerCase().includes('west virginia')
        );

        console.log(`Found ${wvMeets.length} West Virginia meets in DMV:`);

        for (const meet of wvMeets) {
            console.log(`  Fixing: ${meet.Meet}`);
            console.log(`    Address: ${meet.address}`);

            const { error } = await supabase
                .from('usaw_meets')
                .update({ wso_geography: 'Pennsylvania-West Virginia' })
                .eq('meet_id', meet.meet_id);

            if (error) {
                console.error(`    Error: ${error.message}`);
            } else {
                console.log(`    ✅ Moved to Pennsylvania-West Virginia`);
            }
        }

        // Verify the fix
        console.log('\\n🔍 Verifying fix:');
        const { data: newDMV } = await supabase
            .from('usaw_meets')
            .select('meet_id, Meet, address')
            .eq('wso_geography', 'DMV');
        const wvStillInDMV = newDMV.filter(meet =>
            meet.address && meet.address.toLowerCase().includes('west virginia')
        );
        console.log(`West Virginia meets still in DMV: ${wvStillInDMV.length}`);

        console.log('\\n✅ West Virginia meet assignments fixed');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

fixMeetWVAssignments();