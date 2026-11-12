/**
 * IWF SCRAPER CONFIGURATION
 *
 * Centralized configuration for International Weightlifting Federation (IWF)
 * results scraper system. Manages IWF-specific URLs, selectors, rate limiting,
 * batch processing, and database connection.
 *
 * @module iwf-config
 *
 * Environment Variables Required:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SECRET_KEY: Supabase service role key
 *
 * Environment Variables Optional (overrides):
 * - IWF_EVENT_DELAY: Milliseconds between events (default: 2000)
 * - IWF_WC_DELAY: Milliseconds between weight classes (default: 1000)
 * - IWF_PAGE_DELAY: Milliseconds after page load (default: 3000)
 * - IWF_REQUEST_TIMEOUT: Request timeout in milliseconds (default: 30000)
 * - IWF_EVENTS_BATCH: Events per batch (default: 10)
 * - IWF_RESULTS_BATCH: Results per database batch (default: 100)
 * - IWF_MAX_RETRIES: Maximum retry attempts (default: 3)
 * - IWF_START_YEAR: Starting year for scraping (default: 2024)
 * - IWF_END_YEAR: Ending year for scraping (default: 2025)
 *
 * IMPORTANT: Now uses shared database credentials (SUPABASE_URL, SUPABASE_SECRET_KEY)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// DATABASE CONNECTION (IWF-Specific)
// ============================================================================

/**
 * IWF Supabase client - connects to shared database
 * Uses SUPABASE_URL and SUPABASE_SECRET_KEY environment variables
 */
const supabaseIWF = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Verify database credentials are set
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.warn('⚠️  WARNING: Database credentials not found in environment variables');
    console.warn('   Required: SUPABASE_URL and SUPABASE_SECRET_KEY');
}

// ============================================================================
// BASE URLS & ENDPOINTS (Step 3.1)
// ============================================================================

/**
 * IWF splits results across FOUR different URL endpoints based on date ranges:
 *
 * 1. MODERN (August 2026 to present)
 *    - URL: https://iwf.sport/results/results-by-events/
 *    - Append: ?event_id=XXXX or ?event_year=YYYY
 *
 * 2. RESULTS_2025_2026 (July 2025 through July 2026)
 *    - URL: https://iwf.sport/results/results-by-events/results-by-events-2025-2026/
 *    - Append: ?event_id=XXXX or ?event_year=YYYY
 *
 * 3. MID_RANGE (November 2018 through May 2025)
 *    - URL: https://iwf.sport/results/results-by-events/results-by-events-2018-2025/
 *    - Append: ?event_id=XXXX or ?event_year=YYYY
 *
 * 4. HISTORICAL (1998 through October 2018)
 *    - URL: https://iwf.sport/results/results-by-events/results-by-events-upto2018/
 *    - Append: ?event_id=XXXX or ?event_year=YYYY
 */
const URLS = {
    // Tier 1: Modern results (August 2026 onwards)
    MODERN: {
        BASE: 'https://iwf.sport/results/results-by-events/',
        EVENT_LISTING: 'https://iwf.sport/results/results-by-events/?event_year=',
        EVENT_DETAIL: 'https://iwf.sport/results/results-by-events/?event_id=',
        DEFAULT_YEAR: 2026,
        AVAILABLE_YEARS: [2026],
    },

    // Tier 2: July 2025 through July 2026
    RESULTS_2025_2026: {
        BASE: 'https://iwf.sport/results/results-by-events/results-by-events-2025-2026/',
        EVENT_LISTING: 'https://iwf.sport/results/results-by-events/results-by-events-2025-2026/?event_year=',
        EVENT_DETAIL: 'https://iwf.sport/results/results-by-events/results-by-events-2025-2026/?event_id=',
        START_YEAR: 2025,
        END_YEAR: 2026,
    },

    // Tier 3: Mid-range results (2018 Nov through 2025 May)
    MID_RANGE: {
        BASE: 'https://iwf.sport/results/results-by-events/results-by-events-2018-2025/',
        EVENT_LISTING: 'https://iwf.sport/results/results-by-events/results-by-events-2018-2025/?event_year=',
        EVENT_DETAIL: 'https://iwf.sport/results/results-by-events/results-by-events-2018-2025/?event_id=',
        START_YEAR: 2018,
        END_YEAR: 2025,
    },

    // Tier 4: Historical results (1998 through 2018 Oct)
    HISTORICAL: {
        BASE: 'https://iwf.sport/results/results-by-events/results-by-events-upto2018/',
        EVENT_LISTING: 'https://iwf.sport/results/results-by-events/results-by-events-upto2018/?event_year=',
        EVENT_DETAIL: 'https://iwf.sport/results/results-by-events/results-by-events-upto2018/?event_id=',
        START_YEAR: 1998,
        END_YEAR: 2018,
    },

    // Date split points
    CUTOFF_DATES: {
        // 2026: Split at August 1st
        YEAR_2026_SPLIT: '2026-08-01',
        // 2025: Split at July 1st
        YEAR_2025_SPLIT: '2025-07-01',
        // 2018: Split at November 1st
        YEAR_2018_SPLIT: '2018-11-01',
    },
};

