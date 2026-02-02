const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!supabaseKey) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY (or SECRET_KEY) is required.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function checkRecentUsers() {
    console.log('--- Checking Recent Auth Users ---');

    // List users (default sort is by created_at desc? No, usually generic. We might need to sort manually or fetch last page)
    // Actually listUsers returns pages. perPage defaults to 50.
    const { data: { users }, error } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 10
    });

    if (error) {
        console.error('Error listing users:', error);
        return;
    }

    // Sort by created_at desc
    users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    console.log(`Found ${users.length} users. Showing top 5 most recent:`);

    for (const u of users.slice(0, 5)) {
        console.log(`\nUser: ${u.email}`);
        console.log(`   ID: ${u.id}`);
        console.log(`   Created: ${u.created_at}`);
        console.log(`   Confirmed: ${u.email_confirmed_at ? 'YES (' + u.email_confirmed_at + ')' : 'NO'}`);
        console.log(`   Last Sign In: ${u.last_sign_in_at || 'Never'}`);
    }
}

checkRecentUsers();
