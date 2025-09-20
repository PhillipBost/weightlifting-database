const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Correct state-to-WSO mapping from wso_information table
const STATE_TO_WSO = {
    'Alabama': 'Alabama',
    'Alaska': 'Pacific Northwest',
    'Arizona': 'Mountain South',
    'Arkansas': 'Southern',
    'California': 'California North Central', // Default - will be refined for South
    'Colorado': 'Mountain North',
    'Connecticut': 'New England',
    'Delaware': 'DMV',
    'District of Columbia': 'DMV',
    'Florida': 'Florida',
    'Georgia': 'Georgia',
    'Hawaii': 'Hawaii and International',
    'Idaho': 'Mountain North',
    'Illinois': 'Illinois',
    'Indiana': 'Indiana',
    'Iowa': 'Iowa-Nebraska',
    'Kansas': 'Missouri Valley',
    'Kentucky': 'Tennessee-Kentucky',
    'Louisiana': 'Southern',
    'Maine': 'New England',
    'Maryland': 'DMV',
    'Massachusetts': 'New England',
    'Michigan': 'Michigan',
    'Minnesota': 'Minnesota-Dakotas',
    'Mississippi': 'Southern',
    'Missouri': 'Missouri Valley',
    'Montana': 'Mountain North',
    'Nebraska': 'Iowa-Nebraska',
    'Nevada': 'Mountain South',
    'New Hampshire': 'New England',
    'New Jersey': 'New Jersey',
    'New Mexico': 'Mountain South',
    'New York': 'New York',
    'North Carolina': 'Carolina',
    'North Dakota': 'Minnesota-Dakotas',
    'Ohio': 'Ohio',
    'Oklahoma': 'Texas-Oklahoma',
    'Oregon': 'Pacific Northwest',
    'Pennsylvania': 'Pennsylvania-West Virginia',
    'Rhode Island': 'New England',
    'South Carolina': 'Carolina',
    'South Dakota': 'Minnesota-Dakotas',
    'Tennessee': 'Tennessee-Kentucky',
    'Texas': 'Texas-Oklahoma',
    'Utah': 'Mountain South',
    'Vermont': 'New England',
    'Virginia': 'DMV',
    'Washington': 'Pacific Northwest',
    'West Virginia': 'Pennsylvania-West Virginia',
    'Wisconsin': 'Wisconsin',
    'Wyoming': 'Mountain North'
};

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
    
    // First, look for full state names
    for (const fullName of Object.values(US_STATES)) {
        const escaped = fullName.replace(/\\s/g, '\\\\s+');
        const pattern = new RegExp('\\\\b' + escaped + '\\\\b', 'i');
        if (pattern.test(address)) {
            return fullName;
        }
    }
    
    // Then look for state abbreviations
    for (const [abbrev, fullName] of Object.entries(US_STATES)) {
        if (DIRECTIONAL_ABBREVS.includes(abbrev)) {
            const pattern = new RegExp(',\\\\s*' + abbrev + '\\\\s+|' + abbrev + '\\\\s+\\\\d{5}', 'i');
            if (pattern.test(address)) {
                return fullName;
            }
        } else {
            const pattern = new RegExp('\\\\b' + abbrev + '\\\\b|,\\\\s*' + abbrev + '\\\\b|\\\\s' + abbrev + '$', 'i');
            if (pattern.test(address)) {
                return fullName;
            }
        }
    }
    
    return null;
}

function assignCaliforniaWSO(address) {
    if (!address) return 'California North Central'; // Default
    
    const addressLower = address.toLowerCase();
    
    // Check for South California indicators
    const southIndicators = [
        'los angeles', 'orange county', 'riverside', 'san bernardino', 'imperial',
        'ventura', 'santa barbara', 'san diego', 'kern', 'tulare', 'fresno',
        'kings', 'madera', 'inyo', 'mono', 'san luis obispo',
        'la', 'oc', 'hollywood', 'beverly hills', 'santa monica', 'long beach',
        'anaheim', 'huntington beach', 'irvine', 'san diego', 'chula vista',
        'oceanside', 'carlsbad', 'fresno', 'bakersfield', 'stockton'
    ];
    
    for (const indicator of southIndicators) {
        if (addressLower.includes(indicator)) {
            return 'California South';
        }
    }
    
    return 'California North Central'; // Default for California
}

function assignWSO(state, address) {
    if (!state || !STATE_TO_WSO[state]) return null;
    
    // Special handling for California
    if (state === 'California') {
        return assignCaliforniaWSO(address);
    }
    
    return STATE_TO_WSO[state];
}

async function rebuildAllClubsFinal() {
    console.log('🔄 FINAL REBUILD with correct WSO mapping...');
    console.log('Using wso_information table data\\n');
    
    try {
        // Test the functions first
        console.log('🧪 Testing state extraction:');
        const testCases = [
            'Sacramento, California',
            'Los Angeles, California', 
            'Austin, Texas',
            'Portland, Oregon'
        ];
        
        testCases.forEach(address => {
            const state = extractStateFromAddress(address);
            const wso = assignWSO(state, address);
            console.log(`  "${address}" → ${state} → ${wso}`);
        });
        
        // Get all clubs
        const { data: clubs, error } = await supabase
            .from('clubs')
            .select('club_name, address');
            
        if (error) throw error;
        
        console.log(`\\nProcessing ${clubs.length} clubs...\\n`);
        
        let assigned = 0;
        let failed = 0;
        const assignments = [];
        
        for (let i = 0; i < clubs.length; i++) {
            const club = clubs[i];
            
            if (i % 50 === 0) {
                console.log(`  Progress: ${i}/${clubs.length} clubs processed`);
            }
            
            const extractedState = extractStateFromAddress(club.address);
            
            if (extractedState) {
                const wso = assignWSO(extractedState, club.address);
                if (wso) {
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
        
        console.log(`\\n✅ FINAL rebuild complete:`);
        console.log(`  Successfully assigned: ${assigned}`);
        console.log(`  Failed assignments: ${failed}`);
        console.log(`  Assignment rate: ${((assigned/clubs.length)*100).toFixed(1)}%`);
        
        // Show assignments by WSO
        const wsoGroups = {};
        assignments.forEach(assignment => {
            if (!wsoGroups[assignment.assigned_wso]) {
                wsoGroups[assignment.assigned_wso] = [];
            }
            wsoGroups[assignment.assigned_wso].push(assignment);
        });
        
        console.log(`\\n📋 Final assignments by WSO:`);
        Object.entries(wsoGroups)
            .sort(([,a], [,b]) => b.length - a.length)
            .forEach(([wso, clubList]) => {
                console.log(`  ${wso}: ${clubList.length} clubs`);
            });
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

rebuildAllClubsFinal();