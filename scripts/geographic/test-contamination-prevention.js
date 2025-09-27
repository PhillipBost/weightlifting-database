/**
 * Test Contamination Prevention
 * 
 * Tests that the integrated validation engine prevents WSO geography contamination
 * during the geocoding and import process
 */

require('dotenv').config();
const { validateWSOAssignment, preventContamination } = require('./wso-validation-engine');

// Test cases based on known contamination examples
const TEST_CASES = [
    {
        name: "Johnson City, TN should be Tennessee-Kentucky, not Carolina",
        lat: 36.3024236,
        lng: -82.3692822,
        incorrectWSO: "Carolina",
        expectedWSO: "Tennessee-Kentucky",
        location: "Johnson City, TN"
    },
    {
        name: "Ann Arbor, MI should be Michigan, not Ohio", 
        lat: 42.2808256,
        lng: -83.7430378,
        incorrectWSO: "Ohio",
        expectedWSO: "Michigan", 
        location: "Ann Arbor, MI"
    },
    {
        name: "Bakersfield, CA should be California South, not North Central",
        lat: 35.3732921,
        lng: -119.0187125,
        incorrectWSO: "California North Central",
        expectedWSO: "California South",
        location: "Bakersfield, CA"
    },
    {
        name: "San Francisco, CA should be California North Central",
        lat: 37.7749,
        lng: -122.4194,
        incorrectWSO: "California South", 
        expectedWSO: "California North Central",
        location: "San Francisco, CA"
    },
    {
        name: "Atlanta, GA should be Georgia, not Carolina",
        lat: 33.7490,
        lng: -84.3880,
        incorrectWSO: "Carolina",
        expectedWSO: "Georgia",
        location: "Atlanta, GA"
    }
];

function runContaminationPreventionTests() {
    console.log('🧪 Testing Contamination Prevention System');
    console.log('=' .repeat(50));
    
    let passCount = 0;
    let failCount = 0;
    
    for (const testCase of TEST_CASES) {
        console.log(`\n📍 Testing: ${testCase.name}`);
        console.log(`   Location: ${testCase.location} (${testCase.lat}, ${testCase.lng})`);
        console.log(`   Incorrect WSO: ${testCase.incorrectWSO}`);
        console.log(`   Expected WSO: ${testCase.expectedWSO}`);
        
        // Test validation function
        const validation = validateWSOAssignment(testCase.incorrectWSO, testCase.lat, testCase.lng);
        
        console.log(`   Validation result: ${validation.isValid ? 'VALID' : 'INVALID'}`);
        console.log(`   Detected state: ${validation.actualState}`);
        console.log(`   Correct WSO: ${validation.correctWSO}`);
        
        // Check if validation caught the contamination
        if (!validation.isValid && validation.correctWSO === testCase.expectedWSO) {
            console.log(`   ✅ TEST PASSED: Contamination detected and corrected`);
            passCount++;
        } else if (validation.isValid && testCase.incorrectWSO === testCase.expectedWSO) {
            console.log(`   ✅ TEST PASSED: Valid assignment confirmed`);
            passCount++;
        } else {
            console.log(`   ❌ TEST FAILED: Expected ${testCase.expectedWSO}, got ${validation.correctWSO}`);
            failCount++;
        }
        
        // Test prevention function
        console.log(`   Testing prevention function...`);
        const prevention = preventContamination(testCase.lat, testCase.lng, testCase.location);
        
        if (prevention.correctWSO === testCase.expectedWSO) {
            console.log(`   ✅ Prevention function correct: ${prevention.correctWSO}`);
        } else {
            console.log(`   ❌ Prevention function incorrect: Expected ${testCase.expectedWSO}, got ${prevention.correctWSO}`);
            failCount++;
        }
    }
    
    console.log('\n' + '=' .repeat(50));
    console.log(`📊 Test Results: ${passCount} passed, ${failCount} failed`);
    
    if (failCount === 0) {
        console.log('✅ ALL TESTS PASSED - Contamination prevention is working correctly!');
    } else {
        console.log('❌ Some tests failed - Contamination prevention needs adjustment');
    }
    
    return { passed: passCount, failed: failCount };
}

