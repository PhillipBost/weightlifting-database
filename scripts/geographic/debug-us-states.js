const { US_STATES } = require('./meet-wso-assigner.js');

console.log('US_STATES object:');
console.log(US_STATES);

console.log('\nTesting regex patterns:');

// Test Oregon
const oregonPattern = new RegExp(`\\bOregon\\b`, 'i');
const testAddress = '5224 NE 42nd Ave, Portland, Oregon, United States of America, 97218';
console.log(`Oregon pattern test: ${oregonPattern.test(testAddress)}`);

// Test Florida 
const floridaPattern = new RegExp(`\\bFlorida\\b`, 'i');
const testAddress2 = '3185 Capital Circle NE, Tallahassee, Florida, United States of America, 32303';
console.log(`Florida pattern test: ${floridaPattern.test(testAddress2)}`);

// Test NE pattern
const nePattern = new RegExp(`,\\s*NE\\b|NE\\s*,|NE\\s+\\d{5}`, 'i');
console.log(`NE context pattern test on "${testAddress2}": ${nePattern.test(testAddress2)}`);
console.log(`NE context pattern test on "${testAddress}": ${nePattern.test(testAddress)}`);