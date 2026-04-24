
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function run() {
    const { data: results, error } = await supabase
        .from('usaw_meet_results')
        .select('lifter_id, lifter_name, date, meet_name, age_category, weight_class, total, wso, club_name')
        .in('lifter_id', [2267, 199949])
        .order('date', { ascending: false });

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.table(results);
}

run();
