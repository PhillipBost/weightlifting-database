#!/usr/bin/env node

/**
 * Test Border City WSO Assignment
 *
 * Tests clubs in border cities where coordinates might fall into wrong state
 * but the explicit state field should override and give correct assignment.
 */

const { createClient } = require('@supabase/supabase-js');
const { assignWSOGeography } = require('./wso-assignment-engine');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Test clubs in border cities with coordinates that might be ambiguous
const borderCityTests = [
    // NYC/NJ border - coordinates near border but state field says NY
    {
        club_name: 'Border Test - NYC Club',
        latitude: 40.7128,
        longitude: -74.0060,
        state: 'New York',
        city: 'New York',
        expected: 'New York'
    },

    // Another NYC club
    {
        club_name: 'Border Test - Manhattan Barbell',
        latitude: 40.7580,
        longitude: -73.9855,
        state: 'NY',
        city: 'New York',
        expected: 'New York'
    },

    // California border cities - explicit state should work
    {
        club_name: 'Border Test - San Diego South',
        latitude: 32.5149,
        longitude: -117.0382,
        state: 'California',
        city: 'San Diego',
        expected: 'California South'
    },

    {
        club_name: 'Border Test - San Francisco Downtown',
        latitude: 37.7749,
        longitude: -122.4194,
        state: 'CA',
        city: 'San Francisco',
        expected: 'California North Central'
    },

    // State with no coordinates - should still work via state field
    {
        club_name: 'Border Test - Florida No Coords',
        state: 'Florida',
        city: 'Miami',
        expected: 'Florida'
    },

    // Multi-state WSO region
    {
        club_name: 'Border Test - North Carolina',
        latitude: 35.7796,
        longitude: -78.6382,
        state: 'North Carolina',
        city: 'Raleigh',
        expected: 'Carolina'
    },
];

async function runTests() {
    console.log('🧪 Testing Border City WSO Assignment');
    console.log('='.repeat(70));
    console.log('Testing that explicit state field overrides ambiguous coordinates');
    console.log('='.repeat(70));
    console.log('');

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const club of borderCityTests) {
        try {
            // Test the assignment using the shared engine
            const assignment = await assignWSOGeography(club, supabase, {
                includeHistoricalData: false,
                logDetails: false
            });

            const match = assignment.assigned_wso === club.expected;

            if (match) {
                console.log(`✅ ${club.club_name.padEnd(45)} → ${assignment.assigned_wso}`);
                console.log(`   Method: ${assignment.assignment_method.padEnd(20)} | Confidence: ${(assignment.confidence * 100).toFixed(0)}% | State: ${club.state || 'N/A'}`);
                if (club.latitude && club.longitude) {
                    console.log(`   Coords: (${club.latitude}, ${club.longitude})`);
                }
                passed++;
            } else {
                console.log(`❌ ${club.club_name.padEnd(45)} → ${assignment.assigned_wso}`);
                console.log(`   Expected: ${club.expected}`);
                console.log(`   Method: ${assignment.assignment_method}, Confidence: ${(assignment.confidence * 100).toFixed(0)}%`);
                console.log(`   State Field: ${club.state || 'N/A'}, Coords: (${club.latitude || 'N/A'}, ${club.longitude || 'N/A'})`);
                console.log(`   Reasoning: ${assignment.details.reasoning.join('; ')}`);
                failed++;
                failures.push({
                    club: club.club_name,
                    expected: club.expected,
                    actual: assignment.assigned_wso,
                    method: assignment.assignment_method,
                    state: club.state
                });
            }
            console.log('');
        } catch (error) {
            console.log(`❌ ${club.club_name.padEnd(45)} → ERROR`);
            console.log(`   ${error.message}`);
            console.log('');
            failed++;
            failures.push({
                club: club.club_name,
                expected: club.expected,
                error: error.message
            });
        }
    }

    console.log('='.repeat(70));
    console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
    console.log(`   Success rate: ${((passed / borderCityTests.length) * 100).toFixed(1)}%`);

    if (failures.length > 0) {
        console.log('');
        console.log('❌ Failed Tests:');
        failures.forEach(f => {
            if (f.error) {
                console.log(`   - ${f.club}: ${f.error}`);
            } else {
                console.log(`   - ${f.club}:`);
                console.log(`     Expected: ${f.expected}, Got: ${f.actual}`);
                console.log(`     Method: ${f.method}, State: ${f.state}`);
            }
        });
    } else {
        console.log('');
        console.log('✅ All border city tests passed!');
        console.log('   State field correctly overrides ambiguous coordinates.');
    }

    process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
    runTests().catch(error => {
        console.error('Test script failed:', error);
        process.exit(1);
    });
}

module.exports = { runTests };
