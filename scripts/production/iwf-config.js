/**
 * IWF SCRAPER CONFIGURATION
 *
 * Centralized configuration for International Weightlifting Federation (IWF)
 * results scraper system. Manages IWF-specific URLs, selectors, rate limiting,
 * batch processing, and database connection.
 *
 * IMPORTANT: Uses separate IWF database credentials (SUPABASE_IWF_URL, SUPABASE_IWF_SECRET_KEY)
 * NOT the regular USAW database credentials (SUPABASE_URL, SUPABASE_SECRET_KEY)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ============================================================================
// DATABASE CONNECTION (IWF-Specific)
// ============================================================================

/**
 * IWF Supabase client - connects to separate IWF database
 * Uses SUPABASE_IWF_URL and SUPABASE_IWF_SECRET_KEY environment variables
 */
const supabaseIWF = createClient(
    process.env.SUPABASE_IWF_URL,
    process.env.SUPABASE_IWF_SECRET_KEY
);

// Verify IWF credentials are set
if (!process.env.SUPABASE_IWF_URL || !process.env.SUPABASE_IWF_SECRET_KEY) {
    console.warn('⚠️  WARNING: IWF database credentials not found in environment variables');
    console.warn('   Required: SUPABASE_IWF_URL and SUPABASE_IWF_SECRET_KEY');
    console.warn('   Note: These are separate from USAW database credentials');
}

// ============================================================================
// BASE URLS & ENDPOINTS (Step 3.1)
// ============================================================================

/**
 * IWF splits results across THREE different URL endpoints based on date ranges:
 *
 * 1. MODERN (2025 June 1+ to present)
 *    - URL: https://iwf.sport/results/results-by-events/
 *    - Default year: 2027
 *    - Uses dropdown: <select name="event_year">
 *
 * 2. MID_RANGE (2018 Nov to 2025 May 31)
 *    - URL: https://iwf.sport/results/results-by-events/results-by-events-2018-2025/
 *    - Append: ?event_year=YYYY
 *
 * 3. HISTORICAL (1998 to 2018 Oct)
 *    - URL: https://iwf.sport/results/results-by-events/results-by-events-upto2018/
 *    - Append: ?event_year=YYYY
 */
