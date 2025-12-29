require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function run() {
    console.log('Simulating incomplete result for Meet 7016...');

    // 1. Find Aubrey's result
    const { data: results, error: findError } = await supabase
        .from('usaw_meet_results')
        .select('*')
        .eq('meet_id', 7016)
        .eq('lifter_name', 'Aubrey McLaughlin')
        .single();

    if (findError) {
        console.error('Error finding result:', findError);
        return;
    }

    console.log(`Found result ID ${results.result_id} with Total: ${results.total}`);

    // 2. Set Total to NULL
    const { error: updateError } = await supabase
        .from('usaw_meet_results')
        .update({ total: null })
        .eq('result_id', results.result_id);

    if (updateError) {
        console.error('Error simulating incomplete result:', updateError);
        return;
    }

    console.log(`✅ Successfully set Total to NULL for result ${results.result_id}.`);
    console.log('Now run the re-import scraper WITHOUT --force to verify it detects the incomplete meet.');
}

run();
