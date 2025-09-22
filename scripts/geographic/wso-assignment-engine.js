/**
 * WSO Assignment Engine - Shared Logic
 * 
 * Provides sophisticated WSO (Weightlifting State Organizations) geographic assignment
 * logic that can be used across multiple scripts for consistency.
 * 
 * Assignment Strategy (in order of preference):
 * 1. Coordinate-based assignment using geographic boundaries
 * 2. Address parsing for state/region extraction  
 * 3. Meet name parsing for location indicators
 * 4. Historical data analysis from meet results
 * 5. Fallback mapping for edge cases
 * 
 * Usage:
 *   const { assignWSOGeography } = require('./wso-assignment-engine');
 *   const result = await assignWSOGeography(meetData, supabaseClient);
 */

const { createClient } = require('@supabase/supabase-js');

// US State mappings
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

// WSO Geographic Mapping
const WSO_MAPPINGS = {
    // Single State WSOs
    'Alabama': ['Alabama'],
    'Florida': ['Florida'],
    'Georgia': ['Georgia'],
    'Illinois': ['Illinois'],
    'Indiana': ['Indiana'],
    'Michigan': ['Michigan'],
    'New Jersey': ['New Jersey'],
    'New York': ['New York'],
    'Ohio': ['Ohio'],
    'Wisconsin': ['Wisconsin'],

    // Multi-State WSOs
    'Carolina': ['North Carolina', 'South Carolina'],
    'DMV': ['Delaware', 'Maryland', 'Virginia', 'District of Columbia'],
    'Iowa-Nebraska': ['Iowa', 'Nebraska'],
    'Minnesota-Dakotas': ['Minnesota', 'North Dakota', 'South Dakota'],
    'Missouri Valley': ['Missouri', 'Kansas'],
    'Mountain North': ['Montana', 'Idaho', 'Colorado', 'Wyoming'],
    'Mountain South': ['Utah', 'Arizona', 'New Mexico', 'Nevada'],
    'New England': ['Maine', 'New Hampshire', 'Vermont', 'Massachusetts', 'Rhode Island', 'Connecticut'],
    'Pacific Northwest': ['Washington', 'Oregon', 'Alaska'],
    'Pennsylvania-West Virginia': ['Pennsylvania', 'West Virginia'],
    'Southern': ['Louisiana', 'Mississippi', 'Arkansas'],
    'Tennessee-Kentucky': ['Tennessee', 'Kentucky'],
    'Texas-Oklahoma': ['Texas', 'Oklahoma'],

    // Special Regional WSOs
    'California North Central': ['California'], // Special handling needed
    'California South': ['California'], // Special handling needed
    'Hawaii and International': ['Hawaii']
};

