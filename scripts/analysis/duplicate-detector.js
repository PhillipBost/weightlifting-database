/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

/**
 * Duplicate Detection Engine for Athlete Identity Deduplication
 * 
 * This module implements comprehensive duplicate detection for athlete records
 * using multiple matching criteria including name-based matching, performance
 * pattern analysis, and confidence scoring algorithms.
 * 
 * Requirements covered: 1.1, 1.2, 1.3, 1.4
 */

/**
 * Main duplicate detection function
 * Scans the database for potential duplicate athlete records
 * 
 * @param {Object} options - Detection options
 * @param {string} options.country - Limit detection to specific country (optional)
 * @param {number} options.minConfidence - Minimum confidence threshold (default: 50)
 * @param {boolean} options.includePerformanceAnalysis - Include performance pattern analysis (default: true)
 * @returns {Array} Array of duplicate cases with confidence scores
 */
async function detectDuplicates(options = {}) {
    const {
        country = null,
        minConfidence = 50,
        includePerformanceAnalysis = true
    } = options;

    console.log('🔍 Starting comprehensive duplicate detection...');
    console.log(`📊 Options: country=${country || 'all'}, minConfidence=${minConfidence}, performanceAnalysis=${includePerformanceAnalysis}`);

    try {
        // Step 1: Find name-based duplicates
        console.log('📝 Step 1: Finding name-based duplicates...');
        const nameDuplicates = await findNameDuplicates(country);
        console.log(`✅ Found ${nameDuplicates.length} potential name-based duplicate groups`);

        // Step 2: Analyze each duplicate group
        console.log('🔬 Step 2: Analyzing duplicate groups...');
        const duplicateCases = [];

        for (const nameGroup of nameDuplicates) {
            console.log(`  🔍 Analyzing group: ${nameGroup.athlete_name} (${nameGroup.count} records)`);
            
            // Get detailed athlete records for this name group
            const athleteRecords = await getDetailedAthleteRecords(nameGroup.athlete_name, country);
            
            if (athleteRecords.length < 2) {
                console.log(`    ⚠️ Skipping - insufficient records for analysis`);
                continue;
            }

            // Analyze performance patterns if enabled
            let performanceAnalysis = null;
            if (includePerformanceAnalysis) {
                performanceAnalysis = await analyzePerformancePatterns(athleteRecords);
            }

            // Calculate confidence score
            const confidenceScore = calculateConfidenceScore({
                athletes: athleteRecords,
                performanceAnalysis: performanceAnalysis
            });

            // Only include cases above minimum confidence threshold
            if (confidenceScore >= minConfidence) {
                const duplicateCase = {
                    case_id: generateCaseId(athleteRecords),
                    confidence_score: confidenceScore,
                    case_type: determineCaseType(athleteRecords, performanceAnalysis),
                    athletes: athleteRecords.map(athlete => ({
                        db_lifter_id: athlete.lifter_id,
                        athlete_name: athlete.athlete_name,
                        country_code: athlete.country_code || 'USA', // Default to USA for USAW data
                        birth_year: athlete.birth_year,
                        internal_id: athlete.internal_id,
                        membership_number: athlete.membership_number,
                        result_count: athlete.result_count,
                        first_competition: athlete.first_competition,
                        last_competition: athlete.last_competition,
                        weight_class_range: athlete.weight_class_range,
                        performance_summary: athlete.performance_summary
                    })),
                    evidence: generateEvidence(athleteRecords, performanceAnalysis),
                    recommended_action: determineRecommendedAction(confidenceScore, athleteRecords, performanceAnalysis),
                    notes: generateAnalysisNotes(athleteRecords, performanceAnalysis)
                };

                duplicateCases.push(duplicateCase);
                console.log(`    ✅ Added case with confidence ${confidenceScore}%`);
            } else {
                console.log(`    ❌ Skipped - confidence ${confidenceScore}% below threshold ${minConfidence}%`);
            }
        }

        console.log(`🎉 Detection complete: Found ${duplicateCases.length} high-confidence duplicate cases`);
        return duplicateCases;

    } catch (error) {
        console.error('❌ Error during duplicate detection:', error.message);
        throw error;
    }
}

