require('dotenv').config({ path: '../../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkLiam() {
    const ids = [423848, 305015, 423728]; // Guzman, Mallery, Chadbourne
    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('*')
        .in('result_id', ids);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Results:', JSON.stringify(data, null, 2));
    }
}

checkLiam();
