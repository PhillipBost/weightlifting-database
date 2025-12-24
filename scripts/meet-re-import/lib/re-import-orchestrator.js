/**
 * Re-Import Orchestrator
 * 
 * Coordinates the re-import workflow by integrating with existing scraping
 * and import infrastructure while adding intelligent completeness checking.
 */

const { SimpleLogger } = require('./simple-logger');

class ReImportOrchestrator {
    constructor(supabaseClient, options = {}) {
        this.supabase = supabaseClient;
        this.logger = new SimpleLogger('ReImportOrchestrator');
        this.options = {
            tempDir: options.tempDir || './temp',
            batchSize: options.batchSize || 10,
            delayBetweenMeets: options.delayBetweenMeets || 2000,
            maxRetries: options.maxRetries || 3,
            ...options
        };
    }

    /**
     * Re-import a single meet
     * @param {number} meetId - Database meet ID
     * @param {Object} meetDetails - Meet details from database
     * @returns {Promise<Object>} Re-import result
     */
    async reImportMeet(meetId, meetDetails) {
        this.logger.info(`Starting re-import for meet ${meetId}: ${meetDetails.name}`);
        
        const result = {
            meetId,
            meetName: meetDetails.name,
            sport80Id: meetDetails.sport80_id,
            success: false,
            error: null,
            resultsBefore: 0,
            resultsAfter: 0,
            resultsAdded: 0,
            startTime: new Date(),
            endTime: null,
            duration: null,
            partialFailure: false,
            verificationDetails: null
        };

        try {
            // Get initial result count
            result.resultsBefore = await this._getDatabaseResultCount(meetId);
            
            // Perform scraping and import
            const importResult = await this.scrapeAndImport(meetId, meetDetails);
            
            // Get final result count
            result.resultsAfter = await this._getDatabaseResultCount(meetId);
            result.resultsAdded = result.resultsAfter - result.resultsBefore;
            
            // Verify import success
            const verificationResult = await this.verifyImportSuccess(meetId, meetDetails);
            result.verificationDetails = verificationResult;
            
            // Handle different verification outcomes
            if (verificationResult.success) {
                result.success = true;
                result.error = null;
            } else if (result.resultsAdded > 0) {
                // Partial success - we added some results but verification failed
                result.success = false;
                result.partialFailure = true;
                result.error = `Partial import: Added ${result.resultsAdded} results, but ${verificationResult.error}`;
            } else {
                // Complete failure
                result.success = false;
                result.error = verificationResult.error || 'Import failed with no results added';
            }
            
            result.endTime = new Date();
            result.duration = result.endTime - result.startTime;

            if (result.success) {
                this.logger.info(`Successfully re-imported meet ${meetId}`, {
                    resultsAdded: result.resultsAdded,
                    duration: result.duration,
                    sport80Count: verificationResult.sport80Count,
                    databaseCount: verificationResult.databaseCount
                });
            } else if (result.partialFailure) {
                this.logger.warn(`Partial re-import for meet ${meetId}`, {
                    error: result.error,
                    resultsAdded: result.resultsAdded,
                    duration: result.duration
                });
            } else {
                this.logger.warn(`Re-import failed for meet ${meetId}`, {
                    error: result.error,
                    resultsAdded: result.resultsAdded,
                    duration: result.duration
                });
            }

            return result;

        } catch (error) {
            result.success = false;
            result.error = error.message;
            result.endTime = new Date();
            result.duration = result.endTime - result.startTime;

            this.logger.error(`Failed to re-import meet ${meetId}`, { error: error.message });
            return result;
        }
    }

