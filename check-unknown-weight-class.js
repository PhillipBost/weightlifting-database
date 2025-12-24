/**
 * Check how many records have 'Unknown' weight_class after migration
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function checkUnknownWeightClass() {
    console.log('🔍 Checking for records with "Unknown" weight_class...\n');
    
    try {
        // Count records with 'Unknown' weight_class
        const { data: countData, error: countError } = await supabase
            .from('usaw_meet_results')
            .select('result_id', { count: 'exact' })
            .eq('weight_class', 'Unknown');
            
        if (countError) {
            throw countError;
        }
        
        console.log(`📊 Found ${countData.length} records with weight_class = 'Unknown'`);
        
        if (countData.length > 0) {
            // Get some sample records to understand the data
            const { data: sampleData, error: sampleError } = await supabase
                .from('usaw_meet_results')
                .select('result_id, lifter_name, meet_id, meet_name, weight_class, age_category, gender')
                .eq('weight_class', 'Unknown')
                .limit(10);
                
            if (sampleError) {
                throw sampleError;
            }
            
            console.log('\n📋 Sample records with Unknown weight_class:');
            sampleData.forEach((record, index) => {
                console.log(`   ${index + 1}. result_id: ${record.result_id}, lifter: ${record.lifter_name}, meet: ${record.meet_name}, gender: ${record.gender}, age_category: ${record.age_category}`);
            });
            
            console.log('\n🔧 ISSUE IDENTIFIED:');
            console.log('   The constraint migration set NULL/empty weight_class values to "Unknown"');
            console.log('   The surgical-strike-wso-scraper.js script cannot find division codes for "Unknown"');
            console.log('   This is causing the script to skip these records');
            
            console.log('\n💡 SOLUTION OPTIONS:');
            console.log('   1. Update migration to use a different placeholder (like empty string)');
            console.log('   2. Modify surgical strike script to handle "Unknown" weight_class');
            console.log('   3. Revert "Unknown" values back to NULL and modify constraint');
            console.log('   4. Set "Unknown" values to empty string instead');
            
        } else {
            console.log('✅ No records found with "Unknown" weight_class');
            console.log('   The issue may be elsewhere');
        }
        
    } catch (error) {
        console.error('❌ Error checking weight_class data:', error.message);
        throw error;
    }
}

// Run the check
if (require.main === module) {
    checkUnknownWeightClass()
        .then(() => {
            console.log('\n✅ Weight class check completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Weight class check failed:', error.message);
            process.exit(1);
        });
}

module.exports = { checkUnknownWeightClass };