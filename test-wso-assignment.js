/**
 * Test script to verify the complete WSO assignment process for Heartland Strength
 */

// Import the WSO assignment logic from the wso-assignment-engine.js
const { assignWSO, WSO_MAPPINGS } = require('./scripts/geographic/wso-assignment-engine');

console.log('🧪 Testing WSO Assignment for Heartland Strength');
console.log('=' .repeat(60));

// Test the WSO mapping
console.log('\n📋 WSO Mappings that include Nebraska:');
for (const [wso, states] of Object.entries(WSO_MAPPINGS)) {
    if (states.includes('Nebraska')) {
        console.log(`  ✅ ${wso}: [${states.join(', ')}]`);
    }
}

// Test the assignWSO function
const extractedState = 'Nebraska';
const address = '8944 H St., Omaha, Nebraska, United States of America, 68127';

console.log(`\n🔍 Testing assignWSO function:`);
console.log(`  Input state: "${extractedState}"`);
console.log(`  Input address: "${address}"`);

const assignedWSO = assignWSO(extractedState, address);
console.log(`  Assigned WSO: "${assignedWSO}"`);

if (assignedWSO === 'Iowa-Nebraska') {
    console.log('  ✅ SUCCESS: Nebraska correctly assigned to Iowa-Nebraska WSO');
} else {
    console.log('  ❌ FAILURE: Expected "Iowa-Nebraska", got "' + assignedWSO + '"');
}

// Test some edge cases
console.log(`\n🧪 Testing edge cases:`);

const testCases = [
    { state: 'Nebraska', address: null, expected: 'Iowa-Nebraska' },
    { state: 'Iowa', address: null, expected: 'Iowa-Nebraska' },
    { state: 'California', address: 'San Francisco, CA', expected: 'California North Central' },
    { state: 'Texas', address: 'Houston, TX', expected: 'Texas-Oklahoma' },
];

testCases.forEach((testCase, index) => {
    const result = assignWSO(testCase.state, testCase.address);
    const status = result === testCase.expected ? '✅' : '❌';
    console.log(`  ${index + 1}. ${status} ${testCase.state} → ${result} (expected: ${testCase.expected})`);
});

console.log('\n🎯 If all tests pass, the WSO assignment logic is working correctly.');
console.log('🔍 The issue might be elsewhere in the process...');