// California city mappings for WSO assignment
const CALIFORNIA_CITIES = {
    'North Central': [
        // Bay Area
        'san francisco', 'oakland', 'san jose', 'fremont', 'hayward', 'sunnyvale', 'santa clara',
        'berkeley', 'daly city', 'san mateo', 'richmond', 'vallejo', 'concord', 'fairfield',
        'antioch', 'temecula', 'livermore', 'santa rosa', 'petaluma', 'napa', 'emeryville',
        'alameda', 'palo alto', 'mountain view', 'cupertino', 'milpitas', 'union city',
        // Central Valley & Northern
        'sacramento', 'stockton', 'modesto', 'salinas', 'santa cruz', 'watsonville', 'monterey',
        'merced', 'turlock', 'tracy', 'manteca', 'lodi', 'davis', 'woodland', 'yuba city',
        'marysville', 'chico', 'redding', 'eureka', 'ukiah'
    ],
    'South': [
        // LA Area
        'los angeles', 'long beach', 'anaheim', 'santa ana', 'riverside', 'stockton', 'irvine',
        'chula vista', 'fremont', 'san bernardino', 'fontana', 'oxnard', 'moreno valley',
        'huntington beach', 'glendale', 'santa clarita', 'garden grove', 'oceanside', 'rancho cucamonga',
        'ontario', 'corona', 'lancaster', 'palmdale', 'pomona', 'torrance', 'orange', 'fullerton',
        'elk grove', 'corona', 'hayward', 'escondido', 'sunnyvale', 'pasadena', 'hollywood',
        'burbank', 'west hollywood', 'beverly hills', 'santa monica', 'venice', 'manhattan beach',
        'redondo beach', 'hermosa beach', 'culver city', 'inglewood', 'hawthorne', 'compton',
        'downey', 'norwalk', 'whittier', 'lakewood', 'cerritos', 'cypress', 'la mirada',
        'woodland hills', 'van nuys', 'north hollywood', 'sherman oaks', 'encino', 'tarzana',
        // Orange County
        'orange', 'santa ana', 'anaheim', 'huntington beach', 'garden grove', 'irvine', 'fullerton',
        'costa mesa', 'mission viejo', 'westminster', 'newport beach', 'buena park', 'tustin',
        'yorba linda', 'san clemente', 'laguna niguel', 'lake forest', 'cypress', 'placentia',
        // Inland Empire
        'riverside', 'san bernardino', 'fontana', 'moreno valley', 'rancho cucamonga', 'ontario',
        'corona', 'pomona', 'victorville', 'rialto', 'chino', 'upland', 'redlands', 'chino hills',
        'diamond bar', 'hesperia', 'apple valley', 'colton', 'yucaipa', 'highland',
        // San Diego Area
        'san diego', 'chula vista', 'oceanside', 'escondido', 'carlsbad', 'el cajon', 'vista',
        'san marcos', 'encinitas', 'national city', 'la mesa', 'santee', 'poway', 'coronado',
        // Central Coast South
        'ventura', 'thousand oaks', 'simi valley', 'santa barbara', 'santa maria', 'lompoc',
        'camarillo', 'carpinteria', 'goleta', 'paso robles', 'san luis obispo', 'arroyo grande'
    ]
};

