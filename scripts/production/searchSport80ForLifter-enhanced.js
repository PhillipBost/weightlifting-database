/* eslint-disable no-console */
/**
 * Enhanced Sport80 Athlete Search Function
 * 
 * This function searches Sport80's rankings pages for an athlete by name
 * and extracts their internal_id by clicking only on the target athlete.
 * 
 * Solves the "one-way street" problem where clicking one row makes others unclickable.
 */

const puppeteer = require('puppeteer');

/**
 * Search Sport80 rankings pages for a specific athlete and extract their internal_id
 * @param {string} athleteName - The name of the athlete to search for
 * @param {Object} searchParams - Search parameters for rankings
 * @param {string} searchParams.division - Division (e.g., "CA-South")
 * @param {string} searchParams.ageCategory - Age category (e.g., "Senior")
 * @param {string} searchParams.weightClass - Weight class (e.g., "109")
 * @param {string} searchParams.gender - Gender ("Male" or "Female")
 * @param {Date} searchParams.startDate - Start date for results
 * @param {Date} searchParams.endDate - End date for results
 * @param {Object} options - Search options
 * @param {boolean} options.headless - Whether to run browser in headless mode (default: true)
 * @param {number} options.timeout - Timeout in milliseconds (default: 30000)
 * @param {boolean} options.verbose - Whether to log detailed progress (default: false)
 * @returns {Promise<number|null>} The internal_id if found, null otherwise
 */
