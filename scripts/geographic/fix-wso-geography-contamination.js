/**
 * WSO Geography Contamination Fix Script
 * 
 * Purpose: Detects and corrects contaminated WSO geography assignments in both
 * the meets table and meet_results table where meets are assigned to incorrect
 * WSO regions based on their actual geographic location.
 * 
 * Contamination Examples:
 * - Tennessee meets assigned to Carolina WSO
 * - Michigan meets assigned to Ohio WSO  
 * - Bakersfield, CA meets assigned to North Central (should be South)
 * 
 * Strategy:
 * 1. Use coordinate-based validation to detect incorrect assignments
 * 2. Apply correct WSO assignments using existing mapping logic
 * 3. Update both meets and meet_results tables for consistency
 * 4. Generate detailed reports of all changes made
 * 
 * Usage:
 *   node fix-wso-geography-contamination.js --analyze     # Analyze contamination only
 *   node fix-wso-geography-contamination.js --fix         # Fix contamination 
 *   node fix-wso-geography-contamination.js --validate    # Validate fixes
 *   node fix-wso-geography-contamination.js --dry-run     # Show what would be fixed
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'wso_geography_contamination_fix.json');
const LOG_FILE = path.join(LOGS_DIR, 'fix-wso-geography-contamination.log');
const SCRIPT_VERSION = '1.0.0';

// US State abbreviation to full name mapping
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

// WSO Geographic Mapping (from wso-assignment-engine.js)
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
        fix: args.includes('--fix'),
        validate: args.includes('--validate'),
        dryRun: args.includes('--dry-run')
    };
}

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

// Assign California WSO based on coordinates 
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

// Assign WSO based on state and coordinates
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

// Validate if current WSO assignment is correct
function validateWSOAssignment(currentWSO, actualState, lat, lng) {
    if (!currentWSO || !actualState) return { isValid: false, reason: 'Missing data' };

    const correctWSO = assignCorrectWSO(actualState, lat, lng);

    if (!correctWSO) {
        return { isValid: false, reason: 'Cannot determine correct WSO' };
    }

    const isValid = currentWSO === correctWSO;

    return {
        isValid,
        correctWSO,
        reason: isValid ? 'Assignment is correct' : `Should be ${correctWSO} based on location in ${actualState}`
    };
}

// Get meets with coordinates and WSO assignments for analysis
async function getMeetsForAnalysis() {
    log('🔍 Fetching meets with coordinates and WSO assignments...');

    let allMeets = [];
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data: batchData, error } = await supabase
            .from('usaw_meets')
            .select('meet_id, Meet, wso_geography, latitude, longitude, address, city, state, country')
            .not('wso_geography', 'is', null)
            .not('latitude', 'is', null)
            .not('longitude', 'is', null)
            .range(start, start + batchSize - 1);

        if (error) {
            throw new Error(`Failed to fetch meets: ${error.message}`);
        }

        if (batchData && batchData.length > 0) {
            allMeets.push(...batchData);
            log(`  Fetched batch ${Math.floor(start / batchSize) + 1}: ${batchData.length} meets (Total: ${allMeets.length})`);

            hasMore = batchData.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }

    log(`Found ${allMeets.length} meets with coordinates and WSO assignments`);
    return allMeets;
}

// Analyze contamination in WSO assignments
async function analyzeContamination() {
    log('🧬 Analyzing WSO geography contamination...');

    const meets = await getMeetsForAnalysis();
    const contaminated = [];
    const validAssignments = [];

    for (const meet of meets) {
        const lat = parseFloat(meet.latitude);
        const lng = parseFloat(meet.longitude);

        if (isNaN(lat) || isNaN(lng)) {
            continue;
        }

        // Prefer database state field over coordinate-based detection
        // (coordinates have bounding box overlaps, state field is authoritative)
        let actualState = null;

        if (meet.state) {
            // Normalize state name
            const stateStr = meet.state.trim();
            // Check if it's a full name or abbreviation
            actualState = US_STATES[stateStr.toUpperCase()] || stateStr;
            // Ensure it matches our state boundary keys
            if (!STATE_BOUNDARIES[actualState]) {
                actualState = null;
            }
        }

        // Fall back to coordinate-based detection if state field missing/invalid
        if (!actualState) {
            actualState = findStateByCoordinates(lat, lng);
        }

        if (!actualState) {
            continue;
        }

        // Validate current WSO assignment
        const validation = validateWSOAssignment(meet.wso_geography, actualState, lat, lng);

        if (!validation.isValid) {
            contaminated.push({
                meet_id: meet.meet_id,
                meet_name: meet.Meet,
                current_wso: meet.wso_geography,
                correct_wso: validation.correctWSO,
                actual_state: actualState,
                coordinates: { lat, lng },
                location_text: `${meet.city || ''}, ${meet.state || ''}, ${meet.country || ''}`.trim(),
                reason: validation.reason,
                confidence: 'high' // High confidence for coordinate-based validation
            });
        } else {
            validAssignments.push({
                meet_id: meet.meet_id,
                meet_name: meet.Meet,
                wso: meet.wso_geography,
                state: actualState
            });
        }
    }

    // Generate contamination statistics by WSO
    const contaminationStats = {};
    const wsoTotals = {};

    // Count total meets per WSO
    for (const meet of meets) {
        const wso = meet.wso_geography;
        wsoTotals[wso] = (wsoTotals[wso] || 0) + 1;
    }

    // Count contaminated meets per WSO
    for (const contam of contaminated) {
        const wso = contam.current_wso;
        if (!contaminationStats[wso]) {
            contaminationStats[wso] = {
                total_meets: wsoTotals[wso] || 0,
                contaminated_meets: 0,
                contaminated_examples: []
            };
        }
        contaminationStats[wso].contaminated_meets++;
        contaminationStats[wso].contaminated_examples.push({
            meet_name: contam.meet_name,
            actual_state: contam.actual_state,
            correct_wso: contam.correct_wso
        });
    }

    // Calculate contamination rates
    for (const [wso, stats] of Object.entries(contaminationStats)) {
        stats.contamination_rate = ((stats.contaminated_meets / stats.total_meets) * 100).toFixed(1);
    }

    log(`Found ${contaminated.length} contaminated meets out of ${meets.length} total`);
    log(`Found ${validAssignments.length} correctly assigned meets`);

    return {
        contaminated,
        validAssignments,
        contaminationStats,
        summary: {
            total_meets: meets.length,
            contaminated_count: contaminated.length,
            valid_count: validAssignments.length,
            contamination_rate: ((contaminated.length / meets.length) * 100).toFixed(2)
        }
    };
}

// Fix contaminated WSO assignments in meets table
async function fixMeetsTable(contaminatedMeets, dryRun = false) {
    log(`🔧 ${dryRun ? 'DRY RUN: Would fix' : 'Fixing'} ${contaminatedMeets.length} contaminated meets...`);

    const fixResults = [];

    for (const meet of contaminatedMeets) {
        const fixResult = {
            meet_id: meet.meet_id,
            meet_name: meet.meet_name,
            old_wso: meet.current_wso,
            new_wso: meet.correct_wso,
            success: false,
            error: null
        };

        if (!dryRun) {
            try {
                const { error } = await supabase
                    .from('usaw_meets')
                    .update({ wso_geography: meet.correct_wso })
                    .eq('meet_id', meet.meet_id);

                if (error) {
                    fixResult.error = error.message;
                    log(`❌ Failed to fix meet ${meet.meet_id}: ${error.message}`);
                } else {
                    fixResult.success = true;
                    log(`✅ Fixed meet ${meet.meet_id}: ${meet.current_wso} → ${meet.correct_wso}`);
                }
            } catch (error) {
                fixResult.error = error.message;
                log(`❌ Exception fixing meet ${meet.meet_id}: ${error.message}`);
            }
        } else {
            fixResult.success = true; // For dry run
            log(`🔍 Would fix meet ${meet.meet_id}: ${meet.current_wso} → ${meet.correct_wso}`);
        }

        fixResults.push(fixResult);
    }

    const successCount = fixResults.filter(r => r.success).length;
    const failureCount = fixResults.filter(r => !r.success).length;

    log(`${dryRun ? 'DRY RUN: Would have fixed' : 'Fixed'} ${successCount} meets successfully`);
    if (failureCount > 0) {
        log(`❌ Failed to fix ${failureCount} meets`);
    }

    return fixResults;
}

// Update meet_results table with corrected WSO geography
async function updateMeetResultsTable(contaminatedMeets, dryRun = false) {
    log(`🔄 ${dryRun ? 'DRY RUN: Would update' : 'Updating'} meet_results table...`);

    const updateResults = [];

    for (const meet of contaminatedMeets) {
        const updateResult = {
            meet_id: meet.meet_id,
            meet_name: meet.meet_name,
            old_wso: meet.current_wso,
            new_wso: meet.correct_wso,
            affected_records: 0,
            success: false,
            error: null
        };

        if (!dryRun) {
            try {
                // First count how many records will be affected
                const { count, error: countError } = await supabase
                    .from('usaw_meet_results')
                    .select('*', { count: 'exact', head: true })
                    .eq('meet_id', meet.meet_id);

                if (countError) {
                    updateResult.error = `Count error: ${countError.message}`;
                    log(`❌ Failed to count records for meet ${meet.meet_id}: ${countError.message}`);
                    updateResults.push(updateResult);
                    continue;
                }

                updateResult.affected_records = count;

                // Update the records
                const { error: updateError } = await supabase
                    .from('usaw_meet_results')
                    .update({ wso: meet.correct_wso })
                    .eq('meet_id', meet.meet_id);

                if (updateError) {
                    updateResult.error = updateError.message;
                    log(`❌ Failed to update meet_results for meet ${meet.meet_id}: ${updateError.message}`);
                } else {
                    updateResult.success = true;
                    log(`✅ Updated ${count} meet_results records for meet ${meet.meet_id}`);
                }
            } catch (error) {
                updateResult.error = error.message;
                log(`❌ Exception updating meet_results for meet ${meet.meet_id}: ${error.message}`);
            }
        } else {
            // For dry run, still count the records that would be affected
            try {
                const { count, error: countError } = await supabase
                    .from('usaw_meet_results')
                    .select('*', { count: 'exact', head: true })
                    .eq('meet_id', meet.meet_id);

                if (!countError) {
                    updateResult.affected_records = count;
                    updateResult.success = true;
                    log(`🔍 Would update ${count} meet_results records for meet ${meet.meet_id}`);
                }
            } catch (error) {
                log(`⚠️ Could not count records for meet ${meet.meet_id}: ${error.message}`);
            }
        }

        updateResults.push(updateResult);
    }

    const totalRecordsAffected = updateResults.reduce((sum, r) => sum + r.affected_records, 0);
    const successCount = updateResults.filter(r => r.success).length;
    const failureCount = updateResults.filter(r => !r.success).length;

    log(`${dryRun ? 'DRY RUN: Would have updated' : 'Updated'} ${totalRecordsAffected} meet_results records across ${successCount} meets`);
    if (failureCount > 0) {
        log(`❌ Failed to update ${failureCount} meets in meet_results`);
    }

    return updateResults;
}

// Generate comprehensive report
function generateReport(analysisResult, fixResults = null, updateResults = null, options = {}) {
    const report = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_name: 'fix-wso-geography-contamination',
            script_version: SCRIPT_VERSION,
            operation: options.dryRun ? 'dry-run' : (options.fix ? 'fix' : 'analyze')
        },
        summary: analysisResult.summary,
        contamination_by_wso: analysisResult.contaminationStats,
        contaminated_meets: analysisResult.contaminated,
        valid_assignments: analysisResult.validAssignments.length,
        fix_results: fixResults || null,
        update_results: updateResults || null
    };

    return report;
}

// Main execution function
async function main() {
    const startTime = Date.now();

    try {
        ensureDirectories();
        log('🔍 WSO Geography Contamination Fix Script Started');
        log('='.repeat(60));

        const options = parseArguments();

        if (!options.analyze && !options.fix && !options.validate && !options.dryRun) {
            log('❌ Please specify operation: --analyze, --fix, --validate, or --dry-run');
            process.exit(1);
        }

        // Step 1: Analyze contamination
        const analysisResult = await analyzeContamination();

        // Display contamination summary
        log('\n📊 CONTAMINATION ANALYSIS RESULTS');
        log('='.repeat(40));
        log(`Total meets analyzed: ${analysisResult.summary.total_meets}`);
        log(`Contaminated meets: ${analysisResult.summary.contaminated_count}`);
        log(`Valid assignments: ${analysisResult.summary.valid_count}`);
        log(`Overall contamination rate: ${analysisResult.summary.contamination_rate}%`);

        if (Object.keys(analysisResult.contaminationStats).length > 0) {
            log('\n🦠 CONTAMINATION BY WSO:');
            for (const [wso, stats] of Object.entries(analysisResult.contaminationStats)) {
                log(`  ${wso}: ${stats.contamination_rate}% (${stats.contaminated_meets}/${stats.total_meets} meets)`);

                // Show examples
                const examples = stats.contaminated_examples.slice(0, 3);
                for (const example of examples) {
                    log(`    • "${example.meet_name}" in ${example.actual_state} should be ${example.correct_wso}`);
                }
                if (stats.contaminated_examples.length > 3) {
                    log(`    ... and ${stats.contaminated_examples.length - 3} more`);
                }
            }
        }

        let fixResults = null;
        let updateResults = null;

        // Step 2: Fix contamination if requested
        if (options.fix || options.dryRun) {
            if (analysisResult.contaminated.length === 0) {
                log('\n✅ No contaminated meets found - nothing to fix');
            } else {
                log(`\n🔧 ${options.dryRun ? 'DRY RUN: Simulating fixes' : 'Fixing contamination'}...`);

                // Fix meets table
                fixResults = await fixMeetsTable(analysisResult.contaminated, options.dryRun);

                // Update meet_results table
                updateResults = await updateMeetResultsTable(analysisResult.contaminated, options.dryRun);
            }
        }

        // Step 3: Generate and save report
        const report = generateReport(analysisResult, fixResults, updateResults, options);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
        log(`\n📄 Report saved to: ${OUTPUT_FILE}`);

        // Final summary
        log('\n' + '='.repeat(60));
        log('✅ WSO GEOGRAPHY CONTAMINATION FIX COMPLETE');
        if (options.fix && !options.dryRun) {
            const fixedCount = fixResults ? fixResults.filter(r => r.success).length : 0;
            const updatedCount = updateResults ? updateResults.filter(r => r.success).length : 0;
            log(`   Fixed ${fixedCount} meets in meets table`);
            log(`   Updated ${updatedCount} meets in meet_results table`);
        } else if (options.dryRun) {
            log(`   DRY RUN: Would fix ${analysisResult.contaminated.length} contaminated meets`);
        } else {
            log(`   Analysis found ${analysisResult.contaminated.length} contaminated meets`);
        }
        log(`   Processing time: ${Date.now() - startTime}ms`);

    } catch (error) {
        log(`\n❌ Script failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Export functions for testing
module.exports = {
    findStateByCoordinates,
    assignCaliforniaWSO,
    assignCorrectWSO,
    validateWSOAssignment,
    analyzeContamination
};

// Run if called directly
if (require.main === module) {
    main();
}