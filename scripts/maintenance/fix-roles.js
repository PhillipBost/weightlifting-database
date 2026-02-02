const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixRoles() {
    console.log('--- Fixing Roles ---');

    // Update any profile with role 'user' to 'Default'
    const { data, error } = await supabase
        .from('profiles')
        .update({ role: 'Default' })
        .eq('role', 'user')
        .select();

    if (error) {
        console.error('Error updating roles:', error);
    } else {
        console.log(`Updated ${data.length} profiles from 'user' to 'Default'.`);
    }
}

fixRoles();
