// Check for 2019 Southern Pacific LWC Championship meet
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigateMissingMeet() {
    console.log('🔍 Investigating 2019 Southern Pacific LWC Championship...\n');
    
    // Search for the meet in usaw_meets
    console.log('📋 Searching usaw_meets table:');
    console.log('='.repeat(70));
    
    const { data: meetsByName, error: nameError } = await supabase
        .from('usaw_meets')
        .select('*')
        .ilike('Meet', '%Southern Pacific%LWC%')
        .order('Date', { ascending: true });
    
    if (nameError) {
        console.error('Error searching by name:', nameError);
    } else {
        console.log(`\nFound ${meetsByName.length} meet(s) matching "Southern Pacific LWC":`);
        meetsByName.forEach(meet => {
            console.log(`  - meet_id: ${meet.meet_id}`);
            console.log(`    Meet: ${meet.Meet}`);
            console.log(`    Date: ${meet.Date}`);
            console.log(`    Location: ${meet.Location || 'N/A'}`);
            console.log('');
        });
    }
    
    // Search for meets around Nov 2019
    console.log('\n📅 Searching for meets around November 2019:');
    console.log('='.repeat(70));
    
    const { data: meetsNov2019, error: dateError } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, Date, Location')
        .gte('Date', '2019-10-15')
        .lte('Date', '2019-11-15')
        .order('Date', { ascending: true });
    
    if (dateError) {
        console.error('Error searching by date:', dateError);
    } else {
        console.log(`\nFound ${meetsNov2019.length} meet(s) in Oct 15 - Nov 15, 2019:`);
        meetsNov2019.forEach(meet => {
            console.log(`  ${meet.Date} - ${meet.Meet} (ID: ${meet.meet_id})`);
        });
    }
    
    // Search for any results from this date
    console.log('\n📊 Searching meet_results for date 2019-11-02:');
    console.log('='.repeat(70));
    
    const { data: resultsNov2, error: resultsError } = await supabase
        .from('usaw_meet_results')
        .select('result_id, meet_id, meet_name, lifter_name, age_category, weight_class')
        .eq('date', '2019-11-02')
        .order('lifter_name', { ascending: true });
    
    if (resultsError) {
        console.error('Error searching results:', resultsError);
    } else {
        console.log(`\nFound ${resultsNov2.length} result(s) from 2019-11-02:`);
        if (resultsNov2.length > 0) {
            const uniqueMeets = [...new Set(resultsNov2.map(r => r.meet_name))];
            console.log(`\nUnique meets:`);
            uniqueMeets.forEach(name => {
                const count = resultsNov2.filter(r => r.meet_name === name).length;
                console.log(`  - ${name} (${count} results)`);
            });
        }
    }
    
    // Check if there are any 2019 results for either athlete
    console.log('\n📊 Checking 2019 results for Cuevas/Saetern:');
    console.log('='.repeat(70));
    
    const { data: cuevas2019, error: cuevasError } = await supabase
        .from('usaw_meet_results')
        .select('result_id, date, meet_name, age_category, weight_class, total')
        .eq('lifter_id', 11822)
        .gte('date', '2019-01-01')
        .lte('date', '2019-12-31')
        .order('date', { ascending: true });
    
    if (!cuevasError && cuevas2019.length > 0) {
        console.log(`\nCuevas (11822) - ${cuevas2019.length} result(s) in 2019:`);
        cuevas2019.forEach(r => {
            console.log(`  ${r.date} - ${r.meet_name} - ${r.age_category} ${r.weight_class} - ${r.total}kg`);
        });
    } else {
        console.log(`\nCuevas (11822) - No results in 2019`);
    }
    
    const { data: saetern2019, error: saeternError } = await supabase
        .from('usaw_meet_results')
        .select('result_id, date, meet_name, age_category, weight_class, total')
        .eq('lifter_id', 64401)
        .gte('date', '2019-01-01')
        .lte('date', '2019-12-31')
        .order('date', { ascending: true });
    
    if (!saeternError && saetern2019.length > 0) {
        console.log(`\nSaetern (64401) - ${saetern2019.length} result(s) in 2019:`);
        saetern2019.forEach(r => {
            console.log(`  ${r.date} - ${r.meet_name} - ${r.age_category} ${r.weight_class} - ${r.total}kg`);
        });
    } else {
        console.log(`\nSaetern (64401) - No results in 2019`);
    }
    
    console.log('\n✅ Investigation complete!');
}

investigateMissingMeet().catch(console.error);
