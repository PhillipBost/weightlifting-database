const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function applyTrigger() {
    const migrationPath = path.join(__dirname, '../migrations/add_date_parsing_trigger.sql');
    console.log(`Reading migration file: ${migrationPath}`);

    try {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        console.log('Executing SQL to create trigger...');

        // We can't use rpc directly if permissions deny it, but assuming we have same access as before.
        // If this fails, we will know.
        const { error } = await supabase.rpc('execute_sql', { sql_query: sql });

        if (error) {
            console.error('❌ Error executing trigger migration:', error);
            console.log('\n⚠️ Please run the SQL manually in Supabase SQL Editor if this failed.');
        } else {
            console.log('✅ Trigger created successfully!');

            // Test it
            console.log('\n🧪 Testing trigger with a dummy insert...');
            const { data, error: insertError } = await supabase
                .from('usaw_meet_listings')
                .insert({
                    meet_name: 'Trigger Test Meet ' + Date.now(),
                    event_date: 'Dec 25th 2029 - Dec 26th 2029'
                })
                .select('event_date, start_date, end_date')
                .single();

            if (insertError) {
                console.error('❌ Test insert failed:', insertError);
            } else {
                console.log('✅ Test Insert Result:');
                console.table(data);

                if (data.start_date === '2029-12-25' && data.end_date === '2029-12-26') {
                    console.log('🎉 TRIGGER WORKING CONFIRMED!');

                    // Cleanup
                    await supabase.from('usaw_meet_listings').delete().eq('meet_name', data.meet_name);
                } else {
                    console.warn('⚠️ Trigger did not populate dates as expected.');
                }
            }
        }

    } catch (err) {
        console.error('❌ Unexpected error:', err);
    }
}

applyTrigger();
