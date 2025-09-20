// Clear the require cache to force reloading of the module
delete require.cache[require.resolve('./meet-wso-assigner.js')];

const { extractStateFromAddress, assignWSO } = require('./meet-wso-assigner.js');

console.log('🧪 Testing with cleared require cache...');
console.log(`extractStateFromAddress function: ${typeof extractStateFromAddress}`);

// Test with actual club-like addresses
const testAddresses = [
  '123 Main St, Sacramento, California',
  '456 Oak Ave, Miami, Florida', 
  'Athletic Performance Center, Austin, Texas'
];

console.log('\nTesting state extraction:');
testAddresses.forEach(address => {
  const extractedState = extractStateFromAddress(address);
  console.log(`"${address}" → ${extractedState || 'None'}`);
});