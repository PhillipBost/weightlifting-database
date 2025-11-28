/**
 * WSO DATA VERIFICATION SCRIPT
 * 
 * Analyzes WSO data in meet_results to identify artificially populated values
 * from incorrect lifter table migration
 * 
 * Usage: node verify-wso-data.js
 */

require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Configuration
const OUTPUT_FILE = './output/wso_verification_report.json';

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

// Check WSO distribution across time periods
async function checkWsoByTimePeriod() {
    log('Checking WSO distribution by time period...');

    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('date, wso')
        .not('wso', 'is', null)
        .order('date');

    if (error) {
        throw new Error(`Failed to fetch WSO by time period: ${error.message}`);
    }

    const byYear = {};
    const byDecade = {};

    data.forEach(result => {
        const year = new Date(result.date).getFullYear();
        const decade = Math.floor(year / 10) * 10;

        byYear[year] = (byYear[year] || 0) + 1;
        byDecade[decade] = (byDecade[decade] || 0) + 1;
    });

    return { byYear, byDecade, totalWithWso: data.length };
}

// Find lifters with identical WSO across long time periods
async function findSuspiciousWsoPatterns() {
    log('Finding suspicious WSO patterns...');

    const { data, error } = await supabase.rpc('get_suspicious_wso_patterns', {});

    if (error) {
        // Fallback if RPC doesn't exist - use regular query
        const { data: fallbackData, error: fallbackError } = await supabase
            .from('usaw_meet_results')
            .select('lifter_name, lifter_id, wso, date')
            .not('wso', 'is', null)
            .order('lifter_name, date');

        if (fallbackError) {
            throw new Error(`Failed to fetch WSO patterns: ${fallbackError.message}`);
        }

        // Group by lifter and WSO value
        const lifterWsoMap = {};
        fallbackData.forEach(result => {
            const key = `${result.lifter_name}_${result.wso}`;
            if (!lifterWsoMap[key]) {
                lifterWsoMap[key] = {
                    lifter_name: result.lifter_name,
                    lifter_id: result.lifter_id,
                    wso: result.wso,
                    dates: [],
                    result_count: 0
                };
            }
            lifterWsoMap[key].dates.push(result.date);
            lifterWsoMap[key].result_count++;
        });

        // Find suspicious patterns
        const suspicious = [];
        Object.values(lifterWsoMap).forEach(pattern => {
            const dates = pattern.dates.sort();
            const earliestDate = new Date(dates[0]);
            const latestDate = new Date(dates[dates.length - 1]);
            const yearSpan = latestDate.getFullYear() - earliestDate.getFullYear();

            // Suspicious if same WSO appears across 3+ years or 5+ results
            if ((yearSpan >= 3 || pattern.result_count >= 5) && pattern.result_count > 1) {
                suspicious.push({
                    lifter_name: pattern.lifter_name,
                    lifter_id: pattern.lifter_id,
                    wso: pattern.wso,
                    result_count: pattern.result_count,
                    earliest_meet: dates[0],
                    latest_meet: dates[dates.length - 1],
                    year_span: yearSpan
                });
            }
        });

        return suspicious.sort((a, b) => b.result_count - a.result_count);
    }

    return data;
}

// Check for WSO values that seem too modern for historical meets
async function checkAnachronisticWso() {
    log('Checking for anachronistic WSO values...');

    // Get meets from before 2020 with WSO data
    const { data, error } = await supabase
        .from('usaw_meet_results')
        .select('lifter_name, lifter_id, date, wso, meet_name')
        .not('wso', 'is', null)
        .lt('date', '2020-01-01')
        .order('date');

    if (error) {
        throw new Error(`Failed to fetch historical WSO data: ${error.message}`);
    }

    // WSO system may not have existed or been widely used before certain years
    const suspiciousHistorical = data.filter(result => {
        const year = new Date(result.date).getFullYear();
        // Very suspicious if WSO data exists for meets before 2015
        return year < 2015;
    });

    return {
        pre2020WithWso: data.length,
        pre2015WithWso: suspiciousHistorical.length,
        suspiciousHistorical: suspiciousHistorical.slice(0, 20) // Sample
    };
}

// Get overall WSO statistics
async function getWsoStatistics() {
    log('Getting overall WSO statistics...');

    const [totalResults, withWso, withoutWso] = await Promise.all([
        supabase.from('usaw_meet_results').select('result_id', { count: 'exact', head: true }),
        supabase.from('usaw_meet_results').select('result_id', { count: 'exact', head: true }).not('wso', 'is', null),
        supabase.from('usaw_meet_results').select('result_id', { count: 'exact', head: true }).is('wso', null)
    ]);

    return {
        total_results: totalResults.count,
        results_with_wso: withWso.count,
        results_without_wso: withoutWso.count,
        wso_percentage: totalResults.count > 0 ? ((withWso.count / totalResults.count) * 100).toFixed(2) : '0'
    };
}

