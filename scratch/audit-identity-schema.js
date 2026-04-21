const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkSchema() {
    console.log('Checking Production (Self-Hosted) Identity Columns...');

    // 1. Check USAW
    const { data: usaw, error: uErr } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, membership_number')
        .limit(1);
    
    if (uErr) console.error('USAW error:', uErr);
    else console.log('USAW Sample Keys:', Object.keys(usaw[0] || {}));

    // 2. Check IWF
    const { data: iwf, error: iErr } = await supabase
        .from('iwf_lifters')
        .select('db_lifter_id, iwf_lifter_id')
        .limit(1);

    if (iErr) console.error('IWF error:', iErr);
    else console.log('IWF Sample Keys:', Object.keys(iwf[0] || {}));
}

checkSchema();
