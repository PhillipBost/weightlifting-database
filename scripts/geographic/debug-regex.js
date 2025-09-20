// Simple debug of the regex patterns
const address = '123 Main St, Sacramento, California';

const US_STATES = {
    'CA': 'California',
    'FL': 'Florida',
    'TX': 'Texas'
};

console.log('🔍 Debugging regex patterns...');
console.log(`Testing address: "${address}"`);

// Test full state name matching
for (const fullName of Object.values(US_STATES)) {
    console.log(`\nTesting state: "${fullName}"`);
    
    // Original pattern
    const namePattern = new RegExp(`\\b${fullName.replace(/\s/g, '\\s+')}\\b`, 'i');
    console.log(`  Pattern: ${namePattern}`);
    console.log(`  Test result: ${namePattern.test(address)}`);
    
    // Simpler pattern for debugging
    const simplePattern = new RegExp(fullName, 'i');
    console.log(`  Simple pattern: ${simplePattern}`);
    console.log(`  Simple test result: ${simplePattern.test(address)}`);
}