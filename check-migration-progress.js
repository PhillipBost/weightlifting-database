require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkProgress() {
    try {
        // Count how many meet_results now have gender data
        const { count: withGender } = await supabase
            .from('meet_results')
            .select('result_id', { count: 'exact' })
            .not('gender', 'is', null);
        
        // Count total meet_results
        const { count: total } = await supabase
            .from('meet_results')
            .select('result_id', { count: 'exact' });
        
        console.log('Migration progress:');
        console.log(`  Meet results with gender data: ${withGender || 0}`);
        console.log(`  Total meet results: ${total || 0}`);
        console.log(`  Percentage complete: ${((withGender || 0) / (total || 1) * 100).toFixed(1)}%`);
        
        // Show sample migrated data
        const { data: sample } = await supabase
            .from('meet_results')
            .select('lifter_id, lifter_name, gender, birth_year')
            .not('gender', 'is', null)
            .limit(5);
        
        console.log('\nSample migrated data:');
        sample?.forEach((result, i) => {
            console.log(`  ${i+1}. ${result.lifter_name} - Gender: ${result.gender}, Birth Year: ${result.birth_year}`);
        });
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkProgress();