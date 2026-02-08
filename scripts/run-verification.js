const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function verify() {
    console.log('🔍 Verifying backfill results...\n');

    // 1. Check for populated dates
    const { data: sample, error: sampleError } = await supabase
        .from('usaw_meet_listings')
        .select('event_date, start_date, end_date')
        .not('start_date', 'is', null)
        .limit(10);

    if (sampleError) console.error('Error fetching sample:', sampleError);
    else {
        console.log('✅ Sample populated records:');
        console.table(sample);
    }

    // 2. Check for remaining NULLs
    const { count, error: countError } = await supabase
        .from('usaw_meet_listings')
        .select('*', { count: 'exact', head: true })
        .is('start_date', null)
        .not('event_date', 'is', null);

    if (countError) console.error('Error fetching null count:', countError);
    else {
        console.log(`\nRemaining records with NULL start_date: ${count}`);
    }

    // 3. Test sorting
    const { data: sorted, error: sortError } = await supabase
        .from('usaw_meet_listings')
        .select('event_date, start_date')
        .filter('start_date', 'gt', '2025-01-01') // Future/recent dates
        .order('start_date', { ascending: false })
        .limit(5);

    if (sortError) console.error('Error testing sort:', sortError);
    else {
        console.log('\n✅ Sorting Test (Newest first, > 2025-01-01):');
        console.table(sorted);
    }
}

verify();
