/**
 * Core Types and Interfaces for Meet Re-Import System
 * 
 * Defines the data structures and interfaces used throughout the system
 * for meet completeness tracking, re-import operations, and progress reporting.
 */

/**
 * Meet Completeness Record
 * Tracks the completeness status of a meet based on result count comparison
 */
class MeetCompletenessRecord {
    constructor(data = {}) {
        this.meetId = data.meetId || null;
        this.meetInternalId = data.meetInternalId || null;
        this.sport80ResultCount = data.sport80ResultCount || 0;
        this.databaseResultCount = data.databaseResultCount || 0;
        this.resultCountMatch = data.resultCountMatch || false;
        this.isComplete = data.isComplete || false;
        this.lastCheckedDate = data.lastCheckedDate || null;
        this.completionDate = data.completionDate || null;
        this.status = data.status || 'unknown'; // 'incomplete' | 'processing' | 'complete' | 'failed' | 'skipped'
        this.errorLog = data.errorLog || [];
    }

    /**
     * Check if the meet is complete
     * @returns {boolean}
     */
    isCompleteStatus() {
        return this.isComplete && this.resultCountMatch;
    }

    /**
     * Add error to error log
     * @param {string} error - Error message
     */
    addError(error) {
        this.errorLog.push({
            error,
            timestamp: new Date()
        });
    }

    /**
     * Convert to plain object
     * @returns {Object}
     */
    toObject() {
        return {
            meetId: this.meetId,
            meetInternalId: this.meetInternalId,
            sport80ResultCount: this.sport80ResultCount,
            databaseResultCount: this.databaseResultCount,
            resultCountMatch: this.resultCountMatch,
            isComplete: this.isComplete,
            lastCheckedDate: this.lastCheckedDate,
            completionDate: this.completionDate,
            status: this.status,
            errorLog: this.errorLog
        };
    }
}

/**
 * Re-Import Session
 * Tracks a complete re-import session with statistics and results
 */
class ReImportSession {
    constructor(sessionId = null) {
        this.sessionId = sessionId || this._generateSessionId();
        this.startTime = new Date();
        this.endTime = null;
        this.meetsProcessed = 0;
        this.meetsCompleted = 0;
        this.meetsSkipped = 0;
        this.meetsFailed = 0;
        this.totalResultsAdded = 0;
        this.processingErrors = [];
        this.meetResults = [];
        this.summary = '';
    }

    /**
     * Add meet result to session
     * @param {MeetReImportResult} meetResult
     */
    addMeetResult(meetResult) {
        this.meetResults.push(meetResult);
        this.meetsProcessed++;

        if (meetResult.success) {
            this.meetsCompleted++;
            this.totalResultsAdded += meetResult.resultsAdded || 0;
        } else {
            this.meetsFailed++;
            if (meetResult.error) {
                this.processingErrors.push({
                    meetId: meetResult.meetId,
                    error: meetResult.error,
                    timestamp: new Date()
                });
            }
        }
    }

    /**
     * Mark session as complete
     * @param {string} summary - Session summary
     */
    complete(summary = '') {
        this.endTime = new Date();
        this.summary = summary;
    }

    /**
     * Get session duration in milliseconds
     * @returns {number}
     */
    getDuration() {
        const endTime = this.endTime || new Date();
        return endTime - this.startTime;
    }

    /**
     * Get success rate as percentage
     * @returns {number}
     */
    getSuccessRate() {
        if (this.meetsProcessed === 0) return 0;
        return (this.meetsCompleted / this.meetsProcessed) * 100;
    }

    /**
     * Generate session ID
     * @private
     */
    _generateSessionId() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const random = Math.random().toString(36).substring(2, 8);
        return `reimport-${timestamp}-${random}`;
    }
}

/**
 * Meet Re-Import Result
 * Result of re-importing a single meet
 */
class MeetReImportResult {
    constructor(meetId, meetName = '') {
        this.meetId = meetId;
        this.meetName = meetName;
        this.sport80Id = null;
        this.success = false;
        this.error = null;
        this.resultsBefore = 0;
        this.resultsAfter = 0;
        this.resultsAdded = 0;
        this.startTime = new Date();
        this.endTime = null;
        this.duration = null;
        this.scrapeResult = null;
        this.importResult = null;
        this.verificationResult = null;
    }

