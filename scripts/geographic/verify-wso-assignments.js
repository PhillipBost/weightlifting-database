#!/usr/bin/env node

/**
 * WSO Assignment Verification Utility
 *
 * This script provides comprehensive verification of WSO geography assignments
 * in the meets table. It can identify unassigned meets, validate existing assignments,
 * and provide detailed reports on assignment completeness.
 *
 * Usage:
 *   node verify-wso-assignments.js --count       # Count unassigned meets
 *   node verify-wso-assignments.js --list        # List unassigned meets
 *   node verify-wso-assignments.js --validate    # Validate existing assignments
 *   node verify-wso-assignments.js --summary     # Generate summary report
 *   node verify-wso-assignments.js --full        # Full verification report
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const SCRIPT_VERSION = '1.0.0';

// Valid WSO names for validation
const VALID_WSO_NAMES = [
    'Alabama', 'California North Central', 'California South', 'Carolina', 'DMV',
    'Florida', 'Georgia', 'Hawaii and International', 'Illinois', 'Indiana',
    'Iowa-Nebraska', 'Michigan', 'Minnesota-Dakotas', 'Missouri Valley',
    'Mountain North', 'Mountain South', 'New England', 'New Jersey',
    'New York', 'Ohio', 'Pacific Northwest', 'Pennsylvania-West Virginia',
    'Southern', 'Tennessee-Kentucky', 'Texas-Oklahoma', 'Wisconsin'
];

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
    console.log(`[${timestamp}] ${message}`);
}

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    return {
        count: args.includes('--count'),
        list: args.includes('--list'),
        validate: args.includes('--validate'),
        summary: args.includes('--summary'),
        full: args.includes('--full')
    };
}

// Count unassigned meets using proper pagination
async function countUnassignedMeets() {
    log('📊 Counting unassigned meets...');

    let totalCount = 0;
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('meets')
            .select('meet_id')
            .is('wso_geography', null)
            .range(start, start + batchSize - 1);

        if (error) {
            throw new Error(`Failed to count meets: ${error.message}`);
        }

        if (data && data.length > 0) {
            totalCount += data.length;
            log(`  📦 Batch ${Math.floor(start/batchSize) + 1}: Found ${data.length} unassigned meets (Running total: ${totalCount})`);

            hasMore = data.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }

    log(`✅ Total unassigned meets: ${totalCount}`);
    return totalCount;
}

// List unassigned meets with details
async function listUnassignedMeets() {
    log('📋 Listing unassigned meets...');

    const unassignedMeets = [];
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('meets')
            .select('meet_id, start_date, end_date, city, state, address, latitude, longitude')
            .is('wso_geography', null)
            .range(start, start + batchSize - 1);

        if (error) {
            throw new Error(`Failed to fetch unassigned meets: ${error.message}`);
        }

        if (data && data.length > 0) {
            unassignedMeets.push(...data);
            log(`  📦 Batch ${Math.floor(start/batchSize) + 1}: Found ${data.length} unassigned meets`);

            hasMore = data.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }

    log(`📊 Found ${unassignedMeets.length} unassigned meets total`);

    // Analyze unassigned meets
    const analysis = {
        total: unassignedMeets.length,
        with_coordinates: 0,
        with_address: 0,
        with_city_state: 0,
        no_location_data: 0,
        by_year: {},
        by_state: {}
    };

    unassignedMeets.forEach(meet => {
        // Location data availability
        if (meet.latitude && meet.longitude) analysis.with_coordinates++;
        if (meet.address) analysis.with_address++;
        if (meet.city || meet.state) analysis.with_city_state++;

        if (!meet.latitude && !meet.longitude && !meet.address && !meet.city && !meet.state) {
            analysis.no_location_data++;
        }

        // Year analysis
        if (meet.start_date) {
            const year = new Date(meet.start_date).getFullYear();
            if (!isNaN(year)) {
                analysis.by_year[year] = (analysis.by_year[year] || 0) + 1;
            }
        }

        // State analysis
        if (meet.state) {
            analysis.by_state[meet.state] = (analysis.by_state[meet.state] || 0) + 1;
        }
    });

    return { unassignedMeets, analysis };
}

// Validate existing WSO assignments
async function validateExistingAssignments() {
    log('🔍 Validating existing WSO assignments...');

    const results = {
        total_assigned: 0,
        valid_assignments: 0,
        invalid_assignments: 0,
        invalid_meets: [],
        by_wso: {}
    };

    let start = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('meets')
            .select('meet_id, wso_geography')
            .not('wso_geography', 'is', null)
            .range(start, start + batchSize - 1);

        if (error) {
            throw new Error(`Failed to fetch assigned meets: ${error.message}`);
        }

        if (data && data.length > 0) {
            log(`  📦 Batch ${Math.floor(start/batchSize) + 1}: Validating ${data.length} assigned meets`);

            data.forEach(meet => {
                results.total_assigned++;

                if (VALID_WSO_NAMES.includes(meet.wso_geography)) {
                    results.valid_assignments++;
                    results.by_wso[meet.wso_geography] = (results.by_wso[meet.wso_geography] || 0) + 1;
                } else {
                    results.invalid_assignments++;
                    results.invalid_meets.push({
                        meet_id: meet.meet_id,
                        invalid_wso: meet.wso_geography
                    });
                }
            });

            hasMore = data.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }

    log(`✅ Validation complete: ${results.valid_assignments}/${results.total_assigned} valid assignments`);
    return results;
}

// Generate summary report
async function generateSummaryReport() {
    log('📊 Generating summary report...');

    // Get total meets count
    const { count: totalMeets, error: countError } = await supabase
        .from('meets')
        .select('*', { count: 'exact', head: true });

    if (countError) {
        throw new Error(`Failed to get total meets count: ${countError.message}`);
    }

    const unassignedCount = await countUnassignedMeets();
    const validation = await validateExistingAssignments();

    const summary = {
        timestamp: new Date().toISOString(),
        script_version: SCRIPT_VERSION,
        total_meets: totalMeets,
        assigned_meets: validation.total_assigned,
        unassigned_meets: unassignedCount,
        assignment_rate: ((validation.total_assigned / totalMeets) * 100).toFixed(2),
        valid_assignments: validation.valid_assignments,
        invalid_assignments: validation.invalid_assignments,
        validation_rate: ((validation.valid_assignments / validation.total_assigned) * 100).toFixed(2),
        wso_distribution: validation.by_wso,
        invalid_assignments_details: validation.invalid_meets
    };

    return summary;
}

// Main function
async function main() {
    const startTime = Date.now();

    try {
        ensureDirectories();

        log('🔍 Starting WSO Assignment Verification');
        log('='.repeat(60));

        const options = parseArguments();

        if (options.count) {
            const count = await countUnassignedMeets();
            console.log(`\nResult: ${count} unassigned meets`);

        } else if (options.list) {
            const { unassignedMeets, analysis } = await listUnassignedMeets();

            log('\n📋 Unassigned Meets Analysis:');
            log(`  Total unassigned: ${analysis.total}`);
            log(`  With coordinates: ${analysis.with_coordinates}`);
            log(`  With address: ${analysis.with_address}`);
            log(`  With city/state: ${analysis.with_city_state}`);
            log(`  No location data: ${analysis.no_location_data}`);
            log(`  Years represented: ${Object.keys(analysis.by_year).length}`);
            log(`  States represented: ${Object.keys(analysis.by_state).length}`);

            // Save detailed list to file
            const outputFile = path.join(OUTPUT_DIR, 'unassigned_meets.json');
            fs.writeFileSync(outputFile, JSON.stringify({ unassignedMeets, analysis }, null, 2));
            log(`\n📄 Detailed list saved to: ${outputFile}`);

        } else if (options.validate) {
            const validation = await validateExistingAssignments();

            log('\n✅ Validation Results:');
            log(`  Total assigned: ${validation.total_assigned}`);
            log(`  Valid assignments: ${validation.valid_assignments}`);
            log(`  Invalid assignments: ${validation.invalid_assignments}`);
            log(`  Validation rate: ${((validation.valid_assignments / validation.total_assigned) * 100).toFixed(2)}%`);

            if (validation.invalid_assignments > 0) {
                log('\n❌ Invalid WSO assignments found:');
                validation.invalid_meets.forEach(meet => {
                    log(`  - Meet ${meet.meet_id}: "${meet.invalid_wso}" (${meet.meet_name})`);
                });
            }

        } else if (options.summary || options.full) {
            const summary = await generateSummaryReport();

            log('\n📊 WSO Assignment Summary:');
            log(`  Total meets: ${summary.total_meets}`);
            log(`  Assigned: ${summary.assigned_meets} (${summary.assignment_rate}%)`);
            log(`  Unassigned: ${summary.unassigned_meets}`);
            log(`  Valid assignments: ${summary.valid_assignments}`);
            log(`  Invalid assignments: ${summary.invalid_assignments}`);
            log(`  Validation rate: ${summary.validation_rate}%`);

            if (options.full) {
                log('\n📈 WSO Distribution:');
                Object.entries(summary.wso_distribution)
                    .sort(([,a], [,b]) => b - a)
                    .forEach(([wso, count]) => {
                        log(`  ${wso}: ${count} meets`);
                    });
            }

            // Save summary to file
            const summaryFile = path.join(OUTPUT_DIR, 'wso_assignment_summary.json');
            fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
            log(`\n📄 Summary saved to: ${summaryFile}`);

        } else {
            log('WSO Assignment Verification Utility');
            log('===================================');
            log('');
            log('Options:');
            log('  --count      Count unassigned meets');
            log('  --list       List unassigned meets with analysis');
            log('  --validate   Validate existing WSO assignments');
            log('  --summary    Generate assignment summary report');
            log('  --full       Full verification report with details');
            log('');
            log('Example: node verify-wso-assignments.js --summary');
        }

        const processingTime = Math.round((Date.now() - startTime) / 1000);
        log(`\n⏱️ Verification completed in ${processingTime}s`);

    } catch (error) {
        log(`\n❌ Verification failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    countUnassignedMeets,
    listUnassignedMeets,
    validateExistingAssignments,
    generateSummaryReport
};