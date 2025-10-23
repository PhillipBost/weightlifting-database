/**
 * Test Script for IWF Lifter Manager
 *
 * Tests the three scenarios from TASK-14:
 * 1. Existing lifter found (no duplicate created)
 * 2. New lifter created
 * 3. Same name, different countries → separate lifters
 *
 * Additional tests:
 * 4. Name reordering: "LASTNAME Firstname" → "Firstname LASTNAME"
 * 5. Case preservation: Names stored in mixed case
 * 6. Country name population: Both code and name are set
 */

const { findOrCreateLifter, normalizeName, getMatchKey, mapCountryCodeToName } = require('./iwf-lifter-manager');

async function runTests() {
    console.log('========================================');
    console.log('IWF Lifter Manager Tests');
    console.log('========================================\n');

    let testsPassed = 0;
    let testsFailed = 0;

    // ========================================
    // Test 1: Existing Lifter
    // ========================================
    console.log('Test 1: Existing Lifter (should find, not duplicate)');
    console.log('-------------------------------------------');

    try {
        // Create a lifter first
        const lifter1 = await findOrCreateLifter("WANG HAO", "CHN", 1998, "M");
        console.log(`First call - db_lifter_id: ${lifter1?.db_lifter_id}`);

        // Search for same lifter
        const lifter2 = await findOrCreateLifter("WANG HAO", "CHN", 1998, "M");
        console.log(`Second call - db_lifter_id: ${lifter2?.db_lifter_id}`);

        // Should be same lifter (same db_lifter_id)
        if (lifter1 && lifter2 && lifter1.db_lifter_id === lifter2.db_lifter_id) {
            console.log('✅ Test 1 PASSED: Found existing lifter, no duplicate created\n');
            testsPassed++;
        } else {
            console.log('❌ Test 1 FAILED: Created duplicate or IDs do not match\n');
            testsFailed++;
        }
    } catch (error) {
        console.log(`❌ Test 1 FAILED: ${error.message}\n`);
        testsFailed++;
    }

    // ========================================
    // Test 2: New Lifter
    // ========================================
    console.log('Test 2: New Lifter Creation');
    console.log('-------------------------------------------');

    try {
        // Create unique test athlete
        const timestamp = Date.now();
        const lifter = await findOrCreateLifter(`TEST ATHLETE ${timestamp}`, "USA", 2000, "F");

        console.log(`Created lifter - db_lifter_id: ${lifter?.db_lifter_id}`);
        console.log(`Athlete name: ${lifter?.athlete_name}`);

        // Should have valid ID and correct name
        if (lifter && lifter.db_lifter_id > 0 && lifter.athlete_name.includes('TEST ATHLETE')) {
            console.log('✅ Test 2 PASSED: New lifter created successfully\n');
            testsPassed++;
        } else {
            console.log('❌ Test 2 FAILED: Lifter not created properly\n');
            testsFailed++;
        }
    } catch (error) {
        console.log(`❌ Test 2 FAILED: ${error.message}\n`);
        testsFailed++;
    }

    // ========================================
    // Test 3: Same Name, Different Countries
    // ========================================
    console.log('Test 3: Same Name, Different Countries');
    console.log('-------------------------------------------');

    try {
        const lifter1 = await findOrCreateLifter("JOHN SMITH", "USA", 1995, "M");
        console.log(`USA lifter - db_lifter_id: ${lifter1?.db_lifter_id}`);

        const lifter2 = await findOrCreateLifter("JOHN SMITH", "GBR", 1995, "M");
        console.log(`GBR lifter - db_lifter_id: ${lifter2?.db_lifter_id}`);

        // Should be different lifters (different db_lifter_id)
        if (lifter1 && lifter2 && lifter1.db_lifter_id !== lifter2.db_lifter_id) {
            console.log('✅ Test 3 PASSED: Different lifters for different countries\n');
            testsPassed++;
        } else {
            console.log('❌ Test 3 FAILED: Should be different lifters\n');
            testsFailed++;
        }
    } catch (error) {
        console.log(`❌ Test 3 FAILED: ${error.message}\n`);
        testsFailed++;
    }

    // ========================================
    // Test 4: Name Reordering
    // ========================================
    console.log('Test 4: Name Reordering ("LASTNAME Firstname" → "Firstname LASTNAME")');
    console.log('-------------------------------------------');

    try {
        const tests = [
            { input: 'WANG Hao', expected: 'Hao WANG', desc: 'All caps family name' },
            { input: 'Hao WANG', expected: 'Hao WANG', desc: 'Already correct format' },
            { input: 'TALAKHADZE Lasha', expected: 'Lasha TALAKHADZE', desc: 'Georgian athlete' },
            { input: 'ROBLES Clara', expected: 'Clara ROBLES', desc: 'Spanish athlete' },
        ];

        let reorderPass = true;
        for (const test of tests) {
            const result = normalizeName(test.input);
            const pass = result === test.expected;
            console.log(`  ${pass ? '✓' : '✗'} "${test.input}" → "${result}" (expected: "${test.expected}") - ${test.desc}`);
            if (!pass) reorderPass = false;
        }

        if (reorderPass) {
            console.log('✅ Test 4 PASSED: Name reordering works correctly\n');
            testsPassed++;
        } else {
            console.log('❌ Test 4 FAILED: Some name reordering failed\n');
            testsFailed++;
        }
    } catch (error) {
        console.log(`❌ Test 4 FAILED: ${error.message}\n`);
        testsFailed++;
    }

    // ========================================
    // Test 5: Country Name Mapping
    // ========================================
    console.log('Test 5: Country Code to Name Mapping');
    console.log('-------------------------------------------');

    try {
        const countryTests = [
            { code: 'USA', expected: 'United States' },
            { code: 'CHN', expected: 'China' },
            { code: 'GBR', expected: 'United Kingdom' },
            { code: 'RUS', expected: 'Russia' },
            { code: 'KAZ', expected: 'Kazakhstan' },
        ];

        let countryPass = true;
        for (const test of countryTests) {
            const result = mapCountryCodeToName(test.code);
            const pass = result === test.expected;
            console.log(`  ${pass ? '✓' : '✗'} ${test.code} → "${result}" (expected: "${test.expected}")`);
            if (!pass) countryPass = false;
        }

        if (countryPass) {
            console.log('✅ Test 5 PASSED: Country mapping works correctly\n');
            testsPassed++;
        } else {
            console.log('❌ Test 5 FAILED: Some country mappings failed\n');
            testsFailed++;
        }
    } catch (error) {
        console.log(`❌ Test 5 FAILED: ${error.message}\n`);
        testsFailed++;
    }

    // ========================================
    // Test 6: Country Name Population
    // ========================================
    console.log('Test 6: Database Stores Both country_code and country_name');
    console.log('-------------------------------------------');

    try {
        const timestamp = Date.now();
        const lifter = await findOrCreateLifter(`TEST ${timestamp}`, 'USA', 2000, 'F');

        if (!lifter) {
            console.log('❌ Test 6 FAILED: Could not create lifter\n');
            testsFailed++;
        } else {
            const hasCode = lifter.country_code === 'USA';
            const hasName = lifter.country_name === 'United States';

            console.log(`  country_code: ${lifter.country_code} ${hasCode ? '✓' : '✗'}`);
            console.log(`  country_name: ${lifter.country_name} ${hasName ? '✓' : '✗'}`);

            if (hasCode && hasName) {
                console.log('✅ Test 6 PASSED: Both country fields populated\n');
                testsPassed++;
            } else {
                console.log('❌ Test 6 FAILED: Country fields not properly populated\n');
                testsFailed++;
            }
        }
    } catch (error) {
        console.log(`❌ Test 6 FAILED: ${error.message}\n`);
        testsFailed++;
    }

    // ========================================
    // Test 7: Case-Insensitive Matching
    // ========================================
    console.log('Test 7: Case-Insensitive Matching (finds lifter with correct format variation)');
    console.log('-------------------------------------------');

    try {
        const timestamp = Date.now();

        // Create with IWF standard format: "LASTNAME Firstname"
        const lifter1 = await findOrCreateLifter(`MOORE David`, 'AUS', 1990, 'M');
        console.log(`First call - created: "${lifter1?.athlete_name}" (db_lifter_id: ${lifter1?.db_lifter_id})`);

        // Search with already-normalized format: "Firstname LASTNAME"
        // This simulates matching when we receive the name in different format
        const lifter2 = await findOrCreateLifter(`David MOORE`, 'AUS', 1990, 'M');
        console.log(`Second call - found: "${lifter2?.athlete_name}" (db_lifter_id: ${lifter2?.db_lifter_id})`);

        if (lifter1 && lifter2 && lifter1.db_lifter_id === lifter2.db_lifter_id) {
            console.log('✅ Test 7 PASSED: Finds same lifter regardless of input format\n');
            testsPassed++;
        } else {
            console.log('❌ Test 7 FAILED: Should find same lifter with either format\n');
            testsFailed++;
        }
    } catch (error) {
        console.log(`❌ Test 7 FAILED: ${error.message}\n`);
        testsFailed++;
    }

    // ========================================
    // Summary
    // ========================================
    console.log('========================================');
    console.log('Test Summary');
    console.log('========================================');
    console.log(`✅ Passed: ${testsPassed}/7`);
    console.log(`❌ Failed: ${testsFailed}/7`);

    if (testsFailed === 0) {
        console.log('\n🎉 All tests passed! Lifter Manager is working correctly.');
        process.exit(0);
    } else {
        console.log('\n⚠️  Some tests failed. Review errors above.');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error running tests:', error);
    process.exit(1);
});
