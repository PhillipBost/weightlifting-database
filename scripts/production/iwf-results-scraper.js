/**
 * IWF RESULTS SCRAPER MODULE
 *
 * Navigates to IWF event detail pages and extracts competition results.
 * Handles tab switching between men's and women's results, weight class
 * extraction, and athlete performance data.
 *
 * Usage:
 *   node iwf-results-scraper.js --event-id 661 --year 2025
 *   node iwf-results-scraper.js --event-id 621 --year 2025 --date "2025-05-09"
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const config = require('./iwf-config');
const { log, logError, retryOperation, ensureDirectories } = require('./iwf-logger');

const LOG_FILE = config.LOGGING.RESULTS_SCRAPER_LOG;

// ============================================================================
// COMMAND LINE ARGUMENT PARSING
// ============================================================================

function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        eventId: null,
        year: null,
        date: null
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--event-id':
                options.eventId = args[i + 1];
                i++;
                break;
            case '--year':
                options.year = parseInt(args[i + 1]);
                i++;
                break;
            case '--date':
                options.date = args[i + 1];
                i++;
                break;
            case '--help':
                console.log(`
IWF Results Scraper - Usage:
  node iwf-results-scraper.js --event-id 661 --year 2025                    # Single event
  node iwf-results-scraper.js --event-id 621 --year 2025 --date "2025-05-09" # With date for endpoint selection
  node iwf-results-scraper.js --help                                         # Show this help
                `);
                process.exit(0);
        }
    }

    if (!options.eventId) {
        console.error('Error: --event-id is required');
        process.exit(1);
    }

    return options;
}

// ============================================================================
// BROWSER UTILITIES
// ============================================================================

let browser = null;
let page = null;

async function initBrowser() {
    log('Initializing Puppeteer browser...');

    browser = await puppeteer.launch({
        headless: config.BROWSER.headless,
        args: config.BROWSER.args
    });

    page = await browser.newPage();
    await page.setUserAgent(config.BROWSER.userAgent);
    await page.setViewport(config.BROWSER.viewport);

    log('Browser initialized successfully');
}

async function closeBrowser() {
    if (browser) {
        await browser.close();
        log('Browser closed');
    }
}

// ============================================================================
// TAB SWITCHING
// ============================================================================

/**
 * Try multiple selector patterns to find and click men's tab
 * Returns true if successful, false if tab not found
 */
async function clickMensTab() {
    log('Attempting to click Men\'s Snatch, Clean & Jerk tab...');

    // Try each selector from config
    for (const selector of config.SELECTORS.menTab) {
        try {
            log(`  Trying selector: ${selector}`);

            // Wait for selector to appear
            await page.waitForSelector(selector, { timeout: 5000 });

            // Click the tab
            await page.click(selector);
            log(`  ✓ Successfully clicked men's tab using selector: ${selector}`);

            // Wait for content to load
            await new Promise(resolve => setTimeout(resolve, config.TIMING.PAGE_LOAD_DELAY_MS));

            return true;
        } catch (e) {
            log(`  ✗ Selector failed: ${selector}`, 'DEBUG');
            continue;
        }
    }

    log('Failed to find men\'s tab with any selector pattern', 'WARN');
    return false;
}

/**
 * Try multiple selector patterns to find and click women's tab
 * Returns true if successful, false if tab not found
 */
async function clickWomensTab() {
    log('Attempting to click Women\'s Snatch, Clean & Jerk tab...');

    // Try each selector from config
    for (const selector of config.SELECTORS.womenTab) {
        try {
            log(`  Trying selector: ${selector}`);

            // Wait for selector to appear
            await page.waitForSelector(selector, { timeout: 5000 });

            // Click the tab
            await page.click(selector);
            log(`  ✓ Successfully clicked women's tab using selector: ${selector}`);

            // Wait for content to load
            await new Promise(resolve => setTimeout(resolve, config.TIMING.PAGE_LOAD_DELAY_MS));

            return true;
        } catch (e) {
            log(`  ✗ Selector failed: ${selector}`, 'DEBUG');
            continue;
        }
    }

    log('Failed to find women\'s tab with any selector pattern', 'WARN');
    return false;
}

