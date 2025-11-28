/**
 * Test script for WSO Weekly Analytics Calculator
 * 
 * Tests the calculation functions with a single WSO to validate implementation
 * before running the full weekly calculation
 */

const { createClient } = require('@supabase/supabase-js');
const calculator = require('./wso-weekly-calculator');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

async function testSingleWSO(wsoName) {
    log(`🧪 Testing calculations for WSO: ${wsoName}`);

    try {
        // Test individual calculation functions
        log('\n1. Testing barbell clubs count...');
        const clubsCount = await calculator.calculateBarbelClubsCount(wsoName);

        log('\n2. Testing recent meets count...');
        const meetsCount = await calculator.calculateRecentMeetsCount(wsoName);

        log('\n3. Testing active lifters count...');
        const liftersCount = await calculator.calculateActiveLiftersCount(wsoName);

        log('\n4. Testing estimated population...');
        const population = await calculator.calculateEstimatedPopulation(wsoName);

        log('\n📊 Test Results Summary:');
        log(`   WSO: ${wsoName}`);
        log(`   Barbell Clubs: ${clubsCount}`);
        log(`   Recent Meets: ${meetsCount}`);
        log(`   Active Lifters: ${liftersCount}`);
        log(`   Estimated Population: ${population.toLocaleString()}`);

        // Test the complete calculation function
        log('\n5. Testing complete WSO calculation...');
        const result = await calculator.calculateWSOMterics(wsoName);

        if (result.success) {
            log('✅ Complete calculation test: SUCCESS');
            log('   Metrics calculated and stored successfully');
        } else {
            log('❌ Complete calculation test: FAILED');
            log(`   Error: ${result.error}`);
        }

        return result.success;

    } catch (error) {
        log(`❌ Test failed for ${wsoName}: ${error.message}`);
        return false;
    }
}

async function getTestWSOs() {
    log('🔍 Finding WSOs for testing...');

    try {
        const { data: wsos, error } = await supabase
            .from('usaw_wso_information')
            .select('name')
            .limit(3); // Get first 3 WSOs for testing

        if (error) {
            throw new Error(`Failed to fetch test WSOs: ${error.message}`);
        }

        if (!wsos || wsos.length === 0) {
            throw new Error('No WSOs found in database');
        }

        return wsos.map(w => w.name);

    } catch (error) {
        log(`❌ Error getting test WSOs: ${error.message}`);
        throw error;
    }
}

async function testDatabaseConnection() {
    log('🔌 Testing database connection...');

    try {
        // Test wso_information table
        const { data: wsoTest, error: wsoError } = await supabase
            .from('usaw_wso_information')
            .select('name')
            .limit(1);

        if (wsoError) {
            throw new Error(`WSO table error: ${wsoError.message}`);
        }

        // Test clubs table
        const { data: clubsTest, error: clubsError } = await supabase
            .from('usaw_clubs')
            .select('club_name')
            .limit(1);

        if (clubsError) {
            throw new Error(`Clubs table error: ${clubsError.message}`);
        }

        // Test meets table
        const { data: meetsTest, error: meetsError } = await supabase
            .from('usaw_meets')
            .select('meet_id')
            .limit(1);

        if (meetsError) {
            throw new Error(`Meets table error: ${meetsError.message}`);
        }

        // Test meet_results table
        const { data: resultsTest, error: resultsError } = await supabase
            .from('usaw_meet_results')
            .select('result_id')
            .limit(1);

        if (resultsError) {
            throw new Error(`Meet results table error: ${resultsError.message}`);
        }

        log('✅ Database connection test: SUCCESS');
        log(`   Found ${wsoTest?.length || 0} WSOs, ${clubsTest?.length || 0} clubs, ${meetsTest?.length || 0} meets, ${resultsTest?.length || 0} results`);
        return true;

    } catch (error) {
        log(`❌ Database connection test: FAILED`);
        log(`   Error: ${error.message}`);
        return false;
    }
}

async function main() {
    log('🚀 Starting WSO Analytics Calculator Test...');

    try {
        // Test database connection first
        const dbConnected = await testDatabaseConnection();
        if (!dbConnected) {
            process.exit(1);
        }

        // Get test WSOs
        const testWSOs = await getTestWSOs();
        log(`📋 Testing ${testWSOs.length} WSOs: ${testWSOs.join(', ')}`);

        // Run tests for multiple WSOs
        let allTestsPassed = true;
        for (let i = 0; i < testWSOs.length; i++) {
            const wsoName = testWSOs[i];
            log(`
${'='.repeat(50)}`);
            log(`🧪 Test ${i + 1}/${testWSOs.length}: ${wsoName}`);
            log(`${'='.repeat(50)}`);

            const testPassed = await testSingleWSO(wsoName);
            if (!testPassed) {
                allTestsPassed = false;
            }
        }

        const testPassed = allTestsPassed;

        if (testPassed) {
            log('\n🎉 All tests PASSED!');
            log('The WSO analytics calculator is ready for production use.');
        } else {
            log('\n💥 Tests FAILED!');
            log('Please review the errors above before deploying.');
            process.exit(1);
        }

    } catch (error) {
        log(`💥 Test suite failed: ${error.message}`);
        process.exit(1);
    }
}

// Handle command line execution
if (require.main === module) {
    main();
}