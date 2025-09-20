const { extractStateFromAddress, US_STATES } = require('./meet-wso-assigner.js');

console.log('🔍 Debugging imported function...');
console.log(`Function source: ${extractStateFromAddress.toString()}`);
console.log(`US_STATES sample: ${JSON.stringify(Object.keys(US_STATES).slice(0, 5))}`);

// Test if US_STATES is accessible within the function scope
console.log('\n🧪 Testing function execution:');
const testAddress = '123 Main St, Sacramento, California';
const result = extractStateFromAddress(testAddress);
console.log(`Result: ${result}`);