const URLS = {
    // Modern results (2025 June 1+ onwards)
    MODERN: {
        BASE: 'https://iwf.sport/results/results-by-events/',
        EVENT_LISTING: 'https://iwf.sport/results/results-by-events/?event_year=',
        EVENT_DETAIL: 'https://iwf.sport/results/results-by-events/?event_id=',
        DEFAULT_YEAR: 2027,
        AVAILABLE_YEARS: [2027, 2026, 2025], // 2025 = June 1st onwards only
    },

    // Mid-range results (2018 Nov through 2025 May)
    MID_RANGE: {
        BASE: 'https://iwf.sport/results/results-by-events/results-by-events-2018-2025/',
        EVENT_LISTING: 'https://iwf.sport/results/results-by-events/results-by-events-2018-2025/?event_year=',
        EVENT_DETAIL: 'https://iwf.sport/results/results-by-events/results-by-events-2018-2025/?event_id=',
        START_YEAR: 2018,
        END_YEAR: 2025,
    },

    // Historical results (1998 through 2018 Oct)
    HISTORICAL: {
        BASE: 'https://iwf.sport/results/results-by-events/results-by-events-upto2018/',
        EVENT_LISTING: 'https://iwf.sport/results/results-by-events/results-by-events-upto2018/?event_year=',
        EVENT_DETAIL: 'https://iwf.sport/results/results-by-events/results-by-events-upto2018/?event_id=',
        START_YEAR: 1998,
        END_YEAR: 2018,
    },

    // Date split points
    CUTOFF_DATES: {
        // 2025: Split at June 1st
        // Events before June 1, 2025 → MID_RANGE
        // Events June 1, 2025 onwards → MODERN
        YEAR_2025_SPLIT: '2025-06-01',

        // 2018: Split at November 1st
        // Events before November 1, 2018 → HISTORICAL
        // Events November 1, 2018 onwards → MID_RANGE
        YEAR_2018_SPLIT: '2018-11-01',
    },
};

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

    // Event detail page navigation
    menTab: [
        '#results_mens_snatch',
        '[data-target="men_snatchjerk"]',
        'div.single__event__filter:has-text("Men\'s Snatch")',
        'button:has-text("Men\'s Snatch, Clean & Jerk")'
    ],

    womenTab: [
        '#results_womens_snatch',
        '[data-target="women_snatchjerk"]',
        'div.single__event__filter:has-text("Women\'s Snatch")',
        'button:has-text("Women\'s Snatch, Clean & Jerk")'
    ],

    // Results table selectors
    resultsTable: 'table, .results-table, div[class*="results"]',
    weightClassHeader: 'h2, h3, div.weight-class-header, .category-header',
    athleteRow: 'tr, .athlete-row, div[class*="athlete"]',

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
    // Delay between processing events (2 seconds)
    EVENT_DELAY_MS: parseInt(process.env.IWF_EVENT_DELAY) || 2000,

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
    // Launch options
    headless: true,

    // Browser arguments (matches existing scrapers)
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
    ],

    // User agent
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',

    // Viewport (use wide desktop to get individual attempts, not mobile responsive view)
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
     * Determine which endpoint to use based on year
     * @param {number} year - Year to check
     * @param {string} eventDate - Optional event date (YYYY-MM-DD) for precise split handling
     * @returns {string} - 'MODERN', 'MID_RANGE', or 'HISTORICAL'
     */
    determineEndpoint: (year, eventDate = null) => {
        // Handle specific date splits for 2025 and 2018
        if (year === 2025 && eventDate) {
            return eventDate >= URLS.CUTOFF_DATES.YEAR_2025_SPLIT ? 'MODERN' : 'MID_RANGE';
        } else if (year === 2025 && !eventDate) {
            // Default to MID_RANGE for 2025 if no specific date (safer assumption)
            return 'MID_RANGE';
        }

        if (year === 2018 && eventDate) {
            return eventDate >= URLS.CUTOFF_DATES.YEAR_2018_SPLIT ? 'MID_RANGE' : 'HISTORICAL';
        } else if (year === 2018 && !eventDate) {
            // Default to MID_RANGE for 2018 if no specific date (safer assumption)
            return 'MID_RANGE';
        }

        // Standard year-based logic
        if (year >= 2026) {
            return 'MODERN';
        } else if (year >= 2019 && year <= 2024) {
            return 'MID_RANGE';
        } else if (year >= URLS.HISTORICAL.START_YEAR && year <= 2017) {
            return 'HISTORICAL';
        }

        // Fallback to MID_RANGE for unknown cases
        return 'MID_RANGE';
    },

    /**
     * Build event listing URL for specific year
     * @param {number} year - Year to scrape
     * @param {string} eventDate - Optional event date for precise endpoint selection
     * @returns {string} - Complete URL for event listing page
     */
    buildEventListingURL: (year, eventDate = null) => {
        const endpoint = module.exports.determineEndpoint(year, eventDate);

        switch (endpoint) {
            case 'MODERN':
                return `${URLS.MODERN.EVENT_LISTING}${year}`;
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
     * @param {string} eventId - Event ID to view
     * @param {number} year - Year of event (to determine endpoint)
     * @param {string} eventDate - Optional event date for precise endpoint selection
     * @returns {string} - Complete URL for event detail page
     */
    buildEventDetailURL: (eventId, year = null, eventDate = null) => {
        // If no year provided, default to MODERN endpoint (most recent)
        if (!year) {
            return `${URLS.MODERN.EVENT_DETAIL}${eventId}`;
        }

        const endpoint = module.exports.determineEndpoint(year, eventDate);

        switch (endpoint) {
            case 'MODERN':
                return `${URLS.MODERN.EVENT_DETAIL}${eventId}`;
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

            // Handle split years: For 2025 and 2018, we might need both endpoints
            if (year === 2025) {
                // Add note about split year
                years[years.length - 1].note = 'Split year: Events before June 1 in MID_RANGE, June 1+ in MODERN';
            } else if (year === 2018) {
                years[years.length - 1].note = 'Split year: Events before Nov 1 in HISTORICAL, Nov 1+ in MID_RANGE';
            }
        }

        return years;
    },

    /**
     * Get all endpoints that need to be scraped for a given year range
     * Handles split years (2025, 2018) by including both endpoints
     * @param {number} startYear - Starting year
     * @param {number} endYear - Ending year
     * @returns {Array} - Array of {endpoint, year, url} objects to scrape
     */
    getEndpointsToScrape: (startYear, endYear) => {
        const start = startYear || YEARS.START;
        const end = endYear || YEARS.END;
        const endpointsToScrape = [];

        for (let year = start; year <= end; year++) {
            // For split years, we need to scrape BOTH endpoints
            if (year === 2025) {
                // 2025 appears in both MID_RANGE (Jan-May) and MODERN (Jun-Dec)
                endpointsToScrape.push({
                    endpoint: 'MID_RANGE',
                    year: 2025,
                    url: URLS.MID_RANGE.EVENT_LISTING + '2025',
                    dateRange: '2025-01-01 to 2025-05-31',
                });
                endpointsToScrape.push({
                    endpoint: 'MODERN',
                    year: 2025,
                    url: URLS.MODERN.EVENT_LISTING + '2025',
                    dateRange: '2025-06-01 to 2025-12-31',
                });
            } else if (year === 2018) {
                // 2018 appears in both HISTORICAL (Jan-Oct) and MID_RANGE (Nov-Dec)
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
                // Normal years - single endpoint
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
};
