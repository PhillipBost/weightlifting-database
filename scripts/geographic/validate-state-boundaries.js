#!/usr/bin/env node

/**
 * WSO State Boundary Validation Script
 *
 * Purpose: Validates that meets are assigned to correct WSO regions based on
 * their geographic coordinates. Detects contamination issues like:
 * - Meets in one state assigned to another state's WSO
 * - International events with US WSO assignments
 * - Placeholder/default coordinates
 * - Missing state field with questionable WSO assignments
 *
 * This script reports issues without fixing them - cleanup is handled by
 * fix-wso-geography-contamination.js in the weekly data quality pipeline.
 *
 * Usage:
 *   node validate-state-boundaries.js --report     # Generate validation report
 *   node validate-state-boundaries.js --detailed   # Show detailed analysis
 *   node validate-state-boundaries.js --summary    # Show summary only
 */

require('dotenv').config({ path: '../../.env' });
const { createClient } = require('@supabase/supabase-js');
const { validateWSOAssignment, findStateByCoordinates, preventContamination } = require('./wso-validation-engine');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'wso_boundary_validation.json');
const LOG_FILE = path.join(LOGS_DIR, 'validate-state-boundaries.log');
const SCRIPT_VERSION = '1.0.0';

// Known placeholder/default coordinates
const PLACEHOLDER_COORDINATES = [
    { lat: 39.78, lng: -100.45, name: 'US Geographic Center (Kansas)' },
    { lat: 39.83, lng: -98.58, name: 'US Geographic Center (alternate)' },
    { lat: 33.66, lng: -117.87, name: 'Orange County CA Default' },
    { lat: 37.09, lng: -95.71, name: 'US Center Point' },
    { lat: 39.50, lng: -98.35, name: 'Lebanon KS (Geographic Center)' },
];

// International event keywords
const INTERNATIONAL_KEYWORDS = [
    'world', 'olympic', 'pan am', 'panamerican', 'international',
    'commonwealth', 'asian games', 'european', 'continental',
    'ihf', 'iwf', 'rio', 'tokyo', 'beijing', 'athens', 'sydney'
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
    const logMessage = `[${timestamp}] ${message}\n`;

    console.log(message);
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    return {
        report: args.includes('--report') || args.length === 0,
        detailed: args.includes('--detailed'),
        summary: args.includes('--summary')
    };
}

// Check if coordinates are placeholder/default values
function isPlaceholderCoordinate(lat, lng) {
    const tolerance = 0.05; // Allow small variations

    for (const placeholder of PLACEHOLDER_COORDINATES) {
        const latDiff = Math.abs(lat - placeholder.lat);
        const lngDiff = Math.abs(lng - placeholder.lng);

        if (latDiff < tolerance && lngDiff < tolerance) {
            return { isPlaceholder: true, name: placeholder.name };
        }
    }

    return { isPlaceholder: false, name: null };
}

// Check if meet is likely an international event
function isInternationalEvent(meetName, city, country) {
    if (!meetName) return { isInternational: false, reason: null };

    const meetNameLower = meetName.toLowerCase();

    // Check for international keywords
    for (const keyword of INTERNATIONAL_KEYWORDS) {
        if (meetNameLower.includes(keyword)) {
            return {
                isInternational: true,
                reason: `Contains international keyword: "${keyword}"`
            };
        }
    }

    // Check if country field indicates non-US
    if (country && country.toLowerCase() !== 'usa' &&
        country.toLowerCase() !== 'united states' &&
        country.toLowerCase() !== 'us') {
        return {
            isInternational: true,
            reason: `Country field: "${country}"`
        };
    }

    // Check for international cities
    const internationalCities = [
        'rio', 'tokyo', 'beijing', 'athens', 'sydney', 'london',
        'paris', 'moscow', 'seoul', 'barcelona', 'montreal',
        'vancouver', 'guadalajara', 'lima', 'santo domingo', 'auckland'
    ];

    if (city) {
        const cityLower = city.toLowerCase();
        for (const intlCity of internationalCities) {
            if (cityLower.includes(intlCity)) {
                return {
                    isInternational: true,
                    reason: `International city: "${city}"`
                };
            }
        }
    }

    return { isInternational: false, reason: null };
}

