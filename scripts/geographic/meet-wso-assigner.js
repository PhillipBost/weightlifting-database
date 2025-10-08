#!/usr/bin/env node

/**
 * Meet WSO Geography Assignment Script
 *
 * This script assigns WSO (Weightlifting State Organizations) geographic regions 
 * to meets in the meets table based on their location data.
 *
 * Assignment Strategy:
 * 1. Coordinate-based assignment using geographic boundaries
 * 2. Address parsing for state/region extraction
 * 3. Historical data analysis from meet results
 * 4. Meet name parsing for location indicators
 * 5. Manual mapping for edge cases
 *
 * Usage:
 *   node meet-wso-assigner.js --analyze     # Analyze current meet data
 *   node meet-wso-assigner.js --assign      # Assign WSO geography to meets
 *   node meet-wso-assigner.js --validate    # Validate assignments
 *   node meet-wso-assigner.js --report      # Generate assignment report
 */

const { createClient } = require('@supabase/supabase-js');
const { assignWSOGeography, extractStateFromAddress } = require('./wso-assignment-engine');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'meet_wso_assignments.json');
const LOG_FILE = path.join(LOGS_DIR, 'meet-wso-assigner.log');
const SCRIPT_VERSION = '1.0.0';

// US State boundaries (simplified for WSO mapping)
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

// WSO Geographic Mapping (from wso-data-collector.js)
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

