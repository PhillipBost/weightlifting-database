const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillProfiles() {
    console.log('--- Backfilling Missing Profiles ---');

    // 1. Get all Auth Users
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authError) {
        console.error('Error fetching auth users:', authError);
        return;
    }

    // 2. Get all Profiles
    const { data: profiles, error: profileError } = await supabase.from('profiles').select('id');
    if (profileError) {
        console.error('Error fetching profiles:', profileError);
        return;
    }

    const profileIds = new Set(profiles.map(p => p.id));
    const missingUsers = users.filter(u => !profileIds.has(u.id));

    console.log(`Auth Users: ${users.length}`);
    console.log(`Profiles:   ${profiles.length}`);
    console.log(`Missing:    ${missingUsers.length}`);

    if (missingUsers.length === 0) {
        console.log('✅ All users have profiles.');
        return;
    }

    // 3. Insert Missing
    for (const u of missingUsers) {
        console.log(`Creating profile for: ${u.email}`);

        const { error: insertError } = await supabase.from('profiles').insert({
            id: u.id,
            email: u.email,
            role: 'user',
            name: u.email.split('@')[0]
        });

        if (insertError) {
            console.error(`❌ Failed to create profile for ${u.email}:`, insertError.message);
        } else {
            console.log(`✅ Created profile for ${u.email}`);
        }
    }
}

backfillProfiles();
