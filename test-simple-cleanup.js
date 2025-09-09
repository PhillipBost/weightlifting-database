require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function testSimpleCleanup() {
    console.log('🧪 Testing Simple Q-Score Cleanup');
    console.log('=================================');
    
    try {
        // First, let's find some specific records that should be cleaned
        console.log('1️⃣ Finding records with wrong Q-scores...');
        
        const { data: wrongRecords, error } = await supabase
            .from('meet_results')
            .select('result_id, lifter_name, competition_age, qpoints, q_youth, q_masters')
            .lte('competition_age', 9)
            .not('qpoints', 'is', null)
            .limit(5);
        
        if (error) {
            throw new Error(`Query error: ${error.message}`);
        }
        
        console.log(`Found ${wrongRecords.length} sample records for ages ≤9 with qpoints:`);
        wrongRecords.forEach(record => {
            console.log(`  ID ${record.result_id}: ${record.lifter_name} (age ${record.competition_age}) has qpoints=${record.qpoints}`);
        });
        
        if (wrongRecords.length > 0) {
            // Test cleaning one specific record
            console.log('\n2️⃣ Testing cleanup of one specific record...');
            const testRecord = wrongRecords[0];
            
            const { data: cleanedData, error: cleanError } = await supabase
                .from('meet_results')
                .update({ qpoints: null })
                .eq('result_id', testRecord.result_id)
                .select();
            
            if (cleanError) {
                console.error('❌ Cleanup error:', cleanError.message);
            } else {
                console.log(`✅ Successfully cleaned record ID ${testRecord.result_id}`);
                console.log('Updated record:', cleanedData[0]);
            }
        } else {
            console.log('⚠️ No records found that need cleaning');
        }
        
    } catch (error) {
        console.error('💥 Test failed:', error.message);
    }
}

if (require.main === module) {
    testSimpleCleanup();
}