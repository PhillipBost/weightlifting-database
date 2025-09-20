const { extractStateFromAddress } = require('./club-wso-assigner.js');

console.log('🧪 Testing fixed club state extraction algorithm...\n');

const problematicAddresses = [
  '5224 NE 42nd Ave, Portland, Oregon, United States of America, 97218',
  '11207 123rd Lane NE, C-24, Kirkland, Washington, United States of America, 98033',
  '2701 NE 127th St, Seattle, Washington, United States of America, 98125',
  '7524 NE 175th St, Kenmore, Washington, United States of America, 98208',
  '15310 NE 96TH PL, REDMOND, Washington, United States of America, 98052'
];

console.log('Testing problematic club addresses:');
problematicAddresses.forEach(address => {
  const result = extractStateFromAddress(address);
  const city = address.split(',')[1]?.trim() || 'Unknown';
  console.log(`${city}: "${result || 'None'}" (was: Nebraska)`);
});

console.log('\nTesting directional context patterns:');
const testCases = [
  'Portland, OR',
  'Seattle, WA', 
  'Kirkland, WA',
  'Some Street NE, Portland, OR',
  'Capital Circle NE, Tallahassee, FL'
];

testCases.forEach(address => {
  const result = extractStateFromAddress(address);
  console.log(`"${address}" → ${result || 'None'}`);
});