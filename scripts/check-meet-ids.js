require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function checkMeetIds() {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SECRET_KEY
    );

    console.log('Fetching meet_id and meet_internal_id from usaw_meets...');

    const { data, error } = await supabase
        .from('usaw_meets')
        .select('meet_id, meet_internal_id')
        .order('meet_id', { ascending: true });

    if (error) {
        console.error('Error fetching data:', error.message);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No meets found.');
        return;
    }

    const minId = data[0].meet_id;
    const maxId = data[data.length - 1].meet_id;
    const totalMeets = data.length;

    let inconsistentCount = 0;
    const inconsistentExamples = [];

    const existingIds = new Set();
    
    for (const row of data) {
        existingIds.add(Number(row.meet_id));
        if (row.meet_id !== row.meet_internal_id) {
            inconsistentCount++;
            if (inconsistentExamples.length < 5) {
                inconsistentExamples.push({ meet_id: row.meet_id, meet_internal_id: row.meet_internal_id });
            }
        }
    }

    const gaps = [];
    for (let i = minId; i <= maxId; i++) {
        if (!existingIds.has(Number(i))) {
            gaps.push(i);
        }
    }

    console.log('\n--- Results ---');
    console.log(`Min ID: ${minId}`);
    console.log(`Max ID: ${maxId}`);
    console.log(`Total meets in DB: ${totalMeets}`);
    console.log(`Inconsistent IDs (meet_id != meet_internal_id): ${inconsistentCount}`);
    
    if (inconsistentCount > 0) {
        console.log('Examples of inconsistency:');
        console.table(inconsistentExamples);
    }

    console.log(`Total gaps in sequence: ${gaps.length}`);
    if (gaps.length > 0) {
        console.log(`First 10 gap IDs: ${gaps.slice(0, 10).join(', ')}`);
    }
}

checkMeetIds();
