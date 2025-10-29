/**
 * IWF LOGGER - Centralized Logging System
 * 
 * Provides consistent logging and error handling across all IWF scraper modules.
 * - Writes timestamped logs to module-specific log files
 * - Collects all errors in centralized JSON error file
 * - Implements retry logic with exponential backoff for network failures
 */

const fs = require('fs');
const path = require('path');
const config = require('./iwf-config');

// ============================================================================
// DIRECTORY INITIALIZATION
// ============================================================================

/**
 * Ensure log and error directories exist
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
 * @param {string} message - Log message
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
 * @param {string} logFilePath - Optional custom log file path (defaults to main log)
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
 * @param {Error} error - Error object
 * @param {object} context - Contextual information about the error
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
 * @param {Function} operation - Async function to retry
 * @param {number} maxRetries - Maximum number of attempts (from config by default)
 * @param {string} context - Description of operation for logging
 * @returns {Promise} - Result of successful operation
 * @throws {Error} - Original error if all retries fail
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
