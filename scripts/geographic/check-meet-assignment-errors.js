const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkMeetAssignmentErrors() {
    console.log('🔍 Checking meet WSO assignment errors...');
    
    try {
        // Get valid WSO names
        const { data: validWSOs } = await supabase
            .from('wso_information')
            .select('name');
        const validWSONames = validWSOs.map(wso => wso.name);
        
        // Check current meet assignments
        const { data: meets } = await supabase
            .from('meets')
            .select('meet_id, Meet, address, wso_geography')
            .not('wso_geography', 'is', null);
            
        console.log(`Checking ${meets.length} assigned meets...`);
        
        // Find invalid WSO assignments
        const invalidMeets = meets.filter(meet => !validWSONames.includes(meet.wso_geography));
        
        console.log(`\n❌ Invalid meet assignments: ${invalidMeets.length}`);
        if (invalidMeets.length > 0) {
            const invalidGroups = {};
            invalidMeets.forEach(meet => {
                if (!invalidGroups[meet.wso_geography]) {
                    invalidGroups[meet.wso_geography] = [];
                }
                invalidGroups[meet.wso_geography].push(meet);
            });
            
            Object.entries(invalidGroups).forEach(([invalidWSO, meetList]) => {
                console.log(`\n"${invalidWSO}" (${meetList.length} meets):`);
                meetList.slice(0, 3).forEach(meet => {
                    console.log(`  - ${meet.Meet}`);
                    console.log(`    ${meet.address || 'No address'}`);
                });
                if (meetList.length > 3) {
                    console.log(`    ... and ${meetList.length - 3} more`);
                }
            });
        }
        
        // Check for specific issues like West Virginia in DMV
        console.log('\n🔍 Checking for specific assignment issues:');
        
        // West Virginia meets in DMV
        const { data: dmvMeets } = await supabase
            .from('meets')
            .select('meet_id, Meet, address, wso_geography')
            .eq('wso_geography', 'DMV');
        const wvInDMV = dmvMeets?.filter(meet => 
            meet.address && meet.address.toLowerCase().includes('west virginia')
        ) || [];
        console.log(`West Virginia meets in DMV: ${wvInDMV.length}`);
        
        // Texas meets in Georgia
        const { data: gaMeets } = await supabase
            .from('meets')
            .select('meet_id, Meet, address, wso_geography')
            .eq('wso_geography', 'Georgia');
        const txInGA = gaMeets?.filter(meet => 
            meet.address && meet.address.toLowerCase().includes('texas')
        ) || [];
        console.log(`Texas meets in Georgia: ${txInGA.length}`);
        
        if (wvInDMV.length > 0) {
            console.log('\nWest Virginia meets incorrectly in DMV:');
            wvInDMV.slice(0, 3).forEach(meet => {
                console.log(`  - ${meet.Meet}: ${meet.address}`);
            });
        }
        
        if (txInGA.length > 0) {
            console.log('\nTexas meets incorrectly in Georgia:');
            txInGA.slice(0, 3).forEach(meet => {
                console.log(`  - ${meet.Meet}: ${meet.address}`);
            });
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkMeetAssignmentErrors();