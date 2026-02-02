const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log('--- Checking Profiles Table Schema ---');

    // We'll use a raw query via a helper if available, or just try to select * limit 1 to see keys
    // Since we don't have a direct SQL runner, let's try to select from 'profiles' and see what we get (or error)

    // Attempt 1: Just select 1 row
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error querying profiles:', error);
        // If table doesn't exist, we'll know.
    } else {
        console.log('Table "profiles" exists.');
        if (data.length > 0) {
            console.log('Sample Row Keys:', Object.keys(data[0]));
        } else {
            console.log('Table is empty, but exists.');
            // We can't see keys if empty... 
            // In that case, we might need to assume standard Supabase "User Management" starter columns.
            // id, updated_at, username, full_name, avatar_url, website, email...
        }
    }
}

checkSchema();
