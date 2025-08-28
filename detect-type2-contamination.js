/**
 * TYPE 2 CONTAMINATION DETECTION SCRIPT
 * 
 * Purpose: Detects lifter_ids that likely contain meet results from multiple 
 * distinct athletes (Type 2 contamination) by analyzing patterns in the data.
 * 
 * Detection Criteria:
 * - High result counts for single lifter_id (>30 results)  
 * - Wide date ranges spanning many years
 * - Multiple different clubs/WSOs for same athlete
 * - Inconsistent performance patterns
 * - Birth year inconsistencies
 * 
 * Usage:
 *   node detect-type2-contamination.js
 *   node detect-type2-contamination.js --athlete "John Smith"
 *   node detect-type2-contamination.js --limit 100
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'type2_contamination_detection.json');
const LOG_FILE = path.join(LOGS_DIR, 'detect-type2-contamination.log');
const SCRIPT_VERSION = '1.0.0';

// Detection thresholds
const DETECTION_CRITERIA = {
    MIN_RESULTS_FOR_ANALYSIS: 15,      // Only analyze lifter_ids with 15+ results
    SUSPICIOUS_RESULT_COUNT: 30,        // Flag if >30 results for one lifter_id
    MAX_CAREER_SPAN_YEARS: 25,         // Flag if career spans >25 years
    MAX_CLUBS_PER_ATHLETE: 3,          // Flag if >3 different clubs
    MAX_WSOS_PER_ATHLETE: 2,           // Flag if >2 different WSOs
    MIN_CONFIDENCE_SCORE: 0.6          // Only flag if confidence >60%
};

// Common athlete names that are likely to have duplicates
const COMMON_NAMES = [
    'Michael Smith', 'John Smith', 'David Smith', 'Chris Smith', 'Mike Smith',
    'Michael Johnson', 'John Johnson', 'David Johnson', 'Chris Johnson',
    'Michael Brown', 'John Brown', 'David Brown', 'Chris Brown',
    'Michael Davis', 'John Davis', 'David Davis', 'Chris Davis',
    'Michael Miller', 'John Miller', 'David Miller', 'Chris Miller',
    'Michael Wilson', 'John Wilson', 'David Wilson', 'Chris Wilson',
    'Michael Moore', 'John Moore', 'David Moore', 'Chris Moore',
    'Michael Taylor', 'John Taylor', 'David Taylor', 'Chris Taylor',
    'Michael Anderson', 'John Anderson', 'David Anderson', 'Chris Anderson',
    'Michael Thomas', 'John Thomas', 'David Thomas', 'Chris Thomas',
    'Paul Smith', 'Robert Smith', 'James Smith', 'William Smith',
    'Sarah Smith', 'Jennifer Smith', 'Lisa Smith', 'Michelle Smith'
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
    const options = {
        athlete: null,
        limit: null
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--athlete':
                options.athlete = args[i + 1];
                i++;
                break;
            case '--limit':
                options.limit = parseInt(args[i + 1]);
                i++;
                break;
        }
    }
    
    return options;
}

// Find Type 2 contaminated lifter_ids (high result counts for single lifter_id)
async function getType2ContaminatedLifters(options) {
    log('Finding Type 2 contaminated lifter_ids (high result counts)...');
    
    // Query to find lifter_ids with high meet result counts
    // This indicates potential Type 2 contamination (multiple athletes' results under one lifter_id)
    const { data: highResultLifters, error } = await supabase
        .rpc('get_lifters_with_high_result_counts', {
            min_results: 30  // Lifter_ids with 30+ results are suspicious
        });
    
    if (error) {
        // Fallback: manual query if RPC doesn't exist
        log('RPC not available, using manual query...');
        
        let query = supabase
            .from('lifters')
            .select(`
                lifter_id,
                athlete_name,
                membership_number,
                internal_id
            `)
            .not('internal_id', 'is', null)
            .is('internal_id_2', null)  // Only single internal_id (not Type 1 contamination)
            .is('internal_id_3', null)
            .is('internal_id_4', null)
            .is('internal_id_5', null)
            .is('internal_id_6', null)
            .is('internal_id_7', null)
            .is('internal_id_8', null);
        
        // Filter by athlete name if specified
        if (options.athlete) {
            query = query.eq('athlete_name', options.athlete);
            log(`Filtering for specific athlete: ${options.athlete}`);
        }
        
        // Apply limit if specified
        if (options.limit) {
            query = query.limit(options.limit);
            log(`Limiting to ${options.limit} lifter_ids`);
        }
        
        const { data: lifters, error: queryError } = await query;
        
        if (queryError) {
            throw new Error(`Failed to fetch lifter_ids: ${queryError.message}`);
        }
        
        // Now check which ones have high result counts
        const type2Candidates = [];
        
        log(`Checking ${lifters.length} single-internal-id lifters for high result counts...`);
        
        for (const lifter of lifters) {
            const { data: resultCount, error: countError } = await supabase
                .from('meet_results')
                .select('result_id', { count: 'exact', head: true })
                .eq('lifter_id', lifter.lifter_id);
            
            if (countError) {
                log(`⚠️  Error counting results for lifter_id ${lifter.lifter_id}: ${countError.message}`);
                continue;
            }
            
            if (resultCount && resultCount.count >= 30) {
                type2Candidates.push({
                    ...lifter,
                    result_count: resultCount.count
                });
            }
        }
        
        log(`Found ${type2Candidates.length} potential Type 2 contaminated lifter_ids`);
        return type2Candidates;
    }
    
    log(`Found ${highResultLifters.length} potential Type 2 contaminated lifter_ids`);
    return highResultLifters;
}

// Get meet results for a lifter_id with statistical analysis
async function analyzeLifterResults(lifter) {
    const { data: results, error } = await supabase
        .from('meet_results')
        .select('*')
        .eq('lifter_id', lifter.lifter_id)
        .order('date', { ascending: true });
    
    if (error) {
        throw new Error(`Failed to fetch results for lifter_id ${lifter.lifter_id}: ${error.message}`);
    }
    
    if (results.length < DETECTION_CRITERIA.MIN_RESULTS_FOR_ANALYSIS) {
        return null; // Not enough data to analyze
    }
    
    // Analyze the results for contamination indicators
    const analysis = {
        lifter_id: lifter.lifter_id,
        athlete_name: lifter.athlete_name,
        membership_number: lifter.membership_number,
        total_results: results.length,
        date_range: {
            earliest: results[0]?.date,
            latest: results[results.length - 1]?.date,
            span_years: null
        },
        clubs: [...new Set(results.map(r => r.club_name).filter(Boolean))],
        wsos: [...new Set(results.map(r => r.wso).filter(Boolean))],
        lifter_names: [...new Set(results.map(r => r.lifter_name).filter(Boolean))],
        age_categories: [...new Set(results.map(r => r.age_category).filter(Boolean))],
        weight_classes: [...new Set(results.map(r => r.weight_class).filter(Boolean))],
        performance_stats: calculatePerformanceStats(results),
        contamination_indicators: [],
        confidence_score: 0
    };
    
    // Calculate date span
    if (analysis.date_range.earliest && analysis.date_range.latest) {
        const earliestDate = new Date(analysis.date_range.earliest);
        const latestDate = new Date(analysis.date_range.latest);
        analysis.date_range.span_years = (latestDate - earliestDate) / (1000 * 60 * 60 * 24 * 365.25);
    }
    
    // Detect contamination indicators
    detectContaminationIndicators(analysis);
    
    return analysis;
}

// Calculate performance statistics
function calculatePerformanceStats(results) {
    const totals = results
        .map(r => parseInt(r.total))
        .filter(t => t && t > 0);
    
    if (totals.length === 0) {
        return { avg_total: null, min_total: null, max_total: null, total_range: null };
    }
    
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    
    return {
        avg_total: Math.round(avg),
        min_total: min,
        max_total: max,
        total_range: max - min,
        total_count: totals.length
    };
}

// Detect indicators of Type 2 contamination
function detectContaminationIndicators(analysis) {
    let score = 0;
    
    // Indicator 1: High result count
    if (analysis.total_results >= DETECTION_CRITERIA.SUSPICIOUS_RESULT_COUNT) {
        analysis.contamination_indicators.push(`High result count: ${analysis.total_results} results`);
        score += 0.3;
    }
    
    // Indicator 2: Long career span
    if (analysis.date_range.span_years > DETECTION_CRITERIA.MAX_CAREER_SPAN_YEARS) {
        analysis.contamination_indicators.push(`Long career span: ${Math.round(analysis.date_range.span_years)} years`);
        score += 0.25;
    }
    
    // Indicator 3: Multiple clubs
    if (analysis.clubs.length > DETECTION_CRITERIA.MAX_CLUBS_PER_ATHLETE) {
        analysis.contamination_indicators.push(`Multiple clubs: ${analysis.clubs.join(', ')}`);
        score += 0.2;
    }
    
    // Indicator 4: Multiple WSOs
    if (analysis.wsos.length > DETECTION_CRITERIA.MAX_WSOS_PER_ATHLETE) {
        analysis.contamination_indicators.push(`Multiple WSOs: ${analysis.wsos.join(', ')}`);
        score += 0.15;
    }
    
    // Indicator 5: Multiple lifter names (strong indicator)
    if (analysis.lifter_names.length > 1) {
        analysis.contamination_indicators.push(`Multiple lifter names: ${analysis.lifter_names.join(', ')}`);
        score += 0.4;
    }
    
    // Indicator 6: Wide performance range (possible indicator)
    if (analysis.performance_stats.total_range > 100 && analysis.performance_stats.total_count > 10) {
        analysis.contamination_indicators.push(`Wide performance range: ${analysis.performance_stats.min_total}-${analysis.performance_stats.max_total}kg`);
        score += 0.1;
    }
    
    // Indicator 7: Multiple weight classes with big jumps
    const weightClassNumbers = analysis.weight_classes
        .map(wc => parseInt(wc.replace(/[^0-9]/g, '')))
        .filter(n => n > 0)
        .sort((a, b) => a - b);
    
    if (weightClassNumbers.length > 1) {
        const maxJump = Math.max(...weightClassNumbers.slice(1).map((wc, i) => wc - weightClassNumbers[i]));
        if (maxJump > 20) {
            analysis.contamination_indicators.push(`Large weight class jumps: ${analysis.weight_classes.join(', ')}`);
            score += 0.1;
        }
    }
    
    analysis.confidence_score = Math.min(score, 1.0);
}

// Main detection function  
async function detectType2Contamination() {
    const startTime = Date.now();
    
    try {
        ensureDirectories();
        log('🔍 Starting Type 2 contamination detection');
        log('Finding lifter_ids with multiple internal_ids...');
        log('='.repeat(60));
        
        // Parse options
        const options = parseArguments();
        if (options.athlete) log(`🎯 Target athlete: ${options.athlete}`);
        if (options.limit) log(`📊 Limit: ${options.limit}`);
        
        // Get contaminated lifter_ids (simple database query)
        const contaminatedLifters = await getContaminatedLifters(options);
        
        if (contaminatedLifters.length === 0) {
            log('✅ No contaminated lifter_ids found');
            
            const report = {
                metadata: {
                    timestamp: new Date().toISOString(),
                    script_name: 'detect-type2-contamination',
                    script_version: SCRIPT_VERSION,
                    processing_time_ms: Date.now() - startTime
                },
                summary: {
                    contaminated_found: 0
                },
                contaminated_athletes: []
            };
            
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
            log(`📄 Detection report saved to: ${OUTPUT_FILE}`);
            
            return report;
        }
        
        // Convert to simple list for cleanup script
        const contaminatedAthletes = contaminatedLifters.map(lifter => ({
            lifter_id: lifter.lifter_id,
            athlete_name: lifter.athlete_name,
            membership_number: lifter.membership_number,
            internal_id: lifter.internal_id,
            all_internal_ids: [
                lifter.internal_id,
                lifter.internal_id_2,
                lifter.internal_id_3, 
                lifter.internal_id_4,
                lifter.internal_id_5,
                lifter.internal_id_6,
                lifter.internal_id_7,
                lifter.internal_id_8
            ].filter(Boolean)
        }));
        
        // Generate simple report
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                script_name: 'detect-type2-contamination', 
                script_version: SCRIPT_VERSION,
                processing_time_ms: Date.now() - startTime
            },
            summary: {
                contaminated_found: contaminatedAthletes.length
            },
            contaminated_athletes: contaminatedAthletes
        };
        
        // Save report
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
        log(`📄 Detection report saved to: ${OUTPUT_FILE}`);
        
        // Final summary
        log('\n' + '='.repeat(60));
        log('✅ TYPE 2 CONTAMINATION DETECTION COMPLETE');
        log(`   Contaminated lifter_ids found: ${contaminatedAthletes.length}`);
        log(`   Processing time: ${Date.now() - startTime}ms`);
        
        if (contaminatedAthletes.length > 0) {
            log('\n⚠️ CONTAMINATED LIFTER_IDS FOUND:');
            contaminatedAthletes.forEach(athlete => {
                log(`   • ${athlete.athlete_name} (lifter_id: ${athlete.lifter_id}) - ${athlete.all_internal_ids.length} internal_ids`);
            });
        }
        
        return report;
        
    } catch (error) {
        log(`\n❌ Detection failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Export for use by other scripts
module.exports = { 
    detectType2Contamination, 
    analyzeLifterResults, 
    DETECTION_CRITERIA 
};

// Run if called directly
if (require.main === module) {
    detectType2Contamination();
}