async function searchRankingsForAthlete(athleteName, searchParams, options = {}) {
    const {
        headless = true,
        timeout = 30000,
        verbose = false
    } = options;

    if (!athleteName || typeof athleteName !== 'string') {
        throw new Error('Athlete name is required and must be a string');
    }

    const cleanName = athleteName.trim().toLowerCase();
    if (!cleanName) {
        throw new Error('Athlete name cannot be empty');
    }

    let browser = null;
    
    try {
        if (verbose) {
            console.log(`🎯 Searching rankings for specific athlete: "${athleteName}"`);
            console.log(`📊 Search params:`, searchParams);
        }

        // Launch browser
        browser = await puppeteer.launch({ 
            headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: null
        });
        
        const page = await browser.newPage();
        
        // Set user agent to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Use the provided USA Weightlifting rankings URL
        const rankingsUrl = 'https://usaweightlifting.sport80.com/public/rankings/all?filters=eyJkYXRlX3JhbmdlX3N0YXJ0IjoiMjAxNy0wMS0wOCIsImRhdGVfcmFuZ2VfZW5kIjoiMjAxNy0wMS0xOCIsIndlaWdodF9jbGFzcyI6MzU2fQ%3D%3D';
        
        if (verbose) {
            console.log(`📂 Navigating to rankings: ${rankingsUrl}`);
        }
        
        await page.goto(rankingsUrl, { 
            waitUntil: 'networkidle0', 
            timeout 
        });

        // Give Vue.js adequate time to fully render the table
        if (verbose) {
            console.log(`⏳ Waiting for Vue.js table to fully render...`);
        }
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 4000)); // Adequate wait time for Vue.js
        
        let currentPage = 1;
        let foundAthlete = null;
        const maxPages = 10; // Safety limit

        // Search through pages until we find the athlete
        while (currentPage <= maxPages && !foundAthlete) {
            if (verbose) {
                console.log(`🔍 Searching page ${currentPage} for "${athleteName}"...`);
            }

            // Search for the athlete on current page
            const pageResult = await page.evaluate((targetName) => {
                const rows = Array.from(document.querySelectorAll('tbody tr'));
                
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const cells = Array.from(row.querySelectorAll('td'));
                    
                    if (cells.length === 0) continue;
                    
                    const athleteName = cells[0].textContent.trim();
                    const isClickable = row.classList.contains('row-clickable');
                    
                    // Check for name match (case insensitive)
                    if (athleteName.toLowerCase().includes(targetName.toLowerCase())) {
                        return {
                            found: true,
                            athleteName: athleteName,
                            rowIndex: i,
                            isClickable: isClickable,
                            exactMatch: athleteName.toLowerCase() === targetName.toLowerCase()
                        };
                    }
                }
                
                return { found: false };
            }, cleanName);

            if (pageResult.found) {
                if (verbose) {
                    console.log(`✅ Found athlete: "${pageResult.athleteName}" on page ${currentPage} (row ${pageResult.rowIndex + 1})`);
                    console.log(`🔗 Row is clickable: ${pageResult.isClickable}`);
                }

                if (pageResult.isClickable) {
                    // Click the specific athlete's row to extract internal_id
                    if (verbose) {
                        console.log(`🖱️  Clicking on "${pageResult.athleteName}" to extract internal_id...`);
                    }

                    const internalId = await page.evaluate((rowIndex) => {
                        return new Promise((resolve) => {
                            const rows = Array.from(document.querySelectorAll('tbody tr'));
                            const targetRow = rows[rowIndex];
                            
                            if (!targetRow || !targetRow.classList.contains('row-clickable')) {
                                resolve(null);
                                return;
                            }

                            // Set up URL capture before clicking
                            let capturedUrl = null;
                            
                            // Override window.open to capture URL
                            const originalOpen = window.open;
                            window.open = function(url, target, features) {
                                capturedUrl = url;
                                return { close: () => {}, focus: () => {} };
                            };

                            // Capture router navigation
                            const originalPushState = history.pushState;
                            const originalReplaceState = history.replaceState;
                            
                            history.pushState = function(state, title, url) {
                                if (url && url.includes('/member/')) {
                                    capturedUrl = url;
                                }
                                return originalPushState.call(this, state, title, url);
                            };
                            
                            history.replaceState = function(state, title, url) {
                                if (url && url.includes('/member/')) {
                                    capturedUrl = url;
                                }
                                return originalReplaceState.call(this, state, title, url);
                            };

                            // Click the row
                            targetRow.click();
                            
                            // Wait for navigation/URL capture
                            setTimeout(() => {
                                // Restore original functions
                                window.open = originalOpen;
                                history.pushState = originalPushState;
                                history.replaceState = originalReplaceState;
                                
                                // Extract internal_id from captured URL
                                if (capturedUrl) {
                                    const match = capturedUrl.match(/\/member\/(\d+)/);
                                    if (match) {
                                        resolve(parseInt(match[1]));
                                        return;
                                    }
                                }
                                
                                resolve(null);
                            }, 1000);
                        });
                    }, pageResult.rowIndex);

                    if (internalId) {
                        if (verbose) {
                            console.log(`🎉 Successfully extracted internal_id: ${internalId} for "${pageResult.athleteName}"`);
                        }
                        return internalId;
                    } else {
                        if (verbose) {
                            console.log(`❌ Failed to extract internal_id from click for "${pageResult.athleteName}"`);
                        }
                        return null;
                    }
                } else {
                    if (verbose) {
                        console.log(`❌ Found "${pageResult.athleteName}" but row is not clickable`);
                    }
                    return null;
                }
            }

            // Check for next page
            const hasNextPage = await page.evaluate(() => {
                // Try multiple pagination selectors
                const selectors = [
                    '.v-data-footer__icons-after .v-btn:not([disabled])',
                    '.v-pagination__next:not([disabled])',
                    'button[aria-label="Next page"]:not([disabled])',
                    '.pagination .next:not(.disabled)'
                ];
                
                for (const selector of selectors) {
                    const nextBtn = document.querySelector(selector);
                    if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) {
                        return true;
                    }
                }
                
                return false;
            });

            if (hasNextPage) {
                if (verbose) {
                    console.log(`⏭️  Moving to page ${currentPage + 1}...`);
                }

                // Navigate to next page
                if (verbose) {
                    console.log(`⏭️  Clicking next page button...`);
                }
                
                await page.evaluate(() => {
                    const selectors = [
                        '.v-data-footer__icons-after .v-btn:not([disabled])',
                        '.v-pagination__next:not([disabled])',
                        'button[aria-label="Next page"]:not([disabled])',
                        '.pagination .next:not(.disabled)'
                    ];
                    
                    for (const selector of selectors) {
                        const nextBtn = document.querySelector(selector);
                        if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) {
                            nextBtn.click();
                            return;
                        }
                    }
                });

                // Give Vue.js adequate time to render the new page
                if (verbose) {
                    console.log(`⏳ Waiting for Vue.js to render page ${currentPage + 1}...`);
                }
                await new Promise(resolve => setTimeout(resolve, 4000)); // Adequate wait for Vue.js
                
                // Wait for new content to load
                await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 10000 });
                await new Promise(resolve => setTimeout(resolve, 2000)); // Additional stabilization time
                
                currentPage++;
            } else {
                if (verbose) {
                    console.log(`🏁 No more pages available`);
                }
                break;
            }
        }

        if (verbose) {
            console.log(`❌ Athlete "${athleteName}" not found in ${currentPage} pages`);
        }
        return null;

    } catch (error) {
        if (verbose) {
            console.error(`❌ Error searching rankings for "${athleteName}":`, error.message);
        }
        throw new Error(`Rankings search failed: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Enhanced search that tries both the search interface and rankings pages
 * @param {string} athleteName - The name of the athlete to search for
 * @param {Object} searchParams - Optional search parameters for rankings fallback
 * @param {Object} options - Search options
 * @returns {Promise<number|null>} The internal_id if found, null otherwise
 */
async function searchSport80ForLifterEnhanced(athleteName, searchParams = null, options = {}) {
    const { verbose = false } = options;
    
    try {
        if (verbose) {
            console.log(`🔍 Enhanced search for athlete: "${athleteName}"`);
        }

        // First, try the original search interface method (faster)
        const { searchSport80ForLifter } = require('./searchSport80ForLifter');
        
        if (verbose) {
            console.log(`📋 Trying search interface method...`);
        }
        
        const searchResult = await searchSport80ForLifter(athleteName, options);
        
        if (searchResult) {
            if (verbose) {
                console.log(`✅ Found via search interface: ${athleteName} → ID ${searchResult}`);
            }
            return searchResult;
        }

        // If search interface didn't work and we have search params, try rankings pages
        if (searchParams) {
            if (verbose) {
                console.log(`📊 Search interface failed, trying rankings pages...`);
            }
            
            const rankingsResult = await searchRankingsForAthlete(athleteName, searchParams, options);
            
            if (rankingsResult) {
                if (verbose) {
                    console.log(`✅ Found via rankings pages: ${athleteName} → ID ${rankingsResult}`);
                }
                return rankingsResult;
            }
        }

        if (verbose) {
            console.log(`❌ Athlete "${athleteName}" not found via any method`);
        }
        return null;

    } catch (error) {
        if (verbose) {
            console.error(`❌ Enhanced search failed for "${athleteName}":`, error.message);
        }
        throw error;
    }
}

/**
 * Format date for Sport80 API
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string (YYYY-MM-DD)
 */
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

module.exports = {
    searchRankingsForAthlete,
    searchSport80ForLifterEnhanced,
    formatDate
};