const MONTH_NAME_MAP = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
};

/**
 * Parse year and 1-indexed month from date string or numeric year
 *
 * @param {string|number} dateOrYear - Year integer, ISO string, or human date string
 * @returns {{ year: number|null, month: number|null }}
 */
function parseDate(dateOrYear) {
    if (!dateOrYear) {
        return { year: null, month: null };
    }

    if (typeof dateOrYear === 'number') {
        return { year: dateOrYear, month: null };
    }

    const str = String(dateOrYear).trim();
    if (/^\d{4}$/.test(str)) {
        return { year: parseInt(str, 10), month: null };
    }

    const isoMatch = str.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
    if (isoMatch) {
        return {
            year: parseInt(isoMatch[1], 10),
            month: parseInt(isoMatch[2], 10)
        };
    }

    const yearMatch = str.match(/\b(19\d{2}|20\d{2})\b/);
    const monthMatch = str.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);

    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    const month = monthMatch ? MONTH_NAME_MAP[monthMatch[1].toLowerCase()] : null;

    if (year !== null) {
        return { year, month };
    }

    const fallbackDate = new Date(str);
    if (!isNaN(fallbackDate.getTime())) {
        return {
            year: fallbackDate.getUTCFullYear(),
            month: fallbackDate.getUTCMonth() + 1
        };
    }

    return { year: null, month: null };
}

/**
 * Canonical 4-Tier IWF Results URL Resolver
 *
 * @param {string|number} eventId - IWF Event ID
 * @param {string|number} dateOrYear - Date string or year
 * @returns {string} Fully qualified canonical event URL
 */
function getIwfMeetUrl(eventId, dateOrYear) {
    const { year, month } = parseDate(dateOrYear);

    // 1. August 2026 - Current
    if (year > 2026 || (year === 2026 && month && month >= 8)) {
        return `https://iwf.sport/results/results-by-events/?event_id=${eventId}`;
    }
    // 2. July 2025 - July 2026
    if (year === 2026 || (year === 2025 && (month === null || month >= 7))) {
        return `https://iwf.sport/results/results-by-events/results-by-events-2025-2026/?event_id=${eventId}`;
    }
    // 3. Nov 2018 - May 2025
    if ((year === 2025 && month && month <= 6) || (year >= 2019 && year <= 2024) || (year === 2018 && month && month >= 11)) {
        return `https://iwf.sport/results/results-by-events/results-by-events-2018-2025/?event_id=${eventId}`;
    }
    // 4. 1998 - Oct 2018
    return `https://iwf.sport/results/results-by-events/results-by-events-upto2018/?event_id=${eventId}`;
}

// ============================================================================
// CSS SELECTORS (Step 3.1)
// ============================================================================

