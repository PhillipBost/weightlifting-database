const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Parse URL to handle Basic Auth credentials safely
let rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // Restored

let cleanUrl = rawUrl;
let headers = {};

try {
    const urlObj = new URL(rawUrl);
    if (urlObj.username || urlObj.password) {
        const authString = `${urlObj.username}:${urlObj.password}`;
        headers['Authorization'] = `Basic ${Buffer.from(authString).toString('base64')}`;
        // Clean the URL for the client
        cleanUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    }
} catch (e) {
    console.error('URL parsing failed', e);
}

console.log(`Debug: Using URL: ${cleanUrl}`);
if (headers.Authorization) console.log('Debug: Authorization header set.');

const supabase = createClient(cleanUrl, supabaseAnonKey, {
    global: { headers: headers }
});

async function debugSignup() {
    const email = `test_signup_debug_${Date.now()}@gmail.com`;
    const password = 'TestPassword123!';

    console.log(`--- Attempting Signup ---`);
    console.log(`Email: ${email}`);

    const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password
    });

    if (error) {
        console.error('❌ Signup failed!');
        console.error('Error Message:', error.message);
        console.error('Error Name:', error.name);
        console.error('Full Error Object:', JSON.stringify(error, null, 2));
    } else {
        console.log('✅ Signup successful!');
        console.log('User ID:', data.user ? data.user.id : 'No User Object?');
        console.log('Session:', data.session ? 'Created' : 'Null (Expected if email confirm required)');
        console.log('User Confirmed At:', data.user?.email_confirmed_at);
        console.log('Full Data:', JSON.stringify(data, null, 2));
    }
}

debugSignup();
