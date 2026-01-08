require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
);

async function main() {
    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('lifter_name, total, body_weight_kg, date, meet_id, result_id')
        .eq('result_id', 210162)
        .single();

    if (error) console.error(error);
    else {
        console.log('Result Analysis:');
        console.log(`- ID: ${data.result_id}`);
        console.log(`- Name: "${data.lifter_name}"`);
        console.log(`- Total: "${data.total}"`);
        console.log(`- BodyWeight: "${data.body_weight_kg}"`);
    }
}

main();
