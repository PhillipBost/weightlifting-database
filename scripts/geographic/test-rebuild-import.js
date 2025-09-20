const { extractStateFromAddress, assignWSO } = require('./meet-wso-assigner.js');

console.log('🧪 Testing exact rebuild script import pattern...');
console.log(`extractStateFromAddress function: ${typeof extractStateFromAddress}`);
console.log(`assignWSO function: ${typeof assignWSO}`);

// Test with actual club-like addresses
const testAddresses = [
  '123 Main St, Sacramento, California',
  '456 Oak Ave, Miami, Florida', 
  'Athletic Performance Center, Austin, Texas',
  'CrossFit Downtown, Portland, Oregon'
];

console.log('\nTesting state extraction:');
testAddresses.forEach(address => {
  const extractedState = extractStateFromAddress(address);
  console.log(`"${address}" → ${extractedState || 'None'}`);
  
  if (extractedState) {
    const wso = assignWSO(extractedState, address);
    console.log(`  WSO: ${wso || 'None'}`);
  }
  console.log('');
});