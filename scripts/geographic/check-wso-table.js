const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkWSOTable() {
    console.log('📋 Checking wso_information table for actual WSO regions...');
    
    try {
        const { data: wsos, error } = await supabase
            .from('wso_information')
            .select('*')
            .order('wso_name');
            
        if (error) {
            console.error('Error:', error);
            return;
        }
        
        console.log(`Found ${wsos.length} WSO regions:`);
        wsos.forEach((wso, index) => {
            console.log(`${index + 1}. ${wso.wso_name}`);
        });
        
        return wsos;
        
    } catch (error) {
        console.error('Error:', error);
    }
}

checkWSOTable();