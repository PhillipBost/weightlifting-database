const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- Checking for Yeison Lopez ---');
    let { data: d1 } = await supabase.from('iwf_lifters').select('name, nation').ilike('name', '%Yeison%');
    console.log('Matches for Yeison:', d1);

    console.log('--- Checking for Caicedo ---');
    let { data: d2 } = await supabase.from('iwf_lifters').select('name, nation').ilike('name', '%Caicedo%');
    console.log('Matches for Caicedo:', d2);

    console.log('--- Checking for Rybakou ---');
    let { data: d3 } = await supabase.from('iwf_lifters').select('name, nation').ilike('name', '%Rybakou%');
    console.log('Matches for Rybakou:', d3);
}

check();
