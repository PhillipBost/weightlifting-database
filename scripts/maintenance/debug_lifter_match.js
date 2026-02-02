const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- Inspecting iwf_lifters Schema ---');

    // 1. Fetch one row to see columns
    const { data: sample, error: sampleError } = await supabase
        .from('iwf_lifters')
        .select('*')
        .limit(1);

    if (sampleError) {
        console.error('Error fetching sample:', sampleError);
    } else if (sample && sample.length > 0) {
        console.log('Columns found:', Object.keys(sample[0]).join(', '));
        console.log('Sample Row:', sample[0]);
    } else {
        console.log('Table seems empty.');
    }

    // 2. Test Match Logic with athlete_name
    console.log('\n--- Testing Scraper Query Logic ---');
    // Using sample data specific to user's report
    const testCases = [
        { name: 'Yeison LOPEZ LOPEZ', nation: 'COL' },
        { name: 'Zagora Jean S CALLENDER', nation: 'BAR' }
    ];

    for (const tc of testCases) {
        // Try matching with 'nation' column first (if it exists)
        // We will adapt this based on the column check above manually if needed, 
        // but here we try to see what works.

        console.log(`\nTesting "${tc.name}" [${tc.nation}]`);

        // Query 1: Using 'nation' column
        const { data: d1, error: e1 } = await supabase
            .from('iwf_lifters')
            .select('db_lifter_id, athlete_name, nation') // guess 'nation' exists
            .eq('nation', tc.nation)
            .ilike('athlete_name', tc.name);

        if (e1) console.log('Query using "nation" failed:', e1.message);
        else console.log('Query "nation" result:', d1.length ? 'MATCH' : 'No match');

        // Query 2: Using 'country_code' column (guess)
        const { data: d2, error: e2 } = await supabase
            .from('iwf_lifters')
            .select('db_lifter_id, athlete_name, country_code') // guess 'country_code' exists
            .eq('country_code', tc.nation)
            .ilike('athlete_name', tc.name);

        if (e2) console.log('Query using "country_code" failed:', e2.message);
        else console.log('Query "country_code" result:', d2.length ? 'MATCH' : 'No match');
    }
}

check();
