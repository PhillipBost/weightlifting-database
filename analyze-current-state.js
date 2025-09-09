require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function analyzeCurrentState() {
    console.log('📊 Analyzing Current Q-Score State');
    console.log('===================================');
    
    try {
        // Get sample records by age group to see current distribution
        console.log('📋 Sample records by age group:\n');
        
        // Ages 5-9 (should have no Q-scores)
        console.log('Ages 5-9 (should have no Q-scores):');
        const { data: ages59, error: error59 } = await supabase
            .from('meet_results')
            .select('lifter_name, competition_age, qpoints, q_youth, q_masters')
            .gte('competition_age', 5)
            .lte('competition_age', 9)
            .limit(3);
        
        if (ages59 && ages59.length > 0) {
            ages59.forEach(r => {
                console.log(`  ${r.lifter_name} (age ${r.competition_age}): qpoints=${r.qpoints || 'null'}, q_youth=${r.q_youth || 'null'}, q_masters=${r.q_masters || 'null'}`);
            });
        } else {
            console.log('  No records found for ages 5-9');
        }
        
        // Ages 10-20 (should have only q_youth)
        console.log('\nAges 10-20 (should have only q_youth):');
        const { data: ages1020, error: error1020 } = await supabase
            .from('meet_results')
            .select('lifter_name, competition_age, qpoints, q_youth, q_masters')
            .gte('competition_age', 10)
            .lte('competition_age', 20)
            .limit(3);
        
        if (ages1020 && ages1020.length > 0) {
            ages1020.forEach(r => {
                console.log(`  ${r.lifter_name} (age ${r.competition_age}): qpoints=${r.qpoints || 'null'}, q_youth=${r.q_youth || 'null'}, q_masters=${r.q_masters || 'null'}`);
            });
        }
        
        // Ages 21-30 (should have only qpoints)
        console.log('\nAges 21-30 (should have only qpoints):');
        const { data: ages2130, error: error2130 } = await supabase
            .from('meet_results')
            .select('lifter_name, competition_age, qpoints, q_youth, q_masters')
            .gte('competition_age', 21)
            .lte('competition_age', 30)
            .limit(3);
        
        if (ages2130 && ages2130.length > 0) {
            ages2130.forEach(r => {
                console.log(`  ${r.lifter_name} (age ${r.competition_age}): qpoints=${r.qpoints || 'null'}, q_youth=${r.q_youth || 'null'}, q_masters=${r.q_masters || 'null'}`);
            });
        }
        
        // Ages 31+ (should have only q_masters)
        console.log('\nAges 31+ (should have only q_masters):');
        const { data: ages31plus, error: error31plus } = await supabase
            .from('meet_results')
            .select('lifter_name, competition_age, qpoints, q_youth, q_masters')
            .gte('competition_age', 31)
            .limit(3);
        
        if (ages31plus && ages31plus.length > 0) {
            ages31plus.forEach(r => {
                console.log(`  ${r.lifter_name} (age ${r.competition_age}): qpoints=${r.qpoints || 'null'}, q_youth=${r.q_youth || 'null'}, q_masters=${r.q_masters || 'null'}`);
            });
        }
        
        // Check for actual violations
        console.log('\n🔍 Checking for actual Q-score violations:\n');
        
        // Multiple Q-scores for same record (should be mutually exclusive)
        const { data: multipleQScores, error: multiError } = await supabase
            .from('meet_results')
            .select('lifter_name, competition_age, qpoints, q_youth, q_masters')
            .not('qpoints', 'is', null)
            .not('q_youth', 'is', null)
            .limit(5);
        
        console.log(`Records with both qpoints AND q_youth: ${multipleQScores?.length || 0}`);
        multipleQScores?.forEach(r => {
            console.log(`  ${r.lifter_name} (age ${r.competition_age}): qpoints=${r.qpoints}, q_youth=${r.q_youth}`);
        });
        
        const { data: multipleQMasters, error: masterError } = await supabase
            .from('meet_results')
            .select('lifter_name, competition_age, qpoints, q_youth, q_masters')
            .not('qpoints', 'is', null)
            .not('q_masters', 'is', null)
            .limit(5);
        
        console.log(`\nRecords with both qpoints AND q_masters: ${multipleQMasters?.length || 0}`);
        multipleQMasters?.forEach(r => {
            console.log(`  ${r.lifter_name} (age ${r.competition_age}): qpoints=${r.qpoints}, q_masters=${r.q_masters}`);
        });
        
        // Summary statistics
        console.log('\n📊 Current Q-score distribution:');
        
        const { count: totalRecords } = await supabase
            .from('meet_results')
            .select('*', { count: 'exact', head: true });
        
        const { count: recordsWithQPoints } = await supabase
            .from('meet_results')
            .select('*', { count: 'exact', head: true })
            .not('qpoints', 'is', null);
        
        const { count: recordsWithQYouth } = await supabase
            .from('meet_results')
            .select('*', { count: 'exact', head: true })
            .not('q_youth', 'is', null);
        
        const { count: recordsWithQMasters } = await supabase
            .from('meet_results')
            .select('*', { count: 'exact', head: true })
            .not('q_masters', 'is', null);
        
        console.log(`Total records: ${totalRecords}`);
        console.log(`Records with qpoints: ${recordsWithQPoints} (${((recordsWithQPoints/totalRecords)*100).toFixed(1)}%)`);
        console.log(`Records with q_youth: ${recordsWithQYouth} (${((recordsWithQYouth/totalRecords)*100).toFixed(1)}%)`);
        console.log(`Records with q_masters: ${recordsWithQMasters} (${((recordsWithQMasters/totalRecords)*100).toFixed(1)}%)`);
        
        const totalWithQScores = recordsWithQPoints + recordsWithQYouth + recordsWithQMasters;
        console.log(`\nTotal Q-score assignments: ${totalWithQScores}`);
        
        if (totalWithQScores > totalRecords) {
            const overlap = totalWithQScores - totalRecords;
            console.log(`🚨 Overlap detected: ${overlap} records have multiple Q-score types`);
        } else {
            console.log('✅ No overlap detected - Q-scores appear mutually exclusive');
        }
        
    } catch (error) {
        console.error('💥 Analysis failed:', error.message);
    }
}

if (require.main === module) {
    analyzeCurrentState();
}