// US State coordinate boundaries (accurate, non-overlapping)
const STATE_BOUNDARIES = {
    'Alabama': { minLat: 30.223, maxLat: 35.008, minLng: -88.473, maxLng: -84.889 },
    'Alaska': { minLat: 54.0, maxLat: 71.4, minLng: -179.148, maxLng: -129.979 },
    'Arizona': { minLat: 31.332, maxLat: 37.004, minLng: -114.816, maxLng: -109.045 },
    'Arkansas': { minLat: 33.004, maxLat: 36.500, minLng: -94.618, maxLng: -89.644 },
    'California': { minLat: 32.534, maxLat: 42.009, minLng: -124.409, maxLng: -114.131 },
    'Colorado': { minLat: 36.993, maxLat: 41.003, minLng: -109.060, maxLng: -102.042 },
    'Connecticut': { minLat: 40.980, maxLat: 42.050, minLng: -73.727, maxLng: -71.787 },
    'Delaware': { minLat: 38.451, maxLat: 39.839, minLng: -75.789, maxLng: -75.049 },
    'Florida': { minLat: 24.396, maxLat: 31.001, minLng: -87.635, maxLng: -79.974 },
    'Georgia': { minLat: 30.356, maxLat: 35.000, minLng: -85.605, maxLng: -80.751 },
    'Hawaii': { minLat: 18.911, maxLat: 28.402, minLng: -178.334, maxLng: -154.806 },
    'Idaho': { minLat: 41.988, maxLat: 49.001, minLng: -117.243, maxLng: -111.044 },
    'Illinois': { minLat: 36.970, maxLat: 42.508, minLng: -91.513, maxLng: -87.494 },
    'Indiana': { minLat: 37.771, maxLat: 41.761, minLng: -88.098, maxLng: -84.784 },
    'Iowa': { minLat: 40.375, maxLat: 43.502, minLng: -96.640, maxLng: -90.140 },
    'Kansas': { minLat: 36.993, maxLat: 40.003, minLng: -102.052, maxLng: -94.588 },
    'Kentucky': { minLat: 36.497, maxLat: 39.147, minLng: -89.571, maxLng: -81.965 },
    'Louisiana': { minLat: 28.929, maxLat: 33.020, minLng: -94.043, maxLng: -88.817 },
    'Maine': { minLat: 43.058, maxLat: 47.460, minLng: -71.084, maxLng: -66.885 },
    'Maryland': { minLat: 37.911, maxLat: 39.723, minLng: -79.487, maxLng: -75.049 },
    'Massachusetts': { minLat: 41.187, maxLat: 42.887, minLng: -73.508, maxLng: -69.858 },
    'Michigan': { minLat: 41.696, maxLat: 48.306, minLng: -90.418, maxLng: -82.413 },
    'Minnesota': { minLat: 43.499, maxLat: 49.384, minLng: -97.239, maxLng: -89.491 },
    'Mississippi': { minLat: 30.173, maxLat: 35.008, minLng: -91.655, maxLng: -88.098 },
    'Missouri': { minLat: 35.996, maxLat: 40.613, minLng: -95.774, maxLng: -89.099 },
    'Montana': { minLat: 44.358, maxLat: 49.001, minLng: -116.050, maxLng: -104.039 },
    'Nebraska': { minLat: 39.992, maxLat: 43.002, minLng: -104.053, maxLng: -95.308 },
    'Nevada': { minLat: 35.002, maxLat: 42.002, minLng: -120.006, maxLng: -114.040 },
    'New Hampshire': { minLat: 42.697, maxLat: 45.305, minLng: -72.557, maxLng: -70.610 },
    'New Jersey': { minLat: 38.928, maxLat: 41.357, minLng: -75.560, maxLng: -73.894 },
    'New Mexico': { minLat: 31.332, maxLat: 37.000, minLng: -109.050, maxLng: -103.002 },
    'New York': { minLat: 40.496, maxLat: 45.016, minLng: -79.763, maxLng: -71.856 },
    'North Carolina': { minLat: 33.752, maxLat: 36.588, minLng: -84.322, maxLng: -75.461 },
    'North Dakota': { minLat: 45.935, maxLat: 49.001, minLng: -104.048, maxLng: -96.554 },
    'Ohio': { minLat: 38.403, maxLat: 42.327, minLng: -84.820, maxLng: -80.519 },
    'Oklahoma': { minLat: 33.616, maxLat: 37.002, minLng: -103.002, maxLng: -94.431 },
    'Oregon': { minLat: 41.992, maxLat: 46.292, minLng: -124.566, maxLng: -116.463 },
    'Pennsylvania': { minLat: 39.720, maxLat: 42.515, minLng: -80.519, maxLng: -74.690 },
    'Rhode Island': { minLat: 41.146, maxLat: 42.019, minLng: -71.862, maxLng: -71.120 },
    'South Carolina': { minLat: 32.034, maxLat: 35.216, minLng: -83.354, maxLng: -78.499 },
    'South Dakota': { minLat: 42.480, maxLat: 45.945, minLng: -104.058, maxLng: -96.436 },
    'Tennessee': { minLat: 34.983, maxLat: 36.678, minLng: -90.310, maxLng: -81.647 },
    'Texas': { minLat: 25.837, maxLat: 36.501, minLng: -106.646, maxLng: -93.508 },
    'Utah': { minLat: 36.998, maxLat: 42.002, minLng: -114.052, maxLng: -109.041 },
    'Vermont': { minLat: 42.727, maxLat: 45.017, minLng: -73.437, maxLng: -71.465 },
    'Virginia': { minLat: 36.541, maxLat: 39.466, minLng: -83.675, maxLng: -75.242 },
    'Washington': { minLat: 45.544, maxLat: 49.002, minLng: -124.848, maxLng: -116.916 },
    'West Virginia': { minLat: 37.202, maxLat: 40.638, minLng: -82.644, maxLng: -77.719 },
    'Wisconsin': { minLat: 42.492, maxLat: 47.080, minLng: -92.889, maxLng: -86.805 },
    'Wyoming': { minLat: 41.000, maxLat: 45.006, minLng: -111.056, maxLng: -104.052 },
    'District of Columbia': { minLat: 38.791, maxLat: 38.996, minLng: -77.120, maxLng: -76.910 }
};

