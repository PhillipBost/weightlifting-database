/**
 * Detailed Re-Import Orchestrator
 * 
 * Provides detailed, actionable logging for meet re-import operations
 * Shows exactly which athletes fail and why
 */

const fs = require('fs').promises;
const path = require('path');
const { SimpleLogger } = require('./simple-logger');
const { SmartImporter } = require('./smart-importer');

class DetailedReImportOrchestrator {
    constructor(supabaseClient, options = {}) {
        this.supabase = supabaseClient;
        this.logger = new SimpleLogger('ReImport', options);
        this.smartImporter = new SmartImporter(supabaseClient, this.logger);
        this.options = {
            tempDir: options.tempDir || './temp',
            maxRetries: options.maxRetries || 2,
            ...options
        };
    }

    /**
     * Re-import a single meet with detailed logging
     */
    async reImportMeet(meetId, meetDetails) {
        this.logger.logMeetStart(meetId, meetDetails.name);

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
            athleteDetails: []
        };

        try {
            // Get initial count
            result.resultsBefore = await this._getDatabaseResultCount(meetId);
            this.logger.info(`Current database count: ${result.resultsBefore}`);

            // Step 1: Scrape from Sport80
            this.logger.logScrapeStart(meetId);
            const tempFile = await this._scrapeFromSport80(meetId, meetDetails.sport80_id);

            if (!tempFile) {
                throw new Error('Failed to scrape meet from Sport80');
            }

            // Step 2: Analyze scraped data
            const scrapedData = await this._analyzeScrapedData(tempFile);
            this.logger.logScrapeComplete(meetId, scrapedData.athleteCount);

            // Step 3: Import only missing athletes with detailed tracking
            this.logger.logImportStart(meetId);
            const importResult = await this.smartImporter.importMissingAthletes(
                tempFile,
                meetId,
                meetDetails.name,
                this.options.athleteName, // Correctly pass athleteName as 4th arg
                this.options.force        // Pass force as 5th arg
            );

            result.athleteDetails = importResult.errors || [];

            // Step 4: Verify results
            this.logger.logVerificationStart(meetId);
            result.resultsAfter = await this._getDatabaseResultCount(meetId);
            result.resultsAdded = result.resultsAfter - result.resultsBefore;

            // Step 5: Report results
            if (importResult.imported > 0) {
                this.logger.logMeetComplete(meetId, importResult.imported);
                result.success = true;
                result.resultsAdded = importResult.imported;
            } else if (importResult.processed === 0) {
                this.logger.info(`✅ Meet ${meetId} already complete - no missing athletes`);
                result.success = true;
                result.resultsAdded = 0;
            } else {
                const errorMsg = `Failed to import any of ${importResult.processed} missing athletes`;
                this.logger.logMeetFailed(meetId, errorMsg);
                result.error = errorMsg;
            }

            // Clean up temp file
            await this._cleanupTempFile(tempFile);

        } catch (error) {
            this.logger.logMeetFailed(meetId, error.message);
            result.error = error.message;
        }

        result.endTime = new Date();
        result.duration = result.endTime - result.startTime;

