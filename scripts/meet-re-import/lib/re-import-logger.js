/**
 * Re-Import Logger
 * 
 * Comprehensive logging framework for re-import operations with multiple
 * log levels and descriptive console output.
 */

class ReImportLogger {
    constructor(component, options = {}) {
        this.component = component;
        this.options = {
            logLevel: options.logLevel || 'info',
            includeTimestamp: options.includeTimestamp !== false,
            includeComponent: options.includeComponent !== false,
            colorOutput: options.colorOutput !== false,
            ...options
        };

        // Log levels (higher number = more verbose)
        this.logLevels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };

        // Colors for console output
        this.colors = {
            error: '\x1b[31m',   // Red
            warn: '\x1b[33m',    // Yellow
            info: '\x1b[36m',    // Cyan
            debug: '\x1b[37m',   // White
            reset: '\x1b[0m'     // Reset
        };
    }

    /**
     * Log error message
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
    error(message, data = {}) {
        this._log('error', message, data);
    }

    /**
     * Log warning message
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
    warn(message, data = {}) {
        this._log('warn', message, data);
    }

    /**
     * Log info message
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
    info(message, data = {}) {
        this._log('info', message, data);
    }

    /**
     * Log debug message
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
    debug(message, data = {}) {
        this._log('debug', message, data);
    }

    /**
     * Log lifter processing with descriptive formatting
     * @param {string} lifterName - Lifter name
     * @param {string} action - Action being performed
     * @param {Object} data - Additional data
     */
    logLifterProcessing(lifterName, action, data = {}) {
        console.log(''); // Empty line for readability
        this.info(`Processing lifter: ${lifterName}`, { action, ...data });
    }

    /**
     * Log base64 URL creation with full URL display
     * @param {string} url - Complete base64 URL
     * @param {Object} filters - Filters used to create URL
     */
    logBase64URL(url, filters = {}) {
        this.info('Created base64 lookup URL:', { url, filters });
        console.log(`🔗 ${url}`);
    }

    /**
     * Log Tier 2 verification with page details
     * @param {number} pageNumber - Page number being searched
     * @param {number} resultsFound - Number of results found on page
     * @param {Object} searchCriteria - Search criteria used
     */
    logTier2Verification(pageNumber, resultsFound, searchCriteria = {}) {
        this.info(`Tier 2 verification - Page ${pageNumber}`, {
            resultsFound,
            searchCriteria
        });
    }

    /**
     * Log athlete linkage updates with detailed reasoning
     * @param {number} oldLifterId - Old lifter ID
     * @param {number} newLifterId - New lifter ID
     * @param {string} reason - Reason for the update
     * @param {Object} evidence - Evidence supporting the update
     */
    logLinkageUpdate(oldLifterId, newLifterId, reason, evidence = {}) {
        console.log(''); // Empty line for readability
        this.info('Athlete linkage update', {
            oldLifterId,
            newLifterId,
            reason,
            evidence
        });
        console.log(`📝 Updating lifter_id ${oldLifterId} → ${newLifterId}`);
        console.log(`📋 Reason: ${reason}`);
    }

    /**
     * Log comprehensive error details
     * @param {string} operation - Operation that failed
     * @param {Error} error - Error object
     * @param {Object} context - Additional context
     */
    logComprehensiveError(operation, error, context = {}) {
        console.log(''); // Empty line for readability
        this.error(`❌ ${operation} failed`, {
            error: error.message,
            stack: error.stack,
            context
        });
    }

    /**
     * Log session start
     * @param {string} sessionId - Session identifier
     * @param {Object} config - Session configuration
     */
    logSessionStart(sessionId, config = {}) {
        console.log(''); // Empty line for readability
        console.log('='.repeat(80));
        this.info(`🚀 Starting re-import session: ${sessionId}`, config);
        console.log('='.repeat(80));
    }

    /**
     * Log session end
     * @param {string} sessionId - Session identifier
     * @param {Object} summary - Session summary
     */
    logSessionEnd(sessionId, summary = {}) {
        console.log(''); // Empty line for readability
        console.log('='.repeat(80));
        this.info(`✅ Completed re-import session: ${sessionId}`, summary);
        console.log('='.repeat(80));
    }

    /**
     * Internal logging method
     * @private
     */
    _log(level, message, data = {}) {
        // Check if this log level should be output
        if (this.logLevels[level] > this.logLevels[this.options.logLevel]) {
            return;
        }

        // Build log entry
        const timestamp = this.options.includeTimestamp 
            ? new Date().toISOString() 
            : null;

        const component = this.options.includeComponent 
            ? this.component 
            : null;

        // Format message
        let logMessage = '';
        
        if (timestamp) {
            logMessage += `[${timestamp}] `;
        }
        
        if (component) {
            logMessage += `[${component}] `;
        }

        // Add color if enabled
        if (this.options.colorOutput && this.colors[level]) {
            logMessage += this.colors[level];
        }

        logMessage += `${level.toUpperCase()}: ${message}`;

        // Reset color
        if (this.options.colorOutput) {
            logMessage += this.colors.reset;
        }

        // Output to console
        console.log(logMessage);

        // Output data if provided
        if (Object.keys(data).length > 0) {
            console.log(JSON.stringify(data, null, 2));
        }
    }

    /**
     * Create child logger with same configuration
     * @param {string} childComponent - Child component name
     * @returns {ReImportLogger} Child logger instance
     */
    createChild(childComponent) {
        const childName = `${this.component}:${childComponent}`;
        return new ReImportLogger(childName, this.options);
    }

    /**
     * Set log level
     * @param {string} level - New log level
     */
    setLogLevel(level) {
        if (this.logLevels.hasOwnProperty(level)) {
            this.options.logLevel = level;
        } else {
            this.warn(`Invalid log level: ${level}. Valid levels: ${Object.keys(this.logLevels).join(', ')}`);
        }
    }

    /**
     * Get current log level
     * @returns {string} Current log level
     */
    getLogLevel() {
        return this.options.logLevel;
    }
}

module.exports = { ReImportLogger };