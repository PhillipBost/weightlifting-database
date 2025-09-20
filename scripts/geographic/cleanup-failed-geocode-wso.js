#!/usr/bin/env node

/**
 * Cleanup Failed Geocode WSO Assignments
 *
 * This script removes WSO geography assignments from meets where geocoding failed
 * to prevent inaccurate WSO assignments based on bad location data.
 *
 * Usage:
 *   node cleanup-failed-geocode-wso.js --analyze    # Show analysis of problematic assignments
 *   node cleanup-failed-geocode-wso.js --cleanup    # Clean up bad assignments
 *   node cleanup-failed-geocode-wso.js --report     # Generate cleanup report
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'failed_geocode_cleanup_report.json');
const LOG_FILE = path.join(LOGS_DIR, 'cleanup-failed-geocode-wso.log');
const SCRIPT_VERSION = '1.0.0';

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
        cleanup: args.includes('--cleanup'),
        report: args.includes('--report'),
        dryRun: args.includes('--dry-run')
    };
}

// Analyze current problematic assignments
async function analyzeProblematicAssignments() {
    log('🔍 Analyzing problematic WSO assignments...');
    
    // Get overall statistics
    const { data: stats, error: statsError } = await supabase
        .from('meets')
        .select('geocode_success, wso_geography')
        .not('meet_id', 'is', null);
    
    if (statsError) {
        throw new Error(`Failed to fetch meet statistics: ${statsError.message}`);
    }
    
    const analysis = {
        total_meets: stats.length,
        failed_geocode_meets: 0,
        failed_geocode_with_wso: 0,
        successful_geocode_with_wso: 0,
        null_geocode_with_wso: 0,
        total_with_wso: 0
    };
    
    for (const meet of stats) {
        if (meet.wso_geography) {
            analysis.total_with_wso++;
            
            if (meet.geocode_success === false) {
                analysis.failed_geocode_with_wso++;
            } else if (meet.geocode_success === true) {
                analysis.successful_geocode_with_wso++;
            } else {
                analysis.null_geocode_with_wso++;
            }
        }
        
        if (meet.geocode_success === false) {
            analysis.failed_geocode_meets++;
        }
    }
    
    analysis.percent_incorrect_assignments = analysis.total_with_wso > 0 ? 
        ((analysis.failed_geocode_with_wso / analysis.total_with_wso) * 100).toFixed(2) : 0;
    
    // Get examples of problematic assignments
    const { data: examples, error: examplesError } = await supabase
        .from('meets')
        .select('name, address, city, state, country, wso_geography, geocode_success, geocode_error')
        .eq('geocode_success', false)
        .not('wso_geography', 'is', null)
        .order('name')
        .limit(20);
    
    if (examplesError) {
        log(`⚠️ Warning: Could not fetch examples: ${examplesError.message}`);
    }
    
    return { analysis, examples: examples || [] };
}

// Clean up problematic assignments
async function cleanupProblematicAssignments(dryRun = false) {
    log('🧹 Starting cleanup of problematic WSO assignments...');
    
    // First get the records that will be affected
    const { data: affectedRecords, error: selectError } = await supabase
        .from('meets')
        .select('meet_id, name, wso_geography, geocode_error')
        .eq('geocode_success', false)
        .not('wso_geography', 'is', null);
    
    if (selectError) {
        throw new Error(`Failed to fetch affected records: ${selectError.message}`);
    }
    
    log(`📊 Found ${affectedRecords.length} meets with failed geocoding but assigned WSO`);
    
    if (affectedRecords.length === 0) {
        log('✅ No problematic assignments found - database is clean!');
        return { cleaned: 0, failed: 0, examples: [] };
    }
    
    // Show some examples before cleanup
    log('\n📋 Examples of problematic assignments to be cleaned:');
    const examples = affectedRecords.slice(0, 10);
    examples.forEach((record, index) => {
        log(`  ${index + 1}. "${record.name}" -> ${record.wso_geography} (Error: ${record.geocode_error || 'Unknown'})`);
    });
    
    if (!dryRun) {
        log('\n💾 Executing cleanup...');
        
        // Update records to set wso_geography to null
        const { error: updateError } = await supabase
            .from('meets')
            .update({ 
                wso_geography: null,
                updated_at: new Date().toISOString()
            })
            .eq('geocode_success', false)
            .not('wso_geography', 'is', null);
        
        if (updateError) {
            throw new Error(`Failed to update records: ${updateError.message}`);
        }
        
        log(`✅ Successfully cleaned ${affectedRecords.length} problematic WSO assignments`);
    } else {
        log(`\n🔍 DRY RUN: Would clean ${affectedRecords.length} problematic WSO assignments`);
    }
    
    return { 
        cleaned: dryRun ? 0 : affectedRecords.length, 
        failed: 0, 
        examples: examples.map(r => ({
            name: r.name,
            wso_geography: r.wso_geography,
            geocode_error: r.geocode_error
        }))
    };
}

// Generate WSO distribution after cleanup
async function generateWSODistribution() {
    log('📊 Generating WSO distribution after cleanup...');
    
    const { data: distribution, error } = await supabase
        .from('meets')
        .select('wso_geography, geocode_success')
        .not('wso_geography', 'is', null);
    
    if (error) {
        throw new Error(`Failed to fetch WSO distribution: ${error.message}`);
    }
    
    const wsoStats = {};
    
    for (const record of distribution) {
        const wso = record.wso_geography;
        if (!wsoStats[wso]) {
            wsoStats[wso] = {
                total: 0,
                successful_geocode: 0,
                failed_geocode: 0,
                null_geocode: 0
            };
        }
        
        wsoStats[wso].total++;
        
        if (record.geocode_success === true) {
            wsoStats[wso].successful_geocode++;
        } else if (record.geocode_success === false) {
            wsoStats[wso].failed_geocode++;
        } else {
            wsoStats[wso].null_geocode++;
        }
    }
    
    // Sort by total count
    const sortedStats = Object.entries(wsoStats)
        .sort(([,a], [,b]) => b.total - a.total)
        .reduce((obj, [key, value]) => {
            obj[key] = value;
            return obj;
        }, {});
    
    return sortedStats;
}

// Generate comprehensive report
function generateReport(analysis, cleanupResults, wsoDistribution) {
    const report = {
        metadata: {
            timestamp: new Date().toISOString(),
            script_version: SCRIPT_VERSION,
            operation: 'failed_geocode_cleanup'
        },
        before_cleanup: analysis,
        cleanup_results: cleanupResults,
        wso_distribution_after: wsoDistribution,
        recommendations: []
    };
    
    // Add recommendations based on findings
    if (cleanupResults.cleaned > 0) {
        report.recommendations.push(`Successfully cleaned ${cleanupResults.cleaned} inaccurate WSO assignments`);
    }
    
    if (analysis.analysis.null_geocode_with_wso > 0) {
        report.recommendations.push(`Consider reviewing ${analysis.analysis.null_geocode_with_wso} meets with WSO assignments but null geocode status`);
    }
    
    const qualityScore = analysis.analysis.total_with_wso > 0 ? 
        ((analysis.analysis.successful_geocode_with_wso / analysis.analysis.total_with_wso) * 100).toFixed(1) : 100;
    
    report.quality_score = `${qualityScore}% of WSO assignments based on successful geocoding`;
    
    // Save to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
    log(`📊 Cleanup report saved to: ${OUTPUT_FILE}`);
    
    return report;
}

// Main function
async function main() {
    const startTime = Date.now();
    
    try {
        ensureDirectories();
        
        log('🧹 Starting Failed Geocode WSO Cleanup Script');
        log('='.repeat(60));
        
        const options = parseArguments();
        
        if (options.analyze) {
            log('📊 Running analysis mode...');
            const { analysis, examples } = await analyzeProblematicAssignments();
            
            log('\n📈 Analysis Results:');
            log(`  Total meets: ${analysis.total_meets}`);
            log(`  Meets with WSO assigned: ${analysis.total_with_wso}`);
            log(`  Failed geocode with WSO: ${analysis.failed_geocode_with_wso}`);
            log(`  Successful geocode with WSO: ${analysis.successful_geocode_with_wso}`);
            log(`  Null geocode with WSO: ${analysis.null_geocode_with_wso}`);
            log(`  Percent potentially incorrect: ${analysis.percent_incorrect_assignments}%`);
            
            if (examples.length > 0) {
                log('\n🚨 Examples of problematic assignments:');
                examples.slice(0, 5).forEach((example, index) => {
                    log(`  ${index + 1}. "${example.name}" in ${example.city}, ${example.state} -> ${example.wso_geography}`);
                });
            }
            
        } else if (options.cleanup) {
            log('🧹 Running cleanup mode...');
            const { analysis } = await analyzeProblematicAssignments();
            const cleanupResults = await cleanupProblematicAssignments(options.dryRun);
            const wsoDistribution = await generateWSODistribution();
            const report = generateReport({ analysis }, cleanupResults, wsoDistribution);
            
            log('\n✅ Cleanup Complete:');
            log(`  Records cleaned: ${cleanupResults.cleaned}`);
            log(`  Quality improvement: Removed ${analysis.failed_geocode_with_wso} inaccurate assignments`);
            log(`  Remaining WSO assignments: ${Object.values(wsoDistribution).reduce((sum, stats) => sum + stats.total, 0)}`);
            
        } else if (options.report) {
            log('📊 Running report mode...');
            const { analysis } = await analyzeProblematicAssignments();
            const cleanupResults = { cleaned: 0, failed: 0, examples: [] }; // No cleanup in report mode
            const wsoDistribution = await generateWSODistribution();
            const report = generateReport({ analysis }, cleanupResults, wsoDistribution);
            
            log('\n📋 Report Generated');
            
        } else {
            log('Failed Geocode WSO Cleanup Script');
            log('===================================');
            log('');
            log('Options:');
            log('  --analyze     Analyze problematic WSO assignments');
            log('  --cleanup     Clean up inaccurate assignments');
            log('  --report      Generate comprehensive report');
            log('  --dry-run     Preview cleanup without making changes');
            log('');
            log('Example: node cleanup-failed-geocode-wso.js --analyze');
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