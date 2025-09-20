// Test the exact function as exported
const { extractStateFromAddress, US_STATES } = require('./meet-wso-assigner.js');

console.log('Testing minimal case...');
console.log('US_STATES defined:', !!US_STATES);
console.log('Function defined:', typeof extractStateFromAddress);

// Test simple cases
const simpleTest = 'Oregon';
console.log(`Simple test "${simpleTest}": ${extractStateFromAddress(simpleTest)}`);

const fullTest = 'Portland, Oregon';
console.log(`Full test "${fullTest}": ${extractStateFromAddress(fullTest)}`);

// Test the actual problematic address
const problemAddress = '5224 NE 42nd Ave, Portland, Oregon, United States of America, 97218';
console.log(`Problem address: ${extractStateFromAddress(problemAddress)}`);

// Let's step through the function manually with logging
function debugStep(address) {
    console.log(`\n=== Debugging: "${address}" ===`);
    
    if (!address) {
        console.log('Address is null/undefined, returning null');
        return null;
    }
    
    const DIRECTIONAL_ABBREVS = ['NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];
    
    console.log('Testing full state names...');
    for (const fullName of Object.values(US_STATES)) {
        const namePattern = new RegExp(`\\b${fullName.replace(/\\s/g, '\\s+')}\\b`, 'i');
        console.log(`  Testing ${fullName}: pattern=${namePattern.source}, match=${namePattern.test(address)}`);
        if (namePattern.test(address)) {
            console.log(`  *** FOUND: ${fullName} ***`);
            return fullName;
        }
    }
    console.log('No full state names found, continuing to abbreviations...');
    return null;
}

debugStep(problemAddress);