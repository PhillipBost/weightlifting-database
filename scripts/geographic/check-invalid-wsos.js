const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function checkInvalidWSOs() {
    console.log('🔍 Checking for invalid WSO assignments...');
    
    // The actual 25 WSO regions (not all 50 states)
    const VALID_WSOS = [
        'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California North Central', 'California South',
        'Colorado', 'Connecticut', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 
        'Indiana', 'Iowa-Nebraska', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
        'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana',
        'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
        'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pacific Northwest', 'Pennsylvania',
        'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
        'Vermont', 'Virginia', 'West Virginia', 'Wisconsin', 'Wyoming'
    ];
    
    // Get all current WSO assignments
    const { data: allClubs } = await supabase
        .from('clubs')
        .select('wso_geography')
        .not('wso_geography', 'is', null);
        
    const wsoCount = {};
    allClubs.forEach(club => {
        wsoCount[club.wso_geography] = (wsoCount[club.wso_geography] || 0) + 1;
    });
    
    console.log('\\nChecking assignments against valid WSO list...');
    
    const invalidWSOs = [];
    Object.keys(wsoCount).forEach(wso => {
        if (!VALID_WSOS.includes(wso)) {
            invalidWSOs.push(wso);
            console.log(`❌ INVALID: "${wso}" (${wsoCount[wso]} clubs)`);
        }
    });
    
    if (invalidWSOs.length === 0) {
        console.log('✅ All WSO assignments are valid!');
    } else {
        console.log(`\\nFound ${invalidWSOs.length} invalid WSO assignments:`);
        
        for (const invalidWSO of invalidWSOs) {
            const { data: clubs } = await supabase
                .from('clubs')
                .select('club_name, address')
                .eq('wso_geography', invalidWSO);
                
            console.log(`\\n"${invalidWSO}" clubs:`);
            clubs.forEach(club => {
                console.log(`  - ${club.club_name}`);
                console.log(`    ${club.address}`);
            });
        }
    }
}

checkInvalidWSOs();