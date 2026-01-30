require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Error: Missing SUPABASE_URL or SERVICE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Checking gamx_points_factors (Senior Total)...");

    // 1. Check Count
    const { count, error: countError } = await supabase
        .from('gamx_points_factors')
        .select('*', { count: 'exact', head: true });

    if (countError) {
        console.error("Error getting count:", countError.message);
    } else {
        console.log(`Total Rows: ${count}`);
    }

    // 2. Check Sample (Male, 81.0kg)
    // Note: Data is rounded to 0.1
    const targetBw = 81.0;
    const { data: sample, error: sampleError } = await supabase
        .from('gamx_points_factors')
        .select('*')
        .eq('gender', 'm')
        .eq('bodyweight', targetBw)
        .limit(1);

    if (sampleError) {
        console.error("Error fetching sample:", sampleError.message);
    } else if (!sample || sample.length === 0) {
        console.warn(`WARNING: No factors found for Male, ${targetBw}kg`);
    } else {
        console.log(`Found sample for Male ${targetBw}kg:`, sample[0]);
    }

    // 3. Check for specific 'gamx_s_factors' (Snatch) just in case
    const { count: sCount } = await supabase.from('gamx_s_factors').select('*', { count: 'exact', head: true });
    console.log(`gamx_s_factors Rows: ${sCount}`);
}

run();
