// Test the address cleaning fix for "US" removal bug

function removeCountry(addr) {
    return addr
        // Match country with commas, but preserve one comma for proper formatting
        .replace(/,\s*\b(United States of America|United States|USA|US)\b\s*,/gi, ',')
        // Handle country at the end (after last comma)
        .replace(/,\s*\b(United States of America|United States|USA|US)\b\s*$/gi, '')
        .replace(/,\s*,/g, ',')  // Fix double commas
        .replace(/^,\s*|,\s*$/g, '')  // Remove leading/trailing commas
        .trim();
}

// Test cases
const testCases = [
    {
        input: "1801 N. Causway Blvd., Mandeville, Louisiana, United States of America, 70471",
        expected: "1801 N. Causway Blvd., Mandeville, Louisiana, 70471",
        description: "Should preserve 'Causway' (not remove 'us' from it)"
    },
    {
        input: "123 Campus Drive, Houston, Texas, US, 77001",
        expected: "123 Campus Drive, Houston, Texas, 77001",
        description: "Should preserve 'Campus' (not remove 'us' from it)"
    },
    {
        input: "456 Business Park, Austin, Texas, USA",
        expected: "456 Business Park, Austin, Texas",
        description: "Should preserve 'Business' (not remove 'us' from it)"
    },
    {
        input: "789 Main St, Portland, Oregon, United States",
        expected: "789 Main St, Portland, Oregon",
        description: "Should remove 'United States'"
    },
    {
        input: "321 Oak Ave, Seattle, WA, US",
        expected: "321 Oak Ave, Seattle, WA",
        description: "Should remove standalone 'US'"
    },
    {
        input: "555 Museum Way, Los Angeles, California, USA, 90001",
        expected: "555 Museum Way, Los Angeles, California, 90001",
        description: "Should preserve 'Museum' and remove 'USA'"
    }
];

console.log("🧪 Testing Address Cleaning (US Removal Fix)\n");

let passed = 0;
let failed = 0;

testCases.forEach((test, index) => {
    const result = removeCountry(test.input);
    const success = result === test.expected;

    if (success) {
        console.log(`✅ Test ${index + 1}: PASSED`);
        console.log(`   ${test.description}`);
        passed++;
    } else {
        console.log(`❌ Test ${index + 1}: FAILED`);
        console.log(`   ${test.description}`);
        console.log(`   Input:    "${test.input}"`);
        console.log(`   Expected: "${test.expected}"`);
        console.log(`   Got:      "${result}"`);
        failed++;
    }
    console.log();
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
    console.log("🎉 All tests passed! The fix is working correctly.");
    process.exit(0);
} else {
    console.log("⚠️  Some tests failed. Review the fix.");
    process.exit(1);
}