/**
 * Verify that results table content has loaded
 * Returns true if content found, false otherwise
 */
async function verifyResultsLoaded() {
    log('Verifying results content loaded...');

    try {
        // Try to find results table or weight class headers
        const selectors = [
            config.SELECTORS.resultsTable,
            config.SELECTORS.weightClassHeader,
            config.SELECTORS.athleteRow
        ];

        for (const selector of selectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                log(`  ✓ Found results content using selector: ${selector}`);
                return true;
            } catch (e) {
                continue;
            }
        }

        log('No results content found with any selector', 'WARN');
        return false;
    } catch (error) {
        log(`Error verifying results: ${error.message}`, 'ERROR');
        return false;
    }
}

// ============================================================================
// DATA EXTRACTION FROM EXPANDED RESULTS DIVS
// ============================================================================

/**
 * Extract content from expanded results div using XPath
 * Individual lift attempts are in separate DOM section from card summaries
 * 
 * @param {string} xpathSelector - XPath to the expanded results div
 * @param {string} gender - 'men' or 'women' for logging
 * @returns {object} - Parsed attempt data indexed by athlete name
 */
async function extractExpandedResults(xpathSelector, gender) {
    log(`Extracting expanded results for ${gender} using XPath...`);
    
    try {
        // Use page.evaluate to query the DOM with XPath
        const expandedData = await page.evaluate((xpath) => {
            const getElementByXPath = (xpathStr) => {
                const result = document.evaluate(
                    xpathStr,
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                );
                return result.singleNodeValue;
            };
            
            const element = getElementByXPath(xpath);
            if (!element) {
                return null;
            }
            
            // Return the HTML content of the expanded results div
            return {
                innerHTML: element.innerHTML,
                textContent: element.textContent,
                className: element.className,
                children: element.children.length
            };
        }, xpathSelector);
        
        if (!expandedData) {
            log(`  ✗ Expanded results div not found at XPath: ${xpathSelector}`, 'WARN');
            return {};
        }
        
        log(`  ✓ Found expanded results div with ${expandedData.children} children`);
        
        // Save HTML for structure analysis
        await saveExpandedResultsHTML(gender, expandedData.innerHTML);
        
        // Parse the HTML structure to extract attempt data
        const attemptData = parseAttemptHTML(expandedData.innerHTML, gender);
        log(`  ✓ Extracted attempt data structure`);
        
        return attemptData;
        
    } catch (error) {
        log(`  ✗ Error extracting expanded results: ${error.message}`, 'ERROR');
        return {};
    }
}

/**
 * Save expanded results HTML for analysis
 * Saves the raw HTML so we can analyze the structure
 * 
 * @param {string} gender - 'men' or 'women'
 * @param {string} htmlContent - The expanded results HTML
 */
async function saveExpandedResultsHTML(gender, htmlContent) {
    try {
        const filename = path.join(
            config.LOGGING.OUTPUT_DIR,
            `iwf_expanded_results_${gender}_analysis.html`
        );
        fs.writeFileSync(filename, htmlContent);
        log(`    → Saved expanded results for analysis: ${filename}`);
    } catch (error) {
        log(`    Error saving HTML: ${error.message}`, 'WARN');
    }
}

/**
 * Parse expanded results from saved HTML file
 * Reads the HTML file and parses it with parseAttemptHTML
 *
 * @param {string} gender - 'men' or 'women'
 * @param {string} eventId - Event ID for filename lookup
 * @returns {object} - Parsed weight classes data
 */
async function parseExpandedResultsFromFile(gender, eventId) {
    try {
        const filename = path.join(
            config.LOGGING.OUTPUT_DIR,
            `iwf_expanded_results_${gender}_analysis.html`
        );

        if (!fs.existsSync(filename)) {
            log(`  ⚠ Expanded results HTML file not found: ${filename}`, 'WARN');
            return {
                gender: gender,
                weight_classes: [],
                total_athletes: 0
            };
        }

        const htmlContent = fs.readFileSync(filename, 'utf8');
        return parseAttemptHTML(htmlContent, gender);
    } catch (error) {
        log(`  Error reading expanded results file: ${error.message}`, 'ERROR');
        return {
            gender: gender,
            weight_classes: [],
            total_athletes: 0,
            error: error.message
        };
    }
}

