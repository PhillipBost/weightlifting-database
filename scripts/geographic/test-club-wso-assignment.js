#!/usr/bin/env node

/**
 * Test Club WSO Assignment
 *
 * Tests the complete club WSO assignment flow using real club data
 * to verify correct territory assignments, especially for California.
 */

const { createClient } = require('@supabase/supabase-js');
const { assignWSOGeography } = require('./wso-assignment-engine');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Test clubs with known locations
const testClubs = [
    // California South clubs
    { club_name: 'Test - Los Angeles Barbell', latitude: 34.0522, longitude: -118.2437, expected: 'California South' },
    { club_name: 'Test - San Diego Weightlifting', latitude: 32.7157, longitude: -117.1611, expected: 'California South' },
    { club_name: 'Test - Santa Barbara Strength', latitude: 34.4208, longitude: -119.6982, expected: 'California South' },

    // California North Central clubs
    { club_name: 'Test - San Francisco Barbell', latitude: 37.7749, longitude: -122.4194, expected: 'California North Central' },
    { club_name: 'Test - Sacramento Weightlifting', latitude: 38.5816, longitude: -121.4944, expected: 'California North Central' },

    // Other states
    { club_name: 'Test - New York Barbell', latitude: 42.6526, longitude: -73.7562, expected: 'New York' }, // Albany, NY
    { club_name: 'Test - Florida Weightlifting', latitude: 27.9944, longitude: -81.7603, expected: 'Florida' },
];

async function runTests() {
    console.log('🧪 Testing Club WSO Assignment Logic');
    console.log('='.repeat(60));
    console.log('');

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const club of testClubs) {
        try {
            // Test the assignment using the shared engine
            const assignment = await assignWSOGeography(club, supabase, {
                includeHistoricalData: false,
                logDetails: false
            });

            const match = assignment.assigned_wso === club.expected;

            if (match) {
                console.log(`✅ ${club.club_name.padEnd(40)} → ${assignment.assigned_wso}`);
                console.log(`   Method: ${assignment.assignment_method}, Confidence: ${(assignment.confidence * 100).toFixed(0)}%`);
                passed++;
            } else {
                console.log(`❌ ${club.club_name.padEnd(40)} → ${assignment.assigned_wso}`);
                console.log(`   Expected: ${club.expected}`);
                console.log(`   Method: ${assignment.assignment_method}, Confidence: ${(assignment.confidence * 100).toFixed(0)}%`);
                console.log(`   Reasoning: ${assignment.details.reasoning.join('; ')}`);
                failed++;
                failures.push({
                    club: club.club_name,
                    expected: club.expected,
                    actual: assignment.assigned_wso,
                    method: assignment.assignment_method
                });
            }
        } catch (error) {
            console.log(`❌ ${club.club_name.padEnd(40)} → ERROR: ${error.message}`);
            failed++;
            failures.push({
                club: club.club_name,
                expected: club.expected,
                error: error.message
            });
        }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
    console.log(`   Success rate: ${((passed / testClubs.length) * 100).toFixed(1)}%`);

    if (failures.length > 0) {
        console.log('');
        console.log('❌ Failed Tests:');
        failures.forEach(f => {
            if (f.error) {
                console.log(`   - ${f.club}: ${f.error}`);
            } else {
                console.log(`   - ${f.club}: expected ${f.expected}, got ${f.actual} (${f.method})`);
            }
        });
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
