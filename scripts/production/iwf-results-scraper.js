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
const config = require('./iwf-config');
const { enrichAthleteWithAnalytics } = require('./iwf-analytics');

// ============================================================================
// LOGGING SETUP
// ============================================================================

const LOG_FILE = config.LOGGING.RESULTS_SCRAPER_LOG;

function ensureDirectories() {
    const dirs = [
        config.LOGGING.LOGS_DIR,
        config.LOGGING.ERRORS_DIR,
        config.LOGGING.OUTPUT_DIR
    ];

    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;

    console.log(logMessage);
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

function logError(error, context = {}) {
    const timestamp = new Date().toISOString();
    const errorObj = {
        timestamp,
        context,
        error_message: error.message,
        stack_trace: error.stack
    };

    log(`ERROR: ${error.message}`, 'ERROR');

    const errorFile = path.join(config.LOGGING.ERRORS_DIR, 'iwf-results-scraper-errors.json');
    let errors = [];

    if (fs.existsSync(errorFile)) {
        try {
            errors = JSON.parse(fs.readFileSync(errorFile, 'utf8'));
        } catch (e) {
            errors = [];
        }
    }

    errors.push(errorObj);
    fs.writeFileSync(errorFile, JSON.stringify(errors, null, 2));
}

// ============================================================================
// MEET CONTEXT (for analytics enrichment)
// ============================================================================

let meetContext = {
    event_id: null,
    year: null,
    date: null,
    meet_name: null
};

function setMeetContext(eventId, year, date) {
    meetContext = {
        event_id: eventId,
        year: year,
        date: date,
        meet_name: null  // Will be extracted from page if needed
    };
    log(`Meet context set: Event ${eventId}, Year ${year}, Date ${date || 'Not specified'}`);
}

// ============================================================================
// COMMAND LINE ARGUMENT PARSING
// ============================================================================

function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        eventId: null,
        year: null,
        date: null,
        testMode: null
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
            case '--test-mode':
                options.testMode = args[i + 1];
                i++;
                break;
            case '--help':
                console.log(`
IWF Results Scraper - Usage:
  node iwf-results-scraper.js --event-id 661 --year 2025                                      # Single event (full extraction)
  node iwf-results-scraper.js --event-id 621 --year 2025 --date "2025-05-09"                  # With date for endpoint selection
  node iwf-results-scraper.js --event-id 661 --year 2025 --test-mode single-athlete           # Test: single athlete only
  node iwf-results-scraper.js --event-id 661 --year 2025 --test-mode single-weight-class      # Test: single weight class
  node iwf-results-scraper.js --event-id 661 --year 2025 --test-mode all-mens-weight-classes  # Test: all men's weight classes
  node iwf-results-scraper.js --help                                                           # Show this help
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
// RETRY LOGIC
// ============================================================================

async function retryOperation(operation, maxRetries = config.RETRY.NETWORK_REQUESTS, context = '') {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            log(`Attempt ${attempt}/${maxRetries} failed for ${context}: ${error.message}`, 'WARN');

            if (attempt < maxRetries) {
                const backoff = config.RETRY.INITIAL_BACKOFF_MS * Math.pow(config.RETRY.BACKOFF_MULTIPLIER, attempt - 1);
                log(`Retrying in ${backoff}ms...`, 'WARN');
                await new Promise(resolve => setTimeout(resolve, backoff));
            }
        }
    }

    throw lastError;
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

            // Wait for attempt table structure to be injected (JavaScript dynamic content)
            await page.waitForSelector('div.col-md-3 div.col-3', { timeout: 10000 });
            log(`  ✓ Attempt table structure loaded`);

            // Additional safety wait
            await new Promise(resolve => setTimeout(resolve, 1000));

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

            // Wait for attempt table structure to be injected (JavaScript dynamic content)
            await page.waitForSelector('div.col-md-3 div.col-3', { timeout: 10000 });
            log(`  ✓ Attempt table structure loaded`);

            // Additional safety wait
            await new Promise(resolve => setTimeout(resolve, 1000));

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
// WEIGHT CLASS EXTRACTION
// ============================================================================

/**
 * Discover the actual HTML structure for weight class headers
 * Tests multiple selector patterns to find which one works
 *
 * @returns {Object} - Discovery results with working selector and sample data
 */
async function discoverWeightClassStructure() {
    log('Discovering weight class HTML structure...');
    
    const discovery = {
        success: false,
        workingSelector: null,
        sampleData: [],
        testedSelectors: []
    };

    // Get all possible selectors from config
    const selectorsToTest = [
        // Try specific patterns first
        'h2:has-text("KG")',
        'h3:has-text("KG")',
        'h2:has-text("kg")',
        'h3:has-text("kg")',
        'div.weight-class-header',
        '.category-header',
        // Try broader patterns
        'h2',
        'h3',
        'h4',
        // Try by content patterns
        '[class*="weight"]',
        '[class*="category"]',
        '[class*="class"]'
    ];

    for (const selector of selectorsToTest) {
        try {
            log(`  Testing selector: ${selector}`);
            discovery.testedSelectors.push(selector);

            // Try to find elements matching this selector
            const elements = await page.$$(selector);
            
            if (elements.length === 0) {
                log(`    ✗ No elements found`, 'DEBUG');
                continue;
            }

            // Extract text from first few elements to check if they look like weight classes
            const sampleTexts = [];
            for (let i = 0; i < Math.min(3, elements.length); i++) {
                const text = await page.evaluate(el => el.textContent, elements[i]);
                sampleTexts.push(text.trim());
            }

            log(`    Found ${elements.length} elements, samples: ${JSON.stringify(sampleTexts)}`, 'DEBUG');

            // Check if any sample text looks like a weight class (contains "KG" or "kg")
            const hasWeightClassPattern = sampleTexts.some(text => 
                /\d+\s*(KG|kg|Kg)/i.test(text) || 
                /^\+?\d+\s*(KG|kg|Kg)/i.test(text)
            );

            if (hasWeightClassPattern) {
                log(`  ✓ Found weight class pattern with selector: ${selector}`);
                discovery.success = true;
                discovery.workingSelector = selector;
                discovery.sampleData = sampleTexts;
                break;
            }

        } catch (error) {
            log(`    ✗ Error testing selector: ${error.message}`, 'DEBUG');
            continue;
        }
    }

    if (!discovery.success) {
        log('⚠ Could not auto-discover weight class selector, will use fallback extraction', 'WARN');
    }

    return discovery;
}

/**
 * Extract all weight class headers from the current page
 * Returns array of weight class objects with text and element references
 * 
 * @returns {Array<Object>} - Array of {weightClass: string, element: ElementHandle}
 */
async function extractWeightClasses() {
    log('Extracting weight class headers from page...');

    const weightClasses = [];

    // First try to discover the structure
    const discovery = await discoverWeightClassStructure();

    let selector = discovery.workingSelector;
    
    // If discovery failed, try all selectors from config
    if (!selector) {
        // Fall back to config selectors
        const configSelectors = config.SELECTORS.weightClassHeader.split(', ');
        selector = configSelectors[0]; // Use first one as default
        log(`Using fallback selector: ${selector}`, 'WARN');
    }

    try {
        // Get all elements matching the selector
        const elements = await page.$$(selector);
        log(`Found ${elements.length} potential weight class headers`);

        for (const element of elements) {
            // Get text content
            const text = await page.evaluate(el => el.textContent, element);
            const cleanText = text.trim();

            // Check if this looks like a weight class (contains digits AND "kg" or "KG")
            // Must have "kg" in the text to be a valid weight class (not just any number)
            if (/\d+\s*(KG|kg|Kg)/i.test(cleanText)) {
                weightClasses.push({
                    weightClass: cleanText,
                    element: element
                });
                log(`  Found weight class: "${cleanText}"`);
            }
        }

        if (weightClasses.length === 0) {
            log('⚠ No weight classes found with standard selectors, trying alternative approach...', 'WARN');
            
            // Alternative: Find all text nodes containing "KG" and look for their parent headers
            const allText = await page.evaluate(() => {
                const headers = [];
                const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_TEXT,
                    null
                );

                while (walker.nextNode()) {
                    const text = walker.currentNode.textContent.trim();
                    if (/\d+\s*(KG|kg)/i.test(text)) {
                        // Found text with weight class pattern, get parent element
                        const parent = walker.currentNode.parentElement;
                        const tagName = parent.tagName;
                        
                        // Only include if it's a header or prominent element
                        if (['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'SPAN'].includes(tagName)) {
                            headers.push({
                                text: text,
                                tag: tagName,
                                className: parent.className
                            });
                        }
                    }
                }
                return headers;
            });

            log(`Alternative approach found ${allText.length} candidates: ${JSON.stringify(allText)}`, 'DEBUG');
        }

    } catch (error) {
        log(`Error extracting weight classes: ${error.message}`, 'ERROR');
        logError(error, { stage: 'extractWeightClasses', selector });
    }

    log(`Total weight classes extracted: ${weightClasses.length}`);
    return weightClasses;
}

// ============================================================================
// ATHLETE DATA EXTRACTION
// ============================================================================

/**
 * Helper function to identify table type by checking header row
 * IWF has three tables per weight class: Snatch (attempts), C&J (attempts), Total (summary)
 *
 * @param {Element} row - DOM row element to check
 * @returns {string|null} - 'ATTEMPT_TABLE', 'TOTAL_TABLE', or null
 */
function identifyTableType(row) {
    const resultsCol = row.querySelector('.col-md-3');
    if (!resultsCol) return null;

    const rowContainer = resultsCol.querySelector('.row[class*="no-gutters"]') || resultsCol.querySelector('.row');
    if (!rowContainer) return null;

    const text = rowContainer.textContent;

    // Snatch/C&J tables have "1:", "2:", "3:" headers
    if (text.includes('1:') && text.includes('2:') && text.includes('3:')) {
        return 'ATTEMPT_TABLE'; // Will determine Snatch vs C&J by order
    }

    // Total table has "Snatch:", "CI&Jerk:", "Total:" headers
    if (text.includes('Snatch:') && text.includes('CI&Jerk:')) {
        return 'TOTAL_TABLE';
    }

    return null;
}

/**
 * Helper to check if row is a header row
 *
 * @param {Element} row - DOM row element to check
 * @returns {boolean} - True if this is a header row
 */

/**
 * Convert IWF name format from "LASTNAME Firstname" to "Firstname LASTNAME"
 *
 * @param {string} iwfName - Name in IWF format (e.g., "WANG Hao" or "CARDENAS ESTRADA Jorge Adan")
 * @returns {string} - Name in "Firstname LASTNAME" format
 */
function convertIWFNameFormat(iwfName) {
    if (!iwfName || typeof iwfName !== 'string') {
        return iwfName;
    }

    const trimmed = iwfName.trim();

    // Find where the uppercase section ends and mixed/lowercase begins
    // IWF format: All uppercase names come first, then mixed case firstname(s)
    const parts = trimmed.split(' ');

    // Find the index where we transition from ALL CAPS to mixed case
    let lastUpperIndex = -1;
    for (let i = 0; i < parts.length; i++) {
        // A word is considered "all caps" if it's entirely uppercase (ignoring short words like "II", "Jr")
        if (parts[i] === parts[i].toUpperCase() && parts[i].length > 1 && /[A-Z]/.test(parts[i])) {
            lastUpperIndex = i;
        } else {
            break;  // Found first mixed-case word
        }
    }

    if (lastUpperIndex === -1) {
        // No all-caps words found, return as-is
        return trimmed;
    }

    // Split into lastname (all caps) and firstname (rest)
    const lastname = parts.slice(0, lastUpperIndex + 1).join(' ');
    const firstname = parts.slice(lastUpperIndex + 1).join(' ');

    if (!firstname) {
        // No firstname found, might be all caps, return as-is
        return trimmed;
    }

    return `${firstname} ${lastname}`;
}

/**
 * Extract attempt value with strikethrough detection
 *
 * @param {Element} div - DOM element containing attempt value
 * @returns {number|null} - Positive for success, negative for miss, null for no attempt
 */
function extractAttempt(div) {
    const strong = div.querySelector('strong');
    if (!strong) return null;

    const text = strong.textContent.trim();
    // Check for both <s> and <strike> tags
    const hasStrikethrough = strong.querySelector('s') !== null || strong.querySelector('strike') !== null;

    if (text === '---' || text === '') return null;

    const value = parseInt(text);
    if (isNaN(value)) return null;

    return hasStrikethrough ? -Math.abs(value) : value;
}

/**
 * Find athlete row containers for a weight class
 * IWF uses a div-based responsive layout instead of HTML tables
 * Athletes are positioned between div.results__title boundaries
 *
 * @param {string} weightClassName - The weight class name
 * @returns {Object} - Discovery results with athlete row containers
 */
async function findAthleteRows(weightClassName) {
    log(`Finding athlete rows for ${weightClassName}...`);

    try {
        // Determine gender from weight class name
        const gender = weightClassName.includes('Women') ? 'F' : 'M';
        const containerId = gender === 'M' ? 'men_snatchjerk' : 'women_snatchjerk';

        // Use three-table extraction logic (Snatch table, C&J table, Total table)
        const athleteRowsInfo = await page.evaluate((weightClassText, containerId) => {
            // Find the container div by ID (men_snatchjerk or women_snatchjerk)
            const container = document.querySelector(`#${containerId}`);
            if (!container) {
                return {
                    found: false,
                    error: `Container #${containerId} not found`,
                    athleteCount: 0,
                    athletes: [],
                    debug: {}
                };
            }

            // Helper: Extract attempt value with strikethrough detection
            function extractAttempt(div) {
                const strong = div.querySelector('strong');
                if (!strong) return null;

                const text = strong.textContent.trim();
                // Check for both <s> and <strike> tags
                const hasStrikethrough = strong.querySelector('s') !== null || strong.querySelector('strike') !== null;

                if (text === '---' || text === '') return null;

                const value = parseInt(text);
                if (isNaN(value)) return null;

                return hasStrikethrough ? -Math.abs(value) : value;
            }

            // Step 1: Find weight class boundaries at parent level (not inside container)
            // Weight class titles exist at document/parent level, not inside the container
            const parent = container.parentElement || document;
            const resultsTitles = Array.from(parent.querySelectorAll('div.results__title'));

            // CRITICAL: Filter titles by gender to get correct index
            // IWF has ALL weight classes (men + women) in the title list, but each container
            // only has cards for its own gender. So we must count only matching gender titles.
            const gender = weightClassText.includes('Women') ? 'Women' : 'Men';
            const genderFilteredTitles = resultsTitles.filter(title => {
                const h3 = title.querySelector('h3');
                return h3 && h3.textContent.trim().includes(gender);
            });

            let currentTitleIndex = -1;
            for (let i = 0; i < genderFilteredTitles.length; i++) {
                const h3 = genderFilteredTitles[i].querySelector('h3');
                if (h3 && h3.textContent.trim() === weightClassText) {
                    currentTitleIndex = i;
                    break;
                }
            }

            if (currentTitleIndex === -1) {
                return {
                    found: false,
                    error: 'Weight class not found',
                    athleteCount: 0,
                    athletes: [],
                    debug: {}
                };
            }

            // Step 2: Find div.cards for this weight class using index matching
            // There are 3 cards containers per weight class (snatch, C&J, totals)
            // Formula: cardsIndex = weightClassIndex * 3 + tableType (0=snatch, 1=C&J, 2=totals)
            const allCardsContainers = Array.from(container.querySelectorAll('div.cards'));
            const snatchCardsIndex = currentTitleIndex * 3;
            const cjCardsIndex = currentTitleIndex * 3 + 1;
            const totalCardsIndex = currentTitleIndex * 3 + 2;

            const snatchCardsContainer = allCardsContainers[snatchCardsIndex];
            const cjCardsContainer = allCardsContainers[cjCardsIndex];
            const totalCardsContainer = allCardsContainers[totalCardsIndex];

            if (!snatchCardsContainer || !cjCardsContainer || !totalCardsContainer) {
                return {
                    found: false,
                    error: `Missing cards containers for weight class index ${currentTitleIndex} (snatch:${!!snatchCardsContainer}, cj:${!!cjCardsContainer}, total:${!!totalCardsContainer})`,
                    athleteCount: 0,
                    athletes: [],
                    debug: { totalCardsContainers: allCardsContainers.length, weightClassIndex: currentTitleIndex }
                };
            }

            // Get rows from all three cards containers (snatch, C&J, totals)
            // Process snatch table
            const snatchCards = Array.from(snatchCardsContainer.querySelectorAll('.card')).filter(c => !c.classList.contains('card__legend'));
            const snatchRows = [];
            for (const card of snatchCards) {
                const rows = Array.from(card.querySelectorAll('.row')).filter(row => {
                    const hasTitleCol = row.querySelector('.col-md-5.title') || row.querySelector('.col-md-5');
                    const hasDataCol = row.querySelector('.col-md-4');
                    const hasResultsCol = row.querySelector('.col-md-3');
                    return hasTitleCol && hasDataCol && hasResultsCol;
                });
                snatchRows.push(...rows);
            }

            // Process C&J table
            const cjCards = Array.from(cjCardsContainer.querySelectorAll('.card')).filter(c => !c.classList.contains('card__legend'));
            const cjRows = [];
            for (const card of cjCards) {
                const rows = Array.from(card.querySelectorAll('.row')).filter(row => {
                    const hasTitleCol = row.querySelector('.col-md-5.title') || row.querySelector('.col-md-5');
                    const hasDataCol = row.querySelector('.col-md-4');
                    const hasResultsCol = row.querySelector('.col-md-3');
                    return hasTitleCol && hasDataCol && hasResultsCol;
                });
                cjRows.push(...rows);
            }

            // Process totals table
            const totalCards = Array.from(totalCardsContainer.querySelectorAll('.card')).filter(c => !c.classList.contains('card__legend'));
            const totalRows = [];
            for (const card of totalCards) {
                const rows = Array.from(card.querySelectorAll('.row')).filter(row => {
                    const hasTitleCol = row.querySelector('.col-md-5.title') || row.querySelector('.col-md-5');
                    const hasDataCol = row.querySelector('.col-md-4');
                    const hasResultsCol = row.querySelector('.col-md-3');
                    return hasTitleCol && hasDataCol && hasResultsCol;
                });
                totalRows.push(...rows);
            }

            // Use the already-separated rows directly (no need to merge then split)
            // Since we extracted from three separate containers, the data is already organized
            const snatchTable = snatchRows;
            const cjTable = cjRows;
            const totalTable = totalRows;

            // Combine for rowsInWeightClass (needed for common field extraction later)
            const rowsInWeightClass = [...snatchRows, ...cjRows, ...totalRows];

            // Extract data from each table
            const snatchData = {};
            const cjData = {};
            const totalData = {};

            // Process Snatch table
            for (const row of snatchTable) {
                const name = row.querySelector('.col-md-5 .col-7.not__cell__767')?.textContent.trim();
                if (!name) continue;

                const resultsCol = row.querySelector('.col-md-3');
                const rowContainer = resultsCol.querySelector('.row[class*="no-gutters"]') || resultsCol.querySelector('.row');
                const attemptDivs = rowContainer?.querySelectorAll('.col-3.not__cell__767');

                if (attemptDivs && attemptDivs.length >= 4) {
                    snatchData[name] = {
                        snatch_1: extractAttempt(attemptDivs[0]),
                        snatch_2: extractAttempt(attemptDivs[1]),
                        snatch_3: extractAttempt(attemptDivs[2]),
                        best_snatch: extractAttempt(attemptDivs[3])
                    };
                }
            }

            // Process C&J table
            for (const row of cjTable) {
                const name = row.querySelector('.col-md-5 .col-7.not__cell__767')?.textContent.trim();
                if (!name) continue;

                const resultsCol = row.querySelector('.col-md-3');
                const rowContainer = resultsCol.querySelector('.row[class*="no-gutters"]') || resultsCol.querySelector('.row');
                const attemptDivs = rowContainer?.querySelectorAll('.col-3.not__cell__767');

                if (attemptDivs && attemptDivs.length >= 4) {
                    cjData[name] = {
                        cj_1: extractAttempt(attemptDivs[0]),
                        cj_2: extractAttempt(attemptDivs[1]),
                        cj_3: extractAttempt(attemptDivs[2]),
                        best_cj: extractAttempt(attemptDivs[3])
                    };
                }
            }

            // Process Total table
            for (const row of totalTable) {
                const name = row.querySelector('.col-md-5 .col-7.not__cell__767')?.textContent.trim();
                if (!name) continue;

                const resultsCol = row.querySelector('.col-md-3');
                const rowContainer = resultsCol.querySelector('.row[class*="no-gutters"]') || resultsCol.querySelector('.row');
                const totalDivs = rowContainer?.querySelectorAll('.col-4.not__cell__767');

                if (totalDivs && totalDivs.length >= 3) {
                    const extractTotal = (div) => {
                        const strong = div.querySelector('strong');
                        if (!strong) return null;
                        let text = strong.textContent.trim();
                        if (text === '---' || text === '') return null;
                        // Strip any label prefix (e.g., "Total: 302" => "302")
                        text = text.replace(/^.*:\s*/, '');
                        const value = parseInt(text);
                        return isNaN(value) ? null : value;
                    };

                    totalData[name] = {
                        total_snatch: extractTotal(totalDivs[0]),
                        total_cj: extractTotal(totalDivs[1]),
                        total: extractTotal(totalDivs[2])
                    };
                }
            }

            // Step 5: Merge data by athlete name and extract common fields
            const athletes = [];
            const allNames = new Set([...Object.keys(snatchData), ...Object.keys(cjData), ...Object.keys(totalData)]);

            for (const name of allNames) {
                // Find the row with this athlete's name to extract common fields
                const athleteRow = rowsInWeightClass.find(row => {
                    const nameDiv = row.querySelector('.col-md-5 .col-7.not__cell__767');
                    return nameDiv && nameDiv.textContent.trim() === name;
                });

                if (!athleteRow) continue;

                const athlete = {
                    name: name,
                    rank: null,
                    nation: null,
                    born: null,
                    bodyWeight: null,
                    group: null,
                    snatch_1: null,
                    snatch_2: null,
                    snatch_3: null,
                    snatch_total: null,
                    cj_1: null,
                    cj_2: null,
                    cj_3: null,
                    cj_total: null,
                    total: null
                };

                // Merge snatch data
                if (snatchData[name]) {
                    athlete.snatch_1 = snatchData[name].snatch_1;
                    athlete.snatch_2 = snatchData[name].snatch_2;
                    athlete.snatch_3 = snatchData[name].snatch_3;
                    athlete.snatch_total = snatchData[name].best_snatch;
                }

                // Merge C&J data
                if (cjData[name]) {
                    athlete.cj_1 = cjData[name].cj_1;
                    athlete.cj_2 = cjData[name].cj_2;
                    athlete.cj_3 = cjData[name].cj_3;
                    athlete.cj_total = cjData[name].best_cj;
                }

                // Merge total data (use totals table as authoritative source for best values)
                if (totalData[name]) {
                    athlete.snatch_total = totalData[name].total_snatch;  // Best snatch from totals table
                    athlete.cj_total = totalData[name].total_cj;          // Best C&J from totals table
                    athlete.total = totalData[name].total;                 // Competition total
                }

                // Extract common fields
                const titleCol = athleteRow.querySelector('.col-md-5');
                if (titleCol) {
                    const rankDiv = titleCol.querySelector('.col-2.not__cell__767');
                    const nationDiv = titleCol.querySelector('.col-3.not__cell__767');
                    if (rankDiv) athlete.rank = rankDiv.textContent.replace('Rank:', '').trim();
                    if (nationDiv) athlete.nation = nationDiv.textContent.replace('Nation:', '').trim();
                }

                const dataCol = athleteRow.querySelector('.col-md-4');
                if (dataCol) {
                    const colDivs = dataCol.querySelectorAll('.not__cell__767');
                    colDivs.forEach(div => {
                        const text = div.textContent.trim();
                        if (div.classList.contains('col-5')) {
                            athlete.born = text.replace('Born:', '').trim();
                        } else if (div.classList.contains('col-4')) {
                            athlete.bodyWeight = text.replace('B.weight:', '').trim();
                        } else if (div.classList.contains('col-3')) {
                            athlete.group = text.replace('Group:', '').trim();
                        }
                    });
                }

                athletes.push(athlete);
            }

            return {
                found: true,
                athleteCount: athletes.length,
                athletes: athletes,
                debug: {
                    snatchRows: snatchTable.length,
                    cjRows: cjTable.length,
                    totalRows: totalTable.length,
                    totalRowsInWeightClass: rowsInWeightClass.length
                }
            };

        }, weightClassName, containerId);

        if (athleteRowsInfo.found) {
            log(`  ✓ Found ${athleteRowsInfo.athleteCount} athlete rows for ${weightClassName}`);

            // Log debug info for three-table extraction
            if (athleteRowsInfo.debug) {
                log(`  Debug: ${athleteRowsInfo.debug.snatchRows} snatch rows, ` +
                    `${athleteRowsInfo.debug.cjRows} C&J rows, ` +
                    `${athleteRowsInfo.debug.totalRows} total rows, ` +
                    `${athleteRowsInfo.debug.totalRowsInWeightClass} total rows in weight class`, 'DEBUG');
            }

            return { success: true, athletes: athleteRowsInfo.athletes };
        } else {
            log(`  ✗ No athlete rows found: ${athleteRowsInfo.error || 'Unknown error'}`, 'WARN');
            return { success: false, athletes: [] };
        }

    } catch (error) {
        log(`Error finding athlete rows: ${error.message}`, 'ERROR');
        logError(error, { stage: 'findAthleteRows', weightClass: weightClassName });
        return { success: false, athletes: [] };
    }
}

