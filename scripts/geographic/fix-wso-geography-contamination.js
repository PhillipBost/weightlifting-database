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

// US State coordinate boundaries (from meet-wso-assigner.js)
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
    
    const { data: meets, error } = await supabase
        .from('meets')
        .select('meet_id, Meet, wso_geography, latitude, longitude, address, city, state, country')
        .not('wso_geography', 'is', null)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);
    
    if (error) {
        throw new Error(`Failed to fetch meets: ${error.message}`);
    }
    
    log(`Found ${meets.length} meets with coordinates and WSO assignments`);
    return meets;
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
        
        // Find actual state based on coordinates
        const actualState = findStateByCoordinates(lat, lng);
        
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
                    .from('meets')
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
                    .from('meet_results')
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
                    .from('meet_results')
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
                    .from('meet_results')
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
        log('=' .repeat(60));
        
        const options = parseArguments();
        
        if (!options.analyze && !options.fix && !options.validate && !options.dryRun) {
            log('❌ Please specify operation: --analyze, --fix, --validate, or --dry-run');
            process.exit(1);
        }
        
        // Step 1: Analyze contamination
        const analysisResult = await analyzeContamination();
        
        // Display contamination summary
        log('\n📊 CONTAMINATION ANALYSIS RESULTS');
        log('=' .repeat(40));
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
        log('\n' + '=' .repeat(60));
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