/**
 * Parse HTML from expanded results div to extract individual attempts
 * This is a placeholder - structure analysis needed first
 * 
 * @param {string} htmlContent - The innerHTML of expanded results div
 * @param {string} gender - 'men' or 'women' for context
 * @returns {object} - Parsed attempts (structure TBD based on HTML analysis)
 */
function parseAttemptHTML(htmlContent, gender) {
    try {
        log(`Parsing ${gender}'s expanded results HTML...`, 'DEBUG');

        const $ = cheerio.load(htmlContent);
        const weightClasses = [];
        let currentWeightClass = null;
        let currentLiftType = null;  // 'snatch' or 'cj'
        let athleteMap = new Map();  // Map to store athlete data by rank

        // Iterate through all children
        $('.results__title, .cards').each((i, elem) => {
            const $elem = $(elem);

            // Check for weight class header
            const h3 = $elem.find('h3').first();
            if (h3.length > 0) {
                const rawText = h3.text().trim();
                // Extract weight class without gender suffix (e.g., "60 kg Men" → "60 kg")
                const weightClassMatch = rawText.match(/(\d+|\+\d+)\s*kg/i);
                const weightClassText = weightClassMatch ? weightClassMatch[0].trim() : rawText;
                log(`  Found weight class: ${weightClassText}`, 'DEBUG');

                // Save previous weight class if exists
                if (currentWeightClass && athleteMap.size > 0) {
                    currentWeightClass.athletes = Array.from(athleteMap.values());
                    weightClasses.push(currentWeightClass);
                }

                // Start new weight class
                currentWeightClass = {
                    weight_class: weightClassText,
                    athletes: []
                };
                athleteMap = new Map();
                currentLiftType = null;
            }

            // Check for lift type header
            const p = $elem.find('p').first();
            if (p.length > 0 && !p.hasClass('normal__text')) {
                const liftText = p.text().trim().toLowerCase();
                if (liftText.includes('snatch') && !liftText.includes('jerk')) {
                    currentLiftType = 'snatch';
                    log(`    Lift type: Snatch`, 'DEBUG');
                } else if (liftText.includes('clean') || liftText.includes('jerk')) {
                    currentLiftType = 'cj';
                    log(`    Lift type: Clean & Jerk`, 'DEBUG');
                }
            }

            // Process athlete cards
            if ($elem.hasClass('cards') && currentWeightClass && currentLiftType) {
                $elem.find('.card').not('.card__legend').each((cardIndex, card) => {
                    const $card = $(card);

                    // Extract basic athlete info
                    const rankText = $card.find('.col-2.not__cell__767 p').first().text().trim().replace(/Rank:\s*/, '');
                    const rank = parseInt(rankText) || cardIndex + 1;

                    const name = $card.find('.col-7.not__cell__767 p').first().text().trim();
                    const nation = $card.find('.col-3.not__cell__767 p').first().text().trim().replace(/[^A-Z]/g, '');

                    // Get or create athlete object


                    let athlete = athleteMap.get(rank);


                    if (!athlete) {


                        // Extract athlete profile URL and IWF lifter ID


                        const athleteLink = $card.find('a.title[href*="athletes-bios"]');


                        const athleteUrl = athleteLink.attr('href');


                        let iwfLifterId = null;


                        if (athleteUrl) {


                            try {


                                const urlObj = new URL(athleteUrl, 'https://iwf.sport');


                                const idParam = urlObj.searchParams.get('id');


                                if (idParam) {


                                    iwfLifterId = parseInt(idParam);


                                }


                            } catch (e) {


                                // URL parsing failed, continue without ID


                            }


                        }


                    


                        // Extract birth info


                        const bornText = $card.find('.col-5.not__cell__767 p').first().text().trim().replace(/Born:\s*/, '');


                        const birthYearMatch = bornText.match(/[0-9]{4}/)?.[0];
                        const birthYear = (birthYearMatch && birthYearMatch !== 'null') ? parseInt(birthYearMatch) : null;



                        // Extract bodyweight


                        const bweightText = $card.find('.col-4.not__cell__767 p').eq(0).text().trim().replace(/B\.weight:\s*/, '');


                        const bodyweight = parseFloat(bweightText) || null;



                        // Extract group


                        const group = $card.find('.col-3.not__cell__767 p').eq(1).text().trim().replace(/Group:\s*/, '');



                        athlete = {
                            rank: rank,
                            name: name,
                            nation: nation,
                            birth_year: birthYear,
                            body_weight: bodyweight,
                            group: group,
                            iwf_athlete_url: athleteUrl || null,
                            iwf_lifter_id: iwfLifterId,
                            gender: gender === 'men' ? 'M' : gender === 'women' ? 'F' : null,
                            weight_class: currentWeightClass.weight_class,
                            snatch_1: null,
                            snatch_2: null,
                            snatch_3: null,
                            cj_1: null,
                            cj_2: null,
                            cj_3: null,
                            best_snatch: null,
                            best_cj: null,
                            total: null
                        };
                        athleteMap.set(rank, athlete);
                    }

                    // Extract attempts (in the col-md-3 section)
                    const attemptCols = $card.find('.col-md-3 .col-3.not__cell__767');
                    attemptCols.each((attemptIndex, attemptCol) => {
                        if (attemptIndex >= 3) return; // Only first 3 are attempts, 4th is total

                        const $attemptCol = $(attemptCol);
                        const strongText = $attemptCol.find('strong').text().trim();

                        let attemptValue = 0;
                        if (strongText && strongText !== '---') {
                            const hasStrike = $attemptCol.find('strike').length > 0;
                            const numericValue = parseFloat(strongText.replace(/[^\d.-]/g, ''));
                            if (!isNaN(numericValue)) {
                                attemptValue = hasStrike ? -numericValue : numericValue;
                            }
                        }

                        // Set the appropriate field
                        const fieldPrefix = currentLiftType === 'snatch' ? 'snatch' : 'cj';
                        const fieldName = `${fieldPrefix}_${attemptIndex + 1}`;
                        athlete[fieldName] = attemptValue;
                    });

                    // Extract best/total from 4th column
                    const totalCol = $card.find('.col-md-3 .col-3.not__cell__767').eq(3);
                    if (totalCol.length > 0) {
                        const totalText = totalCol.find('strong').text().trim();
                        // Remove "Total:" prefix and any non-numeric characters except dash and decimal point
                        const numericText = totalText.replace(/^Total:\s*/, '').replace(/[^\d.-]/g, '');
                        const totalValue = parseFloat(numericText) || null;

                        if (currentLiftType === 'snatch') {
                            athlete.best_snatch = totalValue;
                        } else if (currentLiftType === 'cj') {
                            athlete.best_cj = totalValue;
                        }
                    }
                });
            }
        });

        // Save last weight class
        if (currentWeightClass && athleteMap.size > 0) {
            currentWeightClass.athletes = Array.from(athleteMap.values());
            weightClasses.push(currentWeightClass);
        }

        // Calculate totals for each athlete
        weightClasses.forEach(wc => {
            wc.athletes.forEach(athlete => {
                if (athlete.best_snatch && athlete.best_cj) {
                    athlete.total = athlete.best_snatch + athlete.best_cj;
                }
            });

            // Count total athletes in weight class
            wc.total_athletes = wc.athletes.length;
        });

        log(`  ✓ Parsed ${weightClasses.length} weight classes with ${weightClasses.reduce((sum, wc) => sum + wc.total_athletes, 0)} total athletes`, 'DEBUG');

        return {
            gender: gender,
            weight_classes: weightClasses,
            total_athletes: weightClasses.reduce((sum, wc) => sum + wc.total_athletes, 0)
        };

    } catch (error) {
        log(`  Error parsing attempt HTML: ${error.message}`, 'ERROR');
        logError(error, { gender });
        return {
            gender: gender,
            weight_classes: [],
            total_athletes: 0,
            error: error.message
        };
    }
}

