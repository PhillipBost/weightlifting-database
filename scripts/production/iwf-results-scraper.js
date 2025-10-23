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
async function scrapeEventResults(eventId, year = null, eventDate = null) {
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
    scrapeEventResults,
    clickMensTab,
    clickWomensTab,
    verifyResultsLoaded
};
