/**
 * IWF EVENT DISCOVERY MODULE
 *
 * Discovers and catalogs IWF competition events from the IWF results pages.
 * Handles three separate URL endpoints (MODERN, MID_RANGE, HISTORICAL) and
 * split years (2025, 2018) where events span multiple endpoints.
 *
 * Usage:
 *   node iwf-event-discovery.js                           # Default years from config
 *   node iwf-event-discovery.js --year 2025               # Single year
 *   node iwf-event-discovery.js --from-year 2024 --to-year 2025  # Year range
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('./iwf-config');

// ============================================================================
// LOGGING SETUP
// ============================================================================

const LOG_FILE = config.LOGGING.EVENT_DISCOVERY_LOG;

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

    const errorFile = path.join(config.LOGGING.ERRORS_DIR, 'iwf-event-discovery-errors.json');
    let errors = [];

    if (fs.existsSync(errorFile)) {
        try {
            errors = JSON.parse(fs.readFileSync(errorFile, 'utf8'));
        } catch (e) {
            // File might be corrupted, start fresh
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
        startYear: null,
        endYear: null
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--year':
                options.startYear = parseInt(args[i + 1]);
                options.endYear = parseInt(args[i + 1]);
                i++;
                break;
            case '--from-year':
                options.startYear = parseInt(args[i + 1]);
                i++;
                break;
            case '--to-year':
                options.endYear = parseInt(args[i + 1]);
                i++;
                break;
            case '--help':
                console.log(`
IWF Event Discovery - Usage:
  node iwf-event-discovery.js                           # Default years from config
  node iwf-event-discovery.js --year 2025               # Single year
  node iwf-event-discovery.js --from-year 2024 --to-year 2025  # Year range
  node iwf-event-discovery.js --help                    # Show this help
                `);
                process.exit(0);
        }
    }

    // Use config defaults if not specified
    if (!options.startYear) options.startYear = config.YEARS.START;
    if (!options.endYear) options.endYear = config.YEARS.END;

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
// EVENT EXTRACTION
// ============================================================================

/**
 * Try multiple selector patterns to find event cards
 * Returns array of element handles or empty array if none found
 */
async function findEventCards() {
    // IWF uses <a class="card"> for event cards
    const selectors = [
        'a.card',          // Primary selector (based on actual HTML)
        '.card',
        '.event-card',
        '.event-item',
        'div[class*="event"]',
        'article'
    ];

    for (const selector of selectors) {
        try {
            await page.waitForSelector(selector, { timeout: 5000 });
            const cards = await page.$$(selector);
            if (cards.length > 0) {
                log(`Found ${cards.length} event cards using selector: ${selector}`);
                return { cards, selector };
            }
        } catch (e) {
            // Try next selector
            continue;
        }
    }

    log('No event cards found with any selector pattern', 'WARN');
    return { cards, selector: null };
}

/**
 * Extract event_id from URL string
 */
function extractEventId(url) {
    if (!url) return null;

    // Try multiple patterns
    const patterns = [
        /event_id=(\d+)/,
        /event-id=(\d+)/,
        /event\/(\d+)/,
        /events\/(\d+)/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return match[1];
        }
    }

    return null;
}

/**
 * Extract event data from a single event card element
 * Based on actual IWF HTML structure:
 * <a href="?event_id=661" class="card">
 *   <p class="title"><span class="text">Event Name</span></p>
 *   <p class="normal__text">Date</p>
 *   <p class="normal__text">City, <strong>COUNTRY</strong></p>
 * </a>
 */
