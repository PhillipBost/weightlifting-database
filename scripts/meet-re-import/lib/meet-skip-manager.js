/**
 * Meet Skip Manager
 * 
 * Manages meet completion status and skip logic to avoid reprocessing
 * already-complete meets.
 */

const fs = require('fs').promises;
const path = require('path');
const { ReImportLogger } = require('./re-import-logger');
const { MeetCompletenessRecord } = require('../types');

class MeetSkipManager {
    constructor(supabaseClient, options = {}) {
        this.supabase = supabaseClient;
        this.logger = new ReImportLogger('MeetSkipManager');
        this.options = {
            skipTableName: options.skipTableName || 'meet_completion_status',
            persistenceFile: options.persistenceFile || path.join(__dirname, '../data/meet_completion_status.json'),
            ...options
        };
        
        // In-memory cache for skip status during session
        this.skipCache = new Map();
        
        // Persistent storage for completion status
        this.completionStorage = new Map();
        
        // Initialize persistence layer
        this._initializePersistence();
    }

    /**
     * Initialize persistence layer for completion status
     * @private
     */
    async _initializePersistence() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.options.persistenceFile);
            await fs.mkdir(dataDir, { recursive: true });
            
            // Load existing completion status from file
            await this._loadCompletionStatus();
            
            this.logger.debug(`Initialized persistence layer with ${this.completionStorage.size} completion records`);
        } catch (error) {
            this.logger.warn('Failed to initialize persistence layer, using in-memory only', { error: error.message });
        }
    }

    /**
     * Load completion status from persistent storage
     * @private
     */
    async _loadCompletionStatus() {
        try {
            const data = await fs.readFile(this.options.persistenceFile, 'utf8');
            const records = JSON.parse(data);
            
            // Convert to Map with MeetCompletenessRecord objects
            for (const [meetId, recordData] of Object.entries(records)) {
                const record = new MeetCompletenessRecord(recordData);
                this.completionStorage.set(parseInt(meetId), record);
            }
            
            this.logger.debug(`Loaded ${this.completionStorage.size} completion records from storage`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.warn('Failed to load completion status from storage', { error: error.message });
            }
            // File doesn't exist or is invalid, start with empty storage
            this.completionStorage.clear();
        }
    }

    /**
     * Save completion status to persistent storage
     * @private
     */
    async _saveCompletionStatus() {
        try {
            // Convert Map to plain object for JSON serialization
            const records = {};
            for (const [meetId, record] of this.completionStorage.entries()) {
                records[meetId] = record.toObject();
            }
            
            const data = JSON.stringify(records, null, 2);
            await fs.writeFile(this.options.persistenceFile, data, 'utf8');
            
            this.logger.debug(`Saved ${this.completionStorage.size} completion records to storage`);
        } catch (error) {
            this.logger.error('Failed to save completion status to storage', { error: error.message });
        }
    }

    /**
     * Check if a meet should be skipped based on completion status
     * @param {number} meetId - Database meet ID
     * @param {Object} options - Skip check options
     * @param {boolean} options.forceRecheck - Force recheck even if cached
     * @param {boolean} options.verifyResultCounts - Verify result counts still match
     * @returns {Promise<boolean>} True if meet should be skipped
     */
    async shouldSkipMeet(meetId, options = {}) {
        try {
            const { forceRecheck = false, verifyResultCounts = true } = options;

            // Check cache first (unless forced recheck)
            if (!forceRecheck && this.skipCache.has(meetId)) {
                const cached = this.skipCache.get(meetId);
                this.logger.debug(`Using cached skip status for meet ${meetId}: ${cached.shouldSkip}`);
                return cached.shouldSkip;
            }

            // Get completion status
            const completionStatus = await this.checkMeetCompleteness(meetId);
            
            // If meet was previously marked complete, verify result counts still match
            if (completionStatus.isComplete && verifyResultCounts) {
                const stillComplete = await this._verifyMeetStillComplete(meetId, completionStatus);
                if (!stillComplete) {
                    this.logger.info(`Meet ${meetId} was previously complete but result counts no longer match, marking as incomplete`);
                    await this.markMeetAsIncomplete(meetId, {
                        meetInternalId: completionStatus.meetInternalId,
                        sport80ResultCount: completionStatus.sport80ResultCount,
                        databaseResultCount: completionStatus.databaseResultCount
                    });
                    return false;
                }
            }

            const shouldSkip = completionStatus.isComplete && completionStatus.resultCountMatch;

            // Cache the result
            this.skipCache.set(meetId, {
                shouldSkip,
                completionStatus,
                cachedAt: new Date()
            });

            this.logger.debug(`Meet ${meetId} skip decision: ${shouldSkip}`, { 
                completionStatus: completionStatus.toObject() 
            });
            
            return shouldSkip;

        } catch (error) {
            this.logger.warn(`Error checking skip status for meet ${meetId}, will not skip`, { error: error.message });
            return false;
        }
    }

    /**
     * Verify that a previously complete meet is still complete
     * @param {number} meetId - Database meet ID
     * @param {MeetCompletenessRecord} previousStatus - Previous completion status
     * @returns {Promise<boolean>} True if meet is still complete
     * @private
     */
    async _verifyMeetStillComplete(meetId, previousStatus) {
        try {
            // Only verify if we have previous result counts
            if (!previousStatus.sport80ResultCount || !previousStatus.databaseResultCount) {
                this.logger.debug(`Cannot verify meet ${meetId} - missing previous result counts`);
                return true; // Assume still complete if we can't verify
            }

            // Get current database result count
            const currentDatabaseCount = await this._getCurrentDatabaseResultCount(meetId);
            
            // Check if database count has changed
            if (currentDatabaseCount !== previousStatus.databaseResultCount) {
                this.logger.info(`Meet ${meetId} database result count changed`, {
                    previous: previousStatus.databaseResultCount,
                    current: currentDatabaseCount
                });
                
                // Update the completion status with new counts
                await this.updateMeetCompletionStatus(meetId, {
                    databaseResultCount: currentDatabaseCount,
                    sport80ResultCount: previousStatus.sport80ResultCount // Keep previous Sport80 count
                });
                
                return currentDatabaseCount === previousStatus.sport80ResultCount;
            }

            // Database count hasn't changed, so meet is still complete
            return true;

        } catch (error) {
            this.logger.warn(`Error verifying meet ${meetId} completion status`, { error: error.message });
            return true; // Assume still complete on error to avoid unnecessary reprocessing
        }
    }

    /**
     * Get current database result count for a meet
     * @param {number} meetId - Database meet ID
     * @returns {Promise<number>} Current result count
     * @private
     */
    async _getCurrentDatabaseResultCount(meetId) {
        const { count, error } = await this.supabase
            .from('usaw_meet_results')
            .select('*', { count: 'exact', head: true })
            .eq('meet_id', meetId);

        if (error) {
            throw new Error(`Failed to get current database result count: ${error.message}`);
        }

        return count || 0;
    }

    /**
     * Handle edge case where a meet becomes incomplete again
     * @param {number} meetId - Database meet ID
     * @param {string} reason - Reason for becoming incomplete
     * @param {Object} data - Additional data
     * @returns {Promise<void>}
     */
    async handleMeetBecameIncomplete(meetId, reason, data = {}) {
        try {
            this.logger.warn(`Meet ${meetId} became incomplete again: ${reason}`, data);
            
            // Mark as incomplete with reason
            await this.markMeetAsIncomplete(meetId, {
                ...data,
                reason,
                becameIncompleteDate: new Date()
            });

            // Clear from skip cache to ensure it gets reprocessed
            this.skipCache.delete(meetId);

        } catch (error) {
            this.logger.error(`Failed to handle meet ${meetId} becoming incomplete`, { error: error.message });
            throw error;
        }
    }

    /**
     * Batch check skip status for multiple meets
     * @param {number[]} meetIds - Array of meet IDs to check
     * @param {Object} options - Skip check options
     * @returns {Promise<Map<number, boolean>>} Map of meet ID to skip status
     */
    async batchShouldSkipMeets(meetIds, options = {}) {
        const results = new Map();
        
        this.logger.debug(`Batch checking skip status for ${meetIds.length} meets`);
        
        for (const meetId of meetIds) {
            try {
                const shouldSkip = await this.shouldSkipMeet(meetId, options);
                results.set(meetId, shouldSkip);
            } catch (error) {
                this.logger.warn(`Error checking skip status for meet ${meetId} in batch`, { error: error.message });
                results.set(meetId, false); // Don't skip on error
            }
        }
        
        const skipCount = Array.from(results.values()).filter(skip => skip).length;
        this.logger.info(`Batch skip check completed: ${skipCount}/${meetIds.length} meets will be skipped`);
        
        return results;
    }

    /**
     * Check meet completion status
     * @param {number} meetId - Database meet ID
     * @returns {Promise<MeetCompletenessRecord>} Completion status record
     */
    async checkMeetCompleteness(meetId) {
        try {
            // Check persistent storage first
            if (this.completionStorage.has(meetId)) {
                const record = this.completionStorage.get(meetId);
                this.logger.debug(`Retrieved completion status from storage for meet ${meetId}`, record.toObject());
                return record;
            }

            // Create default status for new meets
            const defaultRecord = new MeetCompletenessRecord({
                meetId,
                isComplete: false,
                resultCountMatch: false,
                lastCheckedDate: null,
                completionDate: null,
                sport80ResultCount: null,
                databaseResultCount: null,
                status: 'unknown'
            });

            this.logger.debug(`Created default completion status for meet ${meetId}`, defaultRecord.toObject());
            return defaultRecord;

        } catch (error) {
            this.logger.error(`Failed to check completion status for meet ${meetId}`, { error: error.message });
            throw error;
        }
    }

    /**
     * Mark a meet as complete
     * @param {number} meetId - Database meet ID
     * @param {Object} completionData - Completion data
     * @returns {Promise<void>}
     */
    async markMeetAsComplete(meetId, completionData = {}) {
        try {
            const completionRecord = new MeetCompletenessRecord({
                meetId,
                meetInternalId: completionData.meetInternalId || null,
                isComplete: true,
                resultCountMatch: true,
                completionDate: new Date(),
                lastCheckedDate: new Date(),
                sport80ResultCount: completionData.sport80ResultCount || null,
                databaseResultCount: completionData.databaseResultCount || null,
                status: 'complete',
                ...completionData
            });

            // Store in persistent storage
            this.completionStorage.set(meetId, completionRecord);
            await this._saveCompletionStatus();

            // Update cache
            this.skipCache.set(meetId, {
                shouldSkip: true,
                completionStatus: completionRecord,
                cachedAt: new Date()
            });

            this.logger.info(`Marked meet ${meetId} as complete`, completionRecord.toObject());

        } catch (error) {
            this.logger.error(`Failed to mark meet ${meetId} as complete`, { error: error.message });
            throw error;
        }
    }

    /**
     * Mark a meet as incomplete (needs re-import)
     * @param {number} meetId - Database meet ID
     * @param {Object} incompletionData - Incompletion data
     * @returns {Promise<void>}
     */
    async markMeetAsIncomplete(meetId, incompletionData = {}) {
        try {
            const incompletionRecord = new MeetCompletenessRecord({
                meetId,
                meetInternalId: incompletionData.meetInternalId || null,
                isComplete: false,
                resultCountMatch: false,
                completionDate: null,
                lastCheckedDate: new Date(),
                sport80ResultCount: incompletionData.sport80ResultCount || null,
                databaseResultCount: incompletionData.databaseResultCount || null,
                status: 'incomplete',
                ...incompletionData
            });

            // Store in persistent storage
            this.completionStorage.set(meetId, incompletionRecord);
            await this._saveCompletionStatus();

            // Update cache
            this.skipCache.set(meetId, {
                shouldSkip: false,
                completionStatus: incompletionRecord,
                cachedAt: new Date()
            });

            this.logger.info(`Marked meet ${meetId} as incomplete`, incompletionRecord.toObject());

        } catch (error) {
            this.logger.error(`Failed to mark meet ${meetId} as incomplete`, { error: error.message });
            throw error;
        }
    }

    /**
     * Update meet completion status with new data
     * @param {number} meetId - Database meet ID
     * @param {Object} updateData - Data to update
     * @returns {Promise<void>}
     */
    async updateMeetCompletionStatus(meetId, updateData) {
        try {
            // Get existing record or create new one
            let record = this.completionStorage.get(meetId);
            if (!record) {
                record = new MeetCompletenessRecord({ meetId });
            }

            // Update record with new data
            Object.assign(record, updateData);
            record.lastCheckedDate = new Date();

            // Determine completion status based on result counts
            if (record.sport80ResultCount !== null && record.databaseResultCount !== null) {
                record.resultCountMatch = record.sport80ResultCount === record.databaseResultCount;
                record.isComplete = record.resultCountMatch;
                record.status = record.isComplete ? 'complete' : 'incomplete';
                
                if (record.isComplete && !record.completionDate) {
                    record.completionDate = new Date();
                }
            }

            // Store in persistent storage
            this.completionStorage.set(meetId, record);
            await this._saveCompletionStatus();

            // Clear cache to force refresh
            this.skipCache.delete(meetId);

            this.logger.info(`Updated completion status for meet ${meetId}`, record.toObject());

        } catch (error) {
            this.logger.error(`Failed to update completion status for meet ${meetId}`, { error: error.message });
            throw error;
        }
    }

    /**
     * Get completion status for a meet
     * @param {number} meetId - Database meet ID
     * @returns {Promise<MeetCompletenessRecord|null>} Completion record or null if not found
     */
    async getCompletionStatus(meetId) {
        return this.completionStorage.get(meetId) || null;
    }

    /**
     * Get all completion statuses
     * @returns {Map<number, MeetCompletenessRecord>} Map of meet IDs to completion records
     */
    getAllCompletionStatuses() {
        return new Map(this.completionStorage);
    }

    /**
     * Get completion statistics
     * @returns {Object} Statistics about completion status
     */
    getCompletionStats() {
        const stats = {
            total: this.completionStorage.size,
            complete: 0,
            incomplete: 0,
            unknown: 0,
            failed: 0
        };

        for (const record of this.completionStorage.values()) {
            switch (record.status) {
                case 'complete':
                    stats.complete++;
                    break;
                case 'incomplete':
                    stats.incomplete++;
                    break;
                case 'failed':
                    stats.failed++;
                    break;
                default:
                    stats.unknown++;
            }
        }

        return stats;
    }

    /**
     * Clear completion status for a specific meet or all meets
     * @param {number} [meetId] - Specific meet ID to clear, or undefined for all
     */
    async clearCompletionStatus(meetId = null) {
        if (meetId) {
            this.completionStorage.delete(meetId);
            this.logger.debug(`Cleared completion status for meet ${meetId}`);
        } else {
            this.completionStorage.clear();
            this.logger.debug('Cleared all completion statuses');
        }
        
        await this._saveCompletionStatus();
    }

    /**
     * Clear skip cache for a specific meet or all meets
     * @param {number} [meetId] - Specific meet ID to clear, or undefined for all
     */
    clearSkipCache(meetId = null) {
        if (meetId) {
            this.skipCache.delete(meetId);
            this.logger.debug(`Cleared skip cache for meet ${meetId}`);
        } else {
            this.skipCache.clear();
            this.logger.debug('Cleared all skip cache');
        }
    }

    /**
     * Get skip cache statistics
     * @returns {Object} Cache statistics
     */
    getSkipCacheStats() {
        const stats = {
            totalCached: this.skipCache.size,
            shouldSkipCount: 0,
            shouldNotSkipCount: 0
        };

        for (const [meetId, cached] of this.skipCache.entries()) {
            if (cached.shouldSkip) {
                stats.shouldSkipCount++;
            } else {
                stats.shouldNotSkipCount++;
            }
        }

        return stats;
    }
}

module.exports = { MeetSkipManager };