/**
 * Find athletes with identical names within countries
 * Requirement 1.1: Identify athletes with identical names within the same country
 * 
 * @param {string} country - Country code to filter by (optional)
 * @returns {Array} Array of name groups with duplicate counts
 */
async function findNameDuplicates(country = null) {
    console.log(`  🔍 Scanning for name duplicates${country ? ` in ${country}` : ' globally'}...`);

    try {
        // Get all lifters and count duplicates in memory
        // This approach works with Supabase's current API limitations
        let query = supabase
            .from('usaw_lifters')
            .select('athlete_name, lifter_id')
            .not('athlete_name', 'is', null);

        // Add country filter if specified
        if (country) {
            query = query.eq('country_code', country);
        }

        const { data: allLifters, error } = await query;

        if (error) {
            throw new Error(`Failed to get lifters: ${error.message}`);
        }

        if (!allLifters || allLifters.length === 0) {
            console.log(`    📊 No lifters found`);
            return [];
        }

        // Count occurrences of each name
        const nameCounts = {};
        allLifters.forEach(lifter => {
            const name = lifter.athlete_name;
            if (!nameCounts[name]) {
                nameCounts[name] = 0;
            }
            nameCounts[name]++;
        });

        // Filter for duplicates and convert to array format
        const duplicateNames = Object.entries(nameCounts)
            .filter(([name, count]) => count > 1)
            .map(([name, count]) => ({
                athlete_name: name,
                count: count
            }))
            .sort((a, b) => b.count - a.count);

        console.log(`    📊 Found ${duplicateNames.length} names with multiple records`);
        return duplicateNames;

    } catch (error) {
        console.error('❌ Error finding name duplicates:', error.message);
        throw error;
    }
}

/**
 * Get detailed athlete records for analysis
 * Retrieves comprehensive athlete information including performance statistics
 * 
 * @param {string} athleteName - Name of the athlete
 * @param {string} country - Country code filter (optional)
 * @returns {Array} Array of detailed athlete records
 */
async function getDetailedAthleteRecords(athleteName, country = null) {
    try {
        // Get basic lifter information
        let lifterQuery = supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, membership_number, internal_id')
            .eq('athlete_name', athleteName);

        // Note: country filtering not available in usaw_lifters table
        // This is a USAW-specific database, so all athletes are USA

        const { data: lifters, error: lifterError } = await lifterQuery;

        if (lifterError) {
            throw new Error(`Failed to get lifter records: ${lifterError.message}`);
        }

        if (!lifters || lifters.length === 0) {
            return [];
        }

        // Enrich each lifter with performance statistics and birth year from meet results
        const enrichedLifters = [];
        for (const lifter of lifters) {
            const performanceStats = await getLifterPerformanceStats(lifter.lifter_id);
            
            // Get birth year from most recent meet result
            const { data: recentResult } = await supabase
                .from('usaw_meet_results')
                .select('birth_year')
                .eq('lifter_id', lifter.lifter_id)
                .not('birth_year', 'is', null)
                .order('date', { ascending: false })
                .limit(1);

            enrichedLifters.push({
                ...lifter,
                birth_year: recentResult && recentResult.length > 0 ? recentResult[0].birth_year : null,
                country_code: 'USA', // Default for USAW database
                ...performanceStats
            });
        }

        return enrichedLifters;

    } catch (error) {
        console.error('❌ Error getting detailed athlete records:', error.message);
        throw error;
    }
}

/**
 * Get performance statistics for a lifter
 * Calculates comprehensive performance metrics from meet results
 * 
 * @param {number} lifterId - Lifter ID
 * @returns {Object} Performance statistics object
 */