async function extractEventData(cardHandle, endpointInfo) {
    try {
        const eventData = await cardHandle.evaluate((card, endpoint) => {
            // Extract event_id from href attribute
            const href = card.getAttribute('href') || '';

            // Extract event name from p.title span.text
            const titleElem = card.querySelector('p.title span.text');
            const eventName = titleElem ? titleElem.textContent.trim() : null;

            // Extract all p.normal__text elements (date and location)
            const normalTexts = card.querySelectorAll('p.normal__text');

            // First normal__text is the date
            const date = normalTexts[0] ? normalTexts[0].textContent.trim() : null;

            // Second normal__text contains location
            let location = null;
            let city = null;
            let country = null;

            if (normalTexts[1]) {
                const locationText = normalTexts[1].textContent.trim();
                const strongElem = normalTexts[1].querySelector('strong');

                if (strongElem) {
                    country = strongElem.textContent.trim();

                    // Extract city (everything before the strong tag)
                    const fullText = normalTexts[1].textContent.trim();
                    city = fullText.replace(country, '').replace(',', '').trim();
                }

                location = locationText;
            }

            return {
                event_name: eventName,
                date: date,
                location: location,
                location_city: city,
                location_country: country,
                url: href,
                endpoint: endpoint.endpoint,
                year: endpoint.year
            };
        }, endpointInfo);

        // Extract event_id from URL
        if (eventData.url) {
            eventData.event_id = extractEventId(eventData.url);

            // Build proper event detail URL using config
            if (eventData.event_id) {
                eventData.url = config.buildEventDetailURL(
                    eventData.event_id,
                    endpointInfo.year,
                    eventData.date
                );
            }
        }

        eventData.scraped_at = new Date().toISOString();

        return eventData;
    } catch (error) {
        log(`Error extracting event data: ${error.message}`, 'WARN');
        return null;
    }
}

/**
 * Check for and click next page button if it exists
 * Returns true if navigation successful, false if no more pages
 */
async function handlePagination() {
    try {
        // Try each pagination selector from config
        for (const selector of config.SELECTORS.nextPageButton) {
            try {
                const nextButton = await page.$(selector);
                if (nextButton) {
                    log(`Found next page button: ${selector}`);

                    // Check if button is disabled
                    const isDisabled = await nextButton.evaluate(btn => {
                        return btn.disabled ||
                               btn.classList.contains('disabled') ||
                               btn.classList.contains('v-pagination__next--disabled');
                    });

                    if (isDisabled) {
                        log('Next button is disabled, no more pages');
                        return false;
                    }

                    // Click and wait for navigation
                    await nextButton.click();
                    await new Promise(resolve => setTimeout(resolve, config.TIMING.NAVIGATION_DELAY_MS));
                    await page.waitForNetworkIdle({ timeout: config.TIMING.REQUEST_TIMEOUT_MS });

                    log('Navigated to next page successfully');
                    return true;
                }
            } catch (e) {
                // Try next selector
                continue;
            }
        }

        // No pagination found
        return false;
    } catch (error) {
        log(`Pagination error: ${error.message}`, 'WARN');
        return false;
    }
}

/**
 * Scrape events from a single endpoint
 */
async function scrapeEndpoint(endpointInfo) {
    log(`\n${'='.repeat(60)}`);
    log(`Scraping endpoint: ${endpointInfo.endpoint} - Year ${endpointInfo.year}`);
    log(`URL: ${endpointInfo.url}`);
    log(`${'='.repeat(60)}`);

    const events = [];
    let pageNum = 1;

    try {
        // Navigate to endpoint URL
        await retryOperation(async () => {
            await page.goto(endpointInfo.url, {
                waitUntil: 'networkidle0',
                timeout: config.TIMING.REQUEST_TIMEOUT_MS
            });
        }, config.RETRY.NETWORK_REQUESTS, `navigate to ${endpointInfo.url}`);

        log('Page loaded, waiting for dynamic content...');
        await new Promise(resolve => setTimeout(resolve, config.TIMING.PAGE_LOAD_DELAY_MS));

        // Process all pages
        while (true) {
            log(`Processing page ${pageNum}...`);

            // Find event cards
            const { cards, selector } = await findEventCards();

            if (cards.length === 0) {
                log('No event cards found on this page', 'WARN');
                break;
            }

            // Extract data from each card
            log(`Extracting data from ${cards.length} events...`);
            for (let i = 0; i < cards.length; i++) {
                const eventData = await extractEventData(cards[i], endpointInfo);

                if (eventData && eventData.event_id) {
                    events.push(eventData);
                    log(`  [${i + 1}/${cards.length}] ${eventData.event_name} (ID: ${eventData.event_id})`);
                } else {
                    log(`  [${i + 1}/${cards.length}] Failed to extract event data`, 'WARN');
                }
            }

            // Check for next page
            const hasNextPage = await handlePagination();
            if (!hasNextPage) {
                log('No more pages found');
                break;
            }

            pageNum++;
        }

        log(`Scraped ${events.length} events from ${endpointInfo.endpoint} - Year ${endpointInfo.year}`);

    } catch (error) {
        logError(error, {
            endpoint: endpointInfo.endpoint,
            year: endpointInfo.year,
            url: endpointInfo.url,
            page: pageNum
        });
    }

    return events;
}