/**
 * Convert extracted athlete data to our standard format
 *
 * @param {Object} rawData - Raw athlete data from page
 * @param {string} weightClass - Weight class for this athlete
 * @returns {Object} - Standardized athlete data object
 */
function convertAthleteData(rawData, weightClass) {
    // Convert name from IWF format "LASTNAME Firstname" to "Firstname LASTNAME"
    const convertedName = convertIWFNameFormat(rawData.name);

    // Create base athlete object
    const athlete = {
        rank: rawData.rank || null,
        name: convertedName,
        nation: rawData.nation || null,
        birth_date: rawData.born || null,
        body_weight: rawData.bodyWeight || null,
        group: rawData.group || null,
        weight_class: weightClass,
        // Individual attempts (positive = success, negative = miss, null = not attempted)
        snatch_1: rawData.snatch_1,
        snatch_2: rawData.snatch_2,
        snatch_3: rawData.snatch_3,
        best_snatch: rawData.snatch_total,
        cj_1: rawData.cj_1,
        cj_2: rawData.cj_2,
        cj_3: rawData.cj_3,
        best_cj: rawData.cj_total,
        total: rawData.total,
        // TODO: Extract iwf_athlete_url and iwf_lifter_id from athlete bio link
        iwf_athlete_url: null,
        iwf_lifter_id: null
    };

    // Enrich with analytics (successful attempts, bounce-back, Q-scores, etc.)
    return enrichAthleteWithAnalytics(athlete, meetContext);
}

