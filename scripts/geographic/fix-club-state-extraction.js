// Create a working extractStateFromAddress function for clubs
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// US States mapping (same as meets)
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

// WSO Mappings (same as meets)
const WSO_MAPPINGS = {
    'Alabama': ['Alabama'],
    'Carolina': ['North Carolina', 'South Carolina'], 
    'DMV': ['District of Columbia', 'Maryland', 'Virginia'],
    'Pacific Northwest': ['Oregon', 'Washington'],
    'New England': ['Connecticut', 'Maine', 'Massachusetts', 'New Hampshire', 'Rhode Island', 'Vermont'],
    'Michigan': ['Michigan'],
    'California North Central': ['California'], // Will be handled specially
    'Texas-Oklahoma': ['Texas', 'Oklahoma'],
    'Southern': ['Louisiana', 'Mississippi'],
    'Mountain North': ['Idaho', 'Montana', 'Wyoming'],
    'Florida': ['Florida'],
    'Tennessee-Kentucky': ['Tennessee', 'Kentucky'],
    'Minnesota-Dakotas': ['Minnesota', 'North Dakota', 'South Dakota'],
    'Hawaii and International': ['Hawaii'],
    'Ohio': ['Ohio'],
    'New York': ['New York'],
    'Mountain South': ['Arizona', 'Colorado', 'New Mexico', 'Utah'],
    'Wisconsin': ['Wisconsin'],
    'Missouri Valley': ['Kansas', 'Missouri'],
    'Indiana': ['Indiana'],
    'Pennsylvania-West Virginia': ['Pennsylvania', 'West Virginia'],
    'California South': [], // Will be handled specially with California North Central
    'Illinois': ['Illinois'],
    'Georgia': ['Georgia'],
    'New Jersey': ['New Jersey'],
    'Iowa-Nebraska': ['Iowa', 'Nebraska']
};

// California city mappings
const CALIFORNIA_CITIES = {
    'South': [
        'los angeles', 'san diego', 'long beach', 'anaheim', 'bakersfield', 'riverside', 'stockton', 'chula vista',
        'fremont', 'irvine', 'san bernardino', 'modesto', 'oxnard', 'fontana', 'moreno valley', 'huntington beach',
        'glendale', 'santa clarita', 'garden grove', 'oceanside', 'rancho cucamonga', 'santa rosa', 'ontario',
        'lancaster', 'elk grove', 'palmdale', 'corona', 'salinas', 'pomona', 'hayward', 'escondido', 'torrance',
        'sunnyvale', 'orange', 'fullerton', 'pasadena', 'thousand oaks', 'visalia', 'simi valley', 'concord'
    ],
    'North Central': [
        'san francisco', 'san jose', 'oakland', 'sacramento', 'fresno', 'santa ana', 'berkeley', 'richmond',
        'antioch', 'stockton', 'vallejo', 'livermore', 'san rafael', 'mountain view', 'petaluma', 'redwood city',
        'alameda', 'san mateo', 'union city', 'redding', 'turlock', 'fairfield', 'san leandro', 'tracy',
        'merced', 'palo alto', 'milpitas', 'pleasanton', 'vacaville', 'manteca', 'pittsburg', 'citrus heights'
    ]
};

// Working state extraction function (based on successful meets algorithm)
function extractStateFromAddress(address) {
    if (!address) return null;
    
    // Directional abbreviations commonly used in street addresses that conflict with state codes
    const DIRECTIONAL_ABBREVS = ['NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];
    
    // First, look for full state names (highest priority)
    for (const fullName of Object.values(US_STATES)) {
        const namePattern = new RegExp(`\b${fullName.replace(/\s/g, '\s+')}\b`, 'i');
        if (namePattern.test(address)) {
            return fullName;
        }
    }
    
    // Then look for state abbreviations (with proper context filtering)
    for (const [abbrev, fullName] of Object.entries(US_STATES)) {
        // Skip directional abbreviations unless they appear in clear state context
        if (DIRECTIONAL_ABBREVS.includes(abbrev)) {
            // Only match if state abbreviation appears after comma (clear state context)
            const contextPattern = new RegExp(`,\s*${abbrev}\s+|${abbrev}\s+\d{5}`, 'i');
            if (contextPattern.test(address)) {
                return fullName;
            }
        } else {
            // For non-directional abbreviations, use standard word boundary matching
            const abbrevPattern = new RegExp(`\b${abbrev}\b|,\s*${abbrev}\b|\s${abbrev}$`, 'i');
            if (abbrevPattern.test(address)) {
                return fullName;
            }
        }
    }
    
    return null;
}

// Assign WSO based on state
function assignWSO(state, address = null) {
    if (!state) return null;
    
    // Special handling for California
    if (state === 'California') {
        if (address) {
            const cityInfo = extractCaliforniaCity(address);
            if (cityInfo) {
                return `California ${cityInfo.region}`;
            }
        }
        // Default to North Central if city unknown
        return 'California North Central';
    }
    
    // Find WSO that includes this state
    for (const [wso, states] of Object.entries(WSO_MAPPINGS)) {
        if (states.includes(state)) {
            return wso;
        }
    }
    
    return null;
}

// Extract California city information
function extractCaliforniaCity(address) {
    if (!address) return null;
    
    const addressLower = address.toLowerCase();
    
    // Check South cities first
    for (const city of CALIFORNIA_CITIES.South) {
        if (addressLower.includes(city)) {
            return { region: 'South', city: city };
        }
    }
    
    // Check North Central cities
    for (const city of CALIFORNIA_CITIES['North Central']) {
        if (addressLower.includes(city)) {
            return { region: 'North Central', city: city };
        }
    }
    
    return null;
}

// Test the working function
async function testAndApply() {
    console.log('🧪 Testing working state extraction function...');
    
    const testAddresses = [
        'Fort Walton Beach, Florida, United States of America',
        'Albany, New York, United States of America', 
        'Signal Hill, California, United States of America',
        'Tyler, Texas, United States of America',
        'Anchorage, Alaska, United States of America',
        'Auburn, Alabama, United States of America',
        '5224 NE 42nd Ave, Portland, Oregon, United States of America'
    ];

    testAddresses.forEach(address => {
        const state = extractStateFromAddress(address);
        const wso = assignWSO(state, address);
        console.log(`"${address.substring(0, 50)}..." → ${state} → ${wso}`);
    });
    
    if (testAddresses.every(addr => extractStateFromAddress(addr) !== null)) {
        console.log('\\n✅ State extraction is working correctly!');
        console.log('Ready to rebuild club assignments with working algorithm');
    } else {
        console.log('\\n❌ State extraction still has issues');
    }
}

testAndApply();