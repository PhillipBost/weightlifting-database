const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function diagnoseKaileeMatchingFailure() {
    console.log('🔍 Diagnosing why Kailee Bingman matching failed...');
    
    try {
        // Simulate the matching process that should have occurred
        const lifterName = "Kailee Bingman";
        
        console.log('📝 Step 1: Name-based query');
        const { data: nameMatches, error: nameError } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('athlete_name', lifterName);
        
        console.log(`   Query: athlete_name = "${lifterName}"`);
        console.log(`   Results: ${nameMatches?.length || 0} matches`);
        
        if (nameMatches && nameMatches.length > 0) {
            nameMatches.forEach(match => {
                console.log(`   - ID: ${match.lifter_id}, Name: "${match.athlete_name}", Internal_ID: ${match.internal_id}`);
            });
            
            if (nameMatches.length === 1) {
                console.log('✅ Single match found - should have been used');
                console.log('🔍 Step 2: Tier 1 verification should have been attempted');
                
                const athlete = nameMatches[0];
                console.log(`   Target athlete: ${athlete.athlete_name} (ID: ${athlete.lifter_id})`);
                console.log(`   Internal_ID: ${athlete.internal_id}`);
                console.log(`   Meet: 2357`);
                
                // Check if this athlete has results in meet 2357 already
                const { data: existingResults, error: existingError } = await supabase
                    .from('usaw_meet_results')
                    .select('meet_id, lifter_id, lifter_name')
                    .eq('lifter_id', athlete.lifter_id)
                    .eq('meet_id', 2357);
                
                console.log(`   Existing results in meet 2357: ${existingResults?.length || 0}`);
                
                if (existingResults && existingResults.length > 0) {
                    console.log('⚠️ Athlete already has results in this meet - this might explain the issue');
                } else {
                    console.log('❓ No existing results - verification should have proceeded');
                }
            }
        } else {
            console.log('❌ No exact name matches found');
            
            // Try case-insensitive search
            console.log('📝 Step 1b: Case-insensitive name query');
            const { data: iLikeMatches, error: iLikeError } = await supabase
                .from('usaw_lifters')
                .select('lifter_id, athlete_name, internal_id')
                .ilike('athlete_name', lifterName);
            
            console.log(`   Query: athlete_name ILIKE "${lifterName}"`);
            console.log(`   Results: ${iLikeMatches?.length || 0} matches`);
            
            if (iLikeMatches && iLikeMatches.length > 0) {
                iLikeMatches.forEach(match => {
                    console.log(`   - ID: ${match.lifter_id}, Name: "${match.athlete_name}", Internal_ID: ${match.internal_id}`);
                });
            }
        }
        
        // Check what actually happened in the database
        console.log('📊 Step 3: What actually happened');
        const { data: actualResult, error: actualError } = await supabase
            .from('usaw_meet_results')
            .select('meet_id, lifter_id, lifter_name')
            .eq('meet_id', 2357)
            .ilike('lifter_name', '%Kailee%Bingman%');
        
        console.log('   Actual meet result created:');
        if (actualResult && actualResult.length > 0) {
            actualResult.forEach(result => {
                console.log(`   - Lifter_ID: ${result.lifter_id}, Name: "${result.lifter_name}"`);
            });
        }
        
        // Analysis
        console.log('\n🔍 ANALYSIS:');
        if (nameMatches && nameMatches.length === 1) {
            console.log('❌ MATCHING FAILURE: Single exact match existed but was not used');
            console.log('   Expected: Use existing lifter_id', nameMatches[0].lifter_id);
            console.log('   Actual: Created new lifter_id', actualResult?.[0]?.lifter_id);
            console.log('   Root cause: Enhanced matching logic failed to find/use existing athlete');
        }
        
    } catch (error) {
        console.error('💥 Diagnosis failed:', error.message);
    }
}

diagnoseKaileeMatchingFailure();