// California County Mappings
// North Central: All counties NORTH of San Luis Obispo, Kern, and San Bernardino
// South: All counties SOUTH of Monterey, Kings, Tulare, and Inyo
const CALIFORNIA_COUNTIES = {
    'North Central': [
        // Bay Area (9 counties)
        'Alameda', 'Contra Costa', 'Marin', 'Napa', 'San Francisco', 'San Mateo',
        'Santa Clara', 'Solano', 'Sonoma',
        // Central Coast (3 counties)
        'Monterey', 'San Benito', 'Santa Cruz',
        // Central Valley North (12 counties)
        'Sacramento', 'Yolo', 'Sutter', 'Yuba', 'Placer', 'El Dorado',
        'Merced', 'Stanislaus', 'San Joaquin', 'Calaveras', 'Tuolumne', 'Mariposa',
        // Central Valley - Boundary Counties (4 counties - north of SLO/Kern/SB)
        'Fresno', 'Kings', 'Tulare', 'Inyo',
        // Northern Mountains (12 counties)
        'Del Norte', 'Siskiyou', 'Modoc', 'Lassen', 'Shasta', 'Trinity',
        'Tehama', 'Plumas', 'Glenn', 'Butte', 'Sierra', 'Nevada',
        // North Coast (3 counties)
        'Humboldt', 'Mendocino', 'Lake',
        // Sierra Nevada (3 counties)
        'Amador', 'Alpine', 'Mono'
    ],
    'South': [
        // Southern Coast (3 counties)
        'San Luis Obispo', 'Santa Barbara', 'Ventura',
        // LA Metro (2 counties)
        'Los Angeles', 'Orange',
        // Inland Empire & Desert (3 counties)
        'San Bernardino', 'Riverside', 'Imperial',
        // Southern Central Valley (1 county)
        'Kern'
    ]
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

// Extract city from California address
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
// US State coordinate boundaries - US Census Bureau NAD83 (2017)
// Source: https://gist.github.com/a8dx/2340f9527af64f8ef8439366de981168
// Last validated: 2025-09-29
const STATE_BOUNDARIES = {
    'Alabama': { minLat: 30.223334, maxLat: 35.008028, minLng: -88.473227, maxLng: -84.88908 },
    'Alaska': { minLat: 51.214183, maxLat: 71.365162, minLng: -179.148909, maxLng: 179.77847 },
    'Arizona': { minLat: 31.332177, maxLat: 37.00426, minLng: -114.81651, maxLng: -109.045223 },
    'Arkansas': { minLat: 33.004106, maxLat: 36.4996, minLng: -94.617919, maxLng: -89.644395 },
    'California': { minLat: 32.534156, maxLat: 42.009518, minLng: -124.409591, maxLng: -114.131211 },
    'Colorado': { minLat: 36.992426, maxLat: 41.003444, minLng: -109.060253, maxLng: -102.041524 },
    'Connecticut': { minLat: 40.980144, maxLat: 42.050587, minLng: -73.727775, maxLng: -71.786994 },
    'Delaware': { minLat: 38.451013, maxLat: 39.839007, minLng: -75.788658, maxLng: -75.048939 },
    'Florida': { minLat: 24.523096, maxLat: 31.000888, minLng: -87.634938, maxLng: -80.031362 },
    'Georgia': { minLat: 30.357851, maxLat: 35.000659, minLng: -85.605165, maxLng: -80.839729 },
    'Hawaii': { minLat: 18.910361, maxLat: 28.402123, minLng: -178.334698, maxLng: -154.806773 },
    'Idaho': { minLat: 41.988057, maxLat: 49.001146, minLng: -117.243027, maxLng: -111.043564 },
    'Illinois': { minLat: 36.970298, maxLat: 42.508481, minLng: -91.513079, maxLng: -87.494756 },
    'Indiana': { minLat: 37.771742, maxLat: 41.760592, minLng: -88.09776, maxLng: -84.784579 },
    'Iowa': { minLat: 40.375501, maxLat: 43.501196, minLng: -96.639704, maxLng: -90.140061 },
    'Kansas': { minLat: 36.993016, maxLat: 40.003162, minLng: -102.051744, maxLng: -94.588413 },
    'Kentucky': { minLat: 36.497129, maxLat: 39.147458, minLng: -89.571509, maxLng: -81.964971 },
    'Louisiana': { minLat: 28.928609, maxLat: 33.019457, minLng: -94.043147, maxLng: -88.817017 },
    'Maine': { minLat: 43.058401, maxLat: 47.459686, minLng: -71.083924, maxLng: -66.949895 },
    'Maryland': { minLat: 37.911717, maxLat: 39.723043, minLng: -79.487651, maxLng: -75.048939 },
    'Massachusetts': { minLat: 41.237964, maxLat: 42.886589, minLng: -73.508142, maxLng: -69.928393 },
    'Michigan': { minLat: 41.696118, maxLat: 48.2388, minLng: -90.418136, maxLng: -82.413474 },
    'Minnesota': { minLat: 43.499356, maxLat: 49.384358, minLng: -97.239209, maxLng: -89.491739 },
    'Mississippi': { minLat: 30.173943, maxLat: 34.996052, minLng: -91.655009, maxLng: -88.097888 },
    'Missouri': { minLat: 35.995683, maxLat: 40.61364, minLng: -95.774704, maxLng: -89.098843 },
    'Montana': { minLat: 44.358221, maxLat: 49.00139, minLng: -116.050003, maxLng: -104.039138 },
    'Nebraska': { minLat: 39.999998, maxLat: 43.001708, minLng: -104.053514, maxLng: -95.30829 },
    'Nevada': { minLat: 35.001857, maxLat: 42.002207, minLng: -120.005746, maxLng: -114.039648 },
    'New Hampshire': { minLat: 42.69699, maxLat: 45.305476, minLng: -72.557247, maxLng: -70.610621 },
    'New Jersey': { minLat: 38.928519, maxLat: 41.357423, minLng: -75.559614, maxLng: -73.893979 },
    'New Mexico': { minLat: 31.332301, maxLat: 37.000232, minLng: -109.050173, maxLng: -103.001964 },
    'New York': { minLat: 40.496103, maxLat: 45.01585, minLng: -79.762152, maxLng: -71.856214 },
    'North Carolina': { minLat: 33.842316, maxLat: 36.588117, minLng: -84.321869, maxLng: -75.460621 },
    'North Dakota': { minLat: 45.935054, maxLat: 49.000574, minLng: -104.0489, maxLng: -96.554507 },
    'Ohio': { minLat: 38.403202, maxLat: 42.327132, minLng: -84.820159, maxLng: -80.518693 },
    'Oklahoma': { minLat: 33.615833, maxLat: 37.002206, minLng: -103.002565, maxLng: -94.430662 },
    'Oregon': { minLat: 41.991794, maxLat: 46.292035, minLng: -124.566244, maxLng: -116.463504 },
    'Pennsylvania': { minLat: 39.7198, maxLat: 42.26986, minLng: -80.519891, maxLng: -74.689516 },
    'Rhode Island': { minLat: 41.146339, maxLat: 42.018798, minLng: -71.862772, maxLng: -71.12057 },
    'South Carolina': { minLat: 32.0346, maxLat: 35.215402, minLng: -83.35391, maxLng: -78.54203 },
    'South Dakota': { minLat: 42.479635, maxLat: 45.94545, minLng: -104.057698, maxLng: -96.436589 },
    'Tennessee': { minLat: 34.982972, maxLat: 36.678118, minLng: -90.310298, maxLng: -81.6469 },
    'Texas': { minLat: 25.837377, maxLat: 36.500704, minLng: -106.645646, maxLng: -93.508292 },
    'Utah': { minLat: 36.997968, maxLat: 42.001567, minLng: -114.052962, maxLng: -109.041058 },
    'Vermont': { minLat: 42.726853, maxLat: 45.016659, minLng: -73.43774, maxLng: -71.464555 },
    'Virginia': { minLat: 36.540738, maxLat: 39.466012, minLng: -83.675395, maxLng: -75.242266 },
    'Washington': { minLat: 45.543541, maxLat: 49.002494, minLng: -124.848974, maxLng: -116.915989 },
    'West Virginia': { minLat: 37.201483, maxLat: 40.638801, minLng: -82.644739, maxLng: -77.719519 },
    'Wisconsin': { minLat: 42.491983, maxLat: 47.080621, minLng: -92.888114, maxLng: -86.805415 },
    'Wyoming': { minLat: 40.994746, maxLat: 45.005904, minLng: -111.056888, maxLng: -104.05216 },
    'District of Columbia': { minLat: 38.791645, maxLat: 38.99511, minLng: -77.119759, maxLng: -76.909395 }
};

// Find state by coordinates using boundary checking
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
        // Handle conflicts by choosing the best match
        // For overlapping boundaries, choose based on distance from center
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

// Assign California WSO based on coordinates 
function assignCaliforniaWSO(lat, lng) {
    // For now, use simple latitude-based division
    // North Central: roughly above 35.5°N
    // South: below 35.5°N
    if (lat >= 35.5) {
        return 'California North Central';
    } else {
        return 'California South';
    }
}

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

// Ensure directories exist
function ensureDirectories() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

// Logging utility
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    console.log(message);
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    return {
        analyze: args.includes('--analyze'),
        assign: args.includes('--assign'),
        validate: args.includes('--validate'),
        report: args.includes('--report'),
        dryRun: args.includes('--dry-run')
    };
}

