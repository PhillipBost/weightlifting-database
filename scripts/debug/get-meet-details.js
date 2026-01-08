require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
);

async function main() {
    const { data, error } = await supabase
        .from('usaw_meets')
        .select('*')
        .eq('meet_id', 2405)
        .single();

    if (error) console.error(error);
    else {
        console.log('Meet ID:', data.meet_id);
        console.log('Sport80 ID:', data.meet_internal_id);
        console.log('Name:', data.Meet);
    }
}

main();