async function getLifterPerformanceStats(lifterId) {
    try {
        const { data: results, error } = await supabase
            .from('usaw_meet_results')
            .select('date, total, weight_class, meet_id, meet_name')
            .eq('lifter_id', lifterId)
            .not('total', 'is', null)
            .order('date', { ascending: true });

        if (error) {
            throw new Error(`Failed to get performance stats: ${error.message}`);
        }

        if (!results || results.length === 0) {
            return {
                result_count: 0,
                first_competition: null,
                last_competition: null,
                weight_class_range: null,
                performance_summary: {
                    best_total: null,
                    avg_total: null,
                    competition_count: 0
                }
            };
        }

        // Calculate statistics
        const totals = results.map(r => parseFloat(r.total)).filter(t => !isNaN(t));
        const weightClasses = [...new Set(results.map(r => r.weight_class).filter(wc => wc))];
        const meetIds = [...new Set(results.map(r => r.meet_id))];

        return {
            result_count: results.length,
            first_competition: results[0].date,
            last_competition: results[results.length - 1].date,
            weight_class_range: weightClasses.length > 1 ? 
                `${weightClasses[0]} - ${weightClasses[weightClasses.length - 1]}` : 
                weightClasses[0] || null,
            performance_summary: {
                best_total: totals.length > 0 ? Math.max(...totals) : null,
                avg_total: totals.length > 0 ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
                competition_count: meetIds.length
            }
        };

    } catch (error) {
        console.error('❌ Error getting lifter performance stats:', error.message);
        return {
            result_count: 0,
            first_competition: null,
            last_competition: null,
            weight_class_range: null,
            performance_summary: {
                best_total: null,
                avg_total: null,
                competition_count: 0
            }
        };
    }
}

/**
 * Analyze performance patterns for duplicate detection
 * Requirement 1.2: Flag records with suspicious performance patterns
 * 
 * @param {Array} athleteRecords - Array of athlete records to analyze
 * @returns {Object} Performance pattern analysis results
 */
async function analyzePerformancePatterns(athleteRecords) {
    console.log(`    🔬 Analyzing performance patterns for ${athleteRecords.length} athletes...`);

    try {
        const analysis = {
            identical_performances: false,
            temporal_conflicts: false,
            weight_class_conflicts: false,
            performance_anomalies: false,
            pattern_details: []
        };

        // Get detailed performance data for all athletes
        const allPerformances = [];
        for (const athlete of athleteRecords) {
            const { data: results, error } = await supabase
                .from('usaw_meet_results')
                .select('date, total, snatch_lift_1, snatch_lift_2, snatch_lift_3, cj_lift_1, cj_lift_2, cj_lift_3, meet_id, weight_class')
                .eq('lifter_id', athlete.lifter_id)
                .not('total', 'is', null)
                .order('date', { ascending: true });

            if (!error && results) {
                allPerformances.push({
                    lifter_id: athlete.lifter_id,
                    athlete_name: athlete.athlete_name,
                    results: results
                });
            }
        }

        // Check for identical performances (Requirement 6.1)
        analysis.identical_performances = checkIdenticalPerformances(allPerformances);
        
        // Check for temporal conflicts (Requirement 6.2)
        analysis.temporal_conflicts = checkTemporalConflicts(allPerformances);
        
        // Check for weight class progression anomalies (Requirement 6.3)
        analysis.weight_class_conflicts = checkWeightClassAnomalies(allPerformances);
        
        // Check for performance trend anomalies (Requirement 6.4)
        analysis.performance_anomalies = checkPerformanceAnomalies(allPerformances);

        console.log(`      📊 Pattern analysis: identical=${analysis.identical_performances}, temporal=${analysis.temporal_conflicts}, weight=${analysis.weight_class_conflicts}, anomalies=${analysis.performance_anomalies}`);

        return analysis;

    } catch (error) {
        console.error('❌ Error analyzing performance patterns:', error.message);
        return {
            identical_performances: false,
            temporal_conflicts: false,
            weight_class_conflicts: false,
            performance_anomalies: false,
            pattern_details: []
        };
    }
}

