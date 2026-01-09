
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function verify() {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    console.log('Verifying Ralph Guglielmi in Meet 2526...');

    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('lifter_id, lifter_name, total, body_weight_kg, weight_class')
        .eq('meet_id', 2526)
        .eq('lifter_name', 'Ralph Guglielmi');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${data.length} results:`);
    console.table(data);

    if (data.length === 2 && data[0].lifter_id !== data[1].lifter_id) {
        console.log('✅ SUCCESS: Two distinct lifter IDs found!');
    } else {
        console.log('❌ FAILURE: distinct lifter IDs not found.');
    }
}

verify();