// All WSO assignment logic has been moved to the shared wso-assignment-engine.js module

// Get meets from database
async function getMeets() {
    log('🔍 Fetching meets needing WSO assignment from database...');
    
    let allMeets = [];
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
        const { data: batchData, error } = await supabase
            .from('meets')
            .select('*')
            .is('wso_geography', null)  // Only fetch meets that need WSO assignment
            .range(start, start + batchSize - 1);
        
        if (error) {
            throw new Error(`Failed to fetch meets: ${error.message}`);
        }
        
        if (batchData && batchData.length > 0) {
            allMeets.push(...batchData);
            log(`  📦 Batch ${Math.floor(start/batchSize) + 1}: Found ${batchData.length} meets needing assignment (Total: ${allMeets.length})`);
            
            hasMore = batchData.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }
    
    log(`Found ${allMeets.length} meets needing WSO assignment`);
    return allMeets;
}

// Get historical WSO data from meet results
async function getHistoricalMeetWSOData() {
    log('📊 Fetching historical WSO data from meet results...');
    
    const { data, error } = await supabase
        .from('meet_results')
        .select('meet_name, wso')
        .not('meet_name', 'is', null)
        .not('wso', 'is', null);
    
    if (error) {
        log(`⚠️ Error fetching historical data: ${error.message}`);
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
    
    log(`Found historical WSO data for ${Object.keys(meetWSOMap).length} meets`);
    return meetWSOMap;
}

// Assign WSO to a single meet using shared assignment engine
async function assignMeetWSO(meet, historicalData) {
    try {
        // Use the shared sophisticated assignment logic
        const assignment = await assignWSOGeography(meet, supabase, {
            includeHistoricalData: true,
            logDetails: false
        });
        
        // Transform the result to match the expected format for this script
        return {
            meet_id: meet.meet_id,
            meet_name: meet.meet_name,
            original_wso: meet.wso_geography,
            assigned_wso: assignment.assigned_wso,
            assignment_method: assignment.assignment_method,
            confidence: assignment.confidence,
            details: {
                has_coordinates: assignment.details.has_coordinates,
                has_address: assignment.details.has_address,
                historical_match: assignment.details.historical_match,
                meet_name_match: assignment.details.meet_name_match,
                extracted_state: assignment.details.extracted_state,
                meet_location: assignment.details.meet_location,
                reasoning: assignment.details.reasoning
            }
        };
    } catch (error) {
        // Fallback in case of error
        return {
            meet_id: meet.meet_id,
            meet_name: meet.meet_name,
            original_wso: meet.wso_geography,
            assigned_wso: null,
            assignment_method: 'error',
            confidence: 0,
            details: {
                has_coordinates: !!(meet.latitude && meet.longitude),
                has_address: !!(meet.address || meet.city || meet.state),
                historical_match: false,
                meet_name_match: false,
                extracted_state: null,
                meet_location: null,
                reasoning: [`Assignment failed: ${error.message}`]
            }
        };
    }
}

// Analyze current meet data
async function analyzeMeets() {
    log('🔍 Analyzing current meet data...');
    
    const meets = await getMeets();
    const analysis = {
        total_meets: meets.length,
        with_coordinates: 0,
        with_address: 0,
        with_wso_assigned: 0,
        without_location_data: 0,
        by_state: {},
        current_wso_assignments: {},
        by_year: {}
    };
    
    for (const meet of meets) {
        // Count location data availability
        if (meet.latitude && meet.longitude) analysis.with_coordinates++;
        if (meet.address || meet.city || meet.state || meet.street_address) analysis.with_address++;
        if (meet.wso_geography) analysis.with_wso_assigned++;
        
        if (!meet.latitude && !meet.longitude && !meet.address && !meet.city && !meet.state && !meet.street_address) {
            analysis.without_location_data++;
        }
        
        // Extract state for analysis
        const addressFields = [meet.address, meet.city, meet.state, meet.street_address, meet.location_text].filter(Boolean);
        let extractedState = null;
        
        for (const field of addressFields) {
            extractedState = extractStateFromAddress(field);
            if (extractedState) break;
        }
        
        if (extractedState) {
            analysis.by_state[extractedState] = (analysis.by_state[extractedState] || 0) + 1;
        }
        
        // Count current WSO assignments
        if (meet.wso_geography) {
            analysis.current_wso_assignments[meet.wso_geography] = 
                (analysis.current_wso_assignments[meet.wso_geography] || 0) + 1;
        }
        
        // Count by year
        if (meet.start_date) {
            const year = new Date(meet.start_date).getFullYear();
            if (!isNaN(year)) {
                analysis.by_year[year] = (analysis.by_year[year] || 0) + 1;
            }
        }
    }
    
    return analysis;
}

// Verify remaining unassigned meets after processing
async function verifyAssignmentCompleteness() {
    log('🔍 Verifying assignment completeness...');

    let totalRemaining = 0;
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data: batchData, error } = await supabase
            .from('meets')
            .select('meet_id, meet_name')
            .is('wso_geography', null)
            .range(start, start + batchSize - 1);

        if (error) {
            log(`⚠️ Error verifying completeness: ${error.message}`);
            return -1;
        }

        if (batchData && batchData.length > 0) {
            totalRemaining += batchData.length;

            if (batchData.length <= 10) {
                // Log details for small number of remaining meets
                log(`  📋 Remaining unassigned meets:`);
                batchData.forEach(meet => {
                    log(`    - ID: ${meet.meet_id}, Name: ${meet.meet_name}`);
                });
            }

            hasMore = batchData.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }

    log(`📊 Verification complete: ${totalRemaining} meets remain unassigned`);
    return totalRemaining;
}

