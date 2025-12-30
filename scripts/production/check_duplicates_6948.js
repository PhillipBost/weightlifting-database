require('dotenv').config({ path: '../../.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkDuplicates() {
    console.log("Checking for duplicate names in meet 6948...");

    // Fetch all results for the meet
    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('lifter_name, result_id')
        .eq('meet_id', 6948);

    if (error) {
        console.error("Error fetching results:", error);
        return;
    }

    // Count occurrences of each name
    const nameCounts = {};
    data.forEach(row => {
        const name = row.lifter_name;
        if (!nameCounts[name]) {
            nameCounts[name] = [];
        }
        nameCounts[name].push(row.result_id);
    });

    // Filter for duplicates
    const duplicates = Object.entries(nameCounts).filter(([name, ids]) => ids.length > 1);

    if (duplicates.length === 0) {
        console.log("✅ No duplicate names found in meet 6948.");
    } else {
        console.log(`⚠️ Found ${duplicates.length} duplicate name(s):`);
        duplicates.forEach(([name, ids]) => {
            console.log(`   - "${name}": ${ids.length} entries (Result IDs: ${ids.join(', ')})`);
        });
    }
}

checkDuplicates();