// ============================================================================
// NAVIGATION
// ============================================================================

/**
 * Navigate to event detail page and access results tabs
 *
 * @param {string} eventId - IWF event ID
 * @param {number} year - Event year (for endpoint selection)
 * @param {string} eventDate - Event date in YYYY-MM-DD format (optional, for precise endpoint selection)
 * @returns {object} - Navigation result with success status and metadata
 */
async function scrapeEventResults(eventId, year = null, eventDate = null, endpoint = null) {
    log('\n' + '='.repeat(80));
    log(`SCRAPING EVENT: ${eventId}`);
    log('='.repeat(80));

    const result = {
        event_id: eventId,
        year: year,
        event_date: eventDate,
        success: false,
        navigation_success: false,
        mens_tab_success: false,
        womens_tab_success: false,
        url: null,
        endpoint: null,
        error: null
    };

    try {
        // Build event detail URL using endpoint if provided
        let eventUrl;
        if (endpoint) {
            eventUrl = config.buildEventDetailURLFromEndpoint(eventId, endpoint);
            result.endpoint = endpoint;
        } else {
            eventUrl = config.buildEventDetailURL(eventId, year, eventDate);
            if (year) {
                result.endpoint = config.determineEndpoint(year, eventDate);
            }
        }
        result.url = eventUrl;

        log(`Event URL: ${eventUrl}`);
        log(`Endpoint: ${result.endpoint || 'UNKNOWN'}`);

        // Navigate to event detail page with retry
        await retryOperation(async () => {
            await page.goto(eventUrl, {
                waitUntil: 'networkidle0',
                timeout: config.TIMING.REQUEST_TIMEOUT_MS
            });
        }, config.RETRY.NETWORK_REQUESTS, `navigate to event ${eventId}`);

        log('Page loaded successfully');
        result.navigation_success = true;

        // Wait for dynamic content
        log(`Waiting ${config.TIMING.PAGE_LOAD_DELAY_MS}ms for dynamic content...`);
        await new Promise(resolve => setTimeout(resolve, config.TIMING.PAGE_LOAD_DELAY_MS));

        // Click men's tab
        log('\n--- MEN\'S RESULTS ---');
        const mensTabSuccess = await clickMensTab();
        result.mens_tab_success = mensTabSuccess;

        if (mensTabSuccess) {
            // Verify results loaded
            const resultsLoaded = await verifyResultsLoaded();
            if (resultsLoaded) {
                log('✓ Men\'s results loaded successfully');
                
                // Extract expanded results with individual attempts
                log('Extracting men\'s expanded results with attempt details...');
                const mensExpandedXPath = '/html/body/div[4]/section/div[2]/div[2]/div[2]';
                const mensAttempts = await extractExpandedResults(mensExpandedXPath, 'men');
            } else {
                log('⚠ Men\'s tab clicked but results content not detected', 'WARN');
            }
        } else {
            log('✗ Failed to click men\'s tab', 'WARN');
        }

        // Take screenshot for debugging (optional)
        const screenshotPath = path.join(config.LOGGING.OUTPUT_DIR, `event_${eventId}_mens_screenshot.png`);
        await page.screenshot({ path: screenshotPath });
        log(`Screenshot saved: ${screenshotPath}`);

        // Click women's tab (for future Steps 6-8)
        log('\n--- WOMEN\'S RESULTS ---');
        const womensTabSuccess = await clickWomensTab();
        result.womens_tab_success = womensTabSuccess;

        if (womensTabSuccess) {
            // Verify results loaded
            const resultsLoaded = await verifyResultsLoaded();
            if (resultsLoaded) {
                log('✓ Women\'s results loaded successfully');
                
                // Extract expanded results with individual attempts
                log('Extracting women\'s expanded results with attempt details...');
                const womensExpandedXPath = '/html/body/div[4]/section/div[2]/div[2]/div[4]';
                const womensAttempts = await extractExpandedResults(womensExpandedXPath, 'women');
            } else {
                log('⚠ Women\'s tab clicked but results content not detected', 'WARN');
            }

            // Take screenshot
            const womensScreenshotPath = path.join(config.LOGGING.OUTPUT_DIR, `event_${eventId}_womens_screenshot.png`);
            await page.screenshot({ path: womensScreenshotPath });
            log(`Screenshot saved: ${womensScreenshotPath}`);
        } else {
            log('✗ Failed to click women\'s tab', 'WARN');
        }

        // Overall success if navigation worked and at least one tab clicked
        result.success = result.navigation_success && (result.mens_tab_success || result.womens_tab_success);

        // Parse the saved HTML files to extract structured data
        log('\n--- PARSING EXTRACTED DATA ---');
        if (result.mens_tab_success) {
            log('Parsing men\'s expanded results...');
            result.mens_weight_classes = await parseExpandedResultsFromFile('men', eventId);
            log(`✓ Parsed ${result.mens_weight_classes.total_athletes || 0} male athletes`);
        }

        if (result.womens_tab_success) {
            log('Parsing women\'s expanded results...');
            result.womens_weight_classes = await parseExpandedResultsFromFile('women', eventId);
            log(`✓ Parsed ${result.womens_weight_classes.total_athletes || 0} female athletes`);
        }

        log('\n' + '='.repeat(80));
        log('SCRAPING SUMMARY');
        log('='.repeat(80));
        log(`Event ID: ${eventId}`);
        log(`Navigation: ${result.navigation_success ? '✓ SUCCESS' : '✗ FAILED'}`);
        log(`Men's Tab: ${result.mens_tab_success ? '✓ SUCCESS' : '✗ FAILED'}`);
        log(`Women's Tab: ${result.womens_tab_success ? '✓ SUCCESS' : '✗ FAILED'}`);
        log(`Men's Athletes: ${result.mens_weight_classes?.total_athletes || 0}`);
        log(`Women's Athletes: ${result.womens_weight_classes?.total_athletes || 0}`);
        log(`Overall: ${result.success ? '✓ SUCCESS' : '✗ FAILED'}`);
        log('='.repeat(80));

        return result;

    } catch (error) {
        result.error = error.message;
        logError(error, {
            event_id: eventId,
            year: year,
            event_date: eventDate,
            url: result.url,
            stage: 'scrapeEventResults'
        });

        log(`Failed to scrape event ${eventId}: ${error.message}`, 'ERROR');
        return result;
    }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main() {
    const startTime = Date.now();

    try {
        ensureDirectories();

        log('\n' + '='.repeat(80));
        log('IWF RESULTS SCRAPER - STARTED');
        log('='.repeat(80));

        // Parse command line arguments
        const options = parseArguments();
        log(`Event ID: ${options.eventId}`);
        log(`Year: ${options.year || 'Not specified'}`);
        log(`Date: ${options.date || 'Not specified'}`);

        // Initialize browser
        await initBrowser();

        // Scrape event results (navigation only for Step 5)
        const result = await scrapeEventResults(options.eventId, options.year, options.date);

        // Close browser
        await closeBrowser();

        // Summary
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

        log('\n' + '='.repeat(80));
        log('IWF RESULTS SCRAPER - COMPLETED');
        log('='.repeat(80));
        log(`Event ID: ${options.eventId}`);
        log(`Success: ${result.success ? 'YES' : 'NO'}`);
        log(`Elapsed time: ${elapsedTime} seconds`);
        log('='.repeat(80));

        if (!result.success) {
            log('Navigation failed - see error log for details', 'ERROR');
            process.exit(1);
        }

    } catch (error) {
        logError(error, { stage: 'main' });
        log('Results scraper failed with error: ' + error.message, 'ERROR');
        await closeBrowser();
        process.exit(1);
    }
}

// ============================================================================
// RUN
// ============================================================================

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    initBrowser,
    closeBrowser,
    scrapeEventResults,
    clickMensTab,
    clickWomensTab,
    verifyResultsLoaded,
    extractExpandedResults,
    saveExpandedResultsHTML,
    parseExpandedResultsFromFile,
    parseAttemptHTML
};
