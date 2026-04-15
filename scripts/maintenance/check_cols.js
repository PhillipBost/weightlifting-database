require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const iwf = createClient(process.env.SUPABASE_IWF_URL, process.env.SUPABASE_IWF_SECRET_KEY);

async function run() {
    const { data: u, error: ue } = await sub.from('usaw_meet_results').select('*').limit(1);
    const { data: i, error: ie } = await iwf.from('iwf_meet_results').select('*').limit(1);
    if (ue) console.log('USAW ERR:', ue.message);
    else console.log('USAW cols:', Object.keys(u[0]).join(', '));
    if (ie) console.log('IWF ERR:', ie.message);
    else console.log('IWF cols:', Object.keys(i[0]).join(', '));
}

run().catch(console.error);