// Common location patterns in meet names
const MEET_LOCATION_PATTERNS = {
    // State patterns
    'Alabama': /alabama|al(?:\s|$)/i,
    'Alaska': /alaska|ak(?:\s|$)/i,
    'Arizona': /arizona|az(?:\s|$)/i,
    'Arkansas': /arkansas|ar(?:\s|$)/i,
    'California': /california|ca(?:\s|$)|socal|norcal|nor\s*cal|so\s*cal/i,
    'Colorado': /colorado|co(?:\s|$)/i,
    'Connecticut': /connecticut|ct(?:\s|$)/i,
    'Delaware': /delaware|de(?:\s|$)/i,
    'Florida': /florida|fl(?:\s|$)/i,
    'Georgia': /georgia|ga(?:\s|$)/i,
    'Hawaii': /hawaii|hi(?:\s|$)/i,
    'Idaho': /idaho|id(?:\s|$)/i,
    'Illinois': /illinois|il(?:\s|$)/i,
    'Indiana': /indiana|in(?:\s|$)/i,
    'Iowa': /iowa|ia(?:\s|$)/i,
    'Kansas': /kansas|ks(?:\s|$)/i,
    'Kentucky': /kentucky|ky(?:\s|$)/i,
    'Louisiana': /louisiana|la(?:\s|$)/i,
    'Maine': /maine|me(?:\s|$)/i,
    'Maryland': /maryland|md(?:\s|$)/i,
    'Massachusetts': /massachusetts|ma(?:\s|$)/i,
    'Michigan': /michigan|mi(?:\s|$)/i,
    'Minnesota': /minnesota|mn(?:\s|$)/i,
    'Mississippi': /mississippi|ms(?:\s|$)/i,
    'Missouri': /missouri|mo(?:\s|$)/i,
    'Montana': /montana|mt(?:\s|$)/i,
    'Nebraska': /nebraska|ne(?:\s|$)/i,
    'Nevada': /nevada|nv(?:\s|$)/i,
    'New Hampshire': /new\s*hampshire|nh(?:\s|$)/i,
    'New Jersey': /new\s*jersey|nj(?:\s|$)/i,
    'New Mexico': /new\s*mexico|nm(?:\s|$)/i,
    'New York': /new\s*york|ny(?:\s|$)/i,
    'North Carolina': /north\s*carolina|nc(?:\s|$)/i,
    'North Dakota': /north\s*dakota|nd(?:\s|$)/i,
    'Ohio': /ohio|oh(?:\s|$)/i,
    'Oklahoma': /oklahoma|ok(?:\s|$)/i,
    'Oregon': /oregon|or(?:\s|$)/i,
    'Pennsylvania': /pennsylvania|pa(?:\s|$)/i,
    'Rhode Island': /rhode\s*island|ri(?:\s|$)/i,
    'South Carolina': /south\s*carolina|sc(?:\s|$)/i,
    'South Dakota': /south\s*dakota|sd(?:\s|$)/i,
    'Tennessee': /tennessee|tn(?:\s|$)/i,
    'Texas': /texas|tx(?:\s|$)/i,
    'Utah': /utah|ut(?:\s|$)/i,
    'Vermont': /vermont|vt(?:\s|$)/i,
    'Virginia': /virginia|va(?:\s|$)/i,
    'Washington': /washington|wa(?:\s|$)/i,
    'West Virginia': /west\s*virginia|wv(?:\s|$)/i,
    'Wisconsin': /wisconsin|wi(?:\s|$)/i,
    'Wyoming': /wyoming|wy(?:\s|$)/i,
    'District of Columbia': /washington\s*dc|dc(?:\s|$)|district\s*of\s*columbia/i
};

// Regional patterns in meet names
const MEET_REGIONAL_PATTERNS = {
    'New England': /new\s*england|northeast/i,
    'Pacific Northwest': /pacific\s*northwest|pnw/i,
    'Mountain North': /mountain\s*north|rocky\s*mountain/i,
    'Mountain South': /mountain\s*south|southwest/i,
    'Southern': /southern\s*states|deep\s*south/i,
    'California North Central': /nor\s*cal|northern\s*california|bay\s*area|san\s*francisco/i,
    'California South': /so\s*cal|southern\s*california|los\s*angeles|san\s*diego/i
};

/**
 * Find state by coordinates using boundary checking
 */
