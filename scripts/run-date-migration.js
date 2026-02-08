const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function runMigration() {
    const migrationPath = path.join(__dirname, '../migrations/add_sortable_dates_to_listings.sql');
    console.log(`Reading migration file: ${migrationPath}`);

    try {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        console.log('Executing SQL...');

        const { error } = await supabase.rpc('execute_sql', { sql_query: sql });

        // If RPC fails (permissions), try direct SQL execution if possible (usually not via JS client without specific setup)
        // But since we have the MCP tool 'execute_sql', we can't use it from this node script.
        // We will fallback to logging instructions if this fails.

        if (error) {
            // Check if it's a "function not found" error, which means we might need to use a different approach
            // or if it's a permissions error.
            console.error('❌ Error executing migration via RPC:', error);

            // Allow manual execution via MCP if this script fails
            console.log('\n⚠️ If RPC is not enabled, please execute the SQL manually or use the MCP tool.');
        } else {
            console.log('✅ Migration executed successfully!');
        }

    } catch (err) {
        console.error('❌ Unexpected error:', err);
    }
}

runMigration();
