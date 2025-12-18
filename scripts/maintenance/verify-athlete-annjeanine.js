// Verify Annjeanine Cuevas/Saetern athlete records
// This script checks for duplicate records and confirms the athlete's data before migration

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyAthleteRecords() {
    console.log('🔍 Verifying Annjeanine athlete records...\n');

    // Query for both potential names in usaw_lifters
    console.log('📋 Checking usaw_lifters table:');
    console.log('='.repeat(70));

    const { data: cuevasLifters, error: cuevasError } = await supabase
        .from('usaw_lifters')
        .select('*')
        .ilike('athlete_name', '%Annjeanine%Cuevas%');

    if (cuevasError) {
        console.error('Error querying Cuevas:', cuevasError);
        return;
    }

    const { data: saeternLifters, error: saeternError } = await supabase
        .from('usaw_lifters')
        .select('*')
        .ilike('athlete_name', '%Annjeanine%Saetern%');

    if (saeternError) {
        console.error('Error querying Saetern:', saeternError);
        return;
    }

    console.log(`\nFound ${cuevasLifters.length} lifter(s) with "Annjeanine Cuevas":`);
    cuevasLifters.forEach(lifter => {
        console.log(`  - lifter_id: ${lifter.lifter_id}`);
        console.log(`    athlete_name: "${lifter.athlete_name}"`);
        console.log(`    internal_id: ${lifter.internal_id}`);
        console.log(`    birth_year: ${lifter.birth_year || 'N/A'}`);
        console.log('');
    });

    console.log(`Found ${saeternLifters.length} lifter(s) with "Annjeanine Saetern":`);
    saeternLifters.forEach(lifter => {
        console.log(`  - lifter_id: ${lifter.lifter_id}`);
        console.log(`    athlete_name: "${lifter.athlete_name}"`);
        console.log(`    internal_id: ${lifter.internal_id}`);
        console.log(`    birth_year: ${lifter.birth_year || 'N/A'}`);
        console.log('');
    });

    // Check if lifter_id 209151 exists
    console.log('🎯 Checking lifter_id 209151:');
    console.log('='.repeat(70));

    const { data: targetLifter, error: targetError } = await supabase
        .from('usaw_lifters')
        .select('*')
        .eq('lifter_id', 209151)
        .single();

    if (targetError) {
        console.error('Error querying lifter_id 209151:', targetError);
    } else if (targetLifter) {
        console.log(`  athlete_name: "${targetLifter.athlete_name}"`);
        console.log(`  internal_id: ${targetLifter.internal_id}`);
        console.log(`  birth_year: ${targetLifter.birth_year || 'N/A'}`);
        console.log(`  gender: ${targetLifter.gender || 'N/A'}`);
    } else {
        console.log('  ❌ lifter_id 209151 not found!');
    }

    // Check meet_results for both names
    console.log('\n📊 Checking usaw_meet_results table:');
    console.log('='.repeat(70));

    const { data: cuevasResults, error: cuevasResultsError } = await supabase
        .from('usaw_meet_results')
        .select('result_id, lifter_id, lifter_name, date, meet_name')
        .ilike('lifter_name', '%Annjeanine%Cuevas%')
        .order('date', { ascending: true });

    if (cuevasResultsError) {
        console.error('Error querying Cuevas results:', cuevasResultsError);
    } else {
        console.log(`\nFound ${cuevasResults.length} meet result(s) with "Annjeanine Cuevas":`);
        if (cuevasResults.length > 0) {
            console.log(`  First result: ${cuevasResults[0].date} - ${cuevasResults[0].meet_name}`);
            console.log(`  Last result: ${cuevasResults[cuevasResults.length - 1].date} - ${cuevasResults[cuevasResults.length - 1].meet_name}`);
            console.log(`  lifter_id(s): ${[...new Set(cuevasResults.map(r => r.lifter_id))].join(', ')}`);
        }
    }

    const { data: saeternResults, error: saeternResultsError } = await supabase
        .from('usaw_meet_results')
        .select('result_id, lifter_id, lifter_name, date, meet_name')
        .ilike('lifter_name', '%Annjeanine%Saetern%')
        .order('date', { ascending: true });

    if (saeternResultsError) {
        console.error('Error querying Saetern results:', saeternResultsError);
    } else {
        console.log(`\nFound ${saeternResults.length} meet result(s) with "Annjeanine Saetern":`);
        if (saeternResults.length > 0) {
            console.log(`  First result: ${saeternResults[0].date} - ${saeternResults[0].meet_name}`);
            console.log(`  Last result: ${saeternResults[saeternResults.length - 1].date} - ${saeternResults[saeternResults.length - 1].meet_name}`);
            console.log(`  lifter_id(s): ${[...new Set(saeternResults.map(r => r.lifter_id))].join(', ')}`);
        }
    }

    // Check results for lifter_id 209151
    console.log('\n🎯 Checking meet_results for lifter_id 209151:');
    console.log('='.repeat(70));

    const { data: targetResults, error: targetResultsError } = await supabase
        .from('usaw_meet_results')
        .select('result_id, lifter_name, date, meet_name, competition_age, wso, club_name')
        .eq('lifter_id', 209151)
        .order('date', { ascending: true });

    if (targetResultsError) {
        console.error('Error querying results for lifter_id 209151:', targetResultsError);
    } else {
        console.log(`\nFound ${targetResults.length} meet result(s) for lifter_id 209151:`);
        if (targetResults.length > 0) {
            console.log(`  First result: ${targetResults[0].date} - ${targetResults[0].meet_name}`);
            console.log(`  Last result: ${targetResults[targetResults.length - 1].date} - ${targetResults[targetResults.length - 1].meet_name}`);
            console.log(`  Current name(s) in results: ${[...new Set(targetResults.map(r => r.lifter_name))].join(', ')}`);
            
            // Check for missing biographical data
            const missingAge = targetResults.filter(r => !r.competition_age).length;
            const missingWso = targetResults.filter(r => !r.wso).length;
            const missingClub = targetResults.filter(r => !r.club_name).length;
            
            console.log(`\n  Missing biographical data:`);
            console.log(`    competition_age: ${missingAge}/${targetResults.length} missing`);
            console.log(`    wso: ${missingWso}/${targetResults.length} missing`);
            console.log(`    club_name: ${missingClub}/${targetResults.length} missing`);
        }
    }

    console.log('\n✅ Verification complete!');
}

verifyAthleteRecords().catch(console.error);
