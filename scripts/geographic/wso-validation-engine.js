/**
 * WSO Validation Engine
 * 
 * Provides validation functions to prevent WSO geography contamination
 * during data imports and processing. This module ensures that meets
 * are assigned to correct WSO regions based on their geographic coordinates.
 * 
 * Usage:
 *   const { validateWSOAssignment, preventContamination } = require('./wso-validation-engine');
 *   
 *   // Validate existing assignment
 *   const validation = validateWSOAssignment(currentWSO, lat, lng);
 *   
 *   // Get correct WSO for coordinates
 *   const correctWSO = preventContamination(lat, lng, address);
 */

// US State coordinate boundaries (from fix-wso-geography-contamination.js)
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

/**
 * Find state by coordinates using boundary checking
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string|null} - State name or null if not found
 */
function findStateByCoordinates(lat, lng) {
    if (isNaN(lat) || isNaN(lng)) {
        return null;
    }
    
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
        // AND known geographic priority (some states take precedence in border regions)
        let bestMatch = matches[0];
        let bestDistance = Infinity;
        
        // Known border resolution priorities
        const borderPriorities = {
            'Johnson City area': ['Tennessee', 'North Carolina'], // Tennessee has priority  
            'Ann Arbor area': ['Michigan', 'Ohio'] // Michigan has priority
        };
        
        // Special handling for known border conflicts
        if (matches.includes('Tennessee') && matches.includes('North Carolina')) {
            // Johnson City, TN area - Tennessee takes priority
            return 'Tennessee';
        }
        
        if (matches.includes('Michigan') && matches.includes('Ohio')) {
            // Ann Arbor, MI area - Michigan takes priority
            return 'Michigan';
        }
        
        if (matches.includes('Alabama') && matches.includes('Florida')) {
            // Florida Panhandle area - latitude determines the state
            // Florida Panhandle is below ~31°N, Alabama is above
            if (lat < 31.0) {
                return 'Florida';
            } else {
                return 'Alabama';
            }
        }
        
        // Default to distance-based resolution for other conflicts
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
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude  
 * @returns {string} - California WSO region
 */
function assignCaliforniaWSO(lat, lng) {
    // California dividing line: roughly 35.5°N
    // North Central: above 35.5°N (includes Bay Area, Central Valley North)
    // South: below 35.5°N (includes LA, San Diego, Inland Empire, Bakersfield)
    if (lat >= 35.5) {
        return 'California North Central';
    } else {
        return 'California South';
    }
}

/**
 * Assign correct WSO based on state and coordinates
 * @param {string} state - State name
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string|null} - WSO name or null if not found
 */
function assignCorrectWSO(state, lat, lng) {
    if (!state) return null;
    
    // Special handling for California - use coordinates for regional assignment
    if (state === 'California') {
        return assignCaliforniaWSO(lat, lng);
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
 * Validate if current WSO assignment is correct
 * @param {string} currentWSO - Current WSO assignment
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Object} - Validation result with isValid, correctWSO, actualState, and reason
 */
function validateWSOAssignment(currentWSO, lat, lng) {
    if (!currentWSO || isNaN(lat) || isNaN(lng)) {
        return { 
            isValid: false, 
            correctWSO: null, 
            actualState: null,
            reason: 'Missing WSO assignment or invalid coordinates' 
        };
    }
    
    // Find actual state based on coordinates
    const actualState = findStateByCoordinates(lat, lng);
    
    if (!actualState) {
        return { 
            isValid: false, 
            correctWSO: null, 
            actualState: null,
            reason: 'Coordinates do not fall within any US state boundaries' 
        };
    }
    
    // Get correct WSO for this location
    const correctWSO = assignCorrectWSO(actualState, lat, lng);
    
    if (!correctWSO) {
        return { 
            isValid: false, 
            correctWSO: null, 
            actualState,
            reason: `Cannot determine correct WSO for state: ${actualState}` 
        };
    }
    
    const isValid = currentWSO === correctWSO;
    
    return {
        isValid,
        correctWSO,
        actualState,
        reason: isValid ? 'Assignment is correct' : `Should be ${correctWSO} based on location in ${actualState}`
    };
}

/**
 * Prevent contamination by returning the correct WSO for given coordinates
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} address - Optional address for debugging
 * @returns {Object} - Result with correctWSO, state, confidence, and method
 */
function preventContamination(lat, lng, address = null) {
    if (isNaN(lat) || isNaN(lng)) {
        return {
            correctWSO: null,
            state: null,
            confidence: 0,
            method: 'invalid_coordinates',
            warning: 'Invalid or missing coordinates'
        };
    }
    
    // Find state based on coordinates
    const state = findStateByCoordinates(lat, lng);
    
    if (!state) {
        return {
            correctWSO: null,
            state: null,
            confidence: 0,
            method: 'coordinates_out_of_bounds',
            warning: 'Coordinates do not fall within any US state boundaries'
        };
    }
    
    // Get correct WSO
    const correctWSO = assignCorrectWSO(state, lat, lng);
    
    if (!correctWSO) {
        return {
            correctWSO: null,
            state,
            confidence: 0,
            method: 'no_wso_mapping',
            warning: `No WSO mapping found for state: ${state}`
        };
    }
    
    return {
        correctWSO,
        state,
        confidence: 0.95, // High confidence for coordinate-based assignment
        method: 'coordinate_validation',
        warning: null
    };
}

/**
 * Check for potential contamination issues in a dataset
 * @param {Array} meets - Array of meet objects with wso_geography, latitude, longitude
 * @returns {Object} - Summary of contamination issues
 */
function checkDatasetForContamination(meets) {
    const contaminated = [];
    const valid = [];
    const invalid = [];
    
    for (const meet of meets) {
        if (!meet.latitude || !meet.longitude || !meet.wso_geography) {
            invalid.push({
                meet_id: meet.meet_id,
                reason: 'Missing required fields (latitude, longitude, or wso_geography)'
            });
            continue;
        }
        
        const validation = validateWSOAssignment(
            meet.wso_geography, 
            parseFloat(meet.latitude), 
            parseFloat(meet.longitude)
        );
        
        if (validation.isValid) {
            valid.push(meet.meet_id);
        } else {
            contaminated.push({
                meet_id: meet.meet_id,
                current_wso: meet.wso_geography,
                correct_wso: validation.correctWSO,
                actual_state: validation.actualState,
                reason: validation.reason
            });
        }
    }
    
    return {
        total: meets.length,
        valid: valid.length,
        contaminated: contaminated.length,
        invalid: invalid.length,
        contamination_rate: ((contaminated.length / meets.length) * 100).toFixed(2),
        contaminated_meets: contaminated,
        invalid_meets: invalid
    };
}

/**
 * Get a logging function that includes contamination warnings
 * @param {Function} baseLogger - Base logging function (e.g., console.log)
 * @returns {Function} - Enhanced logging function
 */
function getContaminationAwareLogger(baseLogger = console.log) {
    return function logWithContaminationCheck(message, meetData = null) {
        baseLogger(message);
        
        if (meetData && meetData.wso_geography && meetData.latitude && meetData.longitude) {
            const validation = validateWSOAssignment(
                meetData.wso_geography,
                parseFloat(meetData.latitude),
                parseFloat(meetData.longitude)
            );
            
            if (!validation.isValid) {
                baseLogger(`  ⚠️ CONTAMINATION ALERT: ${validation.reason}`);
                baseLogger(`     Current: ${meetData.wso_geography}, Should be: ${validation.correctWSO}`);
            }
        }
    };
}

module.exports = {
    // Core validation functions
    findStateByCoordinates,
    assignCaliforniaWSO,
    assignCorrectWSO,
    validateWSOAssignment,
    preventContamination,
    
    // Dataset validation
    checkDatasetForContamination,
    
    // Utility functions
    getContaminationAwareLogger,
    
    // Constants for external use
    STATE_BOUNDARIES,
    WSO_MAPPINGS
};