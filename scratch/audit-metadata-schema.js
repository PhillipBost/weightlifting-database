const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkProductionSchema() {
    console.log('Checking Production (Self-Hosted) Metadata Columns...');

    // 1. Check USAW Lifters
    const { data: usaw, error: uErr } = await supabase
        .from('usaw_lifters')
        .select('*')
        .limit(1);
    
    if (uErr) console.error('USAW error:', uErr);
    else console.log('USAW Columns:', Object.keys(usaw[0] || {}));

    // 2. Check IWF Lifters
    const { data: iwf, error: iErr } = await supabase
        .from('iwf_lifters')
        .select('*')
        .limit(1);

    if (iErr) console.error('IWF error:', iErr);
    else console.log('IWF Columns:', Object.keys(iwf[0] || {}));
}

checkProductionSchema();
