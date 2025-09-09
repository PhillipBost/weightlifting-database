require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function checkDatabaseSchema() {
    console.log('🔍 Checking Database Schema for Q-score columns');
    console.log('================================================');
    
    try {
        // Get a sample record to see available columns
        const { data: sampleRecord, error } = await supabase
            .from('meet_results')
            .select('*')
            .limit(1)
            .single();
        
        if (error) {
            throw new Error(`Error fetching sample record: ${error.message}`);
        }
        
        console.log('📋 Available columns in meet_results table:');
        const columns = Object.keys(sampleRecord);
        const qColumns = columns.filter(col => col.toLowerCase().includes('q'));
        
        console.log('All Q-related columns:');
        qColumns.forEach(col => {
            console.log(`  - ${col}: ${sampleRecord[col]}`);
        });
        
        // Check if q_youth and q_masters columns exist
        const hasQYouth = columns.includes('q_youth');
        const hasQMasters = columns.includes('q_masters');
        const hasQPoints = columns.includes('qpoints');
        
        console.log('\n📊 Q-score column availability:');
        console.log(`  qpoints: ${hasQPoints ? '✅' : '❌'}`);
        console.log(`  q_youth: ${hasQYouth ? '✅' : '❌'}`);
        console.log(`  q_masters: ${hasQMasters ? '✅' : '❌'}`);
        
        // Test simple update if columns exist
        if (hasQPoints) {
            console.log('\n🧪 Testing simple update query...');
            const { count, error: updateError } = await supabase
                .from('meet_results')
                .update({ qpoints: null })
                .lte('competition_age', 9)
                .not('qpoints', 'is', null);
            
            if (updateError) {
                console.log('❌ Update error:', updateError.message);
            } else {
                console.log(`✅ Update would affect ${count || 0} records`);
            }
        }
        
    } catch (error) {
        console.error('💥 Schema check failed:', error.message);
    }
}

if (require.main === module) {
    checkDatabaseSchema();
}