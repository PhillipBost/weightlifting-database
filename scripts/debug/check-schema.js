require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
);

async function main() {
    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('*')
        .limit(1);

    if (error) console.error(error);
    else if (data && data.length > 0) {
        Object.keys(data[0]).forEach(k => console.log(k));
    }
    else console.log('No data found');
}

main();
