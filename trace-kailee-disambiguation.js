const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function traceKaileeDisambiguation() {
    console.log('🔍 Tracing Kailee Bingman disambiguation logic...');
    
    try {
        const lifterName = "Kailee Bingman";
        const targetMeetId = 2357;
        
        // Step 1: Name-based query (what the system did)
        console.log('📝 Step 1: Name-based query');
        const { data: nameMatches, error: nameError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('athlete_name', lifterName);
        
        console.log(`   Found ${nameMatches?.length || 0} matches for "${lifterName}"`);
        nameMatches?.forEach(match => {
            console.log(`   - ID: ${match.lifter_id}, Name: "${match.athlete_name}", Internal_ID: ${match.internal_id}`);
        });
        
        if (nameMatches && nameMatches.length > 1) {
            console.log('🔍 Step 2: Multiple matches - disambiguation required');
            console.log('   Enhanced system should have used Tier 1 verification');
            
            // Simulate what Tier 1 verification should have done
            for (const candidate of nameMatches) {
                if (candidate.internal_id) {
                    console.log(`\\n   🎯 Checking candidate ${candidate.lifter_id} (internal_id: ${candidate.internal_id})`);
                    
                    // This would be done by visiting Sport80 member page
                    console.log(`   🌐 Would visit: https://usaweightlifting.sport80.com/public/rankings/member/${candidate.internal_id}`);
                    console.log(`   🔍 Would check if meet ${targetMeetId} appears in their meet history`);
                    
                    // Check if this athlete already has results in the target meet
                    const { data: existingResults, error: existingError } = await supabase
                        .from('usaw_meet_results')
                        .select('meet_id, lifter_id, lifter_name, date')
                        .eq('lifter_id', candidate.lifter_id)
                        .eq('meet_id', targetMeetId);
                    
                    if (existingResults && existingResults.length > 0) {
                        console.log(`   ⚠️ Candidate ${candidate.lifter_id} already has ${existingResults.length} result(s) in meet ${targetMeetId}`);
                        console.log(`   📅 Existing result date: ${existingResults[0].date}`);
                    } else {
                        console.log(`   ✅ Candidate ${candidate.lifter_id} has no existing results in meet ${targetMeetId}`);
                        console.log(`   🎯 This should be the correct match for new result`);
                    }
                } else {
                    console.log(`\\n   ❓ Checking candidate ${candidate.lifter_id} (no internal_id)`);
                    console.log(`   🔍 Would attempt Sport80 search for internal_id`);
                }
            }
        }
        
        // Check what the system actually did
        console.log('\\n📊 What actually happened:');
        const { data: actualResult, error: actualError } = await supabase
            .from('usaw_meet_results')
            .select('meet_id, lifter_id, lifter_name, date')
            .eq('meet_id', targetMeetId)
            .ilike('lifter_name', '%Kailee%Bingman%');
        
        if (actualResult && actualResult.length > 0) {
            actualResult.forEach(result => {
                console.log(`   Created result: Lifter_ID ${result.lifter_id}, Name "${result.lifter_name}", Date: ${result.date}`);
            });
        }
        
        // Root cause analysis
        console.log('\\n🔍 ROOT CAUSE ANALYSIS:');
        console.log('❌ DISAMBIGUATION FAILURE');
        console.log('   Expected: System should disambiguate between 2 candidates using Tier 1 verification');
        console.log('   Actual: System created new fallback record instead of disambiguating');
        console.log('   Issue: Enhanced matching logic failed at disambiguation step');
        
        if (nameMatches && nameMatches.length === 2) {
            const existingCandidate = nameMatches.find(m => m.internal_id === 38184);
            const fallbackCandidate = nameMatches.find(m => m.internal_id === null);
            
            if (existingCandidate && fallbackCandidate) {
                console.log('\\n📋 Candidate Analysis:');
                console.log(`   Candidate A: ID ${existingCandidate.lifter_id}, Internal_ID ${existingCandidate.internal_id} (SHOULD BE USED)`);
                console.log(`   Candidate B: ID ${fallbackCandidate.lifter_id}, Internal_ID ${fallbackCandidate.internal_id} (FALLBACK RECORD)`);
                console.log('   The system should have chosen Candidate A via Tier 1 verification');
            }
        }
        
    } catch (error) {
        console.error('💥 Trace failed:', error.message);
    }
}

traceKaileeDisambiguation();