const SELECTORS = {
    // Year dropdown selector (MODERN endpoint only)
    yearDropdown: 'select[name="event_year"]',

    // Event discovery selectors
    eventCard: '.event-card, .event-item, div[class*="event"]',
    eventTitle: 'h2, h3, .event-title, strong',
    eventDate: '.event-date, span[class*="date"]',
    eventLocation: '.event-location, span[class*="location"]',
    moreInfoLink: 'a[href*="event_id"], button[class*="more-info"]',

    // Event detail page navigation - CRITICAL: MUST click these to load athlete data
    // The IWF website has multiple result views (Total, Snatch/C&J) controlled by filter buttons.
    // To extract athlete data with snatch/clean&jerk attempts, you MUST first click the appropriate filter.
    // ONLY after clicking will the athlete card data be visible in the DOM.
    //
    // Men's results: Click div.single__event__filter[data-target="men_snatchjerk"]
    // Women's results: Click div.single__event__filter[data-target="women_snatchjerk"]
    // Then wait for content to load before parsing athlete cards.
    menTab: [
        'div.single__event__filter[data-target="men_snatchjerk"]',  // Most reliable selector
        '#results_mens_snatch',                                      // By ID fallback
        'div[data-target="men_snatchjerk"]'                          // Generic fallback
    ],

    womenTab: [
        'div.single__event__filter[data-target="women_snatchjerk"]',  // Most reliable selector
        '#results_womens_snatch',                                      // By ID fallback
        'div[data-target="women_snatchjerk"]'                          // Generic fallback
    ],

    // Results display selectors
    // IWF uses div.card elements (NOT HTML tables) to display athlete results
    // Each weight class has athletes displayed as card elements with hierarchical divs
    resultsContainer: 'div.results, div.results__container, div[id*="result__container"]',
    weightClassHeader: 'h2, h3',  // Weight class headers like "55 kg Men"
    athleteCard: 'div.card:not(.card__legend)',  // Individual athlete result cards (excludes legend/header card)

    // DEPRECATED - IWF doesn't use tables anymore
    // resultsTable: 'table, .results-table, div[class*="results"]',
    // athleteRow: 'tr, .athlete-row, div[class*="athlete"]',

    // Pagination selectors
    nextPageButton: [
        '.v-pagination__next:not(.v-pagination__next--disabled)',
        '.pagination .next:not(.disabled)',
        'button[aria-label*="next" i]:not([disabled])',
        '.page-navigation .next:not(.disabled)'
    ],
};

// ============================================================================
// YEAR RANGES (Step 3.2)
// ============================================================================

const YEARS = {
    // Default years to scrape (focus on recent data)
    DEFAULT_START: 2024,
    DEFAULT_END: 2025,

    // Data availability by endpoint
    MODERN_START: 2025,           // June 1, 2025 onwards
    MODERN_END: 2027,              // Current default year on MODERN endpoint

    MID_RANGE_START: 2018,        // November 1, 2018 onwards
    MID_RANGE_END: 2025,          // Through May 31, 2025

    HISTORICAL_START: 1998,       // Earliest available data
    HISTORICAL_END: 2018,         // Through October 31, 2018

    // Overall availability (all endpoints combined)
    EARLIEST_AVAILABLE: 1998,
    LATEST_AVAILABLE: new Date().getFullYear() + 2, // IWF has future years

    // Allow override via environment variable
    START: parseInt(process.env.IWF_START_YEAR) || 2024,
    END: parseInt(process.env.IWF_END_YEAR) || 2025,
};

// ============================================================================
// EVENT TYPE FILTERS (Step 3.3)
// ============================================================================

const EVENT_TYPES = {
    WORLD_CHAMPIONSHIPS: 'World Championships',
    CONTINENTAL_CHAMPIONSHIPS: 'Continental Championships',
    GRAND_PRIX: 'Grand Prix',
    OLYMPIC_GAMES: 'Olympic Games',
    JUNIOR: 'Junior',
    YOUTH: 'Youth',

    // All event types for filtering
    ALL: [
        'World Championships',
        'Continental Championships',
        'Grand Prix',
        'Olympic Games',
        'Junior',
        'Youth'
    ]
};

// ============================================================================
// RATE LIMITING SETTINGS (Step 3.4)
// ============================================================================

const TIMING = {
    // Delay between processing events (5 seconds - increased to allow CDN cache expiry and prevent phantom records)
    EVENT_DELAY_MS: parseInt(process.env.IWF_EVENT_DELAY) || 5000,

    // Delay between weight classes (1 second)
    WEIGHT_CLASS_DELAY_MS: parseInt(process.env.IWF_WC_DELAY) || 1000,

    // Delay after page load for dynamic content (3 seconds)
    PAGE_LOAD_DELAY_MS: parseInt(process.env.IWF_PAGE_DELAY) || 3000,

    // Request timeout (30 seconds)
    REQUEST_TIMEOUT_MS: parseInt(process.env.IWF_REQUEST_TIMEOUT) || 30000,

    // Delay between page navigation (2 seconds)
    NAVIGATION_DELAY_MS: 2000,
};

