const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);

async function inspectBadRecord() {
    console.log('🔍 Inspecting reported bad record...');

    const { data, error } = await supabase
        .from('iwf_sanctions')
        .select('*')
        .eq('id', '97357b7d-a929-4256-8ee7-14479e084e17');

    if (error) console.error(error);
    else console.log(JSON.stringify(data, null, 2));
}

inspectBadRecord();
