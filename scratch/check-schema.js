
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function run() {
    const { data, error } = await supabase.rpc('get_table_constraints', { table_val: 'usaw_meet_results' });
    
    if (error) {
        // Fallback: Just query the columns and indexes if RPC is missing
        const { data: columns } = await supabase.from('usaw_meet_results').select('*').limit(1);
        console.log('Columns:', Object.keys(columns[0]));
        return;
    }
    console.table(data);
}

run();