/**
 * Check for identical performance records between athletes
 * Identifies cases where different athlete records have identical lifts at different meets
 * 
 * @param {Array} allPerformances - Performance data for all athletes
 * @returns {boolean} True if identical performances found
 */
function checkIdenticalPerformances(allPerformances) {
    const performanceSignatures = new Map();

    for (const athletePerf of allPerformances) {
        for (const result of athletePerf.results) {
            // Create a signature from lift attempts
            const signature = `${result.snatch_lift_1}-${result.snatch_lift_2}-${result.snatch_lift_3}-${result.cj_lift_1}-${result.cj_lift_2}-${result.cj_lift_3}`;
            
            if (performanceSignatures.has(signature)) {
                const existing = performanceSignatures.get(signature);
                if (existing.lifter_id !== athletePerf.lifter_id && existing.meet_id !== result.meet_id) {
                    console.log(`      🚨 Identical performance found: ${signature} between lifters ${existing.lifter_id} and ${athletePerf.lifter_id}`);
                    return true;
                }
            } else {
                performanceSignatures.set(signature, {
                    lifter_id: athletePerf.lifter_id,
                    meet_id: result.meet_id,
                    date: result.date
                });
            }
        }
    }

    return false;
}

/**
 * Check for temporal conflicts (impossible competition schedules)
 * Identifies cases where an athlete appears to compete at simultaneous meets
 * 
 * @param {Array} allPerformances - Performance data for all athletes
 * @returns {boolean} True if temporal conflicts found
 */
function checkTemporalConflicts(allPerformances) {
    // Group all results by date
    const resultsByDate = new Map();

    for (const athletePerf of allPerformances) {
        for (const result of athletePerf.results) {
            const date = result.date;
            if (!resultsByDate.has(date)) {
                resultsByDate.set(date, []);
            }
            resultsByDate.get(date).push({
                lifter_id: athletePerf.lifter_id,
                meet_id: result.meet_id,
                athlete_name: athletePerf.athlete_name
            });
        }
    }

    // Check for same athlete at multiple meets on same date
    for (const [date, results] of resultsByDate) {
        const lifterMeets = new Map();
        
        for (const result of results) {
            if (!lifterMeets.has(result.lifter_id)) {
                lifterMeets.set(result.lifter_id, new Set());
            }
            lifterMeets.get(result.lifter_id).add(result.meet_id);
        }

        // Check if any lifter has multiple meets on same date
        for (const [lifterId, meetIds] of lifterMeets) {
            if (meetIds.size > 1) {
                console.log(`      🚨 Temporal conflict: Lifter ${lifterId} at ${meetIds.size} meets on ${date}`);
                return true;
            }
        }
    }

    return false;
}

/**
 * Check for weight class progression anomalies
 * Identifies suspicious weight class patterns that might indicate merged athletes
 * 
 * @param {Array} allPerformances - Performance data for all athletes
 * @returns {boolean} True if weight class anomalies found
 */
function checkWeightClassAnomalies(allPerformances) {
    for (const athletePerf of allPerformances) {
        const weightClasses = athletePerf.results
            .map(r => r.weight_class)
            .filter(wc => wc)
            .map(wc => parseFloat(wc.replace(/[^\d.]/g, ''))) // Extract numeric weight
            .filter(w => !isNaN(w));

        if (weightClasses.length > 1) {
            const minWeight = Math.min(...weightClasses);
            const maxWeight = Math.max(...weightClasses);
            
            // Flag if weight class range is suspiciously large (>20kg difference)
            if (maxWeight - minWeight > 20) {
                console.log(`      🚨 Weight class anomaly: Lifter ${athletePerf.lifter_id} range ${minWeight}kg - ${maxWeight}kg`);
                return true;
            }
        }
    }

    return false;
}

/**
 * Check for performance trend anomalies
 * Identifies unusual performance improvements or declines that might indicate identity contamination
 * 
 * @param {Array} allPerformances - Performance data for all athletes
 * @returns {boolean} True if performance anomalies found
 */
