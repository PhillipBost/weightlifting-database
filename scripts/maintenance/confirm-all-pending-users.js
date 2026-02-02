const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!supabaseKey) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY is required.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function confirmAllPending() {
    console.log('--- Checking for Pending Users ---');

    // 1. List users (fetch up to 100 recent ones to be safe)
    const { data: { users }, error } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 100
    });

    if (error) {
        console.error('Error listing users:', error);
        return;
    }

    const pendingUsers = users.filter(u => !u.email_confirmed_at);

    console.log(`Found ${users.length} total users.`);
    console.log(`Found ${pendingUsers.length} PENDING users.`);

    if (pendingUsers.length === 0) {
        console.log('✅ No pending users found.');
        return;
    }

    console.log('--- Confirming Users ---');
    for (const u of pendingUsers) {
        console.log(`Confirming: ${u.email} (${u.id})...`);
        const { error: updateError } = await supabase.auth.admin.updateUserById(
            u.id,
            { email_confirm: true }
        );

        if (updateError) {
            console.error(`❌ Failed to confirm ${u.email}:`, updateError.message);
        } else {
            console.log(`✅ Confirmed ${u.email}`);
        }
    }
    console.log('--- Done ---');
}

confirmAllPending();