/**
 * Extract all athlete data for a specific weight class
 * Uses div-based responsive layout instead of HTML tables
 *
 * @param {ElementHandle} weightClassHeader - The weight class header element (unused, kept for compatibility)
 * @param {string} weightClassName - The weight class name
 * @returns {Array<Object>} - Array of athlete data objects
 */
async function extractAthletesForWeightClass(weightClassHeader, weightClassName) {
    log(`Extracting athletes for weight class: ${weightClassName}...`);

    const athletes = [];

    try {
        // Use the new div-based extraction
        const athleteRowsResult = await findAthleteRows(weightClassName);

        if (!athleteRowsResult.success || athleteRowsResult.athletes.length === 0) {
            log(`  ✗ No athletes found for ${weightClassName}`, 'WARN');
            return athletes;
        }

        // Convert each raw athlete data to our standard format
        for (const rawData of athleteRowsResult.athletes) {
            const athlete = convertAthleteData(rawData, weightClassName);

            // Only include athletes with at least a name
            if (athlete.name && athlete.name.length > 0) {
                athletes.push(athlete);
                log(`    Extracted: ${athlete.name} (${athlete.nation || 'N/A'}) - Rank ${athlete.rank || 'N/A'}`);
            }
        }

        log(`  ✓ Extracted ${athletes.length} athletes for ${weightClassName}`);

    } catch (error) {
        log(`Error extracting athletes for ${weightClassName}: ${error.message}`, 'ERROR');
        logError(error, {
            stage: 'extractAthletesForWeightClass',
            weightClass: weightClassName
        });
    }

    return athletes;
}

