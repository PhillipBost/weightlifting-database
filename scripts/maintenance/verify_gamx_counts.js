const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: Env vars missing');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TABLES = [
    'gamx_u_factors',
    'gamx_a_factors',
    'gamx_masters_factors',
    'gamx_points_factors',
    'gamx_s_factors',
    'gamx_j_factors'
];

const fs = require('fs');

async function run() {
    console.log('Verifying GAMX Table Counts...');
    const results = {};
    let output = 'GAMX Verification:\n';

    for (const table of TABLES) {
        const { count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });

        if (error) {
            console.error(`Error querying ${table}:`, error.message);
            output += `- ${table}: ERROR (${error.message})\n`;
        } else {
            console.log(`- ${table}: ${count} rows`);
            output += `- ${table}: ${count} rows\n`;
        }
    }
    fs.writeFileSync('verification_output.txt', output);
}

run();
