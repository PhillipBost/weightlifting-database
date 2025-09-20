const { extractStateFromAddress, US_STATES } = require('./meet-wso-assigner.js');

console.log('Testing extractStateFromAddress function directly:');

const testAddress1 = '5224 NE 42nd Ave, Portland, Oregon, United States of America, 97218';
const testAddress2 = '3185 Capital Circle NE, Tallahassee, Florida, United States of America, 32303';

console.log(`\nTesting: "${testAddress1}"`);
console.log(`Result: ${extractStateFromAddress(testAddress1)}`);

console.log(`\nTesting: "${testAddress2}"`);  
console.log(`Result: ${extractStateFromAddress(testAddress2)}`);

// Manual test of the loops
console.log('\n=== Manual debugging ===');

function debugExtractState(address) {
    console.log(`\nDebugging address: "${address}"`);
    
    const DIRECTIONAL_ABBREVS = ['NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];
    
    // Test full state names first
    console.log('Testing full state names...');
    for (const fullName of Object.values(US_STATES)) {
        const namePattern = new RegExp(`\\b${fullName.replace(/\\s/g, '\\s+')}\\b`, 'i');
        if (namePattern.test(address)) {
            console.log(`  FOUND: ${fullName} with pattern: ${namePattern}`);
            return fullName;
        }
    }
    
    // Test abbreviations
    console.log('Testing abbreviations...');
    for (const [abbrev, fullName] of Object.entries(US_STATES)) {
        if (DIRECTIONAL_ABBREVS.includes(abbrev)) {
            const contextPattern = new RegExp(`,\\s*${abbrev}\\b|${abbrev}\\s*,|${abbrev}\\s+\\d{5}`, 'i');
            console.log(`  Testing directional ${abbrev}: pattern=${contextPattern}, match=${contextPattern.test(address)}`);
            if (contextPattern.test(address)) {
                console.log(`  FOUND: ${fullName} via directional context`);
                return fullName;
            }
        } else {
            const abbrevPattern = new RegExp(`\\b${abbrev}\\b|,\\s*${abbrev}\\b|\\s${abbrev}$`, 'i');
            if (abbrevPattern.test(address)) {
                console.log(`  FOUND: ${fullName} via standard abbreviation`);
                return fullName;
            }
        }
    }
    
    console.log('  No matches found');
    return null;
}

debugExtractState(testAddress1);
debugExtractState(testAddress2);