/**
 * Process all weight classes for a given gender (men's or women's)
 * Main orchestrator function for weight class extraction
 *
 * @param {string} gender - 'M' for men, 'F' for women
 * @param {string} testMode - Optional test mode: 'single-athlete', 'single-weight-class', 'all-mens-weight-classes'
 * @returns {Object} - Structured weight class data
 */
async function processWeightClasses(gender, testMode = null) {
    const genderLabel = gender === 'M' ? 'Men' : 'Women';
    log(`\n${'='.repeat(80)}`);
    log(`PROCESSING ${genderLabel.toUpperCase()}'S WEIGHT CLASSES`);
    if (testMode) {
        log(`TEST MODE: ${testMode}`);
    }
    log('='.repeat(80));

    const result = {
        gender: gender,
        weight_classes: [],
        total_athletes: 0,
        success: false
    };

    try {
        // Extract all weight classes
        const allWeightClasses = await extractWeightClasses();

        // STEP 8 FIX: Filter weight classes by gender
        // IWF loads all weight classes in DOM, so we need to filter by "Men" or "Women" in the text
        const genderKeyword = gender === 'M' ? 'Men' : 'Women';
        const weightClasses = allWeightClasses.filter(wc => wc.weightClass.includes(genderKeyword));

        log(`Filtered to ${weightClasses.length} ${genderLabel}'s weight classes (from ${allWeightClasses.length} total on page)`);

        if (weightClasses.length === 0) {
            log(`⚠ No weight classes found for ${genderLabel}`, 'WARN');
            return result;
        }

        // Process each weight class (with test mode limits)
        for (let i = 0; i < weightClasses.length; i++) {
            const wc = weightClasses[i];

            // Test mode: single-weight-class - only process first weight class
            if (testMode === 'single-weight-class' && i > 0) {
                log(`Skipping remaining weight classes (test mode: single-weight-class)`);
                break;
            }

            const athletes = await extractAthletesForWeightClass(wc.element, wc.weightClass);

            // Test mode: single-athlete - only keep first athlete
            let processedAthletes = athletes;
            if (testMode === 'single-athlete' && athletes.length > 0) {
                processedAthletes = [athletes[0]];
                log(`  Test mode: Keeping only first athlete from ${athletes.length} total`);
            }

            result.weight_classes.push({
                weight_class: wc.weightClass,
                athletes: processedAthletes,
                athlete_count: processedAthletes.length
            });

            result.total_athletes += processedAthletes.length;

            // Test mode: single-athlete - stop after first weight class
            if (testMode === 'single-athlete') {
                log(`Stopping after first weight class (test mode: single-athlete)`);
                break;
            }
        }

        result.success = true;

        log(`\n${'='.repeat(80)}`);
        log(`${genderLabel.toUpperCase()}'S WEIGHT CLASSES SUMMARY`);
        log('='.repeat(80));
        log(`Total weight classes: ${result.weight_classes.length}`);
        log(`Total athletes: ${result.total_athletes}`);
        
        result.weight_classes.forEach(wc => {
            log(`  ${wc.weight_class}: ${wc.athlete_count} athletes`);
        });
        
        log('='.repeat(80));

        return result;

    } catch (error) {
        log(`Error processing weight classes for ${genderLabel}: ${error.message}`, 'ERROR');
        logError(error, { 
            stage: 'processWeightClasses', 
            gender: gender 
        });
        return result;
    }
}

