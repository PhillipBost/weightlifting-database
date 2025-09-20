const { extractStateFromAddress } = require('./meet-wso-assigner.js');

console.log('🧪 Testing updated meet state extraction function...');

const testCases = [
    'Morgantown, West Virginia',
    'Richmond, Virginia', 
    '14401 South Georgia st, Amarillo, Texas',
    'Sacramento, California',
    'Portland, Oregon',
    'Miami, Florida'
];

testCases.forEach(address => {
    const result = extractStateFromAddress(address);
    console.log(`"${address}" → ${result || 'None'}`);
});

console.log('\n✅ State extraction test complete');