// Get meets needing validation
async function getMeetsForValidation() {
    log('🔍 Fetching meets for validation...');

    let allMeets = [];
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data: batchData, error } = await supabase
            .from('usaw_meets')
            .select('meet_id, Meet, wso_geography, latitude, longitude, address, city, state, country, location_text')
            .not('wso_geography', 'is', null)
            .range(start, start + batchSize - 1);

        if (error) {
            throw new Error(`Failed to fetch meets: ${error.message}`);
        }

        if (batchData && batchData.length > 0) {
            allMeets.push(...batchData);
            log(`  📦 Batch ${Math.floor(start / batchSize) + 1}: Found ${batchData.length} meets (Total: ${allMeets.length})`);

            hasMore = batchData.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }
    }

    log(`✅ Loaded ${allMeets.length} meets with WSO assignments`);
    return allMeets;
}

// Validate meets
async function validateMeets() {
    log('🔬 Starting WSO state boundary validation...');

    const meets = await getMeetsForValidation();

    const issues = {
        boundaryViolations: [],
        internationalEvents: [],
        placeholderCoordinates: [],
        missingStateField: [],
        missingCoordinates: [],
    };

    const summary = {
        totalMeets: meets.length,
        validated: 0,
        issuesFound: 0,
        correctAssignments: 0
    };

    for (const meet of meets) {
        summary.validated++;

        // Check for missing coordinates
        if (!meet.latitude || !meet.longitude) {
            issues.missingCoordinates.push({
                meet_id: meet.meet_id,
                meet_name: meet.Meet,
                wso: meet.wso_geography,
                issue: 'Missing coordinates - WSO assignment cannot be verified'
            });
            continue;
        }

        const lat = parseFloat(meet.latitude);
        const lng = parseFloat(meet.longitude);

        if (isNaN(lat) || isNaN(lng)) {
            issues.missingCoordinates.push({
                meet_id: meet.meet_id,
                meet_name: meet.Meet,
                wso: meet.wso_geography,
                issue: 'Invalid coordinates'
            });
            continue;
        }

        // Check for placeholder coordinates
        const placeholderCheck = isPlaceholderCoordinate(lat, lng);
        if (placeholderCheck.isPlaceholder) {
            issues.placeholderCoordinates.push({
                meet_id: meet.meet_id,
                meet_name: meet.Meet,
                wso: meet.wso_geography,
                coordinates: { lat, lng },
                placeholder_type: placeholderCheck.name,
                severity: 'HIGH',
                recommendation: 'Re-geocode with accurate address or manually verify location'
            });
            summary.issuesFound++;
        }

        // Check for international events
        const intlCheck = isInternationalEvent(meet.Meet, meet.city, meet.country);
        if (intlCheck.isInternational) {
            issues.internationalEvents.push({
                meet_id: meet.meet_id,
                meet_name: meet.Meet,
                wso: meet.wso_geography,
                reason: intlCheck.reason,
                severity: 'MEDIUM',
                recommendation: 'Should not have US WSO assignment - set wso_geography to NULL'
            });
            summary.issuesFound++;
        }

        // Check for missing state field
        if (!meet.state) {
            issues.missingStateField.push({
                meet_id: meet.meet_id,
                meet_name: meet.Meet,
                wso: meet.wso_geography,
                coordinates: { lat, lng },
                city: meet.city,
                severity: 'LOW',
                recommendation: 'Extract state from geocoding results and store in state field'
            });
        }

        // Validate WSO assignment against coordinates
        const validation = validateWSOAssignment(meet.wso_geography, lat, lng);

        if (!validation.isValid) {
            const actualState = validation.actualState;
            const correctWSO = validation.correctWSO;

            issues.boundaryViolations.push({
                meet_id: meet.meet_id,
                meet_name: meet.Meet,
                current_wso: meet.wso_geography,
                correct_wso: correctWSO,
                actual_state: actualState,
                stored_state: meet.state,
                coordinates: { lat, lng },
                location_text: `${meet.city || ''}, ${meet.state || ''}, ${meet.country || ''}`.trim(),
                severity: 'HIGH',
                reason: validation.reason,
                recommendation: `Update wso_geography from "${meet.wso_geography}" to "${correctWSO}"`
            });
            summary.issuesFound++;
        } else {
            summary.correctAssignments++;
        }
    }

    return { issues, summary };
}