// ============================================================================
// BATCH SIZES (Step 3.5)
// ============================================================================

const BATCH = {
    // Number of events to process in one batch
    EVENTS_PER_BATCH: parseInt(process.env.IWF_EVENTS_BATCH) || 10,

    // Number of results to insert in one database batch
    RESULTS_PER_BATCH: parseInt(process.env.IWF_RESULTS_BATCH) || 100,

    // Maximum retry attempts for failed operations
    MAX_RETRIES: parseInt(process.env.IWF_MAX_RETRIES) || 3,
};

// ============================================================================
// RETRY LIMITS (Step 3.6)
// ============================================================================

const RETRY = {
    // Network request retries (navigation failures, timeouts)
    NETWORK_REQUESTS: 3,

    // Parse error retries (malformed data, missing elements)
    PARSE_ERRORS: 1,

    // Database operation retries (connection issues, conflicts)
    DATABASE_OPERATIONS: 2,

    // Exponential backoff multiplier
    BACKOFF_MULTIPLIER: 2,

    // Initial backoff delay (ms)
    INITIAL_BACKOFF_MS: 1000,
};

// ============================================================================
// LOG FILE PATHS (Step 3.7)
// ============================================================================

const LOGGING = {
    // Directory paths
    LOGS_DIR: './logs',
    ERRORS_DIR: './errors',
    OUTPUT_DIR: './output',

    // Main scraper log
    MAIN_LOG: './logs/iwf-scraper.log',

    // Error log (JSON format)
    ERROR_LOG: './errors/iwf-scraper-errors.json',

    // Module-specific logs
    EVENT_DISCOVERY_LOG: './logs/iwf-event-discovery.log',
    RESULTS_SCRAPER_LOG: './logs/iwf-results-scraper.log',
    DATA_PARSER_LOG: './logs/iwf-data-parser.log',
    ANALYTICS_LOG: './logs/iwf-analytics.log',
    IMPORTER_LOG: './logs/iwf-importer.log',

    // Log levels
    LEVELS: {
        ERROR: 'ERROR',
        WARN: 'WARN',
        INFO: 'INFO',
        DEBUG: 'DEBUG'
    },
};

// ============================================================================
// PUPPETEER BROWSER CONFIGURATION
// ============================================================================

const BROWSER = {
    // Launch options: Under xvfb on Linux CI, run as full GUI window (headless: false); otherwise headless
    headless: process.env.IWF_HEADLESS !== undefined
        ? process.env.IWF_HEADLESS === 'true'
        : (process.env.CI && process.platform === 'linux' ? false : true),

    // Browser arguments (stealth configuration avoiding automation fingerprint flags)
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080',
        '--start-maximized'
    ],

    // User agent matching modern desktop Chrome
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',

    // Viewport matching standard full HD desktop
    viewport: {
        width: 1920,
        height: 1080
    },
};

// ============================================================================
// WEIGHT CLASS DEFINITIONS
// ============================================================================

const WEIGHT_CLASSES = {
    // Men's weight classes (2024+ IWF rules)
    MEN: ['61 kg', '73 kg', '89 kg', '102 kg', '+102 kg'],

    // Women's weight classes (2024+ IWF rules)
    WOMEN: ['49 kg', '55 kg', '59 kg', '64 kg', '71 kg', '76 kg', '81 kg', '+81 kg'],

    // Legacy weight classes (may appear in historical data)
    LEGACY_MEN: ['56 kg', '62 kg', '69 kg', '77 kg', '85 kg', '94 kg', '105 kg', '+105 kg'],
    LEGACY_WOMEN: ['48 kg', '53 kg', '58 kg', '63 kg', '69 kg', '75 kg', '90 kg', '+90 kg'],
};

// ============================================================================
// DATA VALIDATION RULES
// ============================================================================

const VALIDATION = {
    // Valid birth year range
    MIN_BIRTH_YEAR: 1900,
    MAX_BIRTH_YEAR: new Date().getFullYear() - 8, // Minimum age 8

    // Valid body weight range (kg)
    MIN_BODY_WEIGHT: 30,
    MAX_BODY_WEIGHT: 200,

    // Valid lift weight range (kg)
    MIN_LIFT_WEIGHT: 20,
    MAX_LIFT_WEIGHT: 500,

    // Valid age range
    MIN_AGE: 8,
    MAX_AGE: 100,
};

