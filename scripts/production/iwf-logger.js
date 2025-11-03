/**
 * IWF LOGGER - Centralized Logging System
 *
 * @module iwf-logger
 *
 * Provides consistent logging and error handling across all IWF scraper modules.
 *
 * Features:
 * - Writes timestamped logs to both console and log files
 * - Module-specific log files for targeted debugging
 * - Centralized JSON error file for all failures
 * - Retry logic with exponential backoff for network failures
 * - Automatic directory creation for logs, errors, output
 *
 * Usage:
 * ```javascript
 * const { log, logError, retryOperation } = require('./iwf-logger');
 *
 * log('Processing started');
 * logError(error, { event_id: 661, stage: 'scraping' });
 * await retryOperation(() => page.goto(url), 3, 'navigate to event page');
 * ```
 */

const fs = require('fs');
const path = require('path');
const config = require('./iwf-config');

// ============================================================================
// DIRECTORY INITIALIZATION
// ============================================================================

/**
 * Ensure log and error directories exist
 *
 * Creates logs/, errors/, and output/ directories if they don't exist.
 * Called automatically by log() and logError() functions.
 *
 * @example
 * ensureDirectories();  // Creates logs/, errors/, output/ if needed
 */
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

// ============================================================================
// LOGGING FUNCTIONS
// ============================================================================

/**
 * Write log message to both console and log file
 *
 * Automatically prepends timestamp and log level to messages.
 * Ensures log directories exist before writing.
 *
 * @param {string} message - Log message
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG). Default: 'INFO'
 * @param {string} logFilePath - Optional custom log file path (defaults to main log)
 *
 * @example
 * log('Event discovery started');
 * log('Retrying operation', 'WARN');
 * log('Custom module log', 'INFO', './logs/custom-module.log');
 */
function log(message, level = 'INFO', logFilePath = null) {
    ensureDirectories();

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    const finalLogPath = logFilePath || config.LOGGING.MAIN_LOG;

    // Console output
    console.log(logMessage);

    // File output
    fs.appendFileSync(finalLogPath, logMessage + '\n');
}

/**
 * Log error to console and centralized error JSON file with context
 *
 * Appends error to errors/iwf-scraper-errors.json with full stack trace
 * and contextual information for debugging. Handles corrupted JSON gracefully.
 *
 * @param {Error} error - Error object
 * @param {object} context - Contextual information about the error
 *
 * @example
 * try {
 *   await page.goto(url);
 * } catch (error) {
 *   logError(error, { event_id: 661, url: url, stage: 'navigation' });
 * }
 */
function logError(error, context = {}) {
    ensureDirectories();

    const timestamp = new Date().toISOString();
    const errorObject = {
        timestamp,
        error_message: error.message,
        stack_trace: error.stack,
        context
    };

    // Log to console
    console.error(`[${timestamp}] [ERROR]`, errorObject);

    // Append to centralized JSON error file
    const errorFile = config.LOGGING.ERROR_LOG;
    let errors = [];

    if (fs.existsSync(errorFile)) {
        try {
            const content = fs.readFileSync(errorFile, 'utf8');
            if (content.trim()) {
                errors = JSON.parse(content);
            }
        } catch (e) {
            // If JSON is corrupted, start fresh
            errors = [];
        }
    }

    errors.push(errorObject);
    fs.writeFileSync(errorFile, JSON.stringify(errors, null, 2));
}

// ============================================================================
// RETRY LOGIC WITH EXPONENTIAL BACKOFF
// ============================================================================

/**
 * Retry operation with exponential backoff for network failures
 *
 * Only retries network-related errors (timeouts, connection resets, etc.).
 * Non-network errors fail immediately. Uses exponential backoff between retries.
 *
 * @param {Function} operation - Async function to retry
 * @param {number} maxRetries - Maximum number of attempts (default from config: 3)
 * @param {string} context - Description of operation for logging
 * @returns {Promise} - Result of successful operation
 * @throws {Error} - Original error if all retries fail or non-network error
 *
 * @example
 * // Retry navigation with 3 attempts
 * await retryOperation(
 *   async () => await page.goto(url, { waitUntil: 'networkidle0' }),
 *   3,
 *   'navigate to event page'
 * );
 *
 * // Retry database operation with custom retry count
 * await retryOperation(
 *   async () => await supabase.from('events').insert(data),
 *   5,
 *   'insert event data'
 * );
 */
async function retryOperation(operation, maxRetries = config.RETRY.NETWORK_REQUESTS, context = '') {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            
            log(`Attempt ${attempt}/${maxRetries} failed for ${context}: ${error.message}`, 'WARN');

            if (attempt < maxRetries) {
                // Only retry on network-related errors
                const isNetworkError = 
                    error.code === 'ECONNRESET' ||
                    error.code === 'ECONNREFUSED' ||
                    error.code === 'ETIMEDOUT' ||
                    error.message.includes('timeout') ||
                    error.message.includes('network') ||
                    error.message.includes('ERR_');

                if (isNetworkError) {
                    const backoff = config.RETRY.INITIAL_BACKOFF_MS * 
                                   Math.pow(config.RETRY.BACKOFF_MULTIPLIER, attempt - 1);
                    log(`Retrying in ${backoff}ms...`, 'WARN');
                    await new Promise(resolve => setTimeout(resolve, backoff));
                } else {
                    // Non-network errors should fail immediately
                    throw error;
                }
            }
        }
    }

    throw lastError;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    log,
    logError,
    retryOperation,
    ensureDirectories
};
