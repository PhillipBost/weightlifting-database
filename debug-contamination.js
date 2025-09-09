require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function debugContamination() {
    console.log('🐛 Debugging Q-Score Contamination Detection');
    console.log('=============================================');
    
    try {
        // Check for any records with negative ages and qpoints
        console.log('1️⃣ Looking for records with negative ages and qpoints...');
        const { data: negativeAgeRecords, error: negError } = await supabase
            .from('meet_results')
            .select('result_id, lifter_name, competition_age, qpoints, q_youth, q_masters')
            .lt('competition_age', 0)
            .not('qpoints', 'is', null)
            .limit(5);
        
        if (negError) {
            console.error('Error:', negError.message);
        } else {
            console.log(`Found ${negativeAgeRecords.length} records with negative ages and qpoints:`);
            negativeAgeRecords.forEach(record => {
                console.log(`  ID ${record.result_id}: ${record.lifter_name} (age ${record.competition_age}) qpoints=${record.qpoints}`);
            });
        }
        
        // Check for young athletes (ages 1-12) with qpoints
        console.log('\n2️⃣ Looking for young athletes (ages 1-12) with qpoints...');
        const { data: youngRecords, error: youngError } = await supabase
            .from('meet_results')
            .select('result_id, lifter_name, competition_age, qpoints, q_youth, q_masters')
            .gte('competition_age', 1)
            .lte('competition_age', 12)
            .not('qpoints', 'is', null)
            .limit(5);
        
        if (youngError) {
            console.error('Error:', youngError.message);
        } else {
            console.log(`Found ${youngRecords.length} records for ages 1-12 with qpoints:`);
            youngRecords.forEach(record => {
                console.log(`  ID ${record.result_id}: ${record.lifter_name} (age ${record.competition_age}) qpoints=${record.qpoints}`);
            });
        }
        
        // Check 10-20 year olds with regular qpoints instead of q_youth
        console.log('\n3️⃣ Looking for 10-20 year olds with regular qpoints...');
        const { data: youth1020Records, error: youth1020Error } = await supabase
            .from('meet_results')
            .select('result_id, lifter_name, competition_age, qpoints, q_youth, q_masters')
            .gte('competition_age', 10)
            .lte('competition_age', 20)
            .not('qpoints', 'is', null)
            .limit(5);
        
        if (youth1020Error) {
            console.error('Error:', youth1020Error.message);
        } else {
            console.log(`Found ${youth1020Records.length} records for ages 10-20 with qpoints:`);
            youth1020Records.forEach(record => {
                console.log(`  ID ${record.result_id}: ${record.lifter_name} (age ${record.competition_age}) qpoints=${record.qpoints}, q_youth=${record.q_youth}`);
            });
            
            // Try to update one of these records
            if (youth1020Records.length > 0) {
                console.log('\n4️⃣ Testing cleanup of 10-20 year old record...');
                const testRecord = youth1020Records[0];
                
                const { data: updated, error: updateError } = await supabase
                    .from('meet_results')
                    .update({ 
                        qpoints: null,  // Remove regular qpoints
                        q_youth: testRecord.qpoints  // Move to q_youth
                    })
                    .eq('result_id', testRecord.result_id)
                    .select('result_id, lifter_name, competition_age, qpoints, q_youth, q_masters');
                
                if (updateError) {
                    console.error('❌ Update error:', updateError.message);
                } else {
                    console.log('✅ Successfully moved qpoints to q_youth:');
                    console.log('Updated record:', updated[0]);
                }
            }
        }
        
        // Total counts for verification
        console.log('\n5️⃣ Total counts by category...');
        
        const { count: totalQPoints } = await supabase
            .from('meet_results')
            .select('*', { count: 'exact', head: true })
            .not('qpoints', 'is', null);
        
        console.log(`Total records with qpoints: ${totalQPoints}`);
        
        const { count: totalQYouth } = await supabase
            .from('meet_results')
            .select('*', { count: 'exact', head: true })
            .not('q_youth', 'is', null);
        
        console.log(`Total records with q_youth: ${totalQYouth}`);
        
        const { count: totalQMasters } = await supabase
            .from('meet_results')
            .select('*', { count: 'exact', head: true })
            .not('q_masters', 'is', null);
        
        console.log(`Total records with q_masters: ${totalQMasters}`);
        
    } catch (error) {
        console.error('💥 Debug failed:', error.message);
    }
}

if (require.main === module) {
    debugContamination();
}