const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function runMigration() {
    console.log('Checking if state column exists...');

    try {
        // Try to query the state column - if it exists, this will work
        const { data: testData, error: testError } = await supabase
            .from('clubs')
            .select('state')
            .limit(1);

        if (testError) {
            if (testError.message.includes('does not exist') || testError.code === '42703') {
                console.log('❌ State column does not exist');
                console.log('\nPlease run this SQL manually in Supabase SQL Editor:');
                console.log('='.repeat(60));
                console.log('ALTER TABLE clubs ADD COLUMN state VARCHAR(50);');
                console.log('='.repeat(60));
                console.log('\nThen re-run this script to verify.');
                process.exit(1);
            } else {
                console.error('Unexpected error:', testError);
                process.exit(1);
            }
        }

        console.log('✅ State column exists');
        console.log('Sample data:', testData[0]);

        // Count how many clubs have state populated
        let totalClubs = 0;
        let withState = 0;
        let start = 0;
        const batchSize = 1000;

        while (true) {
            const { data, error } = await supabase
                .from('clubs')
                .select('state')
                .range(start, start + batchSize - 1);

            if (error) {
                console.error('Error counting clubs:', error);
                break;
            }

            if (!data || data.length === 0) break;

            totalClubs += data.length;
            withState += data.filter(c => c.state).length;

            if (data.length < batchSize) break;
            start += batchSize;
        }

        console.log(`\n📊 Current status:`);
        console.log(`   Total clubs: ${totalClubs}`);
        console.log(`   With state populated: ${withState}`);
        console.log(`   Without state: ${totalClubs - withState}`);

        if (withState === 0) {
            console.log('\n💡 Ready to run backfill script to populate states');
        }

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

runMigration();
