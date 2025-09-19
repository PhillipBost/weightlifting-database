#!/usr/bin/env node

/**
 * WSO Integration Validation Script
 *
 * Tests joins between wso_information table and existing tables,
 * validates data consistency, and identifies missing WSO records.
 *
 * Usage: node validate-wso-integration.js
 */

const { createClient } = require('@supabase/supabase-js');
const { WSOGeographicUtils } = require('./wso-geographic-utils');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const wsoUtils = new WSOGeographicUtils(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function validateJoins() {
    console.log('🔗 Testing joins between wso_information and existing tables');
    console.log('============================================================');

    try {
        // Test join with meet_results
        const { data: joinResults, error: joinError } = await supabase
            .from('meet_results')
            .select(`
                result_id,
                lifter_name,
                wso,
                wso_information (
                    name,
                    official_url,
                    geographic_type,
                    states
                )
            `)
            .not('wso', 'is', null)
            .limit(5);

        if (joinError) {
            console.error('❌ Join test failed:', joinError.message);
            return false;
        }

        console.log('✅ Join test successful! Sample results:');
        joinResults.forEach((result, index) => {
            const wsoInfo = result.wso_information;
            console.log(`   ${index + 1}. ${result.lifter_name} (${result.wso})`);
            if (wsoInfo) {
                console.log(`      URL: ${wsoInfo.official_url || 'Not set'}`);
                console.log(`      Type: ${wsoInfo.geographic_type || 'Not set'}`);
                console.log(`      States: ${wsoInfo.states ? wsoInfo.states.join(', ') : 'Not set'}`);
            } else {
                console.log(`      ⚠️  No WSO information found for "${result.wso}"`);
            }
            console.log('');
        });

        return true;
    } catch (error) {
        console.error('❌ Join validation error:', error.message);
        return false;
    }
}

async function findMissingWSOs() {
    console.log('🔍 Identifying WSOs in meet_results that are missing from wso_information');
    console.log('========================================================================');

    // Get all unique WSOs from meet_results
    const { data: meetResultsWSOs, error: resultsError } = await supabase
        .from('meet_results')
        .select('wso')
        .not('wso', 'is', null);

    if (resultsError) {
        console.error('Error fetching WSOs from meet_results:', resultsError.message);
        return;
    }

    // Get all WSOs from wso_information
    const { data: wsoInfoRecords, error: wsoError } = await supabase
        .from('wso_information')
        .select('name');

    if (wsoError) {
        console.error('Error fetching WSOs from wso_information:', wsoError.message);
        return;
    }

    // Create sets for comparison
    const resultsWSOs = new Set(meetResultsWSOs.map(r => r.wso.trim()));
    const infoWSOs = new Set(wsoInfoRecords.map(r => r.name));

    // Find missing WSOs
    const missingWSOs = [...resultsWSOs].filter(wso => !infoWSOs.has(wso));

    console.log(`📊 WSO Analysis:`);
    console.log(`   Total WSOs in meet_results: ${resultsWSOs.size}`);
    console.log(`   Total WSOs in wso_information: ${infoWSOs.size}`);
    console.log(`   Missing from wso_information: ${missingWSOs.length}`);

    if (missingWSOs.length > 0) {
        console.log('\\n❗ Missing WSOs that need to be added:');
        missingWSOs.sort().forEach((wso, index) => {
            console.log(`   ${index + 1}. "${wso}"`);
        });
    } else {
        console.log('\\n✅ All WSOs from meet_results are present in wso_information!');
    }

    return missingWSOs;
}

async function testGeographicFunctions() {
    console.log('🌍 Testing geographic utility functions');
    console.log('=======================================');

    try {
        // Test getting all WSOs
        const allWSOs = await wsoUtils.getAllWSOs();
        console.log(`✅ getAllWSOs(): Found ${allWSOs.length} WSO records`);

        // Test getting specific WSO
        if (allWSOs.length > 0) {
            const firstWSO = allWSOs[0];
            const wsoByName = await wsoUtils.getWSOByName(firstWSO.name);
            console.log(`✅ getWSOByName("${firstWSO.name}"): ${wsoByName ? 'Found' : 'Not found'}`);

            // Test distance calculation if we have coordinates
            if (wsoByName && wsoByName.geographic_center_lat && wsoByName.geographic_center_lng) {
                const testDistance = await wsoUtils.calculateWSOToMeetDistance(
                    firstWSO.name,
                    40.7128, // NYC coordinates
                    -74.0060
                );
                console.log(`✅ calculateWSOToMeetDistance(): ${testDistance ? testDistance + ' km' : 'No result'}`);
            }
        }

        // Test with non-existent WSO
        const nonExistent = await wsoUtils.getWSOByName('NonExistentWSO');
        console.log(`✅ getWSOByName("NonExistentWSO"): ${nonExistent ? 'Found (unexpected!)' : 'Correctly returned null'}`);

    } catch (error) {
        console.error('❌ Geographic function test failed:', error.message);
    }
}

async function validateDataConsistency() {
    console.log('🔍 Validating data consistency');
    console.log('==============================');

    const { data: wsoRecords, error } = await supabase
        .from('wso_information')
        .select('*');

    if (error) {
        console.error('Error fetching WSO records:', error.message);
        return;
    }

    let issues = 0;

    wsoRecords.forEach(record => {
        console.log(`\\n📋 Checking "${record.name}":`);

        // Check required fields
        if (!record.name || record.name.trim() === '') {
            console.log('   ❌ Missing or empty name');
            issues++;
        } else {
            console.log('   ✅ Name present');
        }

        // Check URL format if provided
        if (record.official_url) {
            if (record.official_url.startsWith('http://') || record.official_url.startsWith('https://')) {
                console.log('   ✅ URL format looks valid');
            } else {
                console.log('   ⚠️  URL format may be invalid (missing protocol)');
            }
        } else {
            console.log('   ⚠️  No official URL set');
        }

        // Check geographic data
        if (record.geographic_center_lat && record.geographic_center_lng) {
            if (record.geographic_center_lat >= -90 && record.geographic_center_lat <= 90 &&
                record.geographic_center_lng >= -180 && record.geographic_center_lng <= 180) {
                console.log('   ✅ Geographic coordinates look valid');
            } else {
                console.log('   ❌ Geographic coordinates out of valid range');
                issues++;
            }
        } else {
            console.log('   ⚠️  No geographic coordinates set');
        }

        // Check states array
        if (record.states && Array.isArray(record.states) && record.states.length > 0) {
            console.log(`   ✅ States defined: ${record.states.join(', ')}`);
        } else {
            console.log('   ⚠️  No states defined');
        }
    });

    console.log(`\\n📊 Data Consistency Summary:`);
    console.log(`   Records checked: ${wsoRecords.length}`);
    console.log(`   Critical issues: ${issues}`);

    if (issues === 0) {
        console.log('   ✅ No critical data consistency issues found!');
    } else {
        console.log(`   ❌ Found ${issues} critical issues that should be addressed`);
    }
}

async function main() {
    console.log('WSO Integration Validation');
    console.log('==========================\\n');

    // Run all validation tests
    const joinSuccess = await validateJoins();
    console.log('\\n' + '='.repeat(50) + '\\n');

    const missingWSOs = await findMissingWSOs();
    console.log('\\n' + '='.repeat(50) + '\\n');

    await testGeographicFunctions();
    console.log('\\n' + '='.repeat(50) + '\\n');

    await validateDataConsistency();

    console.log('\\n🏁 Validation Complete!');
    console.log('========================');

    if (joinSuccess && missingWSOs && missingWSOs.length === 0) {
        console.log('✅ System is ready for geographic analysis!');
    } else {
        console.log('⚠️  Some issues need to be addressed before full functionality');
    }
}

if (require.main === module) {
    main().catch(console.error);
}