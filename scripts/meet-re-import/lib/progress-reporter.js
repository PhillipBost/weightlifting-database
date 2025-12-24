/**
 * Progress Reporter
 * 
 * Tracks and reports re-import progress and results with detailed logging
 * and summary generation.
 */

const { ReImportLogger } = require('./re-import-logger');

class ProgressReporter {
    constructor(options = {}) {
        this.logger = new ReImportLogger('ProgressReporter');
        this.options = {
            reportInterval: options.reportInterval || 10, // Report every N meets
            ...options
        };
        
        // Session tracking
        this.sessionId = this._generateSessionId();
        this.sessionStats = {
            sessionId: this.sessionId,
            startTime: new Date(),
            endTime: null,
            meetsProcessed: 0,
            meetsCompleted: 0,
            meetsSkipped: 0,
            meetsFailed: 0,
            totalResultsAdded: 0,
            processingErrors: [],
            meetResults: []
        };
    }

    /**
     * Log progress for a single meet
     * @param {number} meetId - Database meet ID
     * @param {string} status - Processing status
     * @param {Object} counts - Result counts and other metrics
     */
    async logMeetProgress(meetId, status, counts = {}) {
        const progressEntry = {
            meetId,
            status,
            timestamp: new Date(),
            ...counts
        };

        // Update session stats
        this.sessionStats.meetsProcessed++;
        this.sessionStats.meetResults.push(progressEntry);

        switch (status) {
            case 'completed':
                this.sessionStats.meetsCompleted++;
                this.sessionStats.totalResultsAdded += counts.resultsAdded || 0;
                break;
            case 'skipped':
                this.sessionStats.meetsSkipped++;
                break;
            case 'failed':
                this.sessionStats.meetsFailed++;
                if (counts.error) {
                    this.sessionStats.processingErrors.push({
                        meetId,
                        error: counts.error,
                        timestamp: new Date()
                    });
                }
                break;
        }

        // Log progress
        this.logger.info(`Meet ${meetId} ${status}`, progressEntry);

        // Report interval progress
        if (this.sessionStats.meetsProcessed % this.options.reportInterval === 0) {
            this._logIntervalProgress();
        }
    }

    /**
     * Generate comprehensive summary report
     * @param {Array} processedMeets - Array of processed meet results
     * @returns {Object} Summary report
     */
    async generateSummaryReport(processedMeets = []) {
        this.sessionStats.endTime = new Date();
        this.sessionStats.duration = this.sessionStats.endTime - this.sessionStats.startTime;

        // Calculate additional metrics
        const successRate = this.sessionStats.meetsProcessed > 0 
            ? (this.sessionStats.meetsCompleted / this.sessionStats.meetsProcessed * 100).toFixed(2)
            : 0;

        const avgResultsPerMeet = this.sessionStats.meetsCompleted > 0
            ? (this.sessionStats.totalResultsAdded / this.sessionStats.meetsCompleted).toFixed(2)
            : 0;

        const summary = {
            ...this.sessionStats,
            successRate: `${successRate}%`,
            avgResultsPerMeet: parseFloat(avgResultsPerMeet),
            durationMinutes: Math.round(this.sessionStats.duration / 60000),
            meetsPerMinute: this.sessionStats.duration > 0 
                ? (this.sessionStats.meetsProcessed / (this.sessionStats.duration / 60000)).toFixed(2)
                : 0
        };

        this.logger.info('Re-import session completed', summary);
        return summary;
    }

    /**
     * Track completion statistics
     * @returns {Object} Current completion statistics
     */
    async trackCompletionStats() {
        const stats = {
            sessionId: this.sessionStats.sessionId,
            processed: this.sessionStats.meetsProcessed,
            completed: this.sessionStats.meetsCompleted,
            skipped: this.sessionStats.meetsSkipped,
            failed: this.sessionStats.meetsFailed,
            totalResultsAdded: this.sessionStats.totalResultsAdded,
            currentTime: new Date(),
            elapsedTime: new Date() - this.sessionStats.startTime
        };

        return stats;
    }

    /**
     * Log detailed error information
     * @param {number} meetId - Database meet ID
     * @param {Error} error - Error object
     * @param {Object} context - Additional context
     */
    logError(meetId, error, context = {}) {
        const errorEntry = {
            meetId,
            error: error.message,
            stack: error.stack,
            context,
            timestamp: new Date()
        };

        this.sessionStats.processingErrors.push(errorEntry);
        this.logger.error(`Error processing meet ${meetId}`, errorEntry);
    }

    /**
     * Get current session statistics
     * @returns {Object} Current session statistics
     */
    getSessionStats() {
        return {
            ...this.sessionStats,
            currentTime: new Date(),
            elapsedTime: new Date() - this.sessionStats.startTime
        };
    }

    /**
     * Reset session statistics (start new session)
     */
    resetSession() {
        this.sessionId = this._generateSessionId();
        this.sessionStats = {
            sessionId: this.sessionId,
            startTime: new Date(),
            endTime: null,
            meetsProcessed: 0,
            meetsCompleted: 0,
            meetsSkipped: 0,
            meetsFailed: 0,
            totalResultsAdded: 0,
            processingErrors: [],
            meetResults: []
        };

        this.logger.info(`Started new re-import session: ${this.sessionId}`);
    }

    /**
     * Export session data to JSON
     * @returns {string} JSON string of session data
     */
    exportSessionData() {
        const exportData = {
            ...this.sessionStats,
            exportedAt: new Date(),
            version: '1.0'
        };

        return JSON.stringify(exportData, null, 2);
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

    /**
     * Log interval progress
     * @private
     */
    _logIntervalProgress() {
        const stats = this.trackCompletionStats();
        const elapsedMinutes = Math.round(stats.elapsedTime / 60000);
        
        this.logger.info(`Progress Update - ${stats.processed} meets processed`, {
            completed: stats.completed,
            skipped: stats.skipped,
            failed: stats.failed,
            totalResultsAdded: stats.totalResultsAdded,
            elapsedMinutes
        });
    }
}

module.exports = { ProgressReporter };