function findStateByCoordinates(lat, lng) {
    const matches = [];
    for (const [state, bounds] of Object.entries(STATE_BOUNDARIES)) {
        if (lat >= bounds.minLat && lat <= bounds.maxLat && 
            lng >= bounds.minLng && lng <= bounds.maxLng) {
            matches.push(state);
        }
    }
    
    if (matches.length === 0) {
        return null;
    } else if (matches.length === 1) {
        return matches[0];
    } else {
        // Handle conflicts by choosing the best match based on distance from center
        let bestMatch = matches[0];
        let bestDistance = Infinity;
        
        for (const state of matches) {
            const bounds = STATE_BOUNDARIES[state];
            const centerLat = (bounds.minLat + bounds.maxLat) / 2;
            const centerLng = (bounds.minLng + bounds.maxLng) / 2;
            const distance = Math.sqrt(Math.pow(lat - centerLat, 2) + Math.pow(lng - centerLng, 2));
            
            if (distance < bestDistance) {
                bestDistance = distance;
                bestMatch = state;
            }
        }
        
        return bestMatch;
    }
}

/**
 * Assign California WSO based on coordinates 
 */
function assignCaliforniaWSO(lat, lng) {
    // North Central: roughly above 35.5°N
    // South: below 35.5°N
    if (lat >= 35.5) {
        return 'California North Central';
    } else {
        return 'California South';
    }
}

/**
 * Extract city from California address
 */
function extractCaliforniaCity(address) {
    if (!address) return null;
    
    const addressLower = address.toLowerCase();
    
    // Check South cities first (more specific matches)
    for (const city of CALIFORNIA_CITIES['South']) {
        if (addressLower.includes(city)) {
            return { city, region: 'South' };
        }
    }
    
    // Check North Central cities second
    for (const city of CALIFORNIA_CITIES['North Central']) {
        if (addressLower.includes(city)) {
            return { city, region: 'North Central' };
        }
    }
    
    return null;
}

/**
 * Extract state from address text
 */
