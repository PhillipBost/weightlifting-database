/**
 * MEMBERSHIP MATCHER - STEP 4
 * 
 * Purpose: Matches database meet results to the correct individual athletes
 * Uses concrete data matching - dates, meet names, results values
 * No guessing or contextual clues - only definitive matches
 * 
 * INPUT: 
 *   - /output/successful_scrapes/*.json (scraped athlete profiles from Step 2)
 *   - /output/database_results.json (database results from Step 3)
 * 
 * OUTPUT:
 *   - /output/match_assignments.json (definitive result-to-athlete assignments)
 *   - /output/orphan_results.json (unmatched results needing manual review)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Configuration
const SCRAPED_DATA_DIR = './output/successful_scrapes';
const DATABASE_RESULTS_FILE = './output/database_results.json';
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const MATCH_OUTPUT_FILE = path.join(OUTPUT_DIR, 'match_assignments.json');
const ORPHAN_OUTPUT_FILE = path.join(OUTPUT_DIR, 'orphan_results.json');
const LOG_FILE = path.join(LOGS_DIR, 'membership-matcher.log');
const SCRIPT_VERSION = '1.0.0';

// Matching thresholds
const MATCH_THRESHOLDS = {
    BODY_WEIGHT_TOLERANCE_KG: 2.0,  // Allow 2kg variance in body weight
    DATE_EXACT_MATCH: true,          // Dates must match exactly
    MEET_NAME_FUZZY: false,          // Use exact meet name matching
    RESULTS_EXACT_MATCH: true        // Lift results must match exactly
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
    
    // Console output
    console.log(message);
    
    // File output
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Load scraped athlete data
function loadScrapedAthleteData() {
    log('Loading scraped athlete data...');
    
    if (!fs.existsSync(SCRAPED_DATA_DIR)) {
        throw new Error(`Scraped data directory not found: ${SCRAPED_DATA_DIR}`);
    }
    
    const files = fs.readdirSync(SCRAPED_DATA_DIR).filter(f => f.endsWith('.json'));
    const allAthleteData = [];
    
    for (const file of files) {
        const filePath = path.join(SCRAPED_DATA_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        
        if (data.data && Array.isArray(data.data)) {
            for (const athlete of data.data) {
                allAthleteData.push({
                    athlete_name: athlete.athlete_name,
                    internal_id: athlete.internal_id,
                    membership_number: athlete.profile_data.membership_number,
                    birth_year: athlete.profile_data.birth_year,
                    gender: athlete.profile_data.gender,
                    club_name: athlete.profile_data.club_name,
                    wso: athlete.profile_data.wso,
                    contaminated_lifter_id: athlete.contaminated_lifter_id,
                    needs_new_lifter_id: athlete.needs_new_lifter_id,
                    competition_history: athlete.competition_history || []
                });
            }
            log(`  Loaded ${data.data.length} athletes from ${file}`);
        }
    }
    
    log(`Total athletes loaded: ${allAthleteData.length}`);
    return allAthleteData;
}

// Load database results
function loadDatabaseResults() {
    log('Loading database results...');
    
    if (!fs.existsSync(DATABASE_RESULTS_FILE)) {
        throw new Error(`Database results file not found: ${DATABASE_RESULTS_FILE}`);
    }
    
    const content = fs.readFileSync(DATABASE_RESULTS_FILE, 'utf8');
    const data = JSON.parse(content);
    
    let totalResults = 0;
    for (const athleteName in data.data) {
        const results = data.data[athleteName].results || [];
        totalResults += results.length;
    }
    
    log(`Loaded database results: ${totalResults} total results`);
    return data.data;
}

// Normalize lift values for comparison
function normalizeLiftValue(value) {
    if (!value || value === null || value === undefined) return '0';
    const strValue = value.toString().trim();
    // Remove negative sign for missed lifts
    return strValue.replace(/^-/, '');
}

// Check if body weights are within tolerance
function bodyWeightsMatch(weight1, weight2) {
    if (!weight1 || !weight2) return false;
    
    const w1 = parseFloat(weight1);
    const w2 = parseFloat(weight2);
    
    if (isNaN(w1) || isNaN(w2)) return false;
    
    return Math.abs(w1 - w2) <= MATCH_THRESHOLDS.BODY_WEIGHT_TOLERANCE_KG;
}

// Compare competition results
function resultsMatch(dbResult, scrapedComp) {
    // Match dates exactly
    if (dbResult.date !== scrapedComp.date) {
        return false;
    }
    
    // Match meet names exactly (case-insensitive)
    const dbMeetName = (dbResult.meet_name || '').toLowerCase().trim();
    const scrapedMeetName = (scrapedComp.meet_name || '').toLowerCase().trim();
    
    if (dbMeetName !== scrapedMeetName) {
        return false;
    }
    
    // Check body weight within tolerance
    if (!bodyWeightsMatch(dbResult.body_weight_kg, scrapedComp.body_weight_kg)) {
        return false;
    }
    
    // Check if key results match (best snatch, best C&J, total)
    const dbBestSnatch = normalizeLiftValue(dbResult.best_snatch);
    const scrapedBestSnatch = normalizeLiftValue(scrapedComp.best_snatch);
    
    const dbBestCJ = normalizeLiftValue(dbResult.best_cj);
    const scrapedBestCJ = normalizeLiftValue(scrapedComp.best_cj);
    
    const dbTotal = normalizeLiftValue(dbResult.total);
    const scrapedTotal = normalizeLiftValue(scrapedComp.total);
    
    // All three key results must match
    return dbBestSnatch === scrapedBestSnatch && 
           dbBestCJ === scrapedBestCJ && 
           dbTotal === scrapedTotal;
}

// Find matching athlete for a database result
// Find matching athlete for a database result
function findMatchingAthlete(dbResult, athletesData) {
    const matches = [];
    const seenAthletes = new Set(); // Track athletes we've already matched
    
    for (const athlete of athletesData) {
        // Only check athletes with the same name
        if (athlete.athlete_name !== dbResult.lifter_name) {
            continue;
        }
        
        // Skip if we've already found a match for this specific athlete
        const athleteKey = `${athlete.internal_id}_${athlete.membership_number}`;
        if (seenAthletes.has(athleteKey)) {
            continue;
        }
        
        // Check each competition in the athlete's history
        let foundMatch = false;
        for (const competition of athlete.competition_history) {
            if (resultsMatch(dbResult, competition)) {
                matches.push({
                    athlete: athlete,
                    competition: competition,
                    confidence: 'HIGH' // Exact match on date, meet, and results
                });
                seenAthletes.add(athleteKey);
                foundMatch = true;
                break; // Stop after first match for this athlete
            }
        }
    }
    
    return matches;
}

// Process all database results
function matchAllResults(databaseResults, athletesData) {
    log('Starting result matching process...');
    
    const matchAssignments = [];
    const orphanResults = [];
    let totalMatched = 0;
    let totalOrphaned = 0;
    
    for (const athleteName in databaseResults) {
        const athleteResults = databaseResults[athleteName];
        
        if (!athleteResults.results || athleteResults.results.length === 0) {
            continue;
        }
        
        log(`\nProcessing ${athleteResults.results.length} results for ${athleteName}`);
        
        for (const dbResult of athleteResults.results) {
            const matches = findMatchingAthlete(dbResult, athletesData);
            
            if (matches.length === 1) {
                // Exactly one match - perfect!
                matchAssignments.push({
					result_id: dbResult.result_id,
					meet_id: dbResult.meet_id,
					current_lifter_id: dbResult.lifter_id,
					athlete_name: dbResult.lifter_name,
					meet_name: dbResult.meet_name,
					date: dbResult.date,
					new_lifter_id: matches[0].athlete.needs_new_lifter_id ? 
						`NEW_${matches[0].athlete.internal_id}` : 
						matches[0].athlete.contaminated_lifter_id,
					matched_to: {
						internal_id: matches[0].athlete.internal_id,
						membership_number: matches[0].athlete.membership_number,
						birth_year: matches[0].athlete.birth_year,
						needs_new_lifter_id: matches[0].athlete.needs_new_lifter_id,
						contaminated_lifter_id: matches[0].athlete.contaminated_lifter_id
					},
					match_confidence: matches[0].confidence,
					match_details: {
						body_weight: dbResult.body_weight_kg,
						best_snatch: dbResult.best_snatch,
						best_cj: dbResult.best_cj,
						total: dbResult.total
					}
				});
                totalMatched++;
                
            } else if (matches.length > 1) {
                // Multiple matches - this shouldn't happen with exact matching
                log(`  WARNING: Multiple matches for result_id ${dbResult.result_id}`);
                orphanResults.push({
                    result_id: dbResult.result_id,
                    meet_id: dbResult.meet_id,
                    current_lifter_id: dbResult.lifter_id,
                    athlete_name: dbResult.lifter_name,
                    meet_name: dbResult.meet_name,
                    date: dbResult.date,
                    reason: 'MULTIPLE_MATCHES',
                    potential_matches: matches.map(m => ({
                        internal_id: m.athlete.internal_id,
                        membership_number: m.athlete.membership_number
                    })),
                    result_details: {
                        body_weight: dbResult.body_weight_kg,
                        best_snatch: dbResult.best_snatch,
                        best_cj: dbResult.best_cj,
                        total: dbResult.total
                    }
                });
                totalOrphaned++;
                
            } else {
                // No matches found
                orphanResults.push({
                    result_id: dbResult.result_id,
                    meet_id: dbResult.meet_id,
                    current_lifter_id: dbResult.lifter_id,
                    athlete_name: dbResult.lifter_name,
                    meet_name: dbResult.meet_name,
                    date: dbResult.date,
                    reason: 'NO_MATCH',
                    result_details: {
                        body_weight: dbResult.body_weight_kg,
                        age_category: dbResult.age_category,
                        weight_class: dbResult.weight_class,
                        best_snatch: dbResult.best_snatch,
                        best_cj: dbResult.best_cj,
                        total: dbResult.total,
                        club_name: dbResult.club_name,
                        wso: dbResult.wso
                    }
                });
                totalOrphaned++;
            }
        }
    }
    
    log(`\nMatching complete:`);
    log(`  ✅ Matched: ${totalMatched} results`);
    log(`  ❌ Orphaned: ${totalOrphaned} results`);
    
    return { matchAssignments, orphanResults };
}

// Create summary statistics
function createSummaryStats(matchAssignments, orphanResults, athletesData) {
    const stats = {
        total_database_results: matchAssignments.length + orphanResults.length,
        total_matched: matchAssignments.length,
        total_orphaned: orphanResults.length,
        match_rate: ((matchAssignments.length / (matchAssignments.length + orphanResults.length)) * 100).toFixed(2) + '%',
        by_athlete: {},
        orphan_reasons: {}
    };
    
    // Count matches by athlete
    for (const match of matchAssignments) {
        const name = match.athlete_name;
        if (!stats.by_athlete[name]) {
            stats.by_athlete[name] = {
                matched: 0,
                orphaned: 0,
                internal_ids_matched: new Set()
            };
        }
        stats.by_athlete[name].matched++;
        stats.by_athlete[name].internal_ids_matched.add(match.matched_to.internal_id);
    }
    
    // Count orphans by athlete and reason
    for (const orphan of orphanResults) {
        const name = orphan.athlete_name;
        if (!stats.by_athlete[name]) {
            stats.by_athlete[name] = {
                matched: 0,
                orphaned: 0,
                internal_ids_matched: new Set()
            };
        }
        stats.by_athlete[name].orphaned++;
        
        // Track orphan reasons
        stats.orphan_reasons[orphan.reason] = (stats.orphan_reasons[orphan.reason] || 0) + 1;
    }
    
    // Convert Sets to arrays for JSON serialization
    for (const name in stats.by_athlete) {
        stats.by_athlete[name].internal_ids_matched = 
            Array.from(stats.by_athlete[name].internal_ids_matched);
    }
    
    return stats;
}

// Save match assignments
function saveMatchAssignments(matchAssignments, stats, processingTimeMs) {
    log('Saving match assignments...');
    
    const output = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_name: 'membership-matcher',
            script_version: SCRIPT_VERSION,
            total_matches: matchAssignments.length,
            processing_time_ms: processingTimeMs,
            statistics: stats
        },
        data: matchAssignments
    };
    
    fs.writeFileSync(MATCH_OUTPUT_FILE, JSON.stringify(output, null, 2));
    log(`✅ Match assignments saved to: ${MATCH_OUTPUT_FILE}`);
    
    return output;
}

// Save orphan results
function saveOrphanResults(orphanResults, processingTimeMs) {
    log('Saving orphan results...');
    
    const output = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_name: 'membership-matcher',
            script_version: SCRIPT_VERSION,
            total_orphans: orphanResults.length,
            processing_time_ms: processingTimeMs,
            orphan_breakdown: {}
        },
        data: orphanResults
    };
    
    // Create breakdown by reason
    for (const orphan of orphanResults) {
        output.metadata.orphan_breakdown[orphan.reason] = 
            (output.metadata.orphan_breakdown[orphan.reason] || 0) + 1;
    }
    
    fs.writeFileSync(ORPHAN_OUTPUT_FILE, JSON.stringify(output, null, 2));
    log(`✅ Orphan results saved to: ${ORPHAN_OUTPUT_FILE}`);
    
    return output;
}

// Main execution function
async function main() {
    const startTime = Date.now();
    
    try {
        // Setup
        ensureDirectories();
        log('🚀 Starting membership matching process');
        log('=' .repeat(60));
        
        // Load data
        const athletesData = loadScrapedAthleteData();
        const databaseResults = loadDatabaseResults();
        
        // Perform matching
        const { matchAssignments, orphanResults } = matchAllResults(databaseResults, athletesData);
        
        // Create statistics
        const stats = createSummaryStats(matchAssignments, orphanResults, athletesData);
        
        // Log detailed summary
        log('');
        log('📊 Matching Summary:');
        log(`   Total database results: ${stats.total_database_results}`);
        log(`   Successfully matched: ${stats.total_matched}`);
        log(`   Orphaned (need review): ${stats.total_orphaned}`);
        log(`   Match rate: ${stats.match_rate}`);
        
        log('');
        log('   By athlete:');
        for (const name in stats.by_athlete) {
            const data = stats.by_athlete[name];
            log(`     ${name}:`);
            log(`       - Matched: ${data.matched} results`);
            log(`       - Orphaned: ${data.orphaned} results`);
            if (data.internal_ids_matched.length > 0) {
                log(`       - Internal IDs matched: ${data.internal_ids_matched.join(', ')}`);
            }
        }
        
        if (Object.keys(stats.orphan_reasons).length > 0) {
            log('');
            log('   Orphan reasons:');
            for (const reason in stats.orphan_reasons) {
                log(`     ${reason}: ${stats.orphan_reasons[reason]} results`);
            }
        }
        
        // Save results
        const processingTime = Date.now() - startTime;
        saveMatchAssignments(matchAssignments, stats, processingTime);
        saveOrphanResults(orphanResults, processingTime);
        
        log('');
        log(`✅ Process completed successfully in ${processingTime}ms`);
        log(`📄 Next step: Run database-reconstructor.js to execute the cleanup`);
        
        return { matchAssignments, orphanResults, stats };
        
    } catch (error) {
        log(`❌ Process failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Export for use by master script
module.exports = { main, resultsMatch, findMatchingAthlete };

// Run if called directly
if (require.main === module) {
    main();
}