// ============================================================================
// NAVIGATION
// ============================================================================

/**
 * Display extracted athlete data in readable format
 *
 * @param {Object} weightClassData - Weight class data with athletes
 */
function displayAthleteData(weightClassData) {
    if (!weightClassData || !weightClassData.weight_classes || weightClassData.weight_classes.length === 0) {
        log('No athlete data to display');
        return;
    }

    log('\n' + '='.repeat(80));
    log('EXTRACTED ATHLETE DATA');
    log('='.repeat(80));

    for (const wc of weightClassData.weight_classes) {
        log(`\n--- ${wc.weight_class} (${wc.athlete_count} athletes) ---`);

        for (const athlete of wc.athletes) {
            log(`  Rank: ${athlete.rank || 'N/A'}`);
            log(`  Name: ${athlete.name || 'N/A'}`);
            log(`  Nation: ${athlete.nation || 'N/A'}`);
            log(`  Birth Date: ${athlete.birth_date || 'N/A'}`);
            log(`  Body Weight: ${athlete.body_weight || 'N/A'}`);
            log(`  Group: ${athlete.group || 'N/A'}`);
            log(`  Snatch: ${athlete.snatch_1 || 'N/A'}, ${athlete.snatch_2 || 'N/A'}, ${athlete.snatch_3 || 'N/A'} (Best: ${athlete.best_snatch || 'N/A'})`);
            log(`  C&J: ${athlete.cj_1 || 'N/A'}, ${athlete.cj_2 || 'N/A'}, ${athlete.cj_3 || 'N/A'} (Best: ${athlete.best_cj || 'N/A'})`);
            log(`  Total: ${athlete.total || 'N/A'}`);
            // Display analytics if available
            if (athlete.birth_year !== undefined) {
                log(`  --- ANALYTICS ---`);
                log(`  Birth Year: ${athlete.birth_year || 'N/A'}`);
                log(`  Gender: ${athlete.gender || 'N/A'}`);
                log(`  Competition Age: ${athlete.competition_age || 'N/A'}`);
                log(`  Successful Attempts: Snatch ${athlete.snatch_successful_attempts || 0}, C&J ${athlete.cj_successful_attempts || 0}, Total ${athlete.total_successful_attempts || 0}`);
                log(`  Bounce Back: Snatch2 ${athlete.bounce_back_snatch_2 === null ? 'N/A' : athlete.bounce_back_snatch_2}, Snatch3 ${athlete.bounce_back_snatch_3 === null ? 'N/A' : athlete.bounce_back_snatch_3}, CJ2 ${athlete.bounce_back_cj_2 === null ? 'N/A' : athlete.bounce_back_cj_2}, CJ3 ${athlete.bounce_back_cj_3 === null ? 'N/A' : athlete.bounce_back_cj_3}`);
                log(`  Q-Scores: qpoints=${athlete.qpoints || 'N/A'}, q_youth=${athlete.q_youth || 'N/A'}, q_masters=${athlete.q_masters || 'N/A'}`);
            }
            log(`  ${'─'.repeat(70)}`);
        }
    }

    log('='.repeat(80));
}

