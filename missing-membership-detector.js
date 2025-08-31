/**
 * MISSING MEMBERSHIP NUMBER DETECTOR
 * 
 * Purpose: Comprehensive scan of lifters table to identify all missing membership numbers
 * and prioritize them for backfill operations.
 * 
 * Priority System:
 * 1. HIGH: Active lifters (recent results) with internal_id but no membership
 * 2. MEDIUM: Historical lifters with internal_id but no membership  
 * 3. LOW: Lifters without internal_id or membership (may need manual research)
 * 
 * Usage:
 *   node missing-membership-detector.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const OUTPUT_DIR = './output';
const REPORT_FILE = path.join(OUTPUT_DIR, 'missing_membership_analysis.json');
const CSV_FILE = path.join(OUTPUT_DIR, 'missing_membership_priority.csv');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Priority scoring system
const PRIORITY_WEIGHTS = {
    HAS_INTERNAL_ID: 50,           // Has Sport80 ID - can be scraped
    RECENT_ACTIVITY: 30,           // Competed in last 2 years
    MULTIPLE_INTERNAL_IDS: 20,     // Has backup internal IDs
    HIGH_RESULT_COUNT: 15,         // Many meet results (active athlete)
    RECENT_RESULT: 25,             // Very recent competition (last 6 months)
    CLUB_WSO_KNOWN: 10            // Has affiliation data for context
};

function logWithTimestamp(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

// Calculate priority score for a lifter
function calculatePriorityScore(lifter, recentResultsCount, latestResultDate) {
    let score = 0;
    const now = new Date();
    
    // Internal ID availability (highest priority)
    if (lifter.internal_id) score += PRIORITY_WEIGHTS.HAS_INTERNAL_ID;
    if (lifter.internal_id_2) score += PRIORITY_WEIGHTS.MULTIPLE_INTERNAL_IDS;
    
    // Recent activity scoring
    if (latestResultDate) {
        const daysSinceLastResult = (now - new Date(latestResultDate)) / (1000 * 60 * 60 * 24);
        
        if (daysSinceLastResult < 180) {  // 6 months
            score += PRIORITY_WEIGHTS.RECENT_RESULT;
        } else if (daysSinceLastResult < 730) {  // 2 years
            score += PRIORITY_WEIGHTS.RECENT_ACTIVITY;
        }
    }
    
    // Result volume (indicates active athlete)
    if (recentResultsCount >= 10) {
        score += PRIORITY_WEIGHTS.HIGH_RESULT_COUNT;
    } else if (recentResultsCount >= 5) {
        score += PRIORITY_WEIGHTS.HIGH_RESULT_COUNT * 0.5;
    }
    
    return Math.round(score);
}

// Determine priority category
function getPriorityCategory(score) {
    if (score >= 75) return 'HIGH';
    if (score >= 40) return 'MEDIUM'; 
    return 'LOW';
}

// Get comprehensive lifter data with activity analysis
async function getMissingMembershipLifters() {
    logWithTimestamp('🔍 Scanning lifters table for missing membership numbers...');
    
    // Get all lifters without membership numbers
    const { data: missingLifters, error } = await supabase
        .from('lifters')
        .select(`
            lifter_id,
            athlete_name, 
            internal_id,
            internal_id_2,
            internal_id_3,
            internal_id_4,
            internal_id_5,
            internal_id_6,
            internal_id_7,
            internal_id_8,
            created_at,
            updated_at
        `)
        .is('membership_number', null)
        .order('lifter_id');
    
    if (error) {
        throw new Error(`Failed to fetch lifters: ${error.message}`);
    }
    
    logWithTimestamp(`📊 Found ${missingLifters.length} lifters without membership numbers`);
    
    // Enrich each lifter with activity data
    const enrichedLifters = [];
    
    for (let i = 0; i < missingLifters.length; i++) {
        const lifter = missingLifters[i];
        
        if ((i + 1) % 100 === 0) {
            logWithTimestamp(`📊 Processing lifter ${i + 1}/${missingLifters.length}...`);
        }
        
        // Get recent meet results activity
        const { data: recentResults, error: resultsError } = await supabase
            .from('meet_results')
            .select('result_id, date, meet_name, wso, club_name')
            .eq('lifter_id', lifter.lifter_id)
            .gte('date', '2020-01-01') // Last 4+ years
            .order('date', { ascending: false });
        
        if (resultsError) {
            console.warn(`⚠️  Could not fetch results for lifter_id ${lifter.lifter_id}: ${resultsError.message}`);
            continue;
        }
        
        const recentResultsCount = recentResults?.length || 0;
        const latestResultDate = recentResults?.[0]?.date || null;
        const latestWSO = recentResults?.[0]?.wso || null;
        const latestClub = recentResults?.[0]?.club_name || null;
        
        // Calculate priority score
        const priorityScore = calculatePriorityScore(lifter, recentResultsCount, latestResultDate);
        const priorityCategory = getPriorityCategory(priorityScore);
        
        // Count available internal IDs
        const internalIds = [
            lifter.internal_id,
            lifter.internal_id_2, 
            lifter.internal_id_3,
            lifter.internal_id_4,
            lifter.internal_id_5,
            lifter.internal_id_6,
            lifter.internal_id_7,
            lifter.internal_id_8
        ].filter(id => id !== null);
        
        enrichedLifters.push({
            ...lifter,
            recent_results_count: recentResultsCount,
            latest_result_date: latestResultDate,
            latest_wso: latestWSO,
            latest_club: latestClub,
            priority_score: priorityScore,
            priority_category: priorityCategory,
            internal_ids_available: internalIds.length,
            internal_ids: internalIds,
            scraping_feasible: internalIds.length > 0
        });
    }
    
    return enrichedLifters;
}

// Generate analysis statistics  
function generateAnalysis(lifters) {
    const stats = {
        total_missing_membership: lifters.length,
        by_priority: {
            HIGH: lifters.filter(l => l.priority_category === 'HIGH').length,
            MEDIUM: lifters.filter(l => l.priority_category === 'MEDIUM').length,
            LOW: lifters.filter(l => l.priority_category === 'LOW').length
        },
        scraping_feasible: lifters.filter(l => l.scraping_feasible).length,
        has_recent_activity: lifters.filter(l => l.recent_results_count > 0).length,
        has_internal_id: lifters.filter(l => l.internal_id).length,
        has_multiple_internal_ids: lifters.filter(l => l.internal_ids_available > 1).length,
        top_priorities: lifters
            .filter(l => l.priority_category === 'HIGH')
            .sort((a, b) => b.priority_score - a.priority_score)
            .slice(0, 20)
            .map(l => ({
                lifter_id: l.lifter_id,
                athlete_name: l.athlete_name,
                priority_score: l.priority_score,
                internal_id: l.internal_id,
                recent_results_count: l.recent_results_count,
                latest_result_date: l.latest_result_date
            }))
    };
    
    return stats;
}

// Save results to files
function saveResults(lifters, analysis) {
    // Save detailed JSON report
    const report = {
        generated_at: new Date().toISOString(),
        analysis: analysis,
        lifters: lifters.sort((a, b) => b.priority_score - a.priority_score)
    };
    
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    logWithTimestamp(`📁 Saved detailed report to ${REPORT_FILE}`);
    
    // Save CSV for easy processing
    const headers = [
        'lifter_id',
        'athlete_name', 
        'priority_category',
        'priority_score',
        'internal_id',
        'internal_ids_available',
        'recent_results_count',
        'latest_result_date',
        'latest_wso',
        'latest_club',
        'scraping_feasible'
    ];
    
    let csvContent = headers.join(',') + '\n';
    
    lifters
        .sort((a, b) => b.priority_score - a.priority_score)
        .forEach(lifter => {
            const row = [
                lifter.lifter_id,
                `"${lifter.athlete_name}"`,
                lifter.priority_category,
                lifter.priority_score,
                lifter.internal_id || '',
                lifter.internal_ids_available,
                lifter.recent_results_count,
                lifter.latest_result_date || '',
                `"${lifter.latest_wso || ''}"`,
                `"${lifter.latest_club || ''}"`,
                lifter.scraping_feasible
            ];
            csvContent += row.join(',') + '\n';
        });
    
    fs.writeFileSync(CSV_FILE, csvContent);
    logWithTimestamp(`📁 Saved priority CSV to ${CSV_FILE}`);
}

// Main execution
async function main() {
    console.log('🎯 MISSING MEMBERSHIP NUMBER DETECTOR');
    console.log('=====================================');
    logWithTimestamp('Starting comprehensive membership analysis...');
    
    try {
        // Test database connection
        const { error: testError } = await supabase.from('lifters').select('lifter_id').limit(1);
        if (testError) {
            throw new Error(`Database connection failed: ${testError.message}`);
        }
        logWithTimestamp('✅ Database connection successful');
        
        // Get missing membership lifters
        const lifters = await getMissingMembershipLifters();
        
        // Generate analysis
        logWithTimestamp('📊 Generating priority analysis...');
        const analysis = generateAnalysis(lifters);
        
        // Save results
        saveResults(lifters, analysis);
        
        // Display summary
        console.log('\n📊 MISSING MEMBERSHIP ANALYSIS SUMMARY');
        console.log('======================================');
        console.log(`Total lifters missing membership: ${analysis.total_missing_membership}`);
        console.log(`\n🎯 Priority Breakdown:`);
        console.log(`   HIGH Priority:   ${analysis.by_priority.HIGH} lifters`);
        console.log(`   MEDIUM Priority: ${analysis.by_priority.MEDIUM} lifters`);
        console.log(`   LOW Priority:    ${analysis.by_priority.LOW} lifters`);
        
        console.log(`\n🔍 Scraping Feasibility:`);
        console.log(`   Can be scraped:     ${analysis.scraping_feasible} lifters (have internal_id)`);
        console.log(`   Need manual lookup: ${analysis.total_missing_membership - analysis.scraping_feasible} lifters`);
        
        console.log(`\n📈 Activity Insights:`);
        console.log(`   Have recent activity: ${analysis.has_recent_activity} lifters`);
        console.log(`   Have internal_id:     ${analysis.has_internal_id} lifters`);
        console.log(`   Have backup IDs:      ${analysis.has_multiple_internal_ids} lifters`);
        
        console.log(`\n🏆 Top 5 Priority Lifters:`);
        analysis.top_priorities.slice(0, 5).forEach((lifter, i) => {
            console.log(`   ${i + 1}. ${lifter.athlete_name} (Score: ${lifter.priority_score}, ID: ${lifter.internal_id}, Results: ${lifter.recent_results_count})`);
        });
        
        console.log(`\n✅ Analysis complete! Check output files:`);
        console.log(`   📋 Detailed report: ${REPORT_FILE}`);
        console.log(`   📊 Priority CSV: ${CSV_FILE}`);
        
        logWithTimestamp('🎉 Missing membership detection completed successfully!');
        
    } catch (error) {
        console.error(`\n❌ Detection failed: ${error.message}`);
        console.error(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { main, calculatePriorityScore, getPriorityCategory };