    /**
     * Mark result as successful
     * @param {Object} data - Success data
     */
    markSuccess(data = {}) {
        this.success = true;
        this.error = null;
        this.endTime = new Date();
        this.duration = this.endTime - this.startTime;
        Object.assign(this, data);
    }

    /**
     * Mark result as failed
     * @param {string} error - Error message
     * @param {Object} data - Additional data
     */
    markFailure(error, data = {}) {
        this.success = false;
        this.error = error;
        this.endTime = new Date();
        this.duration = this.endTime - this.startTime;
        Object.assign(this, data);
    }
}

/**
 * Meet Filter Criteria
 * Criteria for filtering meets for re-import
 */
class MeetFilterCriteria {
    constructor(data = {}) {
        this.meetIds = data.meetIds || null;
        this.startDate = data.startDate || null;
        this.endDate = data.endDate || null;
        this.meetType = data.meetType || null;
        this.qualityThreshold = data.qualityThreshold || null;
        this.athleteName = data.athleteName || null;
        this.limit = data.limit || null;
        this.offset = data.offset || 0;
    }

    /**
     * Check if any filters are applied
     * @returns {boolean}
     */
    hasFilters() {
        return !!(this.meetIds || this.startDate || this.endDate || 
                 this.meetType || this.qualityThreshold || this.athleteName);
    }

    /**
     * Convert to database query parameters
     * @returns {Object}
     */
    toQueryParams() {
        const params = {};
        
        if (this.meetIds) params.meetIds = this.meetIds;
        if (this.startDate) params.startDate = this.startDate;
        if (this.endDate) params.endDate = this.endDate;
        if (this.meetType) params.meetType = this.meetType;
        if (this.limit) params.limit = this.limit;
        if (this.offset) params.offset = this.offset;
        
        return params;
    }
}

/**
 * Progress Report Entry
 * Single entry in progress reporting
 */
class ProgressReportEntry {
    constructor(meetId, status, data = {}) {
        this.meetId = meetId;
        this.status = status; // 'processing' | 'completed' | 'skipped' | 'failed'
        this.timestamp = new Date();
        this.sport80Count = data.sport80Count || 0;
        this.databaseCount = data.databaseCount || 0;
        this.resultsAdded = data.resultsAdded || 0;
        this.error = data.error || null;
        this.duration = data.duration || null;
    }
}

/**
 * Re-Import Configuration
 * Configuration options for re-import operations
 */
class ReImportConfiguration {
    constructor(options = {}) {
        // Processing options
        this.batchSize = options.batchSize || 10;
        this.delayBetweenMeets = options.delayBetweenMeets || 2000;
        this.maxRetries = options.maxRetries || 3;
        this.timeoutMs = options.timeoutMs || 30000;
        
        // Directory options
        this.tempDir = options.tempDir || './temp';
        this.logDir = options.logDir || './logs';
        
        // Logging options
        this.logLevel = options.logLevel || 'info';
        this.reportInterval = options.reportInterval || 10;
        
        // Skip options
        this.skipCompleteMetrics = options.skipCompleteMetrics !== false;
        this.forceReImport = options.forceReImport || false;
        
        // Dry run mode
        this.dryRun = options.dryRun || false;
        
        // Analyze only mode (like dry run but specifically for analysis)
        this.analyzeOnly = options.analyzeOnly || false;
    }

    /**
     * Validate configuration
     * @returns {Array} Array of validation errors
     */
    validate() {
        const errors = [];
        
        if (this.batchSize <= 0) {
            errors.push('batchSize must be greater than 0');
        }
        
        if (this.delayBetweenMeets < 0) {
            errors.push('delayBetweenMeets must be non-negative');
        }
        
        if (this.maxRetries < 0) {
            errors.push('maxRetries must be non-negative');
        }
        
        if (this.timeoutMs <= 0) {
            errors.push('timeoutMs must be greater than 0');
        }
        
        return errors;
    }
}

// Export all types and classes
module.exports = {
    MeetCompletenessRecord,
    ReImportSession,
    MeetReImportResult,
    MeetFilterCriteria,
    ProgressReportEntry,
    ReImportConfiguration
};