// Generate validation report
function generateReport(validationResults, options) {
    const { issues, summary } = validationResults;

    log('\n📊 VALIDATION SUMMARY');
    log('='.repeat(60));
    log(`Total meets validated: ${summary.totalMeets}`);
    log(`Correct assignments: ${summary.correctAssignments}`);
    log(`Total issues found: ${summary.issuesFound}`);
    log('');
    log('Issues by Category:');
    log(`  🚨 Boundary violations: ${issues.boundaryViolations.length}`);
    log(`  🌍 International events: ${issues.internationalEvents.length}`);
    log(`  📍 Placeholder coordinates: ${issues.placeholderCoordinates.length}`);
    log(`  ⚠️  Missing state field: ${issues.missingStateField.length}`);
    log(`  ❌ Missing coordinates: ${issues.missingCoordinates.length}`);

    if (options.detailed || options.report) {
        // Show boundary violations (most critical)
        if (issues.boundaryViolations.length > 0) {
            log('\n🚨 BOUNDARY VIOLATIONS (HIGH PRIORITY):');
            log('-'.repeat(60));
            issues.boundaryViolations.forEach((issue, idx) => {
                log(`${idx + 1}. Meet ${issue.meet_id}: "${issue.meet_name}"`);
                log(`   Current WSO: ${issue.current_wso}`);
                log(`   Correct WSO: ${issue.correct_wso} (in ${issue.actual_state})`);
                log(`   Location: ${issue.location_text}`);
                log(`   Coordinates: (${issue.coordinates.lat}, ${issue.coordinates.lng})`);
                log(`   Recommendation: ${issue.recommendation}`);
                log('');
            });
        }

        // Show international events
        if (issues.internationalEvents.length > 0) {
            log('\n🌍 INTERNATIONAL EVENTS:');
            log('-'.repeat(60));
            issues.internationalEvents.slice(0, 10).forEach((issue, idx) => {
                log(`${idx + 1}. Meet ${issue.meet_id}: "${issue.meet_name}"`);
                log(`   Current WSO: ${issue.wso}`);
                log(`   Reason: ${issue.reason}`);
                log(`   Recommendation: ${issue.recommendation}`);
                log('');
            });
            if (issues.internationalEvents.length > 10) {
                log(`   ... and ${issues.internationalEvents.length - 10} more`);
            }
        }

        // Show placeholder coordinates
        if (issues.placeholderCoordinates.length > 0) {
            log('\n📍 PLACEHOLDER COORDINATES:');
            log('-'.repeat(60));
            issues.placeholderCoordinates.slice(0, 5).forEach((issue, idx) => {
                log(`${idx + 1}. Meet ${issue.meet_id}: "${issue.meet_name}"`);
                log(`   WSO: ${issue.wso}`);
                log(`   Placeholder: ${issue.placeholder_type}`);
                log(`   Coordinates: (${issue.coordinates.lat}, ${issue.coordinates.lng})`);
                log(`   Recommendation: ${issue.recommendation}`);
                log('');
            });
            if (issues.placeholderCoordinates.length > 5) {
                log(`   ... and ${issues.placeholderCoordinates.length - 5} more`);
            }
        }
    }

    // Save detailed report
    const report = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_version: SCRIPT_VERSION,
            total_meets_validated: summary.totalMeets
        },
        summary,
        issues,
        recommendations: {
            immediate: [
                `Fix ${issues.boundaryViolations.length} boundary violations using fix-wso-geography-contamination.js`,
                `Review ${issues.internationalEvents.length} international events and remove US WSO assignments`,
                `Re-geocode ${issues.placeholderCoordinates.length} meets with placeholder coordinates`
            ],
            preventive: [
                'Enhance geocode-and-import.js to extract and store state field',
                'Add international event detection during data collection',
                'Implement placeholder coordinate detection in geocoding process'
            ]
        }
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
    log(`\n📄 Detailed report saved to: ${OUTPUT_FILE}`);

    return report;
}

// Main function
async function main() {
    const startTime = Date.now();

    try {
        ensureDirectories();

        log('🔬 WSO State Boundary Validation Script');
        log('='.repeat(60));

        const options = parseArguments();

        // Run validation
        const validationResults = await validateMeets();

        // Generate report
        const report = generateReport(validationResults, options);

        // Exit code based on critical issues
        const criticalIssues = validationResults.issues.boundaryViolations.length;

        if (criticalIssues > 0) {
            log(`\n⚠️  ATTENTION: ${criticalIssues} critical boundary violations found`);
            log('Run fix-wso-geography-contamination.js to auto-correct these issues');
        } else {
            log('\n✅ No critical boundary violations found');
        }

        const processingTime = Math.round((Date.now() - startTime) / 1000);
        log(`\n⏱️  Validation completed in ${processingTime}s`);

    } catch (error) {
        log(`\n❌ Validation failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Export functions for testing
module.exports = {
    isPlaceholderCoordinate,
    isInternationalEvent,
    validateMeets
};

// Run if called directly
if (require.main === module) {
    main();
}