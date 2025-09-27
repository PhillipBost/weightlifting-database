require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function fixTennesseeCarolina() {
    console.log('🔧 Fixing Tennessee meets incorrectly assigned to Carolina...');
    
    try {
        // Get Tennessee meets currently assigned to Carolina
        const { data: incorrectMeets, error1 } = await supabase
            .from('meets')
            .select('meet_id, Meet, latitude, longitude, city, state')
            .eq('wso_geography', 'Carolina')
            .eq('state', 'TN');
        
        if (error1) {
            throw new Error(`Failed to fetch meets: ${error1.message}`);
        }
        
        if (!incorrectMeets || incorrectMeets.length === 0) {
            console.log('✅ No Tennessee meets found incorrectly assigned to Carolina');
            return;
        }
        
        console.log(`Found ${incorrectMeets.length} Tennessee meets to fix:`);
        
        for (const meet of incorrectMeets) {
            console.log(`\n🔧 Fixing: "${meet.Meet}" (ID: ${meet.meet_id})`);
            
            // Update meets table
            const { error: updateError } = await supabase
                .from('meets')
                .update({ wso_geography: 'Tennessee-Kentucky' })
                .eq('meet_id', meet.meet_id);
            
            if (updateError) {
                console.error(`❌ Failed to update meet ${meet.meet_id}: ${updateError.message}`);
                continue;
            }
            
            console.log(`✅ Updated meets table for meet ${meet.meet_id}`);
            
            // Update meet_results table  
            const { error: resultError } = await supabase
                .from('meet_results')
                .update({ wso: 'Tennessee-Kentucky' })
                .eq('meet_id', meet.meet_id);
            
            if (resultError) {
                console.error(`❌ Failed to update meet_results for ${meet.meet_id}: ${resultError.message}`);
            } else {
                console.log(`✅ Updated meet_results for meet ${meet.meet_id}`);
            }
        }
        
        console.log('\n✅ Tennessee-Carolina fix complete!');
        
    } catch (error) {
        console.error('❌ Fix failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    fixTennesseeCarolina();
}