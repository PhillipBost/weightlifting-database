require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function run() {
    console.log('Checking status of Meet 7016...');

    // 1. Check Total Count
    const { count: totalRows, error: countError } = await supabase
        .from('usaw_meet_results')
        .select('*', { count: 'exact', head: true })
        .eq('meet_id', 7016);

    if (countError) console.error('Error getting count:', countError);
    else console.log(`Total Rows in DB: ${totalRows}`);

    // 2. Check NULL Totals
    const { count: nullRows, error: nullError } = await supabase
        .from('usaw_meet_results')
        .select('*', { count: 'exact', head: true })
        .eq('meet_id', 7016)
        .is('total', null);

    if (nullError) console.error('Error getting NULLs:', nullError);
    else console.log(`Rows with NULL Total: ${nullRows}`);

    // 3. Check "0" Totals (string '0' or number 0)
    // Note: This is just for info
    const { data: zeroRows, error: zeroError } = await supabase
        .from('usaw_meet_results')
        .select('lifter_name, total')
        .eq('meet_id', 7016)
        .or('total.eq.0,total.eq."0"');

    if (zeroError) console.error('Error getting Zeros:', zeroError);
    else {
        console.log(`Rows with Zero Total: ${zeroRows.length}`);
        zeroRows.forEach(r => console.log(` - ${r.lifter_name}: ${r.total} (${typeof r.total})`));
    }
}

run();
