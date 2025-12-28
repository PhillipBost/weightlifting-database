/**
 * Shared Configuration and Types for Unified Scraper
 */

const path = require('path');

class UnifiedConfiguration {
    constructor(options = {}) {
        // Mode
        this.mode = options.mode || 'reimport'; // 'reimport', 'wso', 'gaps'

        // Common options
        this.batchSize = options.batchSize || 10;
        this.delay = options.delay || 2000;
        this.timeout = options.timeout || 30000;
        this.logLevel = options.logLevel || 'info';
        this.dryRun = options.dryRun || false;
        this.force = options.force || false;
        this.dateWindow = options.dateWindow || 5;

        // Re-import specific
        this.meetIds = options.meetIds || null;
        this.startDate = options.startDate || null;
        this.endDate = options.endDate || null;
        this.athleteName = options.athleteName || null;
        this.limit = options.limit || null;
        this.analyzeOnly = options.analyzeOnly || false;

        // WSO Scraper specific
        this.genderFilter = options.genderFilter || null;
        this.maxResults = options.maxResults || null;
        this.unresolvedPath = options.unresolvedPath || path.join(__dirname, '../../../logs/surgical-strike-wso-unresolved.json');
        this.updatesLogPath = options.updatesLogPath || path.join(__dirname, `../../../logs/wso-updates-${new Date().toISOString().split('T')[0]}.csv`);

        // Gap Scraper specific
        this.maxGaps = options.maxGaps || 5;
        this.startId = options.startId || null;
        this.endId = options.endId || null;
        this.noMetadata = options.noMetadata || false;
    }

    validate() {
        const errors = [];
        if (!['reimport', 'wso', 'gaps'].includes(this.mode)) {
            errors.push(`Invalid mode: ${this.mode}`);
        }
        if (this.batchSize <= 0) errors.push('batchSize must be > 0');
        if (this.delay < 0) errors.push('delay must be >= 0');
        return errors;
    }
}

class UnifiedSession {
    constructor(mode) {
        this.id = this._generateSessionId(mode);
        this.startTime = new Date();
        this.endTime = null;
        this.processed = 0;
        this.completed = 0;
        this.failed = 0;
        this.skipped = 0;
        this.errors = [];
        this.results = [];
        this.summary = '';
    }

    _generateSessionId(mode) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${mode}-${timestamp}`;
    }

    complete(summary = '') {
        this.endTime = new Date();
        this.summary = summary;
    }

    getDuration() {
        const end = this.endTime || new Date();
        return end - this.startTime;
    }
}

module.exports = {
    UnifiedConfiguration,
    UnifiedSession
};
