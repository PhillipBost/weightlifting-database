const { extractStateFromAddress, US_STATES } = require('./club-wso-assigner.js');

console.log('Testing club extractStateFromAddress function:');
console.log('US_STATES defined:', !!US_STATES);

const testAddresses = [
  'Fort Walton Beach, Florida, United States of America',
  'Albany, New York, United States of America', 
  'Signal Hill, California, United States of America',
  'Tyler, Texas, United States of America',
  'Anchorage, Alaska, United States of America',
  'Auburn, Alabama, United States of America'
];

testAddresses.forEach(address => {
  const result = extractStateFromAddress(address);
  console.log(`"${address}" → ${result || 'None'}`);
});

// Manual test
console.log('\nManual regex test:');
const testAddr = 'Fort Walton Beach, Florida, United States of America';
const floridaPattern = new RegExp(`\\bFlorida\\b`, 'i');
console.log(`Florida pattern test: ${floridaPattern.test(testAddr)}`);