// Test the geocoding integration simulation
async function simulateGeocodingIntegration() {
    console.log('\n🔄 Simulating Geocoding Integration');
    console.log('=' .repeat(40));
    
    for (const testCase of TEST_CASES) {
        console.log(`\n📡 Simulating import for: ${testCase.location}`);
        
        // Simulate what happens in geocode-and-import.js
        const mockAssignment = {
            assigned_wso: testCase.incorrectWSO,
            assignment_method: 'coordinates',
            confidence: 0.95
        };
        
        console.log(`   Original assignment: ${mockAssignment.assigned_wso}`);
        
        // Apply contamination prevention
        const validation = validateWSOAssignment(
            mockAssignment.assigned_wso,
            testCase.lat,
            testCase.lng
        );
        
        let finalWSO = mockAssignment.assigned_wso;
        
        if (!validation.isValid) {
            console.log(`   🚨 CONTAMINATION PREVENTED: ${validation.reason}`);
            console.log(`   🔧 Correcting: ${mockAssignment.assigned_wso} → ${validation.correctWSO}`);
            finalWSO = validation.correctWSO;
            console.log(`   ✅ Using corrected WSO: ${finalWSO}`);
        } else {
            console.log(`   ✅ WSO assignment validated: ${finalWSO} is correct`);
        }
        
        // Check if final result is correct
        if (finalWSO === testCase.expectedWSO) {
            console.log(`   ✅ Final result correct: ${finalWSO}`);
        } else {
            console.log(`   ❌ Final result incorrect: Expected ${testCase.expectedWSO}, got ${finalWSO}`);
        }
    }
}

// Test edge cases
function testEdgeCases() {
    console.log('\n🎯 Testing Edge Cases');
    console.log('=' .repeat(30));
    
    const edgeCases = [
        {
            name: "Invalid coordinates",
            lat: NaN,
            lng: NaN,
            wso: "California North Central",
            expectedValid: false
        },
        {
            name: "Coordinates outside US",
            lat: 51.5074, // London
            lng: -0.1278,
            wso: "California North Central", 
            expectedValid: false
        },
        {
            name: "Missing WSO",
            lat: 37.7749,
            lng: -122.4194,
            wso: null,
            expectedValid: false
        }
    ];
    
    for (const edgeCase of edgeCases) {
        console.log(`\n🧪 Testing: ${edgeCase.name}`);
        
        const validation = validateWSOAssignment(edgeCase.wso, edgeCase.lat, edgeCase.lng);
        
        console.log(`   Expected valid: ${edgeCase.expectedValid}`);
        console.log(`   Actual valid: ${validation.isValid}`);
        console.log(`   Reason: ${validation.reason}`);
        
        if (validation.isValid === edgeCase.expectedValid) {
            console.log(`   ✅ Edge case handled correctly`);
        } else {
            console.log(`   ❌ Edge case failed`);
        }
    }
}

// Main test execution
async function runAllTests() {
    console.log('🚀 Starting Comprehensive Contamination Prevention Tests');
    console.log('='.repeat(60));
    
    // Run basic validation tests
    const basicResults = runContaminationPreventionTests();
    
    // Simulate geocoding integration
    await simulateGeocodingIntegration();
    
    // Test edge cases
    testEdgeCases();
    
    console.log('\n' + '='.repeat(60));
    console.log('🏁 All Tests Complete');
    
    if (basicResults.failed === 0) {
        console.log('✅ Contamination prevention system is ready for production!');
        console.log('   The integrated validation will prevent WSO geography contamination');
        console.log('   during future data imports and geocoding operations.');
    } else {
        console.log('❌ Contamination prevention system needs fixes before production use');
    }
    
    return basicResults;
}

if (require.main === module) {
    runAllTests();
}

module.exports = {
    runContaminationPreventionTests,
    simulateGeocodingIntegration,
    testEdgeCases,
    runAllTests
};