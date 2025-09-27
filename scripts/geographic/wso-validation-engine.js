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