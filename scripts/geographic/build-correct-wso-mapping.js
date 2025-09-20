const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function buildCorrectWSOMapping() {
    console.log('🔧 Building correct state-to-WSO mapping from wso_information table...');
    
    try {
        // Get all WSO information
        const { data: wsos, error } = await supabase
            .from('wso_information')
            .select('name, states, geographic_type');
            
        if (error) throw error;
        
        console.log(`Found ${wsos.length} WSO regions`);
        
        // Build state-to-WSO mapping
        const stateToWSO = {};
        
        wsos.forEach(wso => {
            console.log(`\n${wso.name} (${wso.geographic_type}):`);
            if (wso.states && wso.states.length > 0) {
                wso.states.forEach(state => {
                    console.log(`  ${state} → ${wso.name}`);
                    stateToWSO[state] = wso.name;
                });
            } else {
                console.log(`  No states defined`);
            }
        });
        
        console.log('\n📋 Complete state-to-WSO mapping:');
        Object.entries(stateToWSO)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([state, wso]) => {
                console.log(`  ${state}: ${wso}`);
            });
        
        console.log(`\nMapped ${Object.keys(stateToWSO).length} states to WSO regions`);
        
        // Check for missing states
        const ALL_US_STATES = [
            'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California',
            'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
            'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
            'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
            'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
            'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
            'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
            'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
            'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
            'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
            'District of Columbia'
        ];
        
        const missingStates = ALL_US_STATES.filter(state => !stateToWSO[state]);
        if (missingStates.length > 0) {
            console.log(`\n⚠️  States not mapped to any WSO: ${missingStates.join(', ')}`);
        }
        
        return stateToWSO;
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

buildCorrectWSOMapping();