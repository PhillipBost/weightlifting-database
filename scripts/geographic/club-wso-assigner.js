#!/usr/bin/env node

/**
 * Club WSO Geography Assignment Script
 *
 * This script assigns WSO (Weightlifting State Organizations) geographic regions 
 * to clubs in the clubs table based on their location data.
 *
 * Assignment Strategy:
 * 1. Coordinate-based assignment using geographic boundaries
 * 2. Address parsing for state/region extraction
 * 3. Historical data analysis from meet results
 * 4. Manual mapping for edge cases
 *
 * Usage:
 *   node club-wso-assigner.js --analyze     # Analyze current club data
 *   node club-wso-assigner.js --assign      # Assign WSO geography to clubs
 *   node club-wso-assigner.js --validate    # Validate assignments
 *   node club-wso-assigner.js --report      # Generate assignment report
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'club_wso_assignments.json');
const LOG_FILE = path.join(LOGS_DIR, 'club-wso-assigner.log');
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
const CALIFORNIA_COUNTIES = {
    'North Central': [
        'Alameda', 'Contra Costa', 'Marin', 'Napa', 'San Francisco', 'San Mateo', 
        'Santa Clara', 'Solano', 'Sonoma', 'Monterey', 'San Benito', 'Santa Cruz', 
        'Merced', 'Stanislaus', 'San Joaquin', 'Calaveras', 'Tuolumne', 'Mariposa'
    ],
    'South': [
        'Imperial', 'Riverside', 'San Bernardino', 'Orange', 'Los Angeles', 'Ventura', 
        'Santa Barbara', 'Kern', 'Tulare', 'Fresno', 'Kings', 'Inyo'
    ]
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

// Extract state from address text
function extractStateFromAddress(address) {
    if (!address) return null;
    
    // Directional abbreviations commonly used in street addresses that conflict with state codes
    const DIRECTIONAL_ABBREVS = ['NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];
    
    // First, look for full state names (highest priority)
    for (const fullName of Object.values(US_STATES)) {
        const namePattern = new RegExp(`\b${fullName.replace(/\s/g, '\s+')}\b`, 'i');
        if (namePattern.test(address)) {
            return fullName;
        }
    }
    
    // Then look for state abbreviations (with proper context filtering)
    for (const [abbrev, fullName] of Object.entries(US_STATES)) {
        // Skip directional abbreviations unless they appear in clear state context
        if (DIRECTIONAL_ABBREVS.includes(abbrev)) {
            // Only match if state abbreviation appears after comma (clear state context)
            const contextPattern = new RegExp(`,\s*${abbrev}\s+|${abbrev}\s+\d{5}`, 'i');
            if (contextPattern.test(address)) {
                return fullName;
            }
        } else {
            // For non-directional abbreviations, use standard word boundary matching
            const abbrevPattern = new RegExp(`\b${abbrev}\b|,\s*${abbrev}\b|\s${abbrev}$`, 'i');
            if (abbrevPattern.test(address)) {
                return fullName;
            }
        }
    }
    
    return null;
}

// Assign WSO based on state
function assignWSO(state, county = null) {
    if (!state) return null;
    
    // Special handling for California
    if (state === 'California') {
        if (county) {
            if (CALIFORNIA_COUNTIES['North Central'].includes(county)) {
                return 'California North Central';
            } else if (CALIFORNIA_COUNTIES['South'].includes(county)) {
                return 'California South';
            }
        }
        // Default to North Central if county unknown
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

// Calculate confidence score for assignment
function calculateConfidence(assignmentMethod, hasCoordinates, hasAddress, historicalMatch) {
    let confidence = 0;
    
    switch (assignmentMethod) {
        case 'coordinates':
            confidence = 0.95;
            break;
        case 'address_state':
            confidence = 0.85;
            break;
        case 'address_parsing':
            confidence = 0.75;
            break;
        case 'historical_data':
            confidence = 0.90;
            break;
        case 'fallback':
            confidence = 0.50;
            break;
        default:
            confidence = 0.30;
    }
    
    // Boost confidence if multiple data sources agree
    if (historicalMatch) confidence += 0.05;
    if (hasCoordinates && hasAddress) confidence += 0.05;
    
    return Math.min(confidence, 1.0);
}

// Get clubs from database
async function getClubs() {
    log('🔍 Fetching clubs from database...');
    
    let allClubs = [];
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
        const { data: batchData, error } = await supabase
            .from('clubs')
            .select('*')
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
    
    log(`Found ${allClubs.length} total clubs`);
    return allClubs;
}

// Get historical WSO data from meet results
async function getHistoricalWSOData() {
    log('📊 Fetching historical WSO data from meet results...');
    
    const { data, error } = await supabase
        .from('meet_results')
        .select('club_name, wso')
        .not('club_name', 'is', null)
        .not('wso', 'is', null);
    
    if (error) {
        log(`⚠️ Error fetching historical data: ${error.message}`);
        return {};
    }
    
    // Create club -> WSO mapping from historical data
    const historicalData = {};
    for (const result of data) {
        const clubName = result.club_name.trim();
        const wso = result.wso.trim();
        
        if (!historicalData[clubName]) {
            historicalData[clubName] = {};
        }
        
        if (!historicalData[clubName][wso]) {
            historicalData[clubName][wso] = 0;
        }
        
        historicalData[clubName][wso]++;
    }
    
    // Convert to most common WSO per club
    const clubWSOMap = {};
    for (const [clubName, wsoData] of Object.entries(historicalData)) {
        const mostCommonWSO = Object.entries(wsoData)
            .sort(([,a], [,b]) => b - a)[0][0];
        clubWSOMap[clubName] = mostCommonWSO;
    }
    
    log(`Found historical WSO data for ${Object.keys(clubWSOMap).length} clubs`);
    return clubWSOMap;
}

// Assign WSO to a single club
function assignClubWSO(club, historicalData) {
    const assignment = {
        club_name: club.club_name,
        original_wso: club.wso_geography,
        assigned_wso: null,
        assignment_method: null,
        confidence: 0,
        details: {
            has_coordinates: !!(club.latitude && club.longitude),
            has_address: !!(club.address || club.city || club.state),
            historical_match: false,
            extracted_state: null,
            reasoning: []
        }
    };
    
    // Method 1: Historical data (highest priority for validation)
    if (historicalData[club.club_name]) {
        assignment.assigned_wso = historicalData[club.club_name];
        assignment.assignment_method = 'historical_data';
        assignment.details.historical_match = true;
        assignment.details.reasoning.push(`Historical WSO: ${historicalData[club.club_name]}`);
    }
    
    // Method 2: Parse club address/location
    let extractedState = null;
    const addressFields = [club.address, club.city, club.state, club.location].filter(Boolean);
    
    for (const field of addressFields) {
        extractedState = extractStateFromAddress(field);
        if (extractedState) {
            assignment.details.extracted_state = extractedState;
            assignment.details.reasoning.push(`Extracted state: ${extractedState} from "${field}"`);
            break;
        }
    }
    
    // If no historical data, use extracted state
    if (!assignment.assigned_wso && extractedState) {
        const wso = assignWSO(extractedState);
        if (wso) {
            assignment.assigned_wso = wso;
            assignment.assignment_method = 'address_state';
            assignment.details.reasoning.push(`Assigned WSO: ${wso} based on state: ${extractedState}`);
        }
    }
    
    // Method 3: Fallback - try to extract from club name
    if (!assignment.assigned_wso) {
        const extractedFromName = extractStateFromAddress(club.club_name);
        if (extractedFromName) {
            const wso = assignWSO(extractedFromName);
            if (wso) {
                assignment.assigned_wso = wso;
                assignment.assignment_method = 'club_name_parsing';
                assignment.details.reasoning.push(`Assigned WSO: ${wso} from club name: ${club.club_name}`);
            }
        }
    }
    
    // Calculate confidence score
    assignment.confidence = calculateConfidence(
        assignment.assignment_method,
        assignment.details.has_coordinates,
        assignment.details.has_address,
        assignment.details.historical_match
    );
    
    return assignment;
}

// Analyze current club data
async function analyzeClubs() {
    log('🔍 Analyzing current club data...');
    
    const clubs = await getClubs();
    const analysis = {
        total_clubs: clubs.length,
        with_coordinates: 0,
        with_address: 0,
        with_wso_assigned: 0,
        without_location_data: 0,
        by_state: {},
        current_wso_assignments: {}
    };
    
    for (const club of clubs) {
        // Count location data availability
        if (club.latitude && club.longitude) analysis.with_coordinates++;
        if (club.address || club.city || club.state) analysis.with_address++;
        if (club.wso_geography) analysis.with_wso_assigned++;
        
        if (!club.latitude && !club.longitude && !club.address && !club.city && !club.state) {
            analysis.without_location_data++;
        }
        
        // Extract state for analysis
        const addressFields = [club.address, club.city, club.state, club.location].filter(Boolean);
        let extractedState = null;
        
        for (const field of addressFields) {
            extractedState = extractStateFromAddress(field);
            if (extractedState) break;
        }
        
        if (extractedState) {
            analysis.by_state[extractedState] = (analysis.by_state[extractedState] || 0) + 1;
        }
        
        // Count current WSO assignments
        if (club.wso_geography) {
            analysis.current_wso_assignments[club.wso_geography] = 
                (analysis.current_wso_assignments[club.wso_geography] || 0) + 1;
        }
    }
    
    return analysis;
}

// Assign WSO geography to all clubs
async function assignAllClubs(dryRun = false) {
    log('🏋️ Starting club WSO assignment process...');
    
    const [clubs, historicalData] = await Promise.all([
        getClubs(),
        getHistoricalWSOData()
    ]);
    
    const assignments = [];
    const summary = {
        total_processed: 0,
        successful_assignments: 0,
        failed_assignments: 0,
        by_method: {},
        by_confidence: { high: 0, medium: 0, low: 0 },
        by_wso: {}
    };
    
    log(`📊 Processing ${clubs.length} clubs...`);
    
    for (let i = 0; i < clubs.length; i++) {
        const club = clubs[i];
        
        if (i % 100 === 0) {
            log(`  📋 Progress: ${i}/${clubs.length} clubs processed`);
        }
        
        const assignment = assignClubWSO(club, historicalData);
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
    }
    
    // Update database if not dry run
    if (!dryRun) {
        log('💾 Updating database with WSO assignments...');
        
        let updated = 0;
        let failed = 0;
        
        for (const assignment of assignments) {
            if (assignment.assigned_wso) {
                try {
                    const { error } = await supabase
                        .from('clubs')
                        .update({ wso_geography: assignment.assigned_wso })
                        .eq('club_name', assignment.club_name);
                    
                    if (error) {
                        log(`  ❌ Failed to update ${assignment.club_name}: ${error.message}`);
                        failed++;
                    } else {
                        updated++;
                    }
                } catch (error) {
                    log(`  ❌ Error updating ${assignment.club_name}: ${error.message}`);
                    failed++;
                }
            }
        }
        
        log(`✅ Database update complete: ${updated} updated, ${failed} failed`);
    }
    
    return { assignments, summary };
}

// Generate assignment report
function generateReport(assignments, summary, analysis) {
    const report = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_version: SCRIPT_VERSION,
            total_clubs: assignments.length
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
        
        log('🏋️ Starting Club WSO Assignment Script');
        log('='.repeat(60));
        
        const options = parseArguments();
        
        if (options.analyze) {
            log('📊 Running analysis mode...');
            const analysis = await analyzeClubs();
            log('\n📈 Analysis Results:');
            log(`  Total clubs: ${analysis.total_clubs}`);
            log(`  With coordinates: ${analysis.with_coordinates}`);
            log(`  With address data: ${analysis.with_address}`);
            log(`  With WSO assigned: ${analysis.with_wso_assigned}`);
            log(`  Without location data: ${analysis.without_location_data}`);
            log(`  States represented: ${Object.keys(analysis.by_state).length}`);
            
        } else if (options.assign) {
            log('🎯 Running assignment mode...');
            const analysis = await analyzeClubs();
            const { assignments, summary } = await assignAllClubs(options.dryRun);
            const report = generateReport(assignments, summary, analysis);
            
            log('\n✅ Assignment Complete:');
            log(`  Successfully assigned: ${summary.successful_assignments}/${summary.total_processed}`);
            log(`  Assignment rate: ${((summary.successful_assignments / summary.total_processed) * 100).toFixed(1)}%`);
            log(`  High confidence: ${summary.by_confidence.high}`);
            log(`  Medium confidence: ${summary.by_confidence.medium}`);
            log(`  Low confidence: ${summary.by_confidence.low}`);
            
        } else if (options.validate || options.report) {
            log('🔍 Running validation/report mode...');
            const analysis = await analyzeClubs();
            const { assignments, summary } = await assignAllClubs(true); // Dry run
            const report = generateReport(assignments, summary, analysis);
            
            log('\n📋 Validation Report Generated');
            
        } else {
            log('Club WSO Assignment Script');
            log('============================');
            log('');
            log('Options:');
            log('  --analyze     Analyze current club data');
            log('  --assign      Assign WSO geography to clubs');
            log('  --validate    Validate assignments (dry run)');
            log('  --report      Generate assignment report');
            log('  --dry-run     Run assignment without updating database');
            log('');
            log('Example: node club-wso-assigner.js --assign');
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
    assignClubWSO,
    extractStateFromAddress,
    assignWSO,
    calculateConfidence,
    US_STATES
};