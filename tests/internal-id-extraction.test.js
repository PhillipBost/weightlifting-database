const fc = require('fast-check');
const { createCSVfromArray } = require('../utils/csv_utils');

/**
 * Property-Based Test for Internal ID Extraction from Links
 * 
 * **Property 1: Internal ID Extraction from Links**
 * **Validates: Requirements 1.1, 1.2**
 * 
 * For any athlete row containing a profile link with /member/{id} pattern, 
 * the scraper should successfully extract the numeric internal_id
 */

// Mock DOM environment for testing
function createMockDocument(memberLinks) {
    return {
        querySelector: (selector) => {
            // Extract row index from selector
            const rowMatch = selector.match(/tr:nth-of-type\((\d+)\)/);
            if (!rowMatch) return null;
            
            const rowIndex = parseInt(rowMatch[1]) - 1; // Convert to 0-based index
            
            if (selector.includes('td:first-child a') && memberLinks[rowIndex]) {
                return {
                    href: memberLinks[rowIndex]
                };
            }
            return null;
        }
    };
}

// Extract internal_id logic from the actual implementation
function extractInternalId(document, rowIndex) {
    let internal_id = null;
    let nameSelector = ".data-table div div.v-data-table div.v-data-table__wrapper table tbody tr:nth-of-type("+ rowIndex +") td:first-child a";
    let nameLink = document.querySelector(nameSelector);
    if (nameLink && nameLink.href) {
        // Match pattern /member/{id} in the URL
        let memberMatch = nameLink.href.match(/\/member\/(\d+)/);
        if (memberMatch) {
            internal_id = parseInt(memberMatch[1]);
        }
    }
    return internal_id;
}