// ============================================================================
// EXPORTS (Step 3.8)
// ============================================================================

module.exports = {
    // Database connection (IWF-specific)
    supabaseIWF,

    // Configuration objects
    URLS,
    SELECTORS,
    YEARS,
    EVENT_TYPES,
    TIMING,
    BATCH,
    RETRY,
    LOGGING,
    BROWSER,
    WEIGHT_CLASSES,
    VALIDATION,

    /**
     * Determine which endpoint to use based on year and optional date
     *
     * Implements canonical 4-tier chronological era resolution:
     * 1. MODERN: August 2026 - Current
     * 2. RESULTS_2025_2026: July 2025 - July 2026
     * 3. MID_RANGE: November 2018 - May 2025
     * 4. HISTORICAL: 1998 - October 2018
     *
     * @param {number|string} year - Year to check
     * @param {string} eventDate - Optional event date (e.g. 'Jul 23, 2026', '2026-07-23')
     * @returns {string} - 'MODERN', 'RESULTS_2025_2026', 'MID_RANGE', or 'HISTORICAL'
     */
    determineEndpoint: (year, eventDate = null) => {
        const { year: parsedYear, month } = parseDate(eventDate || year);
        const resolvedYear = parsedYear || (typeof year === 'number' ? year : parseInt(year, 10)) || null;

        // 1. August 2026 - Current
        if (resolvedYear > 2026 || (resolvedYear === 2026 && month && month >= 8)) {
            return 'MODERN';
        }
        // 2. July 2025 - July 2026
        if (resolvedYear === 2026 || (resolvedYear === 2025 && (month === null || month >= 7))) {
            return 'RESULTS_2025_2026';
        }
        // 3. Nov 2018 - May 2025
        if ((resolvedYear === 2025 && month && month <= 6) || (resolvedYear >= 2019 && resolvedYear <= 2024) || (resolvedYear === 2018 && month && month >= 11)) {
            return 'MID_RANGE';
        }
        // 4. 1998 - Oct 2018
        return 'HISTORICAL';
    },

    /**
     * Build event listing URL for specific year
     *
     * Automatically selects correct endpoint based on year and optional date.
     *
     * @param {number} year - Year to scrape
     * @param {string} eventDate - Optional event date for precise endpoint selection
     * @returns {string} - Complete URL for event listing page
     */
    buildEventListingURL: (year, eventDate = null) => {
        const endpoint = module.exports.determineEndpoint(year, eventDate);

        switch (endpoint) {
            case 'MODERN':
                return `${URLS.MODERN.EVENT_LISTING}${year}`;
            case 'RESULTS_2025_2026':
                return `${URLS.RESULTS_2025_2026.EVENT_LISTING}${year}`;
            case 'MID_RANGE':
                return `${URLS.MID_RANGE.EVENT_LISTING}${year}`;
            case 'HISTORICAL':
                return `${URLS.HISTORICAL.EVENT_LISTING}${year}`;
            default:
                return `${URLS.MID_RANGE.EVENT_LISTING}${year}`;
        }
    },

    /**
     * Build event detail URL for specific event ID
     *
     * Automatically selects correct endpoint based on year and optional date.
     * If no year or date provided, defaults to MODERN endpoint.
     *
     * @param {string} eventId - Event ID to view
     * @param {number} year - Year of event (to determine endpoint)
     * @param {string} eventDate - Optional event date for precise endpoint selection
     * @returns {string} - Complete URL for event detail page
     */
    buildEventDetailURL: (eventId, year = null, eventDate = null) => {
        if (!year && !eventDate) {
            return `${URLS.MODERN.EVENT_DETAIL}${eventId}`;
        }
        return getIwfMeetUrl(eventId, eventDate || year);
    },

    /**
     * Build event detail URL from known endpoint (no recalculation needed)
     *
     * @param {string} eventId - Event ID to view
     * @param {string} endpoint - Endpoint type ('MODERN', 'RESULTS_2025_2026', 'MID_RANGE', or 'HISTORICAL')
     * @returns {string} - Complete URL for event detail page
     */
    buildEventDetailURLFromEndpoint: (eventId, endpoint) => {
        switch (endpoint) {
            case 'MODERN':
                return `${URLS.MODERN.EVENT_DETAIL}${eventId}`;
            case 'RESULTS_2025_2026':
                return `${URLS.RESULTS_2025_2026.EVENT_DETAIL}${eventId}`;
            case 'MID_RANGE':
                return `${URLS.MID_RANGE.EVENT_DETAIL}${eventId}`;
            case 'HISTORICAL':
                return `${URLS.HISTORICAL.EVENT_DETAIL}${eventId}`;
            default:
                return `${URLS.MODERN.EVENT_DETAIL}${eventId}`;
        }
    },

    /**
     * Get year range for scraping (handles split years)
     *
     * Returns array of year objects with endpoint information and URLs.
     * Adds notes for split years (2026, 2025, 2018) that span multiple endpoints.
     *
     * @param {number} startYear - Starting year
     * @param {number} endYear - Ending year
     * @returns {Array} - Array of year objects with endpoint info
     */
    getYearRange: (startYear, endYear) => {
        const start = startYear || YEARS.START;
        const end = endYear || YEARS.END;
        const years = [];

        for (let year = start; year <= end; year++) {
            const endpoint = module.exports.determineEndpoint(year);

            years.push({
                year,
                endpoint,
                url: module.exports.buildEventListingURL(year)
            });

            // Handle split years
            if (year === 2026) {
                years[years.length - 1].note = 'Split year: Events through July in RESULTS_2025_2026, August+ in MODERN';
            } else if (year === 2025) {
                years[years.length - 1].note = 'Split year: Events through June in MID_RANGE, July+ in RESULTS_2025_2026';
            } else if (year === 2018) {
                years[years.length - 1].note = 'Split year: Events before Nov 1 in HISTORICAL, Nov 1+ in MID_RANGE';
            }
        }

        return years;
    },

    /**
     * Get all endpoints that need to be scraped for a given year range
     *
     * Handles split years (2026, 2025, 2018) by including BOTH endpoints for those years.
     * Returns array of endpoint objects ready for scraping, including date ranges.
     *
     * @param {number} startYear - Starting year
     * @param {number} endYear - Ending year
     * @returns {Array} - Array of {endpoint, year, url, dateRange} objects to scrape
     */
    getEndpointsToScrape: (startYear, endYear) => {
        const start = startYear || YEARS.START;
        const end = endYear || YEARS.END;
        const endpointsToScrape = [];

        for (let year = start; year <= end; year++) {
            // For split years, scrape both relevant endpoints
            if (year === 2026) {
                endpointsToScrape.push({
                    endpoint: 'RESULTS_2025_2026',
                    year: 2026,
                    url: URLS.RESULTS_2025_2026.EVENT_LISTING + '2026',
                    dateRange: '2026-01-01 to 2026-07-31',
                });
                endpointsToScrape.push({
                    endpoint: 'MODERN',
                    year: 2026,
                    url: URLS.MODERN.EVENT_LISTING + '2026',
                    dateRange: '2026-08-01 to 2026-12-31',
                });
            } else if (year === 2025) {
                endpointsToScrape.push({
                    endpoint: 'MID_RANGE',
                    year: 2025,
                    url: URLS.MID_RANGE.EVENT_LISTING + '2025',
                    dateRange: '2025-01-01 to 2025-06-30',
                });
                endpointsToScrape.push({
                    endpoint: 'RESULTS_2025_2026',
                    year: 2025,
                    url: URLS.RESULTS_2025_2026.EVENT_LISTING + '2025',
                    dateRange: '2025-07-01 to 2025-12-31',
                });
            } else if (year === 2018) {
                endpointsToScrape.push({
                    endpoint: 'HISTORICAL',
                    year: 2018,
                    url: URLS.HISTORICAL.EVENT_LISTING + '2018',
                    dateRange: '2018-01-01 to 2018-10-31',
                });
                endpointsToScrape.push({
                    endpoint: 'MID_RANGE',
                    year: 2018,
                    url: URLS.MID_RANGE.EVENT_LISTING + '2018',
                    dateRange: '2018-11-01 to 2018-12-31',
                });
            } else {
                const endpoint = module.exports.determineEndpoint(year);
                endpointsToScrape.push({
                    endpoint,
                    year,
                    url: module.exports.buildEventListingURL(year),
                    dateRange: `${year}-01-01 to ${year}-12-31`,
                });
            }
        }

        return endpointsToScrape;
    },

    // 4-Tier URL standard helpers
    getIwfMeetUrl,
    parseDate,
};