// Assign WSO geography to all meets
async function assignAllMeets(dryRun = false) {
    log('🏋️ Starting meet WSO assignment process...');

    // Get initial count for verification
    const initialMeets = await getMeets();
    log(`📊 Initial unassigned meets: ${initialMeets.length}`);

    const [meets, historicalData] = await Promise.all([
        Promise.resolve(initialMeets), // Reuse the initial fetch
        getHistoricalMeetWSOData()
    ]);

    const assignments = [];
    const summary = {
        total_processed: 0,
        successful_assignments: 0,
        failed_assignments: 0,
        database_update_failures: 0,
        by_method: {},
        by_confidence: { high: 0, medium: 0, low: 0 },
        by_wso: {}
    };

    log(`📊 Processing ${meets.length} meets...`);

    for (let i = 0; i < meets.length; i++) {
        const meet = meets[i];

        if (i % 100 === 0) {
            log(`  📋 Progress: ${i}/${meets.length} meets processed (${((i/meets.length)*100).toFixed(1)}%)`);
        }

        try {
            const assignment = await assignMeetWSO(meet, historicalData);
            assignments.push(assignment);

            summary.total_processed++;

            if (assignment.assigned_wso) {
                summary.successful_assignments++;

                // Count by method
                summary.by_method[assignment.assignment_method] =
                    (summary.by_method[assignment.assignment_method] || 0) + 1;

                // Count by confidence
                if (assignment.confidence >= 0.8) summary.by_confidence.high++;
                else if (assignment.confidence >= 0.6) summary.by_confidence.medium++;
                else summary.by_confidence.low++;

                // Count by WSO
                summary.by_wso[assignment.assigned_wso] =
                    (summary.by_wso[assignment.assigned_wso] || 0) + 1;
            } else {
                summary.failed_assignments++;
            }
        } catch (error) {
            log(`  ❌ Error assigning WSO for meet ${meet.meet_id}: ${error.message}`);
            summary.failed_assignments++;

            // Add failed assignment to track it
            assignments.push({
                meet_id: meet.meet_id,
                meet_name: meet.meet_name,
                original_wso: meet.wso_geography,
                assigned_wso: null,
                assignment_method: 'error',
                confidence: 0,
                details: {
                    has_coordinates: !!(meet.latitude && meet.longitude),
                    has_address: !!(meet.address || meet.city || meet.state),
                    error_message: error.message
                }
            });
        }
    }
    
    // Update database if not dry run
    if (!dryRun) {
        log('💾 Updating database with WSO assignments...');

        let updated = 0;
        let failed = 0;
        const successfulAssignments = assignments.filter(a => a.assigned_wso);

        log(`  📊 Attempting to update ${successfulAssignments.length} meets in database...`);

        // Process in smaller batches to avoid overwhelming the database
        const batchSize = 50;
        for (let i = 0; i < successfulAssignments.length; i += batchSize) {
            const batch = successfulAssignments.slice(i, i + batchSize);
            log(`  📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(successfulAssignments.length/batchSize)}: ${batch.length} updates`);

            for (const assignment of batch) {
                try {
                    const { error } = await supabase
                        .from('meets')
                        .update({ wso_geography: assignment.assigned_wso })
                        .eq('meet_id', assignment.meet_id);

                    if (error) {
                        log(`    ❌ Failed to update meet_id ${assignment.meet_id}: ${error.message}`);
                        failed++;
                        summary.database_update_failures++;
                    } else {
                        updated++;
                    }
                } catch (error) {
                    log(`    ❌ Error updating meet_id ${assignment.meet_id}: ${error.message}`);
                    failed++;
                    summary.database_update_failures++;
                }
            }

            // Small delay between batches
            if (i + batchSize < successfulAssignments.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        log(`✅ Database update complete: ${updated} updated, ${failed} failed`);

        // Verify the updates worked
        const remainingCount = await verifyAssignmentCompleteness();
        if (remainingCount >= 0) {
            const expectedRemaining = initialMeets.length - updated;
            log(`📊 Post-update verification:`);
            log(`  - Expected remaining: ${expectedRemaining}`);
            log(`  - Actual remaining: ${remainingCount}`);

            if (remainingCount <= expectedRemaining + 10) { // Allow small discrepancy
                log(`✅ Verification successful: remaining count is within expected range`);
            } else {
                log(`⚠️ Warning: More meets remain unassigned than expected`);
            }
        }
    }

    return { assignments, summary };
}

// Generate assignment report
function generateReport(assignments, summary, analysis) {
    const report = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_version: SCRIPT_VERSION,
            total_meets: assignments.length
        },
        analysis: analysis,
        summary: summary,
        assignments: assignments,
        validation: {
            high_confidence: assignments.filter(a => a.confidence >= 0.8).length,
            medium_confidence: assignments.filter(a => a.confidence >= 0.6 && a.confidence < 0.8).length,
            low_confidence: assignments.filter(a => a.confidence < 0.6).length,
            unassigned: assignments.filter(a => !a.assigned_wso).length
        }
    };
    
    // Save to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
    log(`📊 Assignment report saved to: ${OUTPUT_FILE}`);
    
    return report;
}

