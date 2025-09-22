/**
 * Test script to debug the Heartland Strength address parsing issue
 */

// Copy the exact logic from wso-assignment-engine.js
const US_STATES = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
    'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
    'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
    'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
    'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
    'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
    'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
    'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
    'DC': 'District of Columbia'
};

function extractStateFromAddress(address) {
    if (!address) return null;

    console.log(`\n🔍 Testing address: "${address}"`);

    // Get state names sorted by length (longest first) to prioritize "West Virginia" over "Virginia"
    const stateNames = Object.values(US_STATES).sort((a, b) => b.length - a.length);

    // Check for full state names (prioritizing longer names, with context validation)
    for (const state of stateNames) {
        const stateLower = state.toLowerCase();
        const addressLower = address.toLowerCase();

        if (addressLower.includes(stateLower)) {
            console.log(`  ✅ Found full state name: "${state}"`);
            // Additional validation: state should appear after comma or at end for proper context
            const stateIndex = addressLower.indexOf(stateLower);
            const beforeChar = stateIndex > 0 ? addressLower[stateIndex - 1] : '';
            const afterIndex = stateIndex + stateLower.length;
            const afterChar = afterIndex < addressLower.length ? addressLower[afterIndex] : '';

            console.log(`    Context: before="${beforeChar}", after="${afterChar}"`);

            // Valid contexts: after comma/space, or at word boundaries
            if (beforeChar === ',' || beforeChar === ' ' || stateIndex === 0 ||
                afterChar === ',' || afterChar === ' ' || afterChar === '.' || afterIndex === addressLower.length) {
                // Extra check: avoid matching street names like "Georgia St"
                if (afterChar === ' ') {
                    const nextWord = addressLower.substring(afterIndex + 1).split(' ')[0].replace(/[,.]/, '');
                    if (['st', 'street', 'ave', 'avenue', 'rd', 'road', 'blvd', 'boulevard', 'dr', 'drive', 'ln', 'lane', 'way', 'ct', 'court', 'pl', 'place'].includes(nextWord)) {
                        console.log(`    ❌ Skipping - looks like street name (next word: "${nextWord}")`);
                        continue; // Skip this match, it's likely a street name
                    }
                }
                console.log(`    ✅ Valid context - returning "${state}"`);
                return state;
            } else {
                console.log(`    ❌ Invalid context - skipping`);
            }
        }
    }

    console.log(`  📝 No full state name found, checking abbreviations...`);

    // Check for common abbreviations after comma (avoid directional conflicts)
    const stateAbbrevs = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
        'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
        'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
        'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
        'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
        'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
        'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
        'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
        'DC': 'District of Columbia'
    };

    const directionalAbbrevs = ['NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];

    for (const [abbrev, state] of Object.entries(stateAbbrevs)) {
        console.log(`  🔍 Testing abbreviation: "${abbrev}" -> "${state}"`);

        if (directionalAbbrevs.includes(abbrev)) {
            console.log(`    📍 This is a directional abbreviation - using special logic`);
            // Only match directional abbreviations in clear state context
            const pattern1 = ', ' + abbrev + ' ';
            const zipMatch = address.match(/\d{5}/);
            const pattern2 = abbrev + ' ' + (zipMatch ? zipMatch[0] : 'NOMATCH');

            console.log(`    Testing patterns: "${pattern1}" or "${pattern2}"`);
            console.log(`    Pattern 1 match: ${address.includes(pattern1)}`);
            console.log(`    Pattern 2 match: ${zipMatch ? address.includes(pattern2) : false}`);

            if (address.includes(pattern1) || (zipMatch && address.includes(pattern2))) {
                console.log(`    ✅ Directional abbreviation matched - returning "${state}"`);
                return state;
            } else {
                console.log(`    ❌ Directional abbreviation no match`);
            }
        } else {
            console.log(`    📍 Normal abbreviation - using standard logic`);
            // Look for abbreviation after comma or with clear boundaries
            const pattern1 = ', ' + abbrev;
            const pattern2 = ' ' + abbrev + ' ';
            const pattern3 = ' ' + abbrev;
            const endsWithPattern = address.endsWith(pattern3);

            console.log(`    Testing patterns: "${pattern1}", "${pattern2}", ends with "${pattern3}"`);
            console.log(`    Pattern 1 match: ${address.includes(pattern1)}`);
            console.log(`    Pattern 2 match: ${address.includes(pattern2)}`);
            console.log(`    Pattern 3 match: ${endsWithPattern}`);

            if (address.includes(pattern1) || address.includes(pattern2) || endsWithPattern) {
                console.log(`    ✅ Abbreviation matched - returning "${state}"`);
                return state;
            } else {
                console.log(`    ❌ Abbreviation no match`);
            }
        }
    }

    console.log(`  ❌ No state found`);
    return null;
}

// Test the problematic address
const heartlandAddress = "8944 H St., Omaha, Nebraska, United States of America, 68127";
const result = extractStateFromAddress(heartlandAddress);

console.log(`\n🎯 FINAL RESULT: ${result}`);

// Test some other addresses to make sure we don't break anything
const testAddresses = [
    "123 NE 4th Street, Portland, Oregon", // This should NOT match Nebraska
    "456 Main St, Lincoln, NE", // This SHOULD match Nebraska
    "789 South St, Omaha, NE 68127", // This SHOULD match Nebraska
    "321 SE Belmont, Portland, OR", // This should NOT match South Carolina
];

console.log(`\n🧪 Testing other addresses:`);
testAddresses.forEach(addr => {
    const res = extractStateFromAddress(addr);
    console.log(`"${addr}" -> ${res}`);
});