    /**
     * Scrape and import a meet using existing infrastructure
     * @param {number} meetId - Database meet ID
     * @param {Object} meetDetails - Meet details from database
     * @returns {Promise<Object>} Scrape and import result
     */
    async scrapeAndImport(meetId, meetDetails) {
        this.logger.debug(`Scraping and importing meet ${meetId}`);
        
        const result = {
            scraped: false,
            imported: false,
            tempFile: null,
            error: null
        };

        try {
            // Ensure temp directory exists
            const fs = require('fs');
            const path = require('path');
            
            if (!fs.existsSync(this.options.tempDir)) {
                fs.mkdirSync(this.options.tempDir, { recursive: true });
            }

            // Generate temp file path
            const tempFileName = `meet_${meetId}_${Date.now()}.csv`;
            const tempFilePath = path.join(this.options.tempDir, tempFileName);
            result.tempFile = tempFilePath;

            // Step 1: Scrape meet using existing scrapeOneMeet function
            this.logger.info(`Scraping meet ${meetId} from Sport80...`);
            
            // Import the existing scrapeOneMeet function
            const { scrapeOneMeet } = require('../../production/scrapeOneMeet');
            
            // Use sport80_id (internal ID) for scraping, not database meet_id
            const sport80Id = meetDetails.sport80_id || meetDetails.meet_internal_id;
            if (!sport80Id) {
                throw new Error(`No Sport80 ID found for meet ${meetId}`);
            }

            // Graceful degradation: Validate Sport80 ID format
            if (typeof sport80Id !== 'number' || sport80Id <= 0) {
                throw new Error(`Invalid Sport80 ID format: ${sport80Id}`);
            }

            await scrapeOneMeet(sport80Id, tempFilePath);
            result.scraped = true;
            
            this.logger.info(`Successfully scraped meet ${meetId} to ${tempFileName}`);

            // Graceful degradation: Verify temp file was created and has content
            if (!fs.existsSync(tempFilePath)) {
                throw new Error(`Scraping failed - temp file not created: ${tempFileName}`);
            }
            
            const fileStats = fs.statSync(tempFilePath);
            if (fileStats.size === 0) {
                throw new Error(`Scraping failed - temp file is empty: ${tempFileName}`);
            }
            
            this.logger.debug(`Scraped file size: ${fileStats.size} bytes`);

            // Step 2: Import results using existing processMeetCsvFile function
            this.logger.info(`Importing results for meet ${meetId}...`);
            
            // Import the existing processMeetCsvFile function
            const { processMeetCsvFile } = require('../../production/database-importer-custom');
            
            const importResult = await processMeetCsvFile(tempFilePath, meetId, meetDetails.name);
            result.imported = true;
            
            this.logger.info(`Successfully imported meet ${meetId}`, {
                processed: importResult.processed || 0,
                errors: importResult.errors || 0
            });

            // Graceful degradation: Check if import actually processed results
            if (importResult.processed === 0) {
                this.logger.warn(`Import completed but no results were processed for meet ${meetId}`);
            }

            // Clean up temp file
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                this.logger.debug(`Cleaned up temp file: ${tempFileName}`);
            }

            return result;

        } catch (error) {
            this.logger.error(`Failed to scrape and import meet ${meetId}`, { error: error.message });
            
            // Clean up temp file on error
            if (result.tempFile) {
                const fs = require('fs');
                try {
                    if (fs.existsSync(result.tempFile)) {
                        fs.unlinkSync(result.tempFile);
                        this.logger.debug(`Cleaned up temp file after error`);
                    }
                } catch (cleanupError) {
                    this.logger.warn(`Failed to clean up temp file: ${cleanupError.message}`);
                }
            }
            
            result.error = error.message;
            
            // Graceful degradation: Categorize errors for better handling
            if (error.message.includes('timeout') || error.message.includes('network')) {
                result.errorType = 'network';
            } else if (error.message.includes('Sport80 ID') || error.message.includes('Invalid')) {
                result.errorType = 'validation';
            } else if (error.message.includes('temp file') || error.message.includes('empty')) {
                result.errorType = 'scraping';
            } else {
                result.errorType = 'unknown';
            }
            
            throw error;
        }
    }

    /**
     * Verify that import was successful
     * @param {number} meetId - Database meet ID
     * @param {Object} meetDetails - Meet details from database
     * @returns {Promise<Object>} Verification result
     */
    async verifyImportSuccess(meetId, meetDetails) {
        this.logger.debug(`Verifying import success for meet ${meetId}`);
        
        try {
            // Get current database count
            const databaseCount = await this._getDatabaseResultCount(meetId);
            
            // Get Sport80 count using sport80_id
            const sport80Id = meetDetails.sport80_id || meetDetails.meet_internal_id;
            if (!sport80Id) {
                return {
                    success: false,
                    error: 'No Sport80 ID available for verification',
                    sport80Count: 0,
                    databaseCount,
                    countsMatch: false
                };
            }
            
            const sport80Count = await this._getSport80ResultCount(sport80Id);
            
            // Consider import successful if:
            // 1. We have results in the database
            // 2. Database count >= Sport80 count (we may have more due to re-imports)
            // 3. Sport80 count > 0 (valid meet with results)
            const success = sport80Count > 0 && databaseCount >= sport80Count;
            const countsMatch = sport80Count === databaseCount;
            
            let error = null;
            if (sport80Count === 0) {
                error = 'No results found on Sport80 - meet may be invalid or empty';
            } else if (databaseCount < sport80Count) {
                error = `Incomplete import: Sport80=${sport80Count}, Database=${databaseCount}`;
            }

            const result = {
                success,
                error,
                sport80Count,
                databaseCount,
                countsMatch
            };

            // Mark meet as complete if verification successful
            if (success) {
                await this._markMeetAsComplete(meetId, sport80Count, databaseCount);
            }

            this.logger.debug(`Import verification result for meet ${meetId}`, result);
            return result;

        } catch (error) {
            this.logger.error(`Failed to verify import for meet ${meetId}`, { error: error.message });
            return {
                success: false,
                error: error.message,
                sport80Count: 0,
                databaseCount: 0,
                countsMatch: false
            };
        }
    }

    /**
     * Process multiple meets with error isolation
     * @param {Array} meets - Array of meet objects to process
     * @returns {Promise<Object>} Batch processing result
     */
    async processMeetBatch(meets) {
        this.logger.info(`Processing batch of ${meets.length} meets`);
        
        const batchResult = {
            totalMeets: meets.length,
            processedMeets: 0,
            successfulMeets: 0,
            failedMeets: 0,
            skippedMeets: 0,
            partialFailures: 0,
            totalResultsAdded: 0,
            meetResults: [],
            errors: [],
            startTime: new Date(),
            endTime: null,
            duration: null
        };

        try {
            for (let i = 0; i < meets.length; i++) {
                const meet = meets[i];
                
                try {
                    // Add delay between meets to avoid overwhelming Sport80
                    if (batchResult.processedMeets > 0) {
                        await this._delay(this.options.delayBetweenMeets);
                    }

                    this.logger.info(`Processing meet ${i + 1}/${meets.length}: ${meet.id} - ${meet.name}`);

                    // Wrap individual meet processing with comprehensive error handling
                    const meetResult = await this._processIndividualMeetWithRetry(meet);
                    
                    batchResult.meetResults.push(meetResult);
                    batchResult.processedMeets++;

                    // Categorize results
                    if (meetResult.success) {
                        batchResult.successfulMeets++;
                        batchResult.totalResultsAdded += meetResult.resultsAdded;
                    } else if (meetResult.partialFailure) {
                        batchResult.partialFailures++;
                        batchResult.totalResultsAdded += meetResult.resultsAdded;
                    } else {
                        batchResult.failedMeets++;
                    }

                } catch (error) {
                    // Error isolation - log error but continue with other meets
                    const errorInfo = {
                        meetId: meet.id,
                        meetName: meet.name,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    };
                    
                    batchResult.errors.push(errorInfo);
                    this.logger.error(`Critical error processing meet ${meet.id} in batch`, errorInfo);
                    
                    batchResult.failedMeets++;
                    batchResult.processedMeets++;
                    
                    batchResult.meetResults.push({
                        meetId: meet.id,
                        meetName: meet.name,
                        success: false,
                        error: error.message,
                        resultsBefore: 0,
                        resultsAfter: 0,
                        resultsAdded: 0,
                        partialFailure: false,
                        startTime: new Date(),
                        endTime: new Date(),
                        duration: 0
                    });

                    // Implement graceful degradation - continue processing but add longer delay
                    if (error.message.includes('rate limit') || error.message.includes('timeout')) {
                        this.logger.warn('Implementing graceful degradation due to network issues');
                        await this._delay(this.options.delayBetweenMeets * 2);
                    }
                }
            }

            batchResult.endTime = new Date();
            batchResult.duration = batchResult.endTime - batchResult.startTime;

            this.logger.info(`Completed batch processing`, {
                processed: batchResult.processedMeets,
                successful: batchResult.successfulMeets,
                failed: batchResult.failedMeets,
                partialFailures: batchResult.partialFailures,
                totalResultsAdded: batchResult.totalResultsAdded,
                duration: batchResult.duration,
                errorCount: batchResult.errors.length
            });

            return batchResult;

        } catch (error) {
            batchResult.endTime = new Date();
            batchResult.duration = batchResult.endTime - batchResult.startTime;
            
            this.logger.error('Batch processing failed catastrophically', { error: error.message });
            
            // Even in catastrophic failure, return partial results
            batchResult.errors.push({
                type: 'batch_failure',
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            return batchResult;
        }
    }

    /**
     * Process individual meet with retry logic and comprehensive error handling
     * @private
     */
    async _processIndividualMeetWithRetry(meet) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
            try {
                this.logger.debug(`Processing meet ${meet.id}, attempt ${attempt}/${this.options.maxRetries}`);
                
                const result = await this.reImportMeet(meet.id, meet);
                
                // If successful or partial success, return immediately
                if (result.success || result.partialFailure) {
                    if (attempt > 1) {
                        this.logger.info(`Meet ${meet.id} succeeded on attempt ${attempt}`);
                    }
                    return result;
                }
                
                // If complete failure but no exception, don't retry
                this.logger.warn(`Meet ${meet.id} failed on attempt ${attempt}: ${result.error}`);
                return result;
                
            } catch (error) {
                lastError = error;
                this.logger.warn(`Meet ${meet.id} attempt ${attempt} failed: ${error.message}`);
                
                // Implement exponential backoff for retries
                if (attempt < this.options.maxRetries) {
                    const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                    this.logger.debug(`Retrying meet ${meet.id} in ${backoffDelay}ms`);
                    await this._delay(backoffDelay);
                }
            }
        }
        
        // All retries exhausted
        this.logger.error(`Meet ${meet.id} failed after ${this.options.maxRetries} attempts`);
        
        return {
            meetId: meet.id,
            meetName: meet.name,
            success: false,
            error: `Failed after ${this.options.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`,
            resultsBefore: 0,
            resultsAfter: 0,
            resultsAdded: 0,
            partialFailure: false,
            startTime: new Date(),
            endTime: new Date(),
            duration: 0
        };
    }

    /**
     * Get database result count for a meet
     * @private
     */
    async _getDatabaseResultCount(meetId) {
        const { count, error } = await this.supabase
            .from('meet_results')
            .select('*', { count: 'exact', head: true })
            .eq('meet_id', meetId);

        if (error) {
            throw new Error(`Failed to get database result count: ${error.message}`);
        }

        return count || 0;
    }

    /**
     * Get Sport80 result count for a meet
     * @private
     */
    async _getSport80ResultCount(sport80Id) {
        try {
            // Use the existing meet completeness engine
            const { MeetCompletenessEngine } = require('./meet-completeness-engine');
            const completenessEngine = new MeetCompletenessEngine(this.supabase);
            
            return await completenessEngine._getSport80ResultCount(sport80Id);
        } catch (error) {
            this.logger.warn(`Failed to get Sport80 result count for meet ${sport80Id}`, { error: error.message });
            return 0;
        }
    }

    /**
     * Add delay between operations
     * @private
     */
    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Mark meet as complete to avoid reprocessing
     * @private
     */
    async _markMeetAsComplete(meetId, sport80Count, databaseCount) {
        try {
            // Use the existing meet skip manager
            const { MeetSkipManager } = require('./meet-skip-manager');
            const skipManager = new MeetSkipManager(this.supabase);
            
            await skipManager.markMeetAsComplete(meetId, {
                sport80Count,
                databaseCount,
                completedAt: new Date().toISOString()
            });
            
            this.logger.info(`Marked meet ${meetId} as complete`, {
                sport80Count,
                databaseCount
            });
        } catch (error) {
            this.logger.warn(`Failed to mark meet ${meetId} as complete`, { error: error.message });
        }
    }
}

module.exports = { ReImportOrchestrator };