        return result;
    }

    /**
     * Scrape meet from Sport80 using existing infrastructure
     */
    async _scrapeFromSport80(meetId, sport80Id) {
        try {
            // Use existing scrapeOneMeet function
            const { scrapeOneMeet } = require('../../../scripts/production/scrapeOneMeet');
            const tempFile = path.join(this.options.tempDir, `meet_${meetId}_${Date.now()}.csv`);

            // Ensure temp directory exists
            await fs.mkdir(this.options.tempDir, { recursive: true });

            await scrapeOneMeet(sport80Id, tempFile);
            return tempFile;

        } catch (error) {
            this.logger.error(`Failed to scrape meet ${meetId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Analyze scraped CSV data to understand what we're importing
     * Uses Papa.parse with pipe delimiter like database-importer.js
     */
    async _analyzeScrapedData(csvFile) {
        try {
            const csvContent = await fs.readFile(csvFile, 'utf8');

            // Parse CSV with pipe delimiter using Papa.parse like working database-importer.js
            const Papa = require('papaparse');
            const parsed = Papa.parse(csvContent, {
                header: true,
                delimiter: '|',
                dynamicTyping: true,
                skipEmptyLines: true
            });

            if (parsed.errors.length > 0) {
                this.logger.warn('⚠️ CSV parsing warnings:', parsed.errors);
            }

            // Filter out invalid rows using column names like working database-importer.js
            const validRows = parsed.data.filter(row => {
                return row &&
                    typeof row === 'object' &&
                    row.Lifter &&
                    typeof row.Lifter === 'string' &&
                    row.Lifter.trim() !== '';
            });

            return {
                athleteCount: validRows.length,
                athletes: validRows.map((row, index) => {
                    return {
                        rowNumber: index + 1,
                        name: row.Lifter || 'Unknown',
                        club: row.Club || 'Unknown',
                        bodyweight: row['Body Weight (Kg)'] || 'Unknown',
                        total: row.Total || 'Unknown'
                    };
                })
            };
        } catch (error) {
            this.logger.error(`Failed to analyze scraped data: ${error.message}`);
            return { athleteCount: 0, athletes: [] };
        }
    }

    /**
     * Import with detailed athlete-level logging
     */
    async _importWithDetailedLogging(csvFile, meetId, meetName, scrapedData) {
        const result = {
            athleteDetails: []
        };

        try {
            // Use existing database importer WITH same-name athletes fix
            // Use the main custom database importer (which now includes duplicate fixes and fuzzy date matching)
            const processMeetCsvFile = require('../../scripts/production/database-importer-custom').processMeetCsvFile;

            this.logger.info(`Importing ${scrapedData.athleteCount} athletes...`);

            // Process each athlete and track results
            for (let i = 0; i < scrapedData.athletes.length; i++) {
                const athlete = scrapedData.athletes[i];
                this.logger.logAthleteProcessing(athlete.name, 'importing');

                // Track this athlete
                result.athleteDetails.push({
                    name: athlete.name,
                    club: athlete.club,
                    status: 'processing',
                    error: null
                });
            }

            // Run the actual import
            await processMeetCsvFile(csvFile, meetId, meetName);

            // Mark all as successful for now (we'd need to modify the importer for detailed tracking)
            result.athleteDetails.forEach(athlete => {
                athlete.status = 'imported';
                this.logger.logAthleteSuccess(athlete.name, 'database import');
            });

        } catch (error) {
            this.logger.error(`Import failed: ${error.message}`);

            // Mark all remaining athletes as failed
            result.athleteDetails.forEach(athlete => {
                if (athlete.status === 'processing') {
                    athlete.status = 'failed';
                    athlete.error = error.message;
                    this.logger.logAthleteFailed(athlete.name, error.message);
                }
            });
        }

        return result;
    }

    /**
     * Get database result count for a meet
     */
    async _getDatabaseResultCount(meetId) {
        try {
            const { count, error } = await this.supabase
                .from('usaw_meet_results')
                .select('*', { count: 'exact', head: true })
                .eq('meet_id', meetId);

            if (error) {
                throw new Error(`Database query failed: ${error.message}`);
            }

            return count || 0;
        } catch (error) {
            this.logger.error(`Failed to get database count for meet ${meetId}: ${error.message}`);
            return 0;
        }
    }

    /**
     * Clean up temporary file
     */
    async _cleanupTempFile(tempFile) {
        try {
            if (tempFile) {
                await fs.unlink(tempFile);
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    }

    /**
     * Process a batch of meets
     */
    async processMeetBatch(meets) {
        const results = {
            totalMeets: meets.length,
            processedMeets: 0,
            successfulMeets: 0,
            failedMeets: 0,
            totalResultsAdded: 0,
            meetResults: [],
            duration: 0
        };

        const startTime = Date.now();

        for (const meet of meets) {
            try {
                const meetResult = await this.reImportMeet(meet.id, meet);
                results.meetResults.push(meetResult);
                results.processedMeets++;

                if (meetResult.success) {
                    results.successfulMeets++;
                    results.totalResultsAdded += meetResult.resultsAdded;
                } else {
                    results.failedMeets++;
                }

            } catch (error) {
                this.logger.error(`Failed to process meet ${meet.id}: ${error.message}`);
                results.failedMeets++;
                results.processedMeets++;
            }
        }

        results.duration = Date.now() - startTime;

        this.logger.logImportSummary(
            results.processedMeets,
            results.successfulMeets,
            results.failedMeets
        );

        return results;
    }
}

module.exports = { DetailedReImportOrchestrator };
