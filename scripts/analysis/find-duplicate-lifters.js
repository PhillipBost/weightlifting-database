const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function findDuplicateLifters() {
    console.log('🔍 Searching for duplicate athlete names in usaw_lifters...');

    let allLifters = [];
    let start = 0;
    const batchSize = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('usaw_lifters')
            .select('athlete_name, membership_number, club_name, wso')
            .range(start, start + batchSize - 1);

        if (error) {
            console.error('Error fetching lifters:', error);
            break;
        }

        if (data.length === 0) break;

        allLifters = allLifters.concat(data);
        start += batchSize;
        
        if (start % 10000 === 0) {
            console.log(`  Fetched ${start} lifters...`);
        }
    }

    console.log(`✅ Fetched ${allLifters.length} total lifters.`);

    // Count occurrences of each name
    const nameCounts = {};
    allLifters.forEach(l => {
        const name = l.athlete_name;
        if (!nameCounts[name]) {
            nameCounts[name] = {
                count: 0,
                memberships: new Set(),
                clubs: new Set(),
                wsos: new Set()
            };
        }
        nameCounts[name].count++;
        if (l.membership_number) nameCounts[name].memberships.add(l.membership_number);
        if (l.club_name) nameCounts[name].clubs.add(l.club_name);
        if (l.wso) nameCounts[name].wsos.add(l.wso);
    });

    // Filter for duplicates and sort
    const duplicates = Object.entries(nameCounts)
        .filter(([name, info]) => info.count > 1)
        .map(([name, info]) => ({
            name,
            count: info.count,
            uniqueMemberships: info.memberships.size,
            uniqueClubs: info.clubs.size,
            uniqueWSOs: info.wsos.size,
            memberships: Array.from(info.memberships)
        }))
        .sort((a, b) => b.count - a.count);

    console.log('\nTop 20 Duplicate Names:');
    console.log('--------------------------------------------------------------------------------');
    console.log('Name'.padEnd(30) | 'Count'.padEnd(10) | 'Unique IDs'.padEnd(15) | 'Unique Clubs');
    console.log('--------------------------------------------------------------------------------');
    
    duplicates.slice(0, 20).forEach(d => {
        console.log(
            d.name.padEnd(30),
            d.count.toString().padEnd(10),
            d.uniqueMemberships.toString().padEnd(15),
            d.uniqueClubs
        );
    });

    // Check if membership_number is a good distinguisher
    const namesWithMultipleMemberships = duplicates.filter(d => d.uniqueMemberships > 1).length;
    const namesWithSameMembership = duplicates.filter(d => d.uniqueMemberships === 1 && d.count > 1).length;
    const namesWithNoMembership = duplicates.filter(d => d.uniqueMemberships === 0).length;

    console.log('\nAnalysis of Distinguishing Columns:');
    console.log(`Total duplicate names found: ${duplicates.length}`);
    console.log(`Names where all duplicates share the SAME membership number: ${namesWithSameMembership}`);
    console.log(`Names where duplicates have DIFFERENT membership numbers: ${namesWithMultipleMemberships}`);
    console.log(`Names where duplicates have NO membership numbers: ${namesWithNoMembership}`);
    
    if (namesWithSameMembership > 0) {
        console.log('\n⚠️ Warning: Many duplicate names share the same membership number, suggesting actual duplicate records for the same person.');
    }
    if (namesWithMultipleMemberships > 0) {
        console.log('\nℹ️ Note: Some duplicate names have different membership numbers, suggesting different people with the same name.');
    }
}

findDuplicateLifters();
