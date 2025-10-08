#!/usr/bin/env node

/**
 * Backfill Club States Script
 *
 * This script populates the `state` column in the clubs table by extracting
 * state information from existing address and coordinate data.
 *
 * Strategy:
 * 1. Extract state from address using text parsing
 * 2. If no state found, use coordinates to determine state
 * 3. Update clubs table with extracted state
 *
 * This enables the WSO assignment engine to use the high-confidence (98%)
 * state field strategy instead of relying on lower-confidence methods.
 *
 * Usage:
 *   node backfill-club-states.js --analyze    # Analyze what would be updated
 *   node backfill-club-states.js --backfill   # Perform the backfill
 *   node backfill-club-states.js --verify     # Verify backfill results
 */

const { createClient } = require('@supabase/supabase-js');
const { extractStateFromAddress, findStateByCoordinates, US_STATES } = require('./wso-assignment-engine');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Configuration
const LOGS_DIR = './logs';
const LOG_FILE = path.join(LOGS_DIR, 'backfill-club-states.log');
const OUTPUT_DIR = './output';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'club_state_backfill.json');

// Ensure directories exist
function ensureDirectories() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
        backfill: args.includes('--backfill'),
        verify: args.includes('--verify'),
        dryRun: args.includes('--dry-run')
    };
}

// Get all clubs from database
async function getAllClubs() {
    log('🔍 Fetching all clubs from database...');

    let allClubs = [];
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data: batchData, error } = await supabase
            .from('clubs')
            .select('club_name, address, state, latitude, longitude, wso_geography')
            .range(start, start + batchSize - 1);

        if (error) {
            throw new Error(`Failed to fetch clubs: ${error.message}`);
        }

        if (batchData && batchData.length > 0) {
            allClubs.push(...batchData);
            log(`  📦 Batch ${Math.floor(start/batchSize) + 1}: Found ${batchData.length} clubs (Total: ${allClubs.length})`);

            hasMore = batchData.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }

    log(`✅ Fetched ${allClubs.length} clubs from database`);
    return allClubs;
}

// Extract state for a single club
function extractClubState(club) {
    let extractedState = null;
    let method = null;

    // Strategy 1: Check if state field already populated
    if (club.state) {
        // Normalize existing state value
        const stateValue = club.state.trim();
        extractedState = US_STATES[stateValue.toUpperCase()] || extractStateFromAddress(stateValue);
        if (extractedState) {
            method = 'existing_state_field';
            return { state: extractedState, method, confidence: 1.0 };
        }
    }

    // Strategy 2: Extract from address text
    if (club.address) {
        extractedState = extractStateFromAddress(club.address);
        if (extractedState) {
            method = 'address_parsing';
            return { state: extractedState, method, confidence: 0.95 };
        }
    }

    // Strategy 3: Use coordinates to determine state
    if (club.latitude && club.longitude) {
        const lat = parseFloat(club.latitude);
        const lng = parseFloat(club.longitude);

        if (!isNaN(lat) && !isNaN(lng)) {
            extractedState = findStateByCoordinates(lat, lng);
            if (extractedState) {
                method = 'coordinates';
                return { state: extractedState, method, confidence: 0.90 };
            }
        }
    }

    // No state could be determined
    return { state: null, method: 'unable_to_determine', confidence: 0 };
}

// Analyze what would be updated
async function analyzeBackfill() {
    log('📊 Analyzing clubs for state backfill...');

    const clubs = await getAllClubs();
    const analysis = {
        total_clubs: clubs.length,
        already_have_state: 0,
        can_extract_from_address: 0,
        can_extract_from_coordinates: 0,
        cannot_determine_state: 0,
        by_method: {},
        by_state: {},
        sample_updates: []
    };

    for (const club of clubs) {
        const result = extractClubState(club);

        if (club.state && result.method === 'existing_state_field') {
            analysis.already_have_state++;
        } else if (result.state) {
            // Track by method
            analysis.by_method[result.method] = (analysis.by_method[result.method] || 0) + 1;

            // Track by state
            analysis.by_state[result.state] = (analysis.by_state[result.state] || 0) + 1;

            // Collect samples
            if (analysis.sample_updates.length < 20) {
                analysis.sample_updates.push({
                    club_name: club.club_name,
                    address: club.address,
                    current_state: club.state,
                    extracted_state: result.state,
                    method: result.method,
                    confidence: result.confidence
                });
            }
        } else {
            analysis.cannot_determine_state++;
        }
    }

    return analysis;
}

