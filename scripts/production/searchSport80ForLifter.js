/* eslint-disable no-console */
/**
 * Sport80 Athlete Search Function
 * 
 * This function searches Sport80's rankings page for an athlete by name
 * and returns their internal_id if found.
 * 
 * Requirements: 3.1, 3.2
 */

const puppeteer = require('puppeteer');

/**
 * Search Sport80 for a lifter by name and return their internal_id
 * @param {string} athleteName - The name of the athlete to search for
 * @param {Object} options - Search options
 * @param {boolean} options.headless - Whether to run browser in headless mode (default: true)
 * @param {number} options.timeout - Timeout in milliseconds (default: 30000)
 * @param {boolean} options.verbose - Whether to log detailed progress (default: false)
 * @returns {Promise<number|null>} The internal_id if found, null otherwise
 */
async function searchSport80ForLifter(athleteName, options = {}) {
    const {
        headless = true,
        timeout = 30000,
        verbose = false
    } = options;

    if (!athleteName || typeof athleteName !== 'string') {
        throw new Error('Athlete name is required and must be a string');
    }

    const cleanName = athleteName.trim();
    if (!cleanName) {
        throw new Error('Athlete name cannot be empty');
    }

    let browser = null;
    
    try {
        if (verbose) {
            console.log(`🔍 Searching Sport80 for athlete: "${cleanName}"`);
        }

        // Launch browser
        browser = await puppeteer.launch({ 
            headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set user agent to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Navigate to Sport80 rankings page
        const rankingsUrl = 'https://usaweightlifting.sport80.com/public/rankings/all';
        
        if (verbose) {
            console.log(`📂 Navigating to: ${rankingsUrl}`);
        }
        
        await page.goto(rankingsUrl, { 
            waitUntil: 'networkidle0', 
            timeout 
        });

        // Wait for the data table to load
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        
        // Get initial row count
        const initialCount = await page.evaluate(() => {
            return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
        });
        
        if (verbose) {
            console.log(`📊 Initial results: ${initialCount} athletes`);
        }

        // Find and use the search input field
        await page.waitForSelector('.v-text-field input', { timeout: 5000 });
        
        // Clear any existing search and focus the input
        await page.evaluate(() => {
            const input = document.querySelector('.v-text-field input');
            if (input) {
                input.value = '';
                input.focus();
            }
        });

        if (verbose) {
            console.log(`⌨️  Typing athlete name: "${cleanName}"`);
        }

        // Type the athlete name
        await page.type('.v-text-field input', cleanName);

        // Wait for search results to filter (Sport80 filters as you type)
        // We'll monitor the row count to detect when filtering is complete
        let previousCount = initialCount;
        let stableCount = 0;
        let finalCount = null;
        
        if (verbose) {
            console.log(`⏳ Waiting for search results to stabilize...`);
        }

        // Monitor for up to 10 seconds for results to stabilize
        for (let i = 0; i < 50; i++) {
            await new Promise(resolve => setTimeout(resolve, 200));
            
            const currentCount = await page.evaluate(() => {
                return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
            });
            
            if (currentCount === previousCount) {
                stableCount++;
                // If count has been stable for 1 second (5 checks), consider it final
                if (stableCount >= 5) {
                    finalCount = currentCount;
                    break;
                }
            } else {
                stableCount = 0;
                previousCount = currentCount;
            }
        }

        if (finalCount === null) {
            finalCount = previousCount;
        }

        if (verbose) {
            console.log(`📊 Search results: ${finalCount} athletes (filtered from ${initialCount})`);
        }

        // If no results, return null
        if (finalCount === 0) {
            if (verbose) {
                console.log(`❌ No athletes found matching "${cleanName}"`);
            }
            return null;
        }

        // Extract athlete data from the filtered results
        const athleteResults = await page.evaluate((searchName) => {
            const results = [];
            const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
            
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                
                // Get athlete name from first column
                const nameCell = row.querySelector('td:first-child');
                if (!nameCell) continue;
                
                const nameLink = nameCell.querySelector('a');
                if (!nameLink) continue;
                
                const athleteName = nameCell.textContent.trim();
                const memberUrl = nameLink.href;
                
                // Extract internal_id from member URL
                const memberMatch = memberUrl.match(/\/member\/(\d+)/);
                if (!memberMatch) continue;
                
                const internalId = parseInt(memberMatch[1]);
                
                // Get additional data for verification
                const cells = Array.from(row.querySelectorAll('td'));
                const rowData = cells.map(cell => cell.textContent.trim());
                
                results.push({
                    athleteName,
                    internalId,
                    memberUrl,
                    rowData,
                    // Calculate match score for name similarity
                    exactMatch: athleteName.toLowerCase() === searchName.toLowerCase(),
                    containsMatch: athleteName.toLowerCase().includes(searchName.toLowerCase())
                });
            }
            
            return results;
        }, cleanName);

        if (verbose) {
            console.log(`📋 Found ${athleteResults.length} potential matches:`);
            athleteResults.forEach((result, index) => {
                console.log(`  ${index + 1}. ${result.athleteName} (ID: ${result.internalId}) - Exact: ${result.exactMatch}, Contains: ${result.containsMatch}`);
            });
        }

        // Find the best match
        let bestMatch = null;
        
        // First, look for exact name matches
        const exactMatches = athleteResults.filter(r => r.exactMatch);
        if (exactMatches.length === 1) {
            bestMatch = exactMatches[0];
            if (verbose) {
                console.log(`✅ Found exact match: ${bestMatch.athleteName} (ID: ${bestMatch.internalId})`);
            }
        } else if (exactMatches.length > 1) {
            // Multiple exact matches - this shouldn't happen but take the first one
            bestMatch = exactMatches[0];
            if (verbose) {
                console.log(`⚠️  Multiple exact matches found, using first: ${bestMatch.athleteName} (ID: ${bestMatch.internalId})`);
            }
        } else {
            // No exact matches, look for contains matches
            const containsMatches = athleteResults.filter(r => r.containsMatch);
            if (containsMatches.length === 1) {
                bestMatch = containsMatches[0];
                if (verbose) {
                    console.log(`✅ Found partial match: ${bestMatch.athleteName} (ID: ${bestMatch.internalId})`);
                }
            } else if (containsMatches.length > 1) {
                if (verbose) {
                    console.log(`⚠️  Multiple partial matches found, cannot determine best match`);
                    containsMatches.forEach((match, index) => {
                        console.log(`    ${index + 1}. ${match.athleteName} (ID: ${match.internalId})`);
                    });
                }
                // Don't return a match if we can't be sure which one is correct
                return null;
            } else {
                if (verbose) {
                    console.log(`❌ No name matches found for "${cleanName}"`);
                }
                return null;
            }
        }

        return bestMatch ? bestMatch.internalId : null;

    } catch (error) {
        if (verbose) {
            console.error(`❌ Error searching Sport80 for "${cleanName}":`, error.message);
        }
        throw new Error(`Sport80 search failed: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Batch search multiple athletes on Sport80
 * More efficient than individual searches as it reuses the browser instance
 * @param {string[]} athleteNames - Array of athlete names to search for
 * @param {Object} options - Search options (same as searchSport80ForLifter)
 * @returns {Promise<Object[]>} Array of results with {name, internalId, error}
 */
async function batchSearchSport80ForLifters(athleteNames, options = {}) {
    const {
        headless = true,
        timeout = 30000,
        verbose = false
    } = options;

    if (!Array.isArray(athleteNames) || athleteNames.length === 0) {
        throw new Error('Athlete names array is required and must not be empty');
    }

    let browser = null;
    const results = [];
    
    try {
        if (verbose) {
            console.log(`🔍 Batch searching Sport80 for ${athleteNames.length} athletes`);
        }

        browser = await puppeteer.launch({ 
            headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Navigate once to the rankings page
        const rankingsUrl = 'https://usaweightlifting.sport80.com/public/rankings/all';
        await page.goto(rankingsUrl, { waitUntil: 'networkidle0', timeout });
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });

        // Search for each athlete
        for (let i = 0; i < athleteNames.length; i++) {
            const athleteName = athleteNames[i];
            
            try {
                if (verbose) {
                    console.log(`\n[${i + 1}/${athleteNames.length}] Searching for: "${athleteName}"`);
                }

                // Clear search field
                await page.evaluate(() => {
                    const input = document.querySelector('.v-text-field input');
                    if (input) {
                        input.value = '';
                        input.focus();
                    }
                });

                // Type new search
                await page.type('.v-text-field input', athleteName);

                // Wait for results to stabilize
                let stableCount = 0;
                let previousCount = 0;
                
                for (let j = 0; j < 25; j++) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    const currentCount = await page.evaluate(() => {
                        return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
                    });
                    
                    if (currentCount === previousCount) {
                        stableCount++;
                        if (stableCount >= 3) break;
                    } else {
                        stableCount = 0;
                        previousCount = currentCount;
                    }
                }

                // Extract results (reuse logic from single search)
                const athleteResults = await page.evaluate((searchName) => {
                    const results = [];
                    const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                    
                    for (let i = 0; i < rows.length; i++) {
                        const row = rows[i];
                        const nameCell = row.querySelector('td:first-child');
                        if (!nameCell) continue;
                        
                        const nameLink = nameCell.querySelector('a');
                        if (!nameLink) continue;
                        
                        const athleteName = nameCell.textContent.trim();
                        const memberUrl = nameLink.href;
                        const memberMatch = memberUrl.match(/\/member\/(\d+)/);
                        if (!memberMatch) continue;
                        
                        const internalId = parseInt(memberMatch[1]);
                        
                        results.push({
                            athleteName,
                            internalId,
                            exactMatch: athleteName.toLowerCase() === searchName.toLowerCase()
                        });
                    }
                    
                    return results;
                }, athleteName);

                // Find best match
                const exactMatches = athleteResults.filter(r => r.exactMatch);
                const internalId = exactMatches.length === 1 ? exactMatches[0].internalId : null;

                results.push({
                    name: athleteName,
                    internalId,
                    error: null
                });

                if (verbose && internalId) {
                    console.log(`✅ Found: ${athleteName} → ID ${internalId}`);
                } else if (verbose) {
                    console.log(`❌ Not found: ${athleteName}`);
                }

            } catch (error) {
                results.push({
                    name: athleteName,
                    internalId: null,
                    error: error.message
                });
                
                if (verbose) {
                    console.log(`❌ Error searching for ${athleteName}: ${error.message}`);
                }
            }
        }

        return results;

    } catch (error) {
        throw new Error(`Batch Sport80 search failed: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = {
    searchSport80ForLifter,
    batchSearchSport80ForLifters
};