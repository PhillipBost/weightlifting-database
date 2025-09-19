require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function verifyMigration() {
    console.log('🔍 VERIFYING NATIONAL_RANK MIGRATION');
    console.log('='.repeat(50));
    
    // 1. Check how many lifters had national_rank data originally
    const { count: liftersWithRank } = await supabase
        .from('lifters')
        .select('lifter_id', { count: 'exact' })
        .not('national_rank', 'is', null);
    
    console.log(`📊 Lifters with national_rank in lifters table: ${liftersWithRank || 0}`);
    
    // 2. Check how many meet_results now have national_rank data
    const { count: resultsWithRank } = await supabase
        .from('meet_results')
        .select('result_id', { count: 'exact' })
        .not('national_rank', 'is', null);
    
    console.log(`📊 Meet_results with national_rank data: ${resultsWithRank || 0}`);
    
    // 3. Show sample of migrated data
    const { data: sample } = await supabase
        .from('meet_results')
        .select('lifter_id, lifter_name, national_rank, wso')
        .not('national_rank', 'is', null)
        .order('national_rank', { ascending: true })
        .limit(10);
    
    console.log('\n✅ Sample meet_results with national_rank (top 10 ranked):');
    sample?.forEach((result, i) => {
        console.log(`  ${i+1}. ${result.lifter_name} - Rank #${result.national_rank} (WSO: ${result.wso})`);
    });
    
    // 4. Check data integrity - make sure we didn't lose any data
    console.log('\n🔍 DATA INTEGRITY CHECK:');
    
    // Get a sample lifter with national_rank and check if all their results got updated
    const { data: sampleLifter } = await supabase
        .from('lifters')
        .select('lifter_id, athlete_name, national_rank')
        .not('national_rank', 'is', null)
        .limit(1)
        .single();
    
    if (sampleLifter) {
        const { data: lifterResults } = await supabase
            .from('meet_results')
            .select('result_id, meet_name, national_rank')
            .eq('lifter_id', sampleLifter.lifter_id);
        
        const resultsWithRankCount = lifterResults?.filter(r => r.national_rank !== null).length || 0;
        const totalResults = lifterResults?.length || 0;
        
        console.log(`  Sample: ${sampleLifter.athlete_name} (lifter_id ${sampleLifter.lifter_id})`);
        console.log(`    Original national_rank: ${sampleLifter.national_rank}`);
        console.log(`    Total meet results: ${totalResults}`);
        console.log(`    Results with national_rank: ${resultsWithRankCount}`);
        
        if (resultsWithRankCount === totalResults && resultsWithRankCount > 0) {
            console.log('    ✅ All results properly updated with national_rank');
        } else if (totalResults === 0) {
            console.log('    ⚠️  No meet results found for this lifter');
        } else {
            console.log('    ❌ Some results missing national_rank data');
        }
    }
    
    // 5. Check all three migrated columns
    console.log('\n📋 COMPLETE SCHEMA VERIFICATION:');
    const { data: schemaCheck } = await supabase
        .from('meet_results')
        .select('gender, birth_year, national_rank')
        .not('gender', 'is', null)
        .not('birth_year', 'is', null) 
        .not('national_rank', 'is', null)
        .limit(1);
        
    if (schemaCheck && schemaCheck.length > 0) {
        console.log('✅ All three migrated columns (gender, birth_year, national_rank) have data');
        console.log(`   Sample: Gender=${schemaCheck[0].gender}, Birth Year=${schemaCheck[0].birth_year}, National Rank=${schemaCheck[0].national_rank}`);
    } else {
        console.log('⚠️  Some migrated columns may be missing data');
    }
}

verifyMigration().catch(console.error);