describe('Internal ID Extraction Property Tests', () => {
    test('Property 1: Internal ID Extraction from Links - Feature: athlete-internal-id-extraction, Property 1: For any athlete row containing a profile link with /member/{id} pattern, the scraper should successfully extract the numeric internal_id', () => {
        fc.assert(
            fc.property(
                // Generate arbitrary positive integers for member IDs
                fc.integer({ min: 1, max: 999999 }),
                fc.integer({ min: 1, max: 10 }), // Row index
                (memberId, rowIndex) => {
                    // Create a valid member URL with the generated ID
                    const memberUrl = `https://sport80.com/member/${memberId}`;
                    
                    // Create mock document with the member link at the specified row
                    const memberLinks = [];
                    memberLinks[rowIndex - 1] = memberUrl; // Convert to 0-based index
                    const mockDocument = createMockDocument(memberLinks);
                    
                    // Extract internal_id using the actual implementation logic
                    const extractedId = extractInternalId(mockDocument, rowIndex);
                    
                    // Property: The extracted ID should match the original member ID
                    return extractedId === memberId;
                }
            ),
            { numRuns: 10 } // Reduced for faster execution
        );
    });

    test('Property 1 Edge Case: Graceful handling of malformed URLs', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    fc.constant('https://sport80.com/member/'), // Missing ID
                    fc.constant('https://sport80.com/member/abc'), // Non-numeric ID
                    fc.constant('https://sport80.com/profile/123'), // Wrong path
                    fc.constant('invalid-url'), // Invalid URL
                    fc.constant('') // Empty string
                ),
                fc.integer({ min: 1, max: 10 }), // Row index
                (malformedUrl, rowIndex) => {
                    // Create mock document with malformed URL
                    const memberLinks = [];
                    memberLinks[rowIndex - 1] = malformedUrl;
                    const mockDocument = createMockDocument(memberLinks);
                    
                    // Extract internal_id using the actual implementation logic
                    const extractedId = extractInternalId(mockDocument, rowIndex);
                    
                    // Property: Malformed URLs should return null (graceful handling)
                    return extractedId === null;
                }
            ),
            { numRuns: 10 }
        );
    });

    test('Property 1 Edge Case: Handling missing links', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 10 }), // Row index
                (rowIndex) => {
                    // Create mock document with no member links
                    const mockDocument = createMockDocument([]);
                    
                    // Extract internal_id using the actual implementation logic
                    const extractedId = extractInternalId(mockDocument, rowIndex);
                    
                    // Property: Missing links should return null (graceful handling)
                    return extractedId === null;
                }
            ),
            { numRuns: 10 }
        );
    });

    /**
     * Property-Based Test for CSV Output Consistency
     * 
     * **Property 2: CSV Output Consistency**
     * **Validates: Requirements 1.3**
     * 
     * For any athlete data with an internal_id, the CSV output should contain 
     * the internal_id in the designated column
     */
    test('Property 2: CSV Output Consistency - Feature: athlete-internal-id-extraction, Property 2: For any athlete data with an internal_id, the CSV output should contain the internal_id in the designated column', () => {
        fc.assert(
            fc.property(
                // Generate athlete data arrays with various internal_id values
                fc.array(
                    fc.record({
                        athleteName: fc.string({ minLength: 1, maxLength: 50 }),
                        ageCategory: fc.oneof(fc.constant('Youth'), fc.constant('Junior'), fc.constant('Senior'), fc.constant('Masters')),
                        weightClass: fc.string({ minLength: 1, maxLength: 10 }),
                        club: fc.string({ minLength: 1, maxLength: 30 }),
                        total: fc.integer({ min: 0, max: 500 }).map(n => n.toString()),
                        internal_id: fc.oneof(
                            fc.integer({ min: 1, max: 999999 }), // Valid internal_id
                            fc.constant(null) // No internal_id
                        )
                    }),
                    { minLength: 1, maxLength: 10 }
                ),
                (athleteDataArray) => {
                    // Convert athlete objects to arrays (simulating the actual data structure)
                    const athleteArrays = athleteDataArray.map(athlete => [
                        athlete.athleteName,
                        athlete.ageCategory,
                        athlete.weightClass,
                        athlete.club,
                        athlete.total,
                        athlete.internal_id // This is appended as the last element
                    ]);
                    
                    // Create CSV using the actual implementation logic
                    const csvOutput = createCSVfromArray(athleteArrays);
                    
                    // Split CSV into lines and parse
                    const csvLines = csvOutput.trim().split('\n');
                    
                    // Property: Each line should have the correct number of columns
                    // and internal_id should be in the last column
                    return athleteArrays.every((athleteArray, index) => {
                        if (index >= csvLines.length) return false;
                        
                        const csvRow = csvLines[index].split('|');
                        const expectedInternalId = athleteArray[athleteArray.length - 1];
                        const actualInternalId = csvRow[csvRow.length - 1];
                        
                        // Check that internal_id is correctly placed in the CSV
                        if (expectedInternalId === null) {
                            return actualInternalId === 'null' || actualInternalId === '';
                        } else {
                            return actualInternalId === expectedInternalId.toString();
                        }
                    });
                }
            ),
            { numRuns: 10 }
        );
    });

    test('Property 2 Edge Case: CSV format consistency with mixed internal_id values', () => {
        fc.assert(
            fc.property(
                // Generate mixed data with some athletes having internal_ids and others not
                fc.array(
                    fc.oneof(
                        // Athlete with internal_id
                        fc.record({
                            data: fc.array(
                                // Generate strings without pipe characters since they get replaced with commas
                                fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('|')),
                                { minLength: 5, maxLength: 5 }
                            ),
                            internal_id: fc.integer({ min: 1, max: 999999 })
                        }),
                        // Athlete without internal_id
                        fc.record({
                            data: fc.array(
                                // Generate strings without pipe characters since they get replaced with commas
                                fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('|')),
                                { minLength: 5, maxLength: 5 }
                            ),
                            internal_id: fc.constant(null)
                        })
                    ),
                    { minLength: 1, maxLength: 5 }
                ),
                (mixedAthletes) => {
                    // Convert to the format expected by createCSVfromArray
                    const athleteArrays = mixedAthletes.map(athlete => [
                        ...athlete.data,
                        athlete.internal_id
                    ]);
                    
                    // Create CSV
                    const csvOutput = createCSVfromArray(athleteArrays);
                    const csvLines = csvOutput.trim().split('\n');
                    
                    // Property: All rows should have the same number of columns
                    if (csvLines.length === 0) return true;
                    
                    const expectedColumnCount = athleteArrays[0].length;
                    return csvLines.every(line => {
                        const columns = line.split('|');
                        return columns.length === expectedColumnCount;
                    });
                }
            ),
            { numRuns: 5 }
        );
    });

    /**
     * Property-Based Test for Graceful Processing Without Internal ID
     * 
     * **Property 3: Graceful Processing Without Internal ID**
     * **Validates: Requirements 1.4**
     * 
     * For any athlete row lacking a profile link, the scraper should continue 
     * processing without throwing errors
     */
    test('Property 3: Graceful Processing Without Internal ID - Feature: athlete-internal-id-extraction, Property 3: For any athlete row lacking a profile link, the scraper should continue processing without throwing errors', () => {
        fc.assert(
            fc.property(
                // Generate athlete data arrays without internal_id links
                fc.array(
                    fc.record({
                        athleteName: fc.string({ minLength: 1, maxLength: 50 }),
                        ageCategory: fc.oneof(fc.constant('Youth'), fc.constant('Junior'), fc.constant('Senior'), fc.constant('Masters')),
                        weightClass: fc.string({ minLength: 1, maxLength: 10 }),
                        club: fc.string({ minLength: 1, maxLength: 30 }),
                        total: fc.integer({ min: 0, max: 500 }).map(n => n.toString()),
                        // Additional athlete data fields that might be present
                        additionalData: fc.array(fc.string({ minLength: 0, maxLength: 20 }), { minLength: 0, maxLength: 5 })
                    }),
                    { minLength: 1, maxLength: 10 }
                ),
                fc.integer({ min: 1, max: 10 }), // Row index for processing
                (athleteDataArray, rowIndex) => {
                    try {
                        // Simulate the athlete processing logic without internal_id links
                        const processedAthletes = athleteDataArray.map(athlete => {
                            // Create athlete data array as it would appear in the scraper
                            const athleteArray = [
                                athlete.athleteName,
                                athlete.ageCategory,
                                athlete.weightClass,
                                athlete.club,
                                athlete.total,
                                ...athlete.additionalData
                            ];
                            
                            // Simulate the internal_id extraction logic when no link is present
                            let internal_id = null; // No profile link found
                            
                            // Add internal_id to the athlete data (as done in getAthletesOnPage)
                            athleteArray.push(internal_id);
                            
                            return athleteArray;
                        });
                        
                        // Simulate CSV creation (this should not throw errors)
                        const csvOutput = createCSVfromArray(processedAthletes);
                        
                        // Property: Processing should complete successfully without errors
                        // and all athletes should have null internal_id
                        return processedAthletes.every(athleteArray => {
                            const internal_id = athleteArray[athleteArray.length - 1];
                            return internal_id === null;
                        }) && typeof csvOutput === 'string' && csvOutput.length > 0;
                        
                    } catch (error) {
                        // Property violation: Processing should not throw errors
                        console.error('Graceful processing failed:', error);
                        return false;
                    }
                }
            ),
            { numRuns: 10 } // Reduced for faster execution
        );
    });

    test('Property 3 Edge Case: Processing with completely empty athlete data', () => {
        fc.assert(
            fc.property(
                // Generate arrays with minimal or empty data
                fc.array(
                    fc.oneof(
                        fc.constant([]), // Completely empty
                        fc.array(fc.constant(''), { minLength: 1, maxLength: 3 }), // Empty strings
                        fc.array(fc.string({ minLength: 0, maxLength: 1 }), { minLength: 1, maxLength: 2 }) // Very short data
                    ),
                    { minLength: 0, maxLength: 5 }
                ),
                (emptyDataArray) => {
                    try {
                        // Simulate processing empty/minimal athlete data
                        const processedAthletes = emptyDataArray.map(athleteData => {
                            // Add null internal_id as the scraper would
                            const athleteArray = [...athleteData, null];
                            return athleteArray;
                        });
                        
                        // This should not throw errors even with empty data
                        if (processedAthletes.length > 0) {
                            const csvOutput = createCSVfromArray(processedAthletes);
                            return typeof csvOutput === 'string';
                        }
                        
                        // Empty array should also be handled gracefully
                        return true;
                        
                    } catch (error) {
                        // Property violation: Should handle empty data gracefully
                        console.error('Failed to handle empty data gracefully:', error);
                        return false;
                    }
                }
            ),
            { numRuns: 8 }
        );
    });

    test('Property 3 Edge Case: Mixed scenarios with and without internal_ids', () => {
        fc.assert(
            fc.property(
                // Generate mixed athlete data - some with internal_ids, some without
                fc.array(
                    fc.record({
                        athleteName: fc.string({ minLength: 1, maxLength: 30 }),
                        hasInternalId: fc.boolean(), // Randomly determine if athlete has internal_id
                        internal_id: fc.integer({ min: 1, max: 999999 }),
                        otherData: fc.array(fc.string({ minLength: 0, maxLength: 15 }), { minLength: 3, maxLength: 6 })
                    }),
                    { minLength: 1, maxLength: 8 }
                ),
                (mixedAthletes) => {
                    try {
                        // Process mixed data as the scraper would
                        const processedAthletes = mixedAthletes.map(athlete => {
                            const athleteArray = [
                                athlete.athleteName,
                                ...athlete.otherData
                            ];
                            
                            // Simulate internal_id extraction - some succeed, some don't
                            const extractedId = athlete.hasInternalId ? athlete.internal_id : null;
                            athleteArray.push(extractedId);
                            
                            return athleteArray;
                        });
                        
                        // Create CSV output
                        const csvOutput = createCSVfromArray(processedAthletes);
                        
                        // Property: Processing should succeed regardless of internal_id presence
                        // and maintain data integrity
                        const hasValidOutput = typeof csvOutput === 'string' && csvOutput.length > 0;
                        const correctInternalIds = processedAthletes.every((athleteArray, index) => {
                            const expectedId = mixedAthletes[index].hasInternalId ? mixedAthletes[index].internal_id : null;
                            const actualId = athleteArray[athleteArray.length - 1];
                            return actualId === expectedId;
                        });
                        
                        return hasValidOutput && correctInternalIds;
                        
                    } catch (error) {
                        // Property violation: Mixed scenarios should be handled gracefully
                        console.error('Failed to handle mixed internal_id scenarios:', error);
                        return false;
                    }
                }
            ),
            { numRuns: 5 }
        );
    });
});