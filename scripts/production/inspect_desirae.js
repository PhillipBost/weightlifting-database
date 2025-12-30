require('dotenv').config({ path: '../../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectDuplicates() {
    const ids = [439783, 423635];

    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('*')
        .in('result_id', ids);

    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Duplicate Records Details:");
        console.log(JSON.stringify(data, null, 2));
    }
}

inspectDuplicates();