function checkPerformanceAnomalies(allPerformances) {
    for (const athletePerf of allPerformances) {
        const totals = athletePerf.results
            .map(r => parseFloat(r.total))
            .filter(t => !isNaN(t));

        if (totals.length > 2) {
            // Check for extreme variations (>50kg jumps between consecutive competitions)
            for (let i = 1; i < totals.length; i++) {
                const diff = Math.abs(totals[i] - totals[i - 1]);
                if (diff > 50) {
                    console.log(`      🚨 Performance anomaly: Lifter ${athletePerf.lifter_id} ${diff}kg jump between competitions`);
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * Calculate confidence score for duplicate case
 * Requirement 1.3: Calculate confidence scores based on multiple matching criteria
 * 
 * @param {Object} caseData - Case data including athletes and performance analysis
 * @returns {number} Confidence score (0-100)
 */
function calculateConfidenceScore(caseData) {
    const { athletes, performanceAnalysis } = caseData;
    let score = 0;
    const maxScore = 100;

    // Base score for name match (20 points)
    score += 20;

    // Internal ID analysis (30 points max)
    const internalIds = athletes.map(a => a.internal_id).filter(id => id !== null);
    if (internalIds.length > 0) {
        const uniqueInternalIds = new Set(internalIds);
        if (uniqueInternalIds.size === 1) {
            // All have same internal_id - very high confidence for merge
            score += 30;
        } else if (uniqueInternalIds.size === internalIds.length) {
            // All have different internal_ids - suggests different people
            score -= 10;
        }
        // Mixed case (some null, some different) - neutral
    }

    // Membership number analysis (20 points max)
    const membershipNumbers = athletes.map(a => a.membership_number).filter(mn => mn !== null);
    if (membershipNumbers.length > 0) {
        const uniqueMembershipNumbers = new Set(membershipNumbers);
        if (uniqueMembershipNumbers.size === 1) {
            // Same membership number - high confidence for merge
            score += 20;
        } else if (uniqueMembershipNumbers.size === membershipNumbers.length) {
            // Different membership numbers - suggests different people
            score -= 15;
        }
    }

    // Performance pattern analysis (30 points max)
    if (performanceAnalysis) {
        if (performanceAnalysis.identical_performances) {
            score += 15; // Strong indicator of duplicate
        }
        if (performanceAnalysis.temporal_conflicts) {
            score += 10; // Impossible schedule suggests merge needed
        }
        if (performanceAnalysis.weight_class_conflicts) {
            score += 5; // Suspicious weight progression
        }
        if (performanceAnalysis.performance_anomalies) {
            score += 5; // Unusual performance patterns
        }
    }

    // Competition timeline overlap analysis (10 points max)
    const competitionDates = athletes
        .filter(a => a.first_competition && a.last_competition)
        .map(a => ({
            start: new Date(a.first_competition),
            end: new Date(a.last_competition)
        }));

    if (competitionDates.length > 1) {
        // Check for overlapping competition periods
        let hasOverlap = false;
        for (let i = 0; i < competitionDates.length - 1; i++) {
            for (let j = i + 1; j < competitionDates.length; j++) {
                const period1 = competitionDates[i];
                const period2 = competitionDates[j];
                
                if (period1.start <= period2.end && period2.start <= period1.end) {
                    hasOverlap = true;
                    break;
                }
            }
            if (hasOverlap) break;
        }
        
        if (hasOverlap) {
            score += 10; // Overlapping periods suggest same person
        }
    }

    // Ensure score is within bounds
    return Math.max(0, Math.min(maxScore, Math.round(score)));
}

/**
 * Determine case type based on analysis
 * 
 * @param {Array} athleteRecords - Athlete records
 * @param {Object} performanceAnalysis - Performance analysis results
 * @returns {string} Case type: 'merge', 'split', or 'ambiguous'
 */
function determineCaseType(athleteRecords, performanceAnalysis) {
    // Check internal_ids
    const internalIds = athleteRecords.map(a => a.internal_id).filter(id => id !== null);
    const uniqueInternalIds = new Set(internalIds);

    if (internalIds.length > 0 && uniqueInternalIds.size === 1) {
        return 'merge'; // Same internal_id suggests merge
    }

    if (performanceAnalysis) {
        if (performanceAnalysis.identical_performances || performanceAnalysis.temporal_conflicts) {
            return 'merge'; // Performance patterns suggest same person
        }
        
        if (performanceAnalysis.weight_class_conflicts || performanceAnalysis.performance_anomalies) {
            return 'split'; // Suggests different people merged incorrectly
        }
    }

    return 'ambiguous'; // Requires manual review
}

/**
 * Generate evidence object for duplicate case
 * 
 * @param {Array} athleteRecords - Athlete records
 * @param {Object} performanceAnalysis - Performance analysis results
 * @returns {Object} Evidence object
 */
function generateEvidence(athleteRecords, performanceAnalysis) {
    const internalIds = athleteRecords.map(a => a.internal_id).filter(id => id !== null);
    const membershipNumbers = athleteRecords.map(a => a.membership_number).filter(mn => mn !== null);

    return {
        name_match: true, // Always true since we're matching by name
        internal_id_match: internalIds.length > 0 ? new Set(internalIds).size === 1 : null,
        membership_match: membershipNumbers.length > 0 ? new Set(membershipNumbers).size === 1 : null,
        performance_overlap: performanceAnalysis ? performanceAnalysis.identical_performances : false,
        timeline_conflict: performanceAnalysis ? performanceAnalysis.temporal_conflicts : false,
        weight_class_conflict: performanceAnalysis ? performanceAnalysis.weight_class_conflicts : false
    };
}

/**
 * Determine recommended action based on confidence and analysis
 * 
 * @param {number} confidenceScore - Confidence score
 * @param {Array} athleteRecords - Athlete records
 * @param {Object} performanceAnalysis - Performance analysis results
 * @returns {string} Recommended action
 */
function determineRecommendedAction(confidenceScore, athleteRecords, performanceAnalysis) {
    if (confidenceScore >= 90) {
        return 'auto_merge';
    } else if (confidenceScore >= 70) {
        return 'manual_review';
    } else {
        return 'split';
    }
}

/**
 * Generate analysis notes for the case
 * 
 * @param {Array} athleteRecords - Athlete records
 * @param {Object} performanceAnalysis - Performance analysis results
 * @returns {string} Analysis notes
 */
function generateAnalysisNotes(athleteRecords, performanceAnalysis) {
    const notes = [];
    
    notes.push(`${athleteRecords.length} athlete records with identical name`);
    
    const internalIds = athleteRecords.map(a => a.internal_id).filter(id => id !== null);
    if (internalIds.length > 0) {
        const uniqueIds = new Set(internalIds);
        if (uniqueIds.size === 1) {
            notes.push(`All records share internal_id ${Array.from(uniqueIds)[0]}`);
        } else {
            notes.push(`Multiple internal_ids: ${Array.from(uniqueIds).join(', ')}`);
        }
    }

    if (performanceAnalysis) {
        if (performanceAnalysis.identical_performances) {
            notes.push('Identical performance records detected');
        }
        if (performanceAnalysis.temporal_conflicts) {
            notes.push('Temporal conflicts in competition schedule');
        }
        if (performanceAnalysis.weight_class_conflicts) {
            notes.push('Suspicious weight class progression');
        }
        if (performanceAnalysis.performance_anomalies) {
            notes.push('Performance trend anomalies detected');
        }
    }

    return notes.join('; ');
}

/**
 * Generate unique case ID
 * 
 * @param {Array} athleteRecords - Athlete records
 * @returns {string} Unique case ID
 */
function generateCaseId(athleteRecords) {
    const lifterIds = athleteRecords.map(a => a.lifter_id).sort().join('-');
    const timestamp = Date.now();
    return `DUP_${lifterIds}_${timestamp}`;
}

module.exports = {
    detectDuplicates,
    findNameDuplicates,
    analyzePerformancePatterns,
    calculateConfidenceScore
};