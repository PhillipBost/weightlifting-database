const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function resetAllClubs() {
    console.log('🔄 Resetting ALL club assignments to null...');
    
    try {
        const { data, error } = await supabase
            .from('clubs')
            .update({ wso_geography: null })
            .neq('wso_geography', null);
            
        if (error) throw error;
        
        console.log('✅ All club assignments reset to null');
        
        // Verify the reset
        const { data: remaining, error: countError } = await supabase
            .from('clubs')
            .select('wso_geography')
            .not('wso_geography', 'is', null);
            
        if (countError) throw countError;
        
        console.log(`Verification: ${remaining.length} clubs still have assignments`);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

resetAllClubs();