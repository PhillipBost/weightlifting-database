// Clear require cache to get latest version
delete require.cache[require.resolve('./meet-wso-assigner.js')];

const { extractStateFromAddress } = require('./meet-wso-assigner.js');

console.log('🧪 Testing problematic address cases...');

const testCases = [
    { address: 'Morgantown, West Virginia', expected: 'West Virginia' },
    { address: 'Richmond, Virginia', expected: 'Virginia' },
    { address: '14401 South Georgia st, Amarillo, Texas', expected: 'Texas' }, // Should be Texas, not Georgia
    { address: '123 Georgia Street, Miami, Florida', expected: 'Florida' }, // Should be Florida, not Georgia
    { address: 'Sacramento, California', expected: 'California' },
    { address: 'Portland, Oregon', expected: 'Oregon' },
    { address: 'Atlanta, Georgia', expected: 'Georgia' }, // Should correctly identify Georgia state
];

let passed = 0;
let failed = 0;

testCases.forEach(({ address, expected }) => {
    const result = extractStateFromAddress(address);
    const status = result === expected ? '✅' : '❌';
    console.log(`${status} "${address}" → ${result || 'None'} (expected: ${expected})`);
    
    if (result === expected) {
        passed++;
    } else {
        failed++;
    }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.log('❌ Function needs more improvement');
} else {
    console.log('✅ All tests passed!');
}