/**
 * Navigate to event detail page and access results tabs
 *
 * @param {string} eventId - IWF event ID
 * @param {number} year - Event year (for endpoint selection)
 * @param {string} eventDate - Event date in YYYY-MM-DD format (optional, for precise endpoint selection)
 * @param {string} testMode - Optional test mode for limiting extraction
 * @returns {object} - Navigation result with success status and metadata
 */
async function scrapeEventResults(eventId, year = null, eventDate = null, testMode = null) {
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
        // Build event detail URL
        const eventUrl = config.buildEventDetailURL(eventId, year, eventDate);
        result.url = eventUrl;

        // Determine which endpoint we're using
        if (year) {
            result.endpoint = config.determineEndpoint(year, eventDate);
        }

        log(`Event URL: ${eventUrl}`);
        log(`Endpoint: ${result.endpoint || 'UNKNOWN'}`);

        // Set meet context for analytics enrichment
        setMeetContext(eventId, year, eventDate);

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

                // STEP 7: Extract weight classes and athlete data for men's results
                result.mens_weight_classes = await processWeightClasses('M', testMode);

                // Display extracted data if in test mode
                if (testMode && result.mens_weight_classes && result.mens_weight_classes.weight_classes.length > 0) {
                    displayAthleteData(result.mens_weight_classes);
                }
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

                // STEP 8: Extract weight classes and athlete data for women's results
                result.womens_weight_classes = await processWeightClasses('F', testMode);

                // Display extracted data if in test mode
                if (testMode && result.womens_weight_classes && result.womens_weight_classes.weight_classes.length > 0) {
                    displayAthleteData(result.womens_weight_classes);
                }
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

        log('\n' + '='.repeat(80));
        log('NAVIGATION SUMMARY');
        log('='.repeat(80));
        log(`Event ID: ${eventId}`);
        log(`Navigation: ${result.navigation_success ? '✓ SUCCESS' : '✗ FAILED'}`);
        log(`Men's Tab: ${result.mens_tab_success ? '✓ SUCCESS' : '✗ FAILED'}`);
        log(`Women's Tab: ${result.womens_tab_success ? '✓ SUCCESS' : '✗ FAILED'}`);
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
        log(`Test Mode: ${options.testMode || 'None - full extraction'}`);


        // Initialize browser
        await initBrowser();

        // Scrape event results with athlete data extraction (Step 7)
        const result = await scrapeEventResults(options.eventId, options.year, options.date, options.testMode);

        // Close browser
        await closeBrowser();

        // Summary
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

        log('\n' + '='.repeat(80));
        log('IWF RESULTS SCRAPER - COMPLETED');
        log('='.repeat(80));
        log(`Event ID: ${options.eventId}`);
        log(`Success: ${result.success ? 'YES' : 'NO'}`);
        
        // Weight class extraction summary
        if (result.mens_weight_classes) {
            log(`\nMen's Weight Classes: ${result.mens_weight_classes.weight_classes.length}`);
            log(`Men's Total Athletes: ${result.mens_weight_classes.total_athletes}`);
        }

        if (result.womens_weight_classes) {
            log(`\nWomen's Weight Classes: ${result.womens_weight_classes.weight_classes.length}`);
            log(`Women's Total Athletes: ${result.womens_weight_classes.total_athletes}`);
        }

        log(`\nElapsed time: ${elapsedTime} seconds`);
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
    // Main functions
    scrapeEventResults,
    initializeBrowser: initBrowser,  // Export for database importer
    closeBrowser,

    // Helper functions (for testing/debugging)
    clickMensTab,
    clickWomensTab,
    verifyResultsLoaded,
    extractWeightClasses,
    findAthleteRows,
    convertAthleteData,
    extractAthletesForWeightClass,
    processWeightClasses,
    displayAthleteData
};
