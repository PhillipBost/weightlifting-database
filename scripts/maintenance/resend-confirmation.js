const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
// Use PUBLIC key for client-side auth operations usually, but Service Role can also trigger admin actions.
// Resend via client SDK needs public key usually? Or checking admin api.
// Admin API helper: supabase.auth.admin.inviteUserByEmail (not quite).
// Let's use the normal client auth.resend.
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function resend() {
    console.log('--- Attempting to Resend Confirmation ---');
    const email = 'phillipbost+default+test@gmail.com'; // The user found

    const { data, error } = await supabase.auth.resend({
        type: 'signup',
        email: email
    });

    if (error) {
        console.error('❌ Resend failed:', error.message);
        console.error('Full Error:', error);
    } else {
        console.log(`✅ Resend request successful for ${email}`);
        console.log('Data:', data);
    }
}

resend();
