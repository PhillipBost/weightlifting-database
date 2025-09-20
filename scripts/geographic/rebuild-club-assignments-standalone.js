const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Self-contained state extraction function
function extractStateFromAddress(address) {
    if (!address) return null;
    
    const US_STATES = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
        'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
        'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
        'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
        'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
        'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
        'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
        'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
        'DC': 'District of Columbia'
    };
    
    const DIRECTIONAL_ABBREVS = ['NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];
    
    // First, look for full state names (highest priority)
    for (const fullName of Object.values(US_STATES)) {
        const namePattern = new RegExp(`\\b${fullName.replace(/\\s/g, '\\s+')}\\b`, 'i');
        if (namePattern.test(address)) {
            return fullName;
        }
    }
    
    // Then look for state abbreviations (with proper context filtering)
    for (const [abbrev, fullName] of Object.entries(US_STATES)) {
        if (DIRECTIONAL_ABBREVS.includes(abbrev)) {
            const contextPattern = new RegExp(`,\\s*${abbrev}\\s+|${abbrev}\\s+\\d{5}`, 'i');
            if (contextPattern.test(address)) {
                return fullName;
            }
        } else {
            const abbrevPattern = new RegExp(`\\b${abbrev}\\b|,\\s*${abbrev}\\b|\\s${abbrev}$`, 'i');
            if (abbrevPattern.test(address)) {
                return fullName;
            }
        }
    }
    
    return null;
}

// Self-contained WSO assignment function
function assignWSO(state, address) {
    if (!state) return null;
    
    const WSO_ASSIGNMENTS = {
        'Alabama': 'Alabama',
        'Alaska': 'Alaska',
        'Arizona': 'Arizona',
        'Arkansas': 'Arkansas',
        'California': 'California North Central', // Default, will be refined
        'Colorado': 'Colorado',
        'Connecticut': 'Connecticut',
        'Delaware': 'Delaware',
        'Florida': 'Florida',
        'Georgia': 'Georgia',
        'Hawaii': 'Hawaii',
        'Idaho': 'Idaho',
        'Illinois': 'Illinois',
        'Indiana': 'Indiana',
        'Iowa': 'Iowa-Nebraska',
        'Kansas': 'Kansas',
        'Kentucky': 'Kentucky',
        'Louisiana': 'Louisiana',
        'Maine': 'Maine',
        'Maryland': 'Maryland',
        'Massachusetts': 'Massachusetts',
        'Michigan': 'Michigan',
        'Minnesota': 'Minnesota',
        'Mississippi': 'Mississippi',
        'Missouri': 'Missouri',
        'Montana': 'Montana',
        'Nebraska': 'Iowa-Nebraska',
        'Nevada': 'Nevada',
        'New Hampshire': 'New Hampshire',
        'New Jersey': 'New Jersey',
        'New Mexico': 'New Mexico',
        'New York': 'New York',
        'North Carolina': 'North Carolina',
        'North Dakota': 'North Dakota',
        'Ohio': 'Ohio',
        'Oklahoma': 'Oklahoma',
        'Oregon': 'Oregon',
        'Pennsylvania': 'Pennsylvania',
        'Rhode Island': 'Rhode Island',
        'South Carolina': 'South Carolina',
        'South Dakota': 'South Dakota',
        'Tennessee': 'Tennessee',
        'Texas': 'Texas',
        'Utah': 'Utah',
        'Vermont': 'Vermont',
        'Virginia': 'Virginia',
        'Washington': 'Pacific Northwest',
        'West Virginia': 'West Virginia',
        'Wisconsin': 'Wisconsin',
        'Wyoming': 'Wyoming',
        'District of Columbia': 'Maryland'
    };
    
    return WSO_ASSIGNMENTS[state] || null;
}

async function rebuildAllClubAssignments() {
    console.log('🔄 Rebuilding all club WSO assignments from scratch...');
    console.log('Using standalone functions to avoid import issues\\n');
    
    try {
        // Test the function first
        console.log('🧪 Testing state extraction function:');
        const testAddress = '123 Main St, Sacramento, California';
        const testResult = extractStateFromAddress(testAddress);
        console.log(`  "${testAddress}" → ${testResult || 'None'}\\n`);
        
        if (!testResult) {
            console.log('❌ State extraction test failed! Aborting rebuild.');
            return;
        }
        
        // Get all clubs
        const { data: clubs, error } = await supabase
            .from('clubs')
            .select('club_name, address');
            
        if (error) throw error;
        
        console.log(`Processing ${clubs.length} clubs...`);
        
        let assigned = 0;
        let failed = 0;
        const assignments = [];
        
        for (let i = 0; i < clubs.length; i++) {
            const club = clubs[i];
            
            if (i % 50 === 0) {
                console.log(`  Progress: ${i}/${clubs.length} clubs processed`);
            }
            
            // Try to extract state from address
            const extractedState = extractStateFromAddress(club.address);
            
            if (extractedState) {
                const wso = assignWSO(extractedState, club.address);
                if (wso) {
                    // Update the database
                    const { error: updateError } = await supabase
                        .from('clubs')
                        .update({ wso_geography: wso })
                        .eq('club_name', club.club_name);
                        
                    if (!updateError) {
                        assigned++;
                        assignments.push({
                            club_name: club.club_name,
                            address: club.address,
                            extracted_state: extractedState,
                            assigned_wso: wso
                        });
                    } else {
                        console.error(`Failed to update ${club.club_name}:`, updateError.message);
                        failed++;
                    }
                } else {
                    failed++;
                }
            } else {
                failed++;
            }
        }
        
        console.log(`\\n✅ Rebuild complete:`);
        console.log(`  Successfully assigned: ${assigned}`);
        console.log(`  Failed assignments: ${failed}`);
        console.log(`  Assignment rate: ${((assigned/clubs.length)*100).toFixed(1)}%`);
        
        // Show some example assignments
        console.log(`\\n📋 Sample assignments:`);
        assignments.slice(0, 10).forEach(assignment => {
            console.log(`  ${assignment.club_name}: ${assignment.extracted_state} → ${assignment.assigned_wso}`);
        });
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

rebuildAllClubAssignments();