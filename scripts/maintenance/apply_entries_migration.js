require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function runMigration() {
    console.log('Reading migration file...');
    const migrationPath = path.join(__dirname, '../../migrations/create_usaw_meet_entries.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Executing SQL...');

    // Split by semicolons to run statements individually if needed, 
    // but supabase.rpc usually handles blocks if we wrap in a function or use a specific execution endpoint.
    // However, the standard supabase-js client doesn't have a direct 'query' or 'executeSql' method exposed publicly 
    // unless a specific RPC function is set up for it (like 'exec_sql').

    // Most of the scripts in this project seem to use direct table access, not raw SQL.
    // Let's check if there is an RPC for executing SQL. 
    // If not, we might be stuck without a way to run DDL via the JS client unless 'exec_sql' exists.

    // Let's try to call an RPC 'exec_sql' which is common in these setups.

    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
        // Fallback: If exec_sql doesn't exist, we might have to assume the user has a way to run migrations 
        // OR we can try to use the REST API 'query' if enabled (unlikely).
        console.error('Error running migration via RPC:', error);

        // Alternative: Try to use the Postgres connection string if available in env 
        // (but we only see SUPABASE_URL in typical context).

        console.log('Migration failed. attempting to proceed without creating table (will fail later if table needed).');
        process.exit(1);
    } else {
        console.log('Migration executed successfully.');
    }
}

runMigration();