// Perform the backfill
async function performBackfill(dryRun = false) {
    log('🔄 Starting club state backfill...');

    const clubs = await getAllClubs();
    const results = {
        total_processed: 0,
        updated: 0,
        skipped_already_set: 0,
        failed: 0,
        could_not_determine: 0,
        by_method: {},
        by_state: {},
        updates: []
    };

    log(`📊 Processing ${clubs.length} clubs...`);

    for (let i = 0; i < clubs.length; i++) {
        const club = clubs[i];

        if (i % 100 === 0) {
            log(`  📋 Progress: ${i}/${clubs.length} clubs processed (${((i/clubs.length)*100).toFixed(1)}%)`);
        }

        results.total_processed++;

        // Extract state
        const extraction = extractClubState(club);

        // Skip if already has valid state
        if (club.state && extraction.method === 'existing_state_field') {
            results.skipped_already_set++;
            continue;
        }

        // Could not determine state
        if (!extraction.state) {
            results.could_not_determine++;
            results.updates.push({
                club_name: club.club_name,
                status: 'could_not_determine',
                address: club.address,
                has_coordinates: !!(club.latitude && club.longitude)
            });
            continue;
        }

        // Track extraction method and state
        results.by_method[extraction.method] = (results.by_method[extraction.method] || 0) + 1;
        results.by_state[extraction.state] = (results.by_state[extraction.state] || 0) + 1;

        results.updates.push({
            club_name: club.name,
            current_state: club.state,
            new_state: extraction.state,
            method: extraction.method,
            confidence: extraction.confidence
        });

        // Update database if not dry run
        if (!dryRun) {
            try {
                const { error } = await supabase
                    .from('clubs')
                    .update({ state: extraction.state })
                    .eq('club_name', club.club_name);

                if (error) {
                    log(`  ❌ Failed to update ${club.club_name}: ${error.message}`);
                    results.failed++;
                } else {
                    results.updated++;
                }
            } catch (error) {
                log(`  ❌ Error updating ${club.club_name}: ${error.message}`);
                results.failed++;
            }
        } else {
            results.updated++;
        }
    }

    return results;
}

// Verify backfill results
async function verifyBackfill() {
    log('🔍 Verifying club state backfill...');

    const clubs = await getAllClubs();
    const verification = {
        total_clubs: clubs.length,
        with_state: 0,
        without_state: 0,
        by_state: {},
        problematic_clubs: []
    };

    for (const club of clubs) {
        if (club.state) {
            verification.with_state++;
            verification.by_state[club.state] = (verification.by_state[club.state] || 0) + 1;
        } else {
            verification.without_state++;

            // Check if we could determine state but it's missing
            const extraction = extractClubState(club);
            if (extraction.state) {
                verification.problematic_clubs.push({
                    club_name: club.club_name,
                    should_have_state: extraction.state,
                    method: extraction.method,
                    address: club.address
                });
            }
        }
    }

    return verification;
}

// Main function
async function main() {
    const startTime = Date.now();

    try {
        ensureDirectories();

        log('🏋️ Club State Backfill Script');
        log('='.repeat(60));

        const options = parseArguments();

        if (options.analyze) {
            log('📊 Running analysis mode...');
            const analysis = await analyzeBackfill();

            log('\n📈 Analysis Results:');
            log(`  Total clubs: ${analysis.total_clubs}`);
            log(`  Already have state: ${analysis.already_have_state}`);
            log(`  Can extract from address: ${analysis.by_method['address_parsing'] || 0}`);
            log(`  Can extract from coordinates: ${analysis.by_method['coordinates'] || 0}`);
            log(`  Cannot determine: ${analysis.cannot_determine_state}`);
            log(`\n📍 States found: ${Object.keys(analysis.by_state).length}`);

            if (analysis.sample_updates.length > 0) {
                log('\n📋 Sample updates (first 20):');
                analysis.sample_updates.forEach(sample => {
                    log(`  ${sample.club_name}:`);
                    log(`    Current: ${sample.current_state || '(none)'}`);
                    log(`    Extracted: ${sample.extracted_state} (${sample.method}, ${(sample.confidence * 100).toFixed(0)}% confidence)`);
                });
            }

        } else if (options.backfill) {
            log('🔄 Running backfill mode...');
            const results = await performBackfill(options.dryRun);

            log('\n✅ Backfill Complete:');
            log(`  Total processed: ${results.total_processed}`);
            log(`  Updated: ${results.updated}`);
            log(`  Already had state: ${results.skipped_already_set}`);
            log(`  Could not determine: ${results.could_not_determine}`);
            log(`  Failed: ${results.failed}`);

            log('\n📊 Updates by method:');
            Object.entries(results.by_method).forEach(([method, count]) => {
                log(`  ${method}: ${count}`);
            });

            log('\n📍 Updates by state:');
            Object.entries(results.by_state)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 10)
                .forEach(([state, count]) => {
                    log(`  ${state}: ${count}`);
                });

            // Save results
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
            log(`\n💾 Results saved to: ${OUTPUT_FILE}`);

        } else if (options.verify) {
            log('🔍 Running verification mode...');
            const verification = await verifyBackfill();

            log('\n📈 Verification Results:');
            log(`  Total clubs: ${verification.total_clubs}`);
            log(`  With state: ${verification.with_state} (${((verification.with_state/verification.total_clubs)*100).toFixed(1)}%)`);
            log(`  Without state: ${verification.without_state}`);

            if (verification.problematic_clubs.length > 0) {
                log(`\n⚠️ Found ${verification.problematic_clubs.length} clubs that should have state but don't:`);
                verification.problematic_clubs.slice(0, 10).forEach(club => {
                    log(`  ${club.club_name} → should be ${club.should_have_state} (${club.method})`);
                });
            } else {
                log('\n✅ All clubs that can have a state value now have one');
            }

        } else {
            log('Club State Backfill Script');
            log('===========================');
            log('');
            log('Options:');
            log('  --analyze     Analyze what would be updated');
            log('  --backfill    Perform the backfill');
            log('  --verify      Verify backfill results');
            log('  --dry-run     Simulate without updating database');
            log('');
            log('Example: node backfill-club-states.js --analyze');
            log('         node backfill-club-states.js --backfill');
            log('         node backfill-club-states.js --verify');
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
    extractClubState,
    getAllClubs,
    analyzeBackfill,
    performBackfill,
    verifyBackfill
};