// ============================================================================
// DATA STORAGE
// ============================================================================

/**
 * Save events to JSON file grouped by year
 */
function saveEventsToFile(events, year) {
    const outputFile = path.join(config.LOGGING.OUTPUT_DIR, `iwf_events_${year}.json`);

    const output = {
        metadata: {
            year: year,
            scraped_at: new Date().toISOString(),
            event_count: events.length,
            script_version: '1.0.0'
        },
        events: events
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    log(`Saved ${events.length} events to ${outputFile}`);
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main() {
    const startTime = Date.now();

    try {
        ensureDirectories();

        log('\n' + '='.repeat(80));
        log('IWF EVENT DISCOVERY - STARTED');
        log('='.repeat(80));

        // Parse command line arguments
        const options = parseArguments();
        log(`Scraping years: ${options.startYear} to ${options.endYear}`);

        // Get endpoints to scrape
        const endpointsToScrape = config.getEndpointsToScrape(options.startYear, options.endYear);
        log(`Found ${endpointsToScrape.length} endpoint(s) to scrape`);

        // Initialize browser
        await initBrowser();

        // Track all events by year
        const eventsByYear = {};

        // Scrape each endpoint
        for (let i = 0; i < endpointsToScrape.length; i++) {
            const endpointInfo = endpointsToScrape[i];

            log(`\nEndpoint ${i + 1}/${endpointsToScrape.length}`);

            const events = await scrapeEndpoint(endpointInfo);

            // Group events by year
            if (!eventsByYear[endpointInfo.year]) {
                eventsByYear[endpointInfo.year] = [];
            }
            eventsByYear[endpointInfo.year].push(...events);

            // Delay between endpoints
            if (i < endpointsToScrape.length - 1) {
                log(`Waiting ${config.TIMING.EVENT_DELAY_MS}ms before next endpoint...`);
                await new Promise(resolve => setTimeout(resolve, config.TIMING.EVENT_DELAY_MS));
            }
        }

        // Save events to files (one file per year)
        log('\n' + '='.repeat(80));
        log('SAVING RESULTS');
        log('='.repeat(80));

        for (const [year, events] of Object.entries(eventsByYear)) {
            // Remove duplicates by event_id
            const uniqueEvents = Array.from(
                new Map(events.map(e => [e.event_id, e])).values()
            );

            saveEventsToFile(uniqueEvents, year);
        }

        // Summary
        const totalEvents = Object.values(eventsByYear).reduce((sum, events) => sum + events.length, 0);
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

        log('\n' + '='.repeat(80));
        log('IWF EVENT DISCOVERY - COMPLETED');
        log('='.repeat(80));
        log(`Years processed: ${options.startYear} to ${options.endYear}`);
        log(`Endpoints scraped: ${endpointsToScrape.length}`);
        log(`Total events discovered: ${totalEvents}`);
        log(`Elapsed time: ${elapsedTime} seconds`);
        log('='.repeat(80));

    } catch (error) {
        logError(error, { stage: 'main' });
        log('Event discovery failed with error: ' + error.message, 'ERROR');
        process.exit(1);
    } finally {
        await closeBrowser();
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
    scrapeEndpoint,
    extractEventId,
    findEventCards,
    extractEventData
};
