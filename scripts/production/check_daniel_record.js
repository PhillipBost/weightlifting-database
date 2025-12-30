require('dotenv').config({ path: '../../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkDaniel() {
    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select(`
            result_id, lifter_name, meet_id, date,
            competition_age, gender, body_weight_kg, total,
            age_category, weight_class,
            updated_at
        `)
        .ilike('lifter_name', '%Daniel%Reynolds%')
        .order('date', { ascending: false });

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Results:', JSON.stringify(data, null, 2));
    }
}

checkDaniel();