// Sample recent vs historical WSO data
async function sampleWsoData() {
    log('Sampling WSO data across time periods...');

    const [recent, historical] = await Promise.all([
        supabase
            .from('usaw_meet_results')
            .select('lifter_name, date, wso, meet_name')
            .not('wso', 'is', null)
            .gte('date', '2022-01-01')
            .order('date', { ascending: false })
            .limit(10),
        supabase
            .from('usaw_meet_results')
            .select('lifter_name, date, wso, meet_name')
            .not('wso', 'is', null)
            .lt('date', '2018-01-01')
            .order('date', { ascending: false })
            .limit(10)
    ]);

    return {
        recent_sample: recent.data || [],
        historical_sample: historical.data || []
    };
}

// Main verification function
async function verifyWsoData() {
    const startTime = Date.now();

    try {
        log('🔍 Starting WSO data verification...');
        log('='.repeat(60));

        const [
            timeDistribution,
            suspiciousPatterns,
            anachronisticData,
            overallStats,
            sampleData
        ] = await Promise.all([
            checkWsoByTimePeriod(),
            findSuspiciousWsoPatterns(),
            checkAnachronisticWso(),
            getWsoStatistics(),
            sampleWsoData()
        ]);

        // Build comprehensive report
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                script_name: 'verify-wso-data',
                processing_time_ms: Date.now() - startTime
            },
            overall_statistics: overallStats,
            time_distribution: timeDistribution,
            suspicious_patterns: {
                count: suspiciousPatterns.length,
                top_20_suspicious: suspiciousPatterns.slice(0, 20)
            },
            anachronistic_analysis: anachronisticData,
            sample_data: sampleData,
            findings: {
                likely_artificial_migration: false,
                evidence: []
            }
        };

        // Analyze findings
        const evidence = [];

        // Check if WSO percentage is suspiciously high
        if (parseFloat(overallStats.wso_percentage) > 80) {
            evidence.push(`High WSO completion rate (${overallStats.wso_percentage}%) suggests artificial population`);
        }

        // Check for too many historical WSO values
        if (anachronisticData.pre2015WithWso > 100) {
            evidence.push(`${anachronisticData.pre2015WithWso} results with WSO data from pre-2015 (WSO system may not have existed)`);
        }

        // Check for suspiciously consistent patterns
        if (suspiciousPatterns.length > 50) {
            evidence.push(`${suspiciousPatterns.length} lifters with identical WSO across multiple years/meets`);
        }

        // Check time distribution anomalies
        const recentYears = Object.keys(timeDistribution.byYear).filter(year => year >= 2020).length;
        const oldYears = Object.keys(timeDistribution.byYear).filter(year => year < 2015).length;
        if (oldYears > recentYears) {
            evidence.push(`More WSO data in old years (${oldYears}) than recent years (${recentYears})`);
        }

        report.findings.likely_artificial_migration = evidence.length >= 2;
        report.findings.evidence = evidence;

        // Save report
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

        // Log summary
        log('\n' + '='.repeat(60));
        log('✅ WSO DATA VERIFICATION COMPLETE');
        log(`   Total meet results: ${overallStats.total_results.toLocaleString()}`);
        log(`   Results with WSO: ${overallStats.results_with_wso.toLocaleString()} (${overallStats.wso_percentage}%)`);
        log(`   Results without WSO: ${overallStats.results_without_wso.toLocaleString()}`);
        log(`   Suspicious patterns found: ${suspiciousPatterns.length}`);
        log(`   Pre-2015 results with WSO: ${anachronisticData.pre2015WithWso}`);

        if (report.findings.likely_artificial_migration) {
            log('\n🚨 LIKELY ARTIFICIAL WSO MIGRATION DETECTED!');
            log('   Evidence:');
            evidence.forEach(item => log(`   • ${item}`));
            log('\n   Recommendation: Consider nullifying artificially migrated WSO values');
        } else {
            log('\n✅ WSO data appears legitimate');
        }

        log('\n📊 TOP SUSPICIOUS LIFTERS (Same WSO across multiple years):');
        suspiciousPatterns.slice(0, 10).forEach(pattern => {
            log(`   • ${pattern.lifter_name}: WSO ${pattern.wso} across ${pattern.result_count} results (${pattern.earliest_meet} to ${pattern.latest_meet})`);
        });

        log(`\n📄 Full report saved to: ${OUTPUT_FILE}`);

        return report;

    } catch (error) {
        log(`\n❌ Verification failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    verifyWsoData();
}

module.exports = { verifyWsoData };