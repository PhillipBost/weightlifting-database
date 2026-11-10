/**
 * IWF RESULTS SCRAPER MODULE
 *
 * @module iwf-results-scraper
 *
 * Navigates to IWF event detail pages and extracts complete competition results.
 * Uses Puppeteer (headless Chrome) to scrape dynamic content from IWF website.
 *
 * Features:
 * - Tab switching between men's and women's results (critical for data visibility)
 * - Weight class detection and athlete grouping
 * - Complete lift attempt extraction (snatch 1-3, C&J 1-3)
 * - Body weight, rank, and biographical data parsing
 * - Pagination support for large competitions
 * - CSV export for processed data
 *
 * Important DOM Notes:
 * - IWF uses div.card elements (NOT tables) for athlete results
 * - Men's/women's data only visible after clicking respective filter tabs
 * - Must click div.single__event__filter[data-target="men_snatchjerk"] first
 * - Weight class headers use h2/h3 elements
 *
 * Usage:
 *   node iwf-results-scraper.js --event-id 661 --year 2025
 *   node iwf-results-scraper.js --event-id 621 --year 2025 --date "2025-05-09"
 *   node iwf-results-scraper.js --help
 *
 * Output:
 *   Creates CSV file: output/iwf_results_EVENTID_YEAR.csv
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
        date: null,
        url: null
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
            case '--url':
                options.url = args[i + 1];
                i++;
                break;
            case '--help':
                console.log(`
IWF Results Scraper - Usage:
  node iwf-results-scraper.js --event-id 661 --year 2025                    # Single event
  node iwf-results-scraper.js --event-id 621 --year 2025 --date "2025-05-09" # With date for endpoint selection
  node iwf-results-scraper.js --url "https://iwf.sport/results/results-by-events/?event_id=700" # Direct URL
  node iwf-results-scraper.js --help                                         # Show this help
                `);
                process.exit(0);
        }
    }

    if (options.url && !options.eventId) {
        const match = options.url.match(/[?&]event_id=(\d+)/i);
        if (match) {
            options.eventId = match[1];
        }
    }

    if (!options.eventId) {
        console.error('Error: --event-id or --url is required');
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

    const defaultWindowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ||
        (fs.existsSync(defaultWindowsChrome) ? defaultWindowsChrome : undefined);

    browser = await puppeteer.launch({
        headless: config.BROWSER.headless,
        executablePath,
        args: config.BROWSER.args
    });

    page = await browser.newPage();

    // Prevent detection of automated browser (suppress navigator.webdriver and mock standard browser artifacts)
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });

        window.chrome = {
            runtime: {},
            loadTimes: function () { },
            csi: function () { },
            app: {}
        };

        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });

        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });
    });

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

    // Diagnostic: find all available clickable filter elements or tabs on the page
    try {
        const availableFilters = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('[data-target], .single__event__filter, [class*="filter"], [class*="tab"], h2, h3, button'));
            return elements.slice(0, 15).map(el => ({
                tag: el.tagName,
                class: el.className,
                target: el.getAttribute('data-target'),
                text: el.innerText ? el.innerText.trim().slice(0, 40) : ''
            }));
        });
        log(`Diagnostic - Available clickable candidates (${availableFilters.length}): ${JSON.stringify(availableFilters)}`, 'WARN');
    } catch (diagErr) {
        log(`Diagnostic error: ${diagErr.message}`, 'DEBUG');
    }

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

            // Check for weight class header (supports both h2 and h3)
            const hHeader = $elem.find('h2, h3').first();
            if (hHeader.length > 0) {
                const rawText = hHeader.text().trim();
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
                } else if (liftText.includes('total')) {
                    currentLiftType = 'total';
                    log(`    Lift type: Total`, 'DEBUG');
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

                    // Extract birth year BEFORE athlete lookup (needed for unique key)
                    const bornText = $card.find('.col-5.not__cell__767 p').first().text().trim().replace(/Born:\s*/, '');
                    const birthYearMatch = bornText.match(/[0-9]{4}/)?.[0];
                    const birthYear = (birthYearMatch && birthYearMatch !== 'null') ? parseInt(birthYearMatch) : null;

                    // Get or create athlete object using name+nation+birth_year+weight_class as unique key
                    // (preserves multi-category same-meet athletes across weight classes)
                    const athleteKey = `${name}-${nation}-${birthYear}-${currentWeightClass.weight_class}`;

                    // DEBUG: Log extraction
                    console.log(`[DEBUG] Card: name="${name}", nation="${nation}", bornText="${bornText}", birthYear=${birthYear}, athleteKey="${athleteKey}"`);

                    let athlete = athleteMap.get(athleteKey);


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
                        athleteMap.set(athleteKey, athlete);
                    }

                    // Extract attempts (in the col-md-3 section) for Snatch and Clean & Jerk
                    if (currentLiftType === 'snatch' || currentLiftType === 'cj') {
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
                    }

                    // Extract official overall rank and competition total from Total cards
                    if (currentLiftType === 'total') {
                        athlete.rank = rank;

                        const totalCol = $card.find('.col-md-3 .col-3.not__cell__767').last();
                        if (totalCol.length > 0) {
                            const totalText = totalCol.find('strong').text().trim();
                            const numericText = totalText.replace(/^Total:\s*/, '').replace(/[^\d.-]/g, '');
                            const totalValue = parseFloat(numericText) || null;
                            if (totalValue !== null) {
                                athlete.total = totalValue;
                            }
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

        // Calculate totals for each athlete if not already set from total cards
        weightClasses.forEach(wc => {
            wc.athletes.forEach(athlete => {
                if (!athlete.total && athlete.best_snatch && athlete.best_cj) {
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

/**
 * Parse full IWF meet HTML page directly
 * Extracts meet metadata, men's results, and women's results
 * Merges snatch/jerk attempt data with total cards
 *
 * @param {string} htmlContent - Full page HTML string
 * @param {string|number} [eventId] - Optional event ID
 * @returns {object} - Scraper-compatible results object
 */
function parseIwfEventHtml(htmlContent, eventId = null) {
    if (!htmlContent || typeof htmlContent !== 'string') {
        throw new Error('Valid HTML content string is required');
    }

    const $ = cheerio.load(htmlContent);

    // 1. Extract Event ID if not passed
    let resolvedEventId = eventId ? String(eventId) : null;
    if (!resolvedEventId) {
        const urlMatch = htmlContent.match(/event_id=(\d+)/);
        if (urlMatch) {
            resolvedEventId = urlMatch[1];
        }
    }

    // 2. Extract Meet Metadata
    const eventTitleElem = $('.title__event h2').first();
    let meetName = eventTitleElem.length > 0 ? eventTitleElem.text().trim() : null;
    if (!meetName) {
        const pageTitle = $('title').text().trim();
        meetName = pageTitle.replace(/\s*–\s*International Weightlifting Federation.*$/i, '').trim();
    }
    if (!meetName && resolvedEventId) {
        meetName = `Event ${resolvedEventId}`;
    }

    log(`Extracted meet name from HTML: "${meetName}" (Event ID: ${resolvedEventId || 'unknown'})`);

    // Helper to merge totals from #..._total container into parsed attempt results
    function mergeTotals(attemptResults, totalContainerHtml, gender) {
        if (!totalContainerHtml) return attemptResults;

        const $total = cheerio.load(totalContainerHtml);
        let currentWeightClass = null;
        let totalCount = 0;

        // Build lookup map for existing athletes in attemptResults
        const athleteMap = new Map();
        if (attemptResults && attemptResults.weight_classes) {
            for (const wc of attemptResults.weight_classes) {
                for (const ath of wc.athletes) {
                    const normWc = (ath.weight_class || wc.weight_class || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    const key = `${ath.name.toUpperCase()}_${normWc}`;
                    athleteMap.set(key, ath);
                }
            }
        }

        $total('.results__title, .cards').each((i, elem) => {
            const $elem = $total(elem);
            const hHeader = $elem.find('h2, h3').first();
            if (hHeader.length > 0) {
                const rawText = hHeader.text().trim();
                const m = rawText.match(/(\d+|\+\d+)\s*kg/i);
                currentWeightClass = m ? m[0].trim() : rawText;
            }

            if ($elem.hasClass('cards') && currentWeightClass) {
                $elem.find('.card').not('.card__legend').each((idx, card) => {
                    const $card = $total(card);
                    const name = $card.find('.col-7.not__cell__767 p').first().text().trim();
                    const rankText = $card.find('.col-2.not__cell__767 p').first().text().trim().replace(/Rank:\s*/, '');
                    const rank = parseInt(rankText) || null;

                    // Extract total from col-md-3
                    let totalVal = null;
                    const colMd3 = $card.find('.col-md-3');
                    const totalStrong = colMd3.find('strong').last();
                    if (totalStrong.length > 0) {
                        const numMatch = totalStrong.text().replace(/^Total:\s*/, '').match(/[\d.]+/);
                        if (numMatch) totalVal = parseFloat(numMatch[0]);
                    }

                    // Best snatch & CJ from total card columns if available
                    let bestSnatch = null;
                    let bestCj = null;
                    const col4s = colMd3.find('.col-4.not__cell__767');
                    if (col4s.length >= 2) {
                        const sMatch = col4s.eq(0).find('strong').text().match(/[\d.]+/);
                        if (sMatch) bestSnatch = parseFloat(sMatch[0]);
                        const cMatch = col4s.eq(1).find('strong').text().match(/[\d.]+/);
                        if (cMatch) bestCj = parseFloat(cMatch[0]);
                    }

                    const normWc = currentWeightClass.replace(/\s+/g, ' ').trim().toLowerCase();
                    const key = `${name.toUpperCase()}_${normWc}`;
                    const existingAth = athleteMap.get(key);

                    if (existingAth) {
                        if (rank !== null) existingAth.rank = rank;
                        if (totalVal !== null) existingAth.total = totalVal;
                        if (!existingAth.best_snatch && bestSnatch) existingAth.best_snatch = bestSnatch;
                        if (!existingAth.best_cj && bestCj) existingAth.best_cj = bestCj;
                        totalCount++;
                    }
                });
            }
        });

        log(`Merged overall rankings and totals for ${totalCount} ${gender} athletes`);
        return attemptResults;
    }

    // 3. Process Men's Results
    let mensResults = { gender: 'men', weight_classes: [], total_athletes: 0 };
    const menSjHtml = $('#men_snatchjerk').html();
    const menTotHtml = $('#men_total').html();

    if (menSjHtml) {
        mensResults = parseAttemptHTML(menSjHtml, 'men');
        if (menTotHtml) {
            mensResults = mergeTotals(mensResults, menTotHtml, 'men');
        }
    } else if (menTotHtml) {
        mensResults = parseAttemptHTML(menTotHtml, 'men');
    }

    // 4. Process Women's Results
    let womensResults = { gender: 'women', weight_classes: [], total_athletes: 0 };
    const womSjHtml = $('#women_snatchjerk').html();
    const womTotHtml = $('#women_total').html();

    if (womSjHtml) {
        womensResults = parseAttemptHTML(womSjHtml, 'women');
        if (womTotHtml) {
            womensResults = mergeTotals(womensResults, womTotHtml, 'women');
        }
    } else if (womTotHtml) {
        womensResults = parseAttemptHTML(womTotHtml, 'women');
    }

    const totalAthletes = (mensResults.total_athletes || 0) + (womensResults.total_athletes || 0);

    return {
        event_id: resolvedEventId,
        meet_name: meetName,
        success: totalAthletes > 0,
        mens_weight_classes: mensResults,
        womens_weight_classes: womensResults,
        total_athletes: totalAthletes
    };
}

// ============================================================================
// NAVIGATION & DISCOVERY
// ============================================================================

/**
 * Discover authentic event card metadata (name, date, location) from listing page or cache
 *
 * @param {object} browserInstance - Puppeteer browser instance
 * @param {string} eventId - IWF event ID
 * @param {number} year - Event year
 * @param {string} endpoint - Endpoint key (MODERN, MID_RANGE, HISTORICAL)
 * @returns {Promise<object|null>} - Discovered metadata or null
 */
async function discoverEventCardMetadata(browserInstance, eventId, year, endpoint) {
    if (!eventId) return null;

    const resolvedYear = year || new Date().getFullYear();
    const resolvedEndpoint = endpoint || config.determineEndpoint(resolvedYear);
    const eventsFilePath = path.join(config.LOGGING.OUTPUT_DIR, `iwf_events_${resolvedYear}.json`);

    // 1. Check local cache first
    if (fs.existsSync(eventsFilePath)) {
        try {
            const cachedData = JSON.parse(fs.readFileSync(eventsFilePath, 'utf8'));
            const found = (cachedData.events || []).find(e => String(e.event_id) === String(eventId));
            if (found && found.date) {
                log(`✓ Found cached event card metadata for Event ${eventId} in ${eventsFilePath}`);
                return {
                    event_name: found.event_name,
                    date: found.date,
                    location: found.location,
                    location_city: found.location_city,
                    location_country: found.location_country
                };
            }
        } catch (readErr) {
            log(`Warning reading cached events file: ${readErr.message}`, 'DEBUG');
        }
    }

    // 2. Discover from annual listing page if browser is available
    if (!browserInstance) return null;

    const listingBase = config.URLS[resolvedEndpoint]?.EVENT_LISTING;
    if (!listingBase) return null;

    const listingUrl = `${listingBase}${resolvedYear}`;
    log(`Querying annual listing for authentic event card metadata: ${listingUrl}`);

    let listingPage = null;
    try {
        listingPage = await browserInstance.newPage();
        await listingPage.goto(listingUrl, {
            waitUntil: 'networkidle0',
            timeout: config.TIMING.REQUEST_TIMEOUT_MS
        });

        const cardData = await listingPage.evaluate((targetId) => {
            const cards = Array.from(document.querySelectorAll('a.card, .event-card, .card'));
            for (const card of cards) {
                const href = card.getAttribute('href') || '';
                if (href.includes(`event_id=${targetId}`)) {
                    const titleElem = card.querySelector('p.title span.text, .title');
                    const normalTexts = card.querySelectorAll('p.normal__text');
                    const dateText = normalTexts[0] ? normalTexts[0].textContent.trim() : null;

                    let city = null;
                    let country = null;
                    let locationText = null;

                    if (normalTexts[1]) {
                        locationText = normalTexts[1].textContent.trim();
                        const strongElem = normalTexts[1].querySelector('strong');
                        if (strongElem) {
                            country = strongElem.textContent.trim();
                            city = locationText.replace(country, '').replace(',', '').trim();
                        } else {
                            city = locationText;
                        }
                    }

                    return {
                        event_name: titleElem ? titleElem.textContent.trim() : null,
                        date: dateText,
                        location: locationText,
                        location_city: city,
                        location_country: country
                    };
                }
            }
            return null;
        }, String(eventId));

        if (cardData) {
            log(`✓ Discovered event card: "${cardData.event_name}" (${cardData.date}), Location: ${cardData.location || 'N/A'}`);

            // Persist discovered event into output/iwf_events_YYYY.json cache
            try {
                let eventsData = {
                    metadata: {
                        year: String(resolvedYear),
                        scraped_at: new Date().toISOString(),
                        event_count: 0,
                        script_version: '1.0.0'
                    },
                    events: []
                };

                if (fs.existsSync(eventsFilePath)) {
                    eventsData = JSON.parse(fs.readFileSync(eventsFilePath, 'utf8'));
                    if (!Array.isArray(eventsData.events)) eventsData.events = [];
                }

                const existingIdx = eventsData.events.findIndex(e => String(e.event_id) === String(eventId));
                const newEntry = {
                    event_id: String(eventId),
                    event_name: cardData.event_name,
                    date: cardData.date,
                    location: cardData.location,
                    location_city: cardData.location_city,
                    location_country: cardData.location_country,
                    url: `${config.URLS[resolvedEndpoint]?.EVENT_DETAIL || ''}${eventId}`,
                    endpoint: resolvedEndpoint,
                    year: resolvedYear,
                    scraped_at: new Date().toISOString()
                };

                if (existingIdx >= 0) {
                    eventsData.events[existingIdx] = newEntry;
                } else {
                    eventsData.events.push(newEntry);
                }
                eventsData.metadata.event_count = eventsData.events.length;
                fs.writeFileSync(eventsFilePath, JSON.stringify(eventsData, null, 2));
                log(`✓ Saved discovered event into cache: ${eventsFilePath}`);
            } catch (saveErr) {
                log(`Warning saving discovered event cache: ${saveErr.message}`, 'WARN');
            }
        }

        return cardData;
    } catch (err) {
        log(`Warning: Failed to discover event card from listing page: ${err.message}`, 'WARN');
        return null;
    } finally {
        if (listingPage) {
            await listingPage.close().catch(() => {});
        }
    }
}

/**
 * Navigate to event detail page and access results tabs
 *
 * @param {string} eventId - IWF event ID
 * @param {number} year - Event year (for endpoint selection)
 * @param {string} eventDate - Event date in YYYY-MM-DD format (optional, for precise endpoint selection)
 * @returns {object} - Navigation result with success status and metadata
 */
async function scrapeEventResults(eventId, year = null, eventDate = null, endpoint = null, targetUrl = null) {
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
        meet_metadata: null,
        error: null
    };

    try {
        // Build event detail URL using direct targetUrl or endpoint
        let eventUrl;
        if (typeof targetUrl === 'string' && targetUrl.startsWith('http')) {
            eventUrl = targetUrl;
            if (eventUrl.includes('2025-2026')) result.endpoint = 'MODERN';
            else if (eventUrl.includes('2018-2025')) result.endpoint = 'MID_RANGE';
            else if (eventUrl.includes('upto2018')) result.endpoint = 'HISTORICAL';
            else result.endpoint = 'CUSTOM';
        } else if (endpoint) {
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

        // Disable browser disk/memory cache without injecting custom CORS-breaking HTTP headers
        await page.setCacheEnabled(false);
        log(`Browser cache disabled for event ${eventId}`);

        // Navigate to event detail page with retry
        await retryOperation(async () => {
            await page.goto(eventUrl, {
                waitUntil: 'networkidle0',
                timeout: config.TIMING.REQUEST_TIMEOUT_MS
            });
        }, config.RETRY.NETWORK_REQUESTS, `navigate to event ${eventId}`);

        let pageTitle = await page.title().catch(() => 'Unknown');
        log(`Page loaded successfully: "${pageTitle}"`);

        // Check if page is currently undergoing Cloudflare security verification
        if (pageTitle.toLowerCase().includes('just a moment') || pageTitle.toLowerCase().includes('security verification')) {
            log('Detected Cloudflare verification gate. Waiting for automated verification and redirect...');
            const verificationStart = Date.now();
            const maxVerificationWaitMs = 30000;

            while (Date.now() - verificationStart < maxVerificationWaitMs) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                pageTitle = await page.title().catch(() => 'Unknown');
                log(`  Current page title: "${pageTitle}"`);

                if (!pageTitle.toLowerCase().includes('just a moment') &&
                    !pageTitle.toLowerCase().includes('security verification') &&
                    !pageTitle.toLowerCase().includes('cloudflare')) {
                    log(`  ✓ Cloudflare verification cleared! Page title: "${pageTitle}"`);
                    break;
                }

                // Check if Cloudflare marked verification successful
                const verificationStatus = await page.evaluate(() => {
                    const text = document.body ? document.body.innerText : '';
                    if (text.includes('Verification successful')) return 'SUCCESS';
                    return 'PENDING';
                }).catch(() => 'ERROR');

                if (verificationStatus === 'SUCCESS') {
                    log('  ✓ Verification successful reported by Cloudflare. Awaiting redirect/navigation...');
                    try {
                        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
                    } catch (navErr) {
                        log(`  Navigation wait completed: ${navErr.message}`, 'DEBUG');
                    }
                    pageTitle = await page.title().catch(() => 'Unknown');
                    log(`  Page title after navigation: "${pageTitle}"`);
                    if (!pageTitle.toLowerCase().includes('just a moment') &&
                        !pageTitle.toLowerCase().includes('security verification')) {
                        log(`  ✓ Successfully navigated to target page: "${pageTitle}"`);
                        break;
                    }
                }
            }
        }

        // *** VERIFY URL ACTUALLY CHANGED ***
        const currentUrl = await page.url();
        log(`Current URL after navigation: ${currentUrl}`);

        // Extract event_id from current URL
        const urlEventIdMatch = currentUrl.match(/event_id=(\d+)/);
        const currentEventId = urlEventIdMatch ? urlEventIdMatch[1] : null;

        if (currentEventId !== String(eventId)) {
            const errorMsg =
                `URL mismatch after navigation!\n` +
                `Expected event_id: ${eventId}\n` +
                `Actual event_id: ${currentEventId}\n` +
                `Current URL: ${currentUrl}\n` +
                `This indicates CDN cache contamination. Retrying...`;

            log(errorMsg, 'ERROR');
            throw new Error(errorMsg);
        }

        log(`✓ URL verified: event_id=${eventId} matches`);
        result.navigation_success = true;

        // Extract meet title from event detail page DOM
        const extractedMeetTitle = await page.evaluate(() => {
            const h2 = document.querySelector('.title__filters h2, .filters h2, .title__event h2, .event_title, h2.title');
            if (h2 && h2.textContent.trim()) {
                return h2.textContent.trim();
            }
            const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
            for (const h of headings) {
                const text = h.textContent.trim();
                if (text &&
                    !text.toLowerCase().includes('results by events') &&
                    !text.toLowerCase().includes('events') &&
                    !text.toLowerCase().includes('year search') &&
                    !text.toLowerCase().includes('event search') &&
                    !text.toLowerCase().includes('athletes search') &&
                    !text.toLowerCase().includes('search') &&
                    !text.toLowerCase().includes('menu')) {
                    return text;
                }
            }
            return null;
        }).catch(() => null);

        if (extractedMeetTitle) {
            log(`✓ Extracted meet title from page DOM: "${extractedMeetTitle}"`);
        }

        // Discover authentic event card metadata (date, location, official name) from annual listing page
        const cardMetadata = await discoverEventCardMetadata(browser, eventId, year, result.endpoint);

        result.meet_metadata = {
            event_id: String(eventId),
            meet_name: cardMetadata?.event_name || extractedMeetTitle || null,
            date: cardMetadata?.date || null,
            location_city: cardMetadata?.location_city || null,
            location_country: cardMetadata?.location_country || null,
            location_text: cardMetadata?.location || null
        };

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

        // Take screenshot and HTML snapshot for debugging
        const screenshotPath = path.join(config.LOGGING.OUTPUT_DIR, `event_${eventId}_mens_screenshot.png`);
        await page.screenshot({ path: screenshotPath });
        log(`Screenshot saved: ${screenshotPath}`);

        if (!mensTabSuccess) {
            const pageTitle = await page.title().catch(() => 'Unknown');
            const bodySnippet = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || '').catch(() => '');
            log(`Page Title on tab failure: "${pageTitle}"`, 'WARN');
            log(`Page text snippet: "${bodySnippet.replace(/\s+/g, ' ')}"`, 'WARN');

            const htmlDumpPath = path.join(config.LOGGING.OUTPUT_DIR, `event_${eventId}_page.html`);
            const html = await page.content().catch(() => '');
            if (html) {
                fs.writeFileSync(htmlDumpPath, html);
                log(`HTML snapshot saved: ${htmlDumpPath}`);
            }
        }

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
        if (options.url) log(`Target URL: ${options.url}`);

        // Initialize browser
        await initBrowser();

        // Scrape event results (navigation only for Step 5)
        const result = await scrapeEventResults(options.eventId, options.year, options.date, null, options.url || null);

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
    parseAttemptHTML,
    parseIwfEventHtml
};
