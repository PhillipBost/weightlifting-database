require('dotenv').config({ path: '../../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function findLiam() {
    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('meet_id, meet_name, date, weight_class, body_weight_kg, lifter_name')
        .eq('lifter_name', 'Liam O\'Brien')
        .limit(5);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Results:', JSON.stringify(data, null, 2));
    }
}

findLiam();