// Main function
async function main() {
    const startTime = Date.now();
    
    try {
        ensureDirectories();
        
        log('🏋️ Starting Meet WSO Assignment Script');
        log('='.repeat(60));
        
        const options = parseArguments();
        
        if (options.analyze) {
            log('📊 Running analysis mode...');
            const analysis = await analyzeMeets();
            log('\n📈 Analysis Results:');
            log(`  Total meets: ${analysis.total_meets}`);
            log(`  With coordinates: ${analysis.with_coordinates}`);
            log(`  With address data: ${analysis.with_address}`);
            log(`  With WSO assigned: ${analysis.with_wso_assigned}`);
            log(`  Without location data: ${analysis.without_location_data}`);
            log(`  States represented: ${Object.keys(analysis.by_state).length}`);
            log(`  Years covered: ${Object.keys(analysis.by_year).length}`);
            
        } else if (options.assign) {
            log('🎯 Running assignment mode...');
            const analysis = await analyzeMeets();
            const { assignments, summary } = await assignAllMeets(options.dryRun);
            const report = generateReport(assignments, summary, analysis);
            
            log('\n✅ Assignment Complete:');
            log(`  Successfully assigned: ${summary.successful_assignments}/${summary.total_processed}`);
            log(`  Assignment rate: ${((summary.successful_assignments / summary.total_processed) * 100).toFixed(1)}%`);
            log(`  High confidence: ${summary.by_confidence.high}`);
            log(`  Medium confidence: ${summary.by_confidence.medium}`);
            log(`  Low confidence: ${summary.by_confidence.low}`);
            
        } else if (options.validate || options.report) {
            log('🔍 Running validation/report mode...');
            const analysis = await analyzeMeets();
            const { assignments, summary } = await assignAllMeets(true); // Dry run
            const report = generateReport(assignments, summary, analysis);
            
            log('\n📋 Validation Report Generated');
            
        } else {
            log('Meet WSO Assignment Script');
            log('============================');
            log('');
            log('Options:');
            log('  --analyze     Analyze current meet data');
            log('  --assign      Assign WSO geography to meets');
            log('  --validate    Validate assignments (dry run)');
            log('  --report      Generate assignment report');
            log('  --dry-run     Run assignment without updating database');
            log('');
            log('Example: node meet-wso-assigner.js --assign');
        }
        
        const processingTime = Math.round((Date.now() - startTime) / 1000);
        log(`\n⏱️ Processing completed in ${processingTime}s`);
        
    } catch (error) {
        log(`\n❌ Script failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    assignMeetWSO,
    getMeets,
    verifyAssignmentCompleteness,
    assignAllMeets,
    US_STATES
};