#!/usr/bin/env node

/**
 * Test California WSO Assignment
 *
 * Tests the updated California WSO assignment logic using actual coordinates
 * from known locations to verify correct territory assignments.
 */

const { createClient } = require('@supabase/supabase-js');
const { assignCaliforniaWSO } = require('./wso-assignment-engine');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Test coordinates for known California locations
const testLocations = [
    // California South (should be South)
    { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, expected: 'California South' },
    { name: 'San Diego', lat: 32.7157, lng: -117.1611, expected: 'California South' },
    { name: 'San Luis Obispo', lat: 35.2828, lng: -120.6596, expected: 'California South' },
    { name: 'Santa Barbara', lat: 34.4208, lng: -119.6982, expected: 'California South' },
    { name: 'Bakersfield (Kern County)', lat: 35.3733, lng: -119.0187, expected: 'California South' },
    { name: 'Riverside', lat: 33.9533, lng: -117.3962, expected: 'California South' },

    // California North Central (should be North Central)
    { name: 'San Francisco', lat: 37.7749, lng: -122.4194, expected: 'California North Central' },
    { name: 'San Jose', lat: 37.3382, lng: -121.8863, expected: 'California North Central' },
    { name: 'Sacramento', lat: 38.5816, lng: -121.4944, expected: 'California North Central' },
    { name: 'Fresno', lat: 36.7378, lng: -119.7871, expected: 'California North Central' },
    { name: 'Monterey', lat: 36.6002, lng: -121.8947, expected: 'California North Central' },
    { name: 'Santa Cruz', lat: 36.9741, lng: -122.0308, expected: 'California North Central' },
];

async function runTests() {
    console.log('🧪 Testing California WSO Assignment Logic');
    console.log('='.repeat(60));
    console.log('');

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const location of testLocations) {
        try {
            // Test with supabase client (uses geospatial polygon checking)
            const resultWithPolygon = await assignCaliforniaWSO(location.lat, location.lng, supabase);

            // Test without supabase client (uses latitude fallback)
            const resultWithFallback = await assignCaliforniaWSO(location.lat, location.lng, null);

            const polygonMatch = resultWithPolygon === location.expected;
            const fallbackMatch = resultWithFallback === location.expected;

            if (polygonMatch) {
                console.log(`✅ ${location.name.padEnd(30)} → ${resultWithPolygon} (polygon: ✓, fallback: ${fallbackMatch ? '✓' : '✗'})`);
                passed++;
            } else {
                console.log(`❌ ${location.name.padEnd(30)} → ${resultWithPolygon} (expected: ${location.expected})`);
                console.log(`   Fallback result: ${resultWithFallback} ${fallbackMatch ? '(correct)' : '(also wrong)'}`);
                failed++;
                failures.push({
                    location: location.name,
                    expected: location.expected,
                    polygonResult: resultWithPolygon,
                    fallbackResult: resultWithFallback
                });
            }
        } catch (error) {
            console.log(`❌ ${location.name.padEnd(30)} → ERROR: ${error.message}`);
            failed++;
            failures.push({
                location: location.name,
                expected: location.expected,
                error: error.message
            });
        }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
    console.log(`   Success rate: ${((passed / testLocations.length) * 100).toFixed(1)}%`);

    if (failures.length > 0) {
        console.log('');
        console.log('❌ Failed Tests:');
        failures.forEach(f => {
            if (f.error) {
                console.log(`   - ${f.location}: ${f.error}`);
            } else {
                console.log(`   - ${f.location}: expected ${f.expected}, got ${f.polygonResult} (fallback: ${f.fallbackResult})`);
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
