#!/usr/bin/env node

/**
 * Fix WSO Assignment Issues
 *
 * This script addresses the fundamental flaws in WSO assignment by:
 * 1. Using coordinate-based validation when available
 * 2. Implementing proper state boundary checking
 * 3. Validating assignments against known geographic rules
 * 4. Only assigning WSO when confidence is very high
 *
 * Usage:
 *   node fix-wso-assignments.js --analyze     # Find problematic assignments
 *   node fix-wso-assignments.js --fix         # Fix incorrect assignments
 *   node fix-wso-assignments.js --reset       # Reset all WSO assignments to start over
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'wso_fix_report.json');
const LOG_FILE = path.join(LOGS_DIR, 'fix-wso-assignments.log');

// US State coordinate boundaries (approximate bounding boxes)
const STATE_BOUNDARIES = {
    'Alabama': { minLat: 30.2, maxLat: 35.0, minLng: -88.5, maxLng: -84.9 },
    'Alaska': { minLat: 54.0, maxLat: 71.4, minLng: -179.1, maxLng: -129.9 },
    'Arizona': { minLat: 31.3, maxLat: 37.0, minLng: -114.8, maxLng: -109.0 },
    'Arkansas': { minLat: 33.0, maxLat: 36.5, minLng: -94.6, maxLng: -89.6 },
    'California': { minLat: 32.5, maxLat: 42.0, minLng: -124.4, maxLng: -114.1 },
    'Colorado': { minLat: 37.0, maxLat: 41.0, minLng: -109.1, maxLng: -102.0 },
    'Connecticut': { minLat: 40.9, maxLat: 42.1, minLng: -73.7, maxLng: -71.8 },
    'Delaware': { minLat: 38.4, maxLat: 39.8, minLng: -75.8, maxLng: -75.0 },
    'Florida': { minLat: 24.4, maxLat: 31.0, minLng: -87.6, maxLng: -80.0 },
    'Georgia': { minLat: 30.4, maxLat: 35.0, minLng: -85.6, maxLng: -80.8 },
    'Hawaii': { minLat: 18.9, maxLat: 28.4, minLng: -178.3, maxLng: -154.8 },
    'Idaho': { minLat: 42.0, maxLat: 49.0, minLng: -117.2, maxLng: -111.0 },
    'Illinois': { minLat: 36.9, maxLat: 42.5, minLng: -91.5, maxLng: -87.0 },
    'Indiana': { minLat: 37.8, maxLat: 41.8, minLng: -88.1, maxLng: -84.8 },
    'Iowa': { minLat: 40.4, maxLat: 43.5, minLng: -96.6, maxLng: -90.1 },
    'Kansas': { minLat: 37.0, maxLat: 40.0, minLng: -102.1, maxLng: -94.6 },
    'Kentucky': { minLat: 36.5, maxLat: 39.1, minLng: -89.6, maxLng: -81.9 },
    'Louisiana': { minLat: 28.9, maxLat: 33.0, minLng: -94.0, maxLng: -88.8 },
    'Maine': { minLat: 43.1, maxLat: 47.5, minLng: -71.1, maxLng: -66.9 },
    'Maryland': { minLat: 37.9, maxLat: 39.7, minLng: -79.5, maxLng: -75.0 },
    'Massachusetts': { minLat: 41.2, maxLat: 42.9, minLng: -73.5, maxLng: -69.9 },
    'Michigan': { minLat: 41.7, maxLat: 48.2, minLng: -90.4, maxLng: -82.4 },
    'Minnesota': { minLat: 43.5, maxLat: 49.4, minLng: -97.2, maxLng: -89.5 },
    'Mississippi': { minLat: 30.2, maxLat: 35.0, minLng: -91.7, maxLng: -88.1 },
    'Missouri': { minLat: 36.0, maxLat: 40.6, minLng: -95.8, maxLng: -89.1 },
    'Montana': { minLat: 45.0, maxLat: 49.0, minLng: -116.1, maxLng: -104.0 },
    'Nebraska': { minLat: 40.0, maxLat: 43.0, minLng: -104.1, maxLng: -95.3 },
    'Nevada': { minLat: 35.0, maxLat: 42.0, minLng: -120.0, maxLng: -114.0 },
    'New Hampshire': { minLat: 42.7, maxLat: 45.3, minLng: -72.6, maxLng: -70.6 },
    'New Jersey': { minLat: 38.9, maxLat: 41.4, minLng: -75.6, maxLng: -73.9 },
    'New Mexico': { minLat: 31.3, maxLat: 37.0, minLng: -109.1, maxLng: -103.0 },
    'New York': { minLat: 40.5, maxLat: 45.0, minLng: -79.8, maxLng: -71.9 },
    'North Carolina': { minLat: 33.8, maxLat: 36.6, minLng: -84.3, maxLng: -75.5 },
    'North Dakota': { minLat: 45.9, maxLat: 49.0, minLng: -104.1, maxLng: -96.6 },
    'Ohio': { minLat: 38.4, maxLat: 42.3, minLng: -84.8, maxLng: -80.5 },
    'Oklahoma': { minLat: 33.6, maxLat: 37.0, minLng: -103.0, maxLng: -94.4 },
    'Oregon': { minLat: 42.0, maxLat: 46.3, minLng: -124.6, maxLng: -116.5 },
    'Pennsylvania': { minLat: 39.7, maxLat: 42.5, minLng: -80.5, maxLng: -74.7 },
    'Rhode Island': { minLat: 41.1, maxLat: 42.0, minLng: -71.9, maxLng: -71.1 },
    'South Carolina': { minLat: 32.0, maxLat: 35.2, minLng: -83.4, maxLng: -78.5 },
    'South Dakota': { minLat: 42.5, maxLat: 45.9, minLng: -104.1, maxLng: -96.4 },
    'Tennessee': { minLat: 35.0, maxLat: 36.7, minLng: -90.3, maxLng: -81.6 },
    'Texas': { minLat: 25.8, maxLat: 36.5, minLng: -106.6, maxLng: -93.5 },
    'Utah': { minLat: 37.0, maxLat: 42.0, minLng: -114.1, maxLng: -109.0 },
    'Vermont': { minLat: 42.7, maxLat: 45.0, minLng: -73.4, maxLng: -71.5 },
    'Virginia': { minLat: 36.5, maxLat: 39.5, minLng: -83.7, maxLng: -75.2 },
    'Washington': { minLat: 45.5, maxLat: 49.0, minLng: -124.8, maxLng: -116.9 },
    'West Virginia': { minLat: 37.2, maxLat: 40.6, minLng: -82.6, maxLng: -77.7 },
    'Wisconsin': { minLat: 42.5, maxLat: 47.1, minLng: -92.9, maxLng: -86.8 },
    'Wyoming': { minLat: 41.0, maxLat: 45.0, minLng: -111.1, maxLng: -104.1 }
};

// WSO Geographic Mapping
const WSO_MAPPINGS = {
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
    'Carolina': ['North Carolina', 'South Carolina'],
    'DMV': ['Delaware', 'Maryland', 'Virginia'],
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
    'California North Central': ['California'], // Northern CA
    'California South': ['California'], // Southern CA
    'Hawaii and International': ['Hawaii']
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

// Check if coordinates are within a state's boundaries
function isCoordinateInState(lat, lng, state) {
    if (!STATE_BOUNDARIES[state]) return false;

    const bounds = STATE_BOUNDARIES[state];
    return lat >= bounds.minLat && lat <= bounds.maxLat &&
        lng >= bounds.minLng && lng <= bounds.maxLng;
}

// Validate WSO assignment against coordinates
function validateWSO(wso, lat, lng) {
    if (!wso || !lat || !lng) return false;

    const states = WSO_MAPPINGS[wso];
    if (!states) return false;

    // Check if coordinates fall within any of the WSO's states
    return states.some(state => isCoordinateInState(lat, lng, state));
}

// Find problematic assignments
async function findProblematicAssignments() {
    log('🔍 Finding problematic WSO assignments...');

    const { data: meets, error } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, wso_geography, latitude, longitude, city, state, country, geocode_success')
        .not('wso_geography', 'is', null)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);

    if (error) {
        throw new Error(`Failed to fetch meets: ${error.message}`);
    }

    const problematic = [];

    for (const meet of meets) {
        const lat = parseFloat(meet.latitude);
        const lng = parseFloat(meet.longitude);

        if (isNaN(lat) || isNaN(lng)) continue;

        const isValid = validateWSO(meet.wso_geography, lat, lng);

        if (!isValid) {
            // Find which state the coordinates actually fall in
            let actualState = null;
            for (const [state, bounds] of Object.entries(STATE_BOUNDARIES)) {
                if (isCoordinateInState(lat, lng, state)) {
                    actualState = state;
                    break;
                }
            }

            problematic.push({
                meet_id: meet.meet_id,
                name: meet.Meet,
                assigned_wso: meet.wso_geography,
                coordinates: { lat, lng },
                location_text: `${meet.city || ''}, ${meet.state || ''}, ${meet.country || ''}`.trim(),
                actual_state: actualState,
                geocode_success: meet.geocode_success
            });
        }
    }

    return problematic;
}

// Fix incorrect assignments
async function fixIncorrectAssignments(problematic, dryRun = false) {
    log(`🔧 ${dryRun ? 'Analyzing' : 'Fixing'} ${problematic.length} problematic assignments...`);

    let fixed = 0;
    let failed = 0;

    for (const meet of problematic) {
        try {
            if (!dryRun) {
                // Set WSO to null for incorrect assignments
                // We're being conservative and only removing bad assignments
                const { error } = await supabase
                    .from('usaw_meets')
                    .update({ wso_geography: null })
                    .eq('meet_id', meet.meet_id);

                if (error) {
                    log(`❌ Failed to fix meet_id ${meet.meet_id}: ${error.message}`);
                    failed++;
                } else {
                    fixed++;
                }
            } else {
                log(`🔍 Would fix: "${meet.name}" (${meet.assigned_wso} -> NULL) - Actually in ${meet.actual_state || 'Unknown'}`);
            }
        } catch (error) {
            log(`❌ Error processing meet_id ${meet.meet_id}: ${error.message}`);
            failed++;
        }
    }

    return { fixed, failed };
}

// Reset all WSO assignments
async function resetAllWSO() {
    log('🔄 Resetting all WSO assignments...');

    const { error } = await supabase
        .from('usaw_meets')
        .update({ wso_geography: null })
        .not('wso_geography', 'is', null);

    if (error) {
        throw new Error(`Failed to reset WSO assignments: ${error.message}`);
    }

    const { count } = await supabase
        .from('usaw_meets')
        .select('*', { count: 'exact', head: true })
        .not('wso_geography', 'is', null);

    log(`✅ Reset complete. Remaining assignments: ${count || 0}`);
}

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    return {
        analyze: args.includes('--analyze'),
        fix: args.includes('--fix'),
        reset: args.includes('--reset'),
        dryRun: args.includes('--dry-run')
    };
}

// Main function
async function main() {
    const startTime = Date.now();

    try {
        ensureDirectories();

        log('🔧 Starting WSO Assignment Fix Script');
        log('='.repeat(60));

        const options = parseArguments();

        if (options.reset) {
            log('🔄 Running reset mode...');
            await resetAllWSO();

        } else if (options.analyze || options.fix) {
            const problematic = await findProblematicAssignments();

            log(`\n📊 Found ${problematic.length} problematic assignments:`);

            // Show examples
            const examples = problematic.slice(0, 10);
            examples.forEach((meet, index) => {
                log(`  ${index + 1}. "${meet.name}" -> ${meet.assigned_wso} (Actually in ${meet.actual_state || 'Unknown'})`);
                log(`     Location: ${meet.location_text}`);
                log(`     Coordinates: ${meet.coordinates.lat}, ${meet.coordinates.lng}`);
            });

            if (problematic.length > 10) {
                log(`  ... and ${problematic.length - 10} more`);
            }

            if (options.fix) {
                const { fixed, failed } = await fixIncorrectAssignments(problematic, options.dryRun);

                log(`\n✅ Fix Results:`);
                log(`  Fixed: ${fixed}`);
                log(`  Failed: ${failed}`);

                if (options.dryRun) {
                    log(`\n🔍 This was a dry run - no changes made`);
                    log(`Run with --fix (without --dry-run) to apply changes`);
                }
            }

        } else {
            log('WSO Assignment Fix Script');
            log('==========================');
            log('');
            log('Options:');
            log('  --analyze     Find problematic WSO assignments');
            log('  --fix         Fix incorrect assignments (sets to NULL)');
            log('  --reset       Reset all WSO assignments to NULL');
            log('  --dry-run     Preview changes without applying them');
            log('');
            log('Examples:');
            log('  node fix-wso-assignments.js --analyze');
            log('  node fix-wso-assignments.js --fix --dry-run');
            log('  node fix-wso-assignments.js --fix');
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