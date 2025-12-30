require('dotenv').config({ path: '../../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkElijah() {
    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('meet_id, meet_name, date, lifter_name')
        .eq('result_id', 423848)
        .single();

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Result:', JSON.stringify(data, null, 2));
    }
}

checkElijah();
