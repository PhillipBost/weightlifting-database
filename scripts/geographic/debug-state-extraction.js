const { extractStateFromAddress, US_STATES } = require('./meet-wso-assigner.js');

// Debug the state extraction
function debugExtractStateFromAddress(address) {
    console.log(`\n🔍 Debugging: "${address}"`);
    
    if (!address) {
        console.log('  → Address is null/undefined');
        return null;
    }
    
    console.log(`  → US_STATES available: ${Object.keys(US_STATES).length} states`);
    console.log(`  → Sample states: ${Object.values(US_STATES).slice(0, 3).join(', ')}`);
    
    // Directional abbreviations commonly used in street addresses that conflict with state codes
    const DIRECTIONAL_ABBREVS = ['NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];
    
    // First, look for full state names (highest priority)
    console.log('  → Checking full state names...');
    for (const fullName of Object.values(US_STATES)) {
        const namePattern = new RegExp(`\\b${fullName.replace(/\\s/g, '\\s+')}\\b`, 'i');
        console.log(`    Testing "${fullName}" with pattern: ${namePattern}`);
        if (namePattern.test(address)) {
            console.log(`    ✅ MATCH: ${fullName}`);
            return fullName;
        }
    }
    
    console.log('  → No full state name matches, checking abbreviations...');
    // Then look for state abbreviations (with proper context filtering)
    for (const [abbrev, fullName] of Object.entries(US_STATES)) {
        // Skip directional abbreviations unless they appear in clear state context
        if (DIRECTIONAL_ABBREVS.includes(abbrev)) {
            console.log(`    Testing directional abbrev "${abbrev}" (${fullName})`);
            const contextPattern = new RegExp(`,\\s*${abbrev}\\s+|${abbrev}\\s+\\d{5}`, 'i');
            if (contextPattern.test(address)) {
                console.log(`    ✅ MATCH: ${fullName} (${abbrev})`);
                return fullName;
            }
        } else {
            console.log(`    Testing abbrev "${abbrev}" (${fullName})`);
            const abbrevPattern = new RegExp(`\\b${abbrev}\\b|,\\s*${abbrev}\\b|\\s${abbrev}$`, 'i');
            if (abbrevPattern.test(address)) {
                console.log(`    ✅ MATCH: ${fullName} (${abbrev})`);
                return fullName;
            }
        }
    }
    
    console.log('  → No matches found');
    return null;
}

// Test one address
const testAddress = '123 Main St, Sacramento, California';
const result = debugExtractStateFromAddress(testAddress);
console.log(`\nFinal result: ${result || 'None'}`);