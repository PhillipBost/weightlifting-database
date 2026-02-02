const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function clearTable() {
    console.log('🗑️  Clearing iwf_sanctions table...');

    const { error } = await supabase
        .from('iwf_sanctions')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all where UUID is not nil (effectively all)

    if (error) {
        console.error('Error clearing table:', error);
    } else {
        console.log('✅ Table cleared successfully.');
    }
}

clearTable();
