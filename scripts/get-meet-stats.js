require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function getMeetStats() {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SECRET_KEY
    );

    console.log('Querying usaw_meets table...');

    // Get min and max meet_id
    const { data: minMaxData, error: minMaxError } = await supabase
        .from('usaw_meets')
        .select('meet_id')
        .order('meet_id', { ascending: true });

    if (minMaxError) {
        console.error('Error fetching meet IDs:', minMaxError.message);
        return;
    }

    if (minMaxData.length === 0) {
        console.log('No meets found in the table.');
        return;
    }

    const minId = minMaxData[0].meet_id;
    const maxId = minMaxData[minMaxData.length - 1].meet_id;
    const count = minMaxData.length;

    console.log('--- Meet Statistics ---');
    console.log(`Minimum meet_id: ${minId}`);
    console.log(`Maximum meet_id: ${maxId}`);
    console.log(`Total meets:    ${count}`);
}

getMeetStats();
