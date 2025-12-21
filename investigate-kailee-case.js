const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function investigateKailee() {
    console.log('🔍 Investigating Kailee Bingman case...');
    
    try {
        // Check existing athlete record
        const { data: existing, error: existingError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('lifter_id', 1003800);
        
        if (existingError) {
            console.log('❌ Error fetching existing athlete:', existingError.message);
            return;
        }
        
        console.log('📋 Existing athlete records with ID 1003800:');
        if (existing && existing.length > 0) {
            existing.forEach(record => {
                console.log(`   ID: ${record.lifter_id}, Name: "${record.athlete_name}", Internal_ID: ${record.internal_id}`);
            });
        } else {
            console.log('   No records found with ID 1003800');
        }
        
        // Check new fallback record
        const { data: fallback, error: fallbackError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('lifter_id', 200587)
            .single();
        
        if (!fallbackError && fallback) {
            console.log('📋 Fallback athlete record (ID: 200587):');
            console.log('   Name:', fallback.athlete_name);
            console.log('   Internal_ID:', fallback.internal_id);
        }
        
        // Check for name-based matches
        const { data: nameMatches, error: nameError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .ilike('athlete_name', '%Kailee%Bingman%');
        
        console.log('📋 All Kailee Bingman name matches:');
        nameMatches?.forEach(match => {
            console.log(`   ID: ${match.lifter_id}, Name: "${match.athlete_name}", Internal_ID: ${match.internal_id}`);
        });
        
        // Check meet results
        const { data: meetResults, error: meetError } = await supabase
            .from('usaw_meet_results')
            .select('meet_id, lifter_id, lifter_name')
            .eq('meet_id', 2357)
            .ilike('lifter_name', '%Kailee%Bingman%');
        
        // Check Sport80 URL for existing athlete
        if (nameMatches && nameMatches.length > 0) {
            const existingAthlete = nameMatches.find(a => a.internal_id === 38184);
            if (existingAthlete) {
                console.log('🌐 Sport80 URL for existing athlete:');
                console.log(`   https://usaweightlifting.sport80.com/public/rankings/member/${existingAthlete.internal_id}`);
            }
        }
        
        console.log('📊 Meet 2357 results for Kailee Bingman:');
        meetResults?.forEach(result => {
            console.log(`   Lifter_ID: ${result.lifter_id}, Name: "${result.lifter_name}"`);
        });
        
    } catch (error) {
        console.error('💥 Investigation failed:', error.message);
    }
}

investigateKailee();