function extractStateFromAddress(address) {
    if (!address) return null;
    
    // Get state names sorted by length (longest first) to prioritize "West Virginia" over "Virginia"
    const stateNames = Object.values(US_STATES).sort((a, b) => b.length - a.length);
    
    // Check for full state names (prioritizing longer names, with context validation)
    for (const state of stateNames) {
        const stateLower = state.toLowerCase();
        const addressLower = address.toLowerCase();
        
        if (addressLower.includes(stateLower)) {
            // Additional validation: state should appear after comma or at end for proper context
            const stateIndex = addressLower.indexOf(stateLower);
            const beforeChar = stateIndex > 0 ? addressLower[stateIndex - 1] : '';
            const afterIndex = stateIndex + stateLower.length;
            const afterChar = afterIndex < addressLower.length ? addressLower[afterIndex] : '';
            
            // Valid contexts: after comma/space, or at word boundaries
            if (beforeChar === ',' || beforeChar === ' ' || stateIndex === 0 || 
                afterChar === ',' || afterChar === ' ' || afterChar === '.' || afterIndex === addressLower.length) {
                // Extra check: avoid matching street names like "Georgia St"
                if (afterChar === ' ') {
                    const nextWord = addressLower.substring(afterIndex + 1).split(' ')[0].replace(/[,.]/, '');
                    if (['st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'boulevard', 'dr', 'drive', 'ln', 'lane', 'way', 'ct', 'court', 'pl', 'place'].includes(nextWord)) {
                        continue; // Skip this match, it's likely a street name
                    }
                }
                return state;
            }
        }
    }
    
    // Check for common abbreviations after comma (avoid directional conflicts)
    const stateAbbrevs = {
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
    
    const directionalAbbrevs = ['NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];
    
    for (const [abbrev, state] of Object.entries(stateAbbrevs)) {
        if (directionalAbbrevs.includes(abbrev)) {
            // Only match directional abbreviations in clear state context
            if (address.includes(', ' + abbrev + ' ') || address.includes(abbrev + ' ' + address.match(/\d{5}/)?.[0])) {
                return state;
            }
        } else {
            // Look for abbreviation after comma or with clear boundaries
            if (address.includes(', ' + abbrev) || address.includes(' ' + abbrev + ' ') || address.endsWith(' ' + abbrev)) {
                return state;
            }
        }
    }
    
    return null;
}

/**
 * Extract state/region from meet name
 */
function extractLocationFromMeetName(meetName) {
    if (!meetName) return null;
    
    // First check for regional patterns
    for (const [region, pattern] of Object.entries(MEET_REGIONAL_PATTERNS)) {
        if (pattern.test(meetName)) {
            return { type: 'region', value: region };
        }
    }
    
    // Then check for state patterns
    for (const [state, pattern] of Object.entries(MEET_LOCATION_PATTERNS)) {
        if (pattern.test(meetName)) {
            return { type: 'state', value: state };
        }
    }
    
    return null;
}

/**
 * Assign WSO based on state
 */
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
        // Default to North Central if city unknown (most conservative choice)
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

/**
 * Calculate confidence score for assignment
 */
function calculateConfidence(assignmentMethod, hasCoordinates, hasAddress, historicalMatch, meetNameMatch) {
    let confidence = 0;
    
    switch (assignmentMethod) {
        case 'coordinates':
            confidence = 0.95;
            break;
        case 'address_state':
            confidence = 0.85;
            break;
        case 'meet_name_region':
            confidence = 0.90;
            break;
        case 'meet_name_state':
            confidence = 0.80;
            break;
        case 'historical_data':
            confidence = 0.85;
            break;
        case 'address_parsing':
            confidence = 0.75;
            break;
        case 'fallback':
            confidence = 0.50;
            break;
        default:
            confidence = 0.30;
    }
    
    // Boost confidence if multiple data sources agree
    if (historicalMatch) confidence += 0.05;
    if (meetNameMatch) confidence += 0.05;
    if (hasCoordinates && hasAddress) confidence += 0.05;
    
    return Math.min(confidence, 1.0);
}

/**
 * Get historical WSO data from meet results
 */
async function getHistoricalMeetWSOData(supabaseClient) {
    const { data, error } = await supabaseClient
        .from('meet_results')
        .select('meet_name, wso')
        .not('meet_name', 'is', null)
        .not('wso', 'is', null);
    
    if (error) {
        console.warn(`Warning: Could not fetch historical data: ${error.message}`);
        return {};
    }
    
    // Create meet -> WSO mapping from historical data
    const historicalData = {};
    for (const result of data) {
        const meetName = result.meet_name.trim();
        const wso = result.wso.trim();
        
        if (!historicalData[meetName]) {
            historicalData[meetName] = {};
        }
        
        if (!historicalData[meetName][wso]) {
            historicalData[meetName][wso] = 0;
        }
        
        historicalData[meetName][wso]++;
    }
    
    // Convert to most common WSO per meet
    const meetWSOMap = {};
    for (const [meetName, wsoData] of Object.entries(historicalData)) {
        const mostCommonWSO = Object.entries(wsoData)
            .sort(([,a], [,b]) => b - a)[0][0];
        meetWSOMap[meetName] = mostCommonWSO;
    }
    
    return meetWSOMap;
}

/**
 * Main WSO Assignment Function
 * 
 * @param {Object} meetData - Meet data object
 * @param {Object} supabaseClient - Supabase client instance (optional)
 * @param {Object} options - Assignment options
 * @returns {Object} Assignment result with WSO, method, confidence, and details
 */
async function assignWSOGeography(meetData, supabaseClient = null, options = {}) {
    const {
        includeHistoricalData = true,
        logDetails = false
    } = options;

    const assignment = {
        assigned_wso: null,
        assignment_method: null,
        confidence: 0,
        details: {
            has_coordinates: !!(meetData.latitude && meetData.longitude),
            has_address: !!(meetData.address || meetData.city || meetData.state),
            historical_match: false,
            meet_name_match: false,
            extracted_state: null,
            meet_location: null,
            reasoning: []
        }
    };

    // Get historical data if requested and client provided
    let historicalData = {};
    if (includeHistoricalData && supabaseClient) {
        try {
            historicalData = await getHistoricalMeetWSOData(supabaseClient);
        } catch (error) {
            if (logDetails) {
                console.warn('Could not fetch historical data:', error.message);
            }
        }
    }

    // STRATEGY 1: Coordinate-based assignment
    if (meetData.latitude && meetData.longitude) {
        const lat = parseFloat(meetData.latitude);
        const lng = parseFloat(meetData.longitude);
        
        if (!isNaN(lat) && !isNaN(lng)) {
            const state = findStateByCoordinates(lat, lng);
            if (state) {
                let wso;
                if (state === 'California') {
                    wso = assignCaliforniaWSO(lat, lng);
                } else {
                    wso = assignWSO(state);
                }
                
                if (wso) {
                    assignment.assigned_wso = wso;
                    assignment.assignment_method = 'coordinates';
                    assignment.confidence = calculateConfidence('coordinates', true, assignment.details.has_address, false, false);
                    assignment.details.extracted_state = state;
                    assignment.details.reasoning.push(`Coordinate-based: ${state} → ${wso} (${lat}, ${lng})`);
                    
                    if (logDetails) {
                        console.log(`✅ Coordinate assignment: ${wso}`);
                    }
                    return assignment;
                }
            }
        }
    }

    // STRATEGY 2: Address parsing for state extraction
    let extractedState = null;
    const addressFields = [
        meetData.address, 
        meetData.city, 
        meetData.state, 
        meetData.location_text, 
        meetData.street_address
    ].filter(Boolean);
    
    for (const field of addressFields) {
        extractedState = extractStateFromAddress(field);
        if (extractedState) {
            assignment.details.extracted_state = extractedState;
            assignment.details.reasoning.push(`Extracted state: ${extractedState} from "${field}"`);
            break;
        }
    }
    
    if (extractedState) {
        const wso = assignWSO(extractedState, meetData.address);
        if (wso) {
            assignment.assigned_wso = wso;
            assignment.assignment_method = 'address_state';
            assignment.confidence = calculateConfidence('address_state', assignment.details.has_coordinates, true, false, false);
            assignment.details.reasoning.push(`Address-based: ${extractedState} → ${wso}`);
            
            if (logDetails) {
                console.log(`✅ Address assignment: ${wso}`);
            }
            return assignment;
        }
    }

    // STRATEGY 3: Meet name analysis
    if (meetData.meet_name || meetData.name) {
        const meetName = meetData.meet_name || meetData.name;
        const meetLocation = extractLocationFromMeetName(meetName);
        
        if (meetLocation) {
            assignment.details.meet_location = meetLocation;
            assignment.details.meet_name_match = true;
            
            let wso = null;
            if (meetLocation.type === 'region') {
                wso = meetLocation.value;
                assignment.assignment_method = 'meet_name_region';
            } else if (meetLocation.type === 'state') {
                wso = assignWSO(meetLocation.value, meetData.address);
                assignment.assignment_method = 'meet_name_state';
            }
            
            if (wso) {
                assignment.assigned_wso = wso;
                assignment.confidence = calculateConfidence(assignment.assignment_method, assignment.details.has_coordinates, assignment.details.has_address, false, true);
                assignment.details.reasoning.push(`Meet name analysis: "${meetName}" → ${meetLocation.value} → ${wso}`);
                
                if (logDetails) {
                    console.log(`✅ Meet name assignment: ${wso}`);
                }
                return assignment;
            }
        }
    }

    // STRATEGY 4: Historical data matching
    if (includeHistoricalData && (meetData.meet_name || meetData.name)) {
        const meetName = meetData.meet_name || meetData.name;
        if (historicalData[meetName]) {
            const wso = historicalData[meetName];
            assignment.assigned_wso = wso;
            assignment.assignment_method = 'historical_data';
            assignment.confidence = calculateConfidence('historical_data', assignment.details.has_coordinates, assignment.details.has_address, true, false);
            assignment.details.historical_match = true;
            assignment.details.reasoning.push(`Historical data: "${meetName}" → ${wso}`);
            
            if (logDetails) {
                console.log(`✅ Historical assignment: ${wso}`);
            }
            return assignment;
        }
    }

    // No assignment possible
    assignment.details.reasoning.push('No WSO assignment method succeeded');
    if (logDetails) {
        console.log(`❌ No WSO assignment possible for meet`);
    }
    
    return assignment;
}

// Export functions for use in other scripts
module.exports = {
    assignWSOGeography,
    extractStateFromAddress,
    extractLocationFromMeetName,
    assignWSO,
    calculateConfidence,
    findStateByCoordinates,
    assignCaliforniaWSO,
    extractCaliforniaCity,
    getHistoricalMeetWSOData,
    US_STATES,
    WSO_MAPPINGS,
    STATE_BOUNDARIES,
    MEET_LOCATION_PATTERNS,
    MEET_REGIONAL_PATTERNS,
    CALIFORNIA_CITIES
};