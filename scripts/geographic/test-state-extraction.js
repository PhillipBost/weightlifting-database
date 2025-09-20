const { extractStateFromAddress, US_STATES } = require('./meet-wso-assigner.js');

// Test addresses from real clubs that should work
const testAddresses = [
  '123 Main St, Sacramento, California',
  '456 Oak Ave, Miami, Florida', 
  '789 Pine Rd, Austin, Texas',
  '321 Elm St, New York, NY',
  '654 Maple Dr, Chicago, Illinois',
  '987 Cedar Ln, Portland, Oregon'
];

console.log('🧪 Testing state extraction function...');
console.log(`US_STATES defined: ${!!US_STATES}`);
console.log(`Function defined: ${typeof extractStateFromAddress}`);

testAddresses.forEach(address => {
  const result = extractStateFromAddress(address);
  console.log(`Address: ${address}`);
  console.log(`  → Extracted state: ${result || 'None'}`);
  console.log('');
});