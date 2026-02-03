const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);

async function debug() {
    console.log('🔍 Inspecting duplicates for KEROUI AHMED...');

    const { data: rows, error } = await supabase
        .from('iwf_sanctions')
        .select('*')
        .eq('name', 'KEROUI AHMED'); // or ilike

    if (error) {
        console.error(error);
        return;
    }

    console.log(`Found ${rows.length} rows.`);
    console.log(JSON.stringify(rows, null, 2));

    if (rows.length >= 2) {
        const r1 = rows[0];
        const r2 = rows[1];

        console.log('--- Comparison ---');
        console.log('Name Equal?', r1.name === r2.name, `"${r1.name}" vs "${r2.name}"`);
        console.log('Start Date Equal?', r1.start_date === r2.start_date, `"${r1.start_date}" vs "${r2.start_date}"`);
        console.log('Substance Equal?', r1.substance === r2.substance, `"${r1.substance}" vs "${r2.substance}"`);
        console.log('Year Group Equal?', r1.sanction_year_group === r2.sanction_year_group, `"${r1.sanction_year_group}" vs "${r2.sanction_year_group}"`);
    }
}

debug();
