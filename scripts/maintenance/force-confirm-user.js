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

async function forceConfirm() {
    // ID from previous check-recent-users.js output
    const userId = 'e127a5f4-b9c5-4da7-be43-7981e1ee218a';
    const email = 'phillipbost+default+test@gmail.com';

    console.log(`--- Force Confirming User ---`);
    console.log(`User:  ${email}`);
    console.log(`ID:    ${userId}`);

    const { data, error } = await supabase.auth.admin.updateUserById(
        userId,
        { email_confirm: true }
    );

    if (error) {
        console.error('❌ Failed to confirm user:', error.message);
        console.error(error);
    } else {
        console.log('✅ User confirmed successfully!');
        console.log(`New Email Confirmed At: ${data.user.email_confirmed_at}`);
    }
}

forceConfirm();
