/**
 * Smart Importer - Only processes missing athletes
 * 
 * Compares scraped data against database and only processes what's actually missing
 */

const fs = require('fs').promises;
const csv = require('csv-parser');
const { createReadStream } = require('fs');

class SmartImporter {
    constructor(supabaseClient, logger) {
        this.supabase = supabaseClient;
        this.logger = logger;
    }

    /**
     * Import ALL results from Sport80 for a meet (treating Sport80 as source of truth)
     */
    /**
     * Import only missing results from a meet
     * @param {string} csvFile - Path to scraped CSV file
     * @param {number} meetId - Database meet ID
     * @param {string} meetName - Meet name
     * @param {string} athleteName - Optional athlete name to filter for
     * @param {boolean} force - If true, re-import matching athletes even if they exist
     */
    async importMissingAthletes(csvFile, meetId, meetName, athleteNames = [], force = false) {
        try {
            // Step 1: Get existing results in database for this meet
            this.logger.info('🔍 Checking existing results in database...');
            const existingResults = await this._getExistingAthletes(meetId);
            this.logger.info(`📊 Found ${existingResults.length} existing results in database`);

            // Step 2: Parse scraped CSV data
            this.logger.info('📄 Analyzing scraped data...');
            let scrapedAthletes = await this._parseScrapedData(csvFile);
            this.logger.info(`📊 Found ${scrapedAthletes.length} results in scraped data`);

            // Step 3: Apply athlete name filter if specified
            // Support legacy single string or array
            const targetNames = Array.isArray(athleteNames) ? athleteNames : (athleteNames ? [athleteNames] : []);

            if (targetNames.length > 0) {
                const normalizedTargetNames = targetNames.map(n => this._normalizeAthleteName(n));
                const originalCount = scrapedAthletes.length;

                scrapedAthletes = scrapedAthletes.filter(athlete => {
                    const athleteNameNormalized = this._normalizeAthleteName(athlete.name);
                    return normalizedTargetNames.includes(athleteNameNormalized); // Check ANY match
                });

                this.logger.info(`🎯 Applied athlete filter: "${targetNames.join(', ')}" - found ${scrapedAthletes.length} of ${originalCount} athletes matching`);

                if (scrapedAthletes.length === 0) {
                    this.logger.warn(`⚠️ No athletes found matching names "${targetNames.join(', ')}"`);
                    return {
                        processed: 0,
                        imported: 0,
                        skipped: originalCount,
                        errors: [{
                            name: targetNames.join(', '),
                            reason: `No athlete found with specified names`
                        }]
                    };
                }
            }

            // Step 4: Identify results to process (or force all if force=true)
            let missingAthletes;
            if (force) {
                this.logger.info('⚠️ FORCE MODE: Ignoring existing results check - processing all matching athletes');
                missingAthletes = scrapedAthletes;
            } else {
                missingAthletes = this._identifyMissingAthletes(scrapedAthletes, existingResults);
            }

            if (missingAthletes.length === 0) {
                this.logger.info('✅ No missing results found - all results already in database');
                return {
                    processed: 0,
                    imported: 0,
                    skipped: scrapedAthletes.length,
                    errors: []
                };
            }

            this.logger.info(`🎯 Found ${missingAthletes.length} missing results to import:`);
            missingAthletes.forEach((athlete, index) => {
                console.log(`   ${index + 1}. ${athlete.name} (${athlete.club}) - BW: ${athlete.bodyweight}, Total: ${athlete.total}`);
            });
            console.log(''); // Add spacing

            // Step 4: Process only missing results
            const results = await this._processMissingAthletes(missingAthletes, meetId, meetName);

            // Step 5: Summary
            this.logger.info(`\n📋 Import Summary:`);
            this.logger.info(`   Total scraped: ${scrapedAthletes.length}`);
            this.logger.info(`   Already existed: ${existingResults.length}`);
            this.logger.info(`   Missing results: ${missingAthletes.length}`);
            this.logger.info(`   Successfully imported: ${results.imported}`);
            this.logger.info(`   Failed: ${results.errors.length}`);

            if (results.errors.length > 0) {
                this.logger.warn(`\n❌ Failed results:`);
                results.errors.forEach(error => {
                    console.log(`   • ${error.name}: ${error.reason}`);
                });
            }

            return results;

        } catch (error) {
            this.logger.error(`Import failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get existing results for this meet from database
     * Note: Returns ALL results, including duplicates (e.g., multiple Molly Raines entries)
     */
    async _getExistingAthletes(meetId) {
        try {
            const { data, error } = await this.supabase
                .from('usaw_meet_results')
                .select(`
                    result_id,
                    lifter_id,
                    lifter_name,
                    club_name,
                    body_weight_kg,
                    total
                `)
                .eq('meet_id', meetId);

            if (error) {
                throw new Error(`Database query failed: ${error.message}`);
            }

            return data.map(row => ({
                result_id: row.result_id,
                name: row.lifter_name,
                club: row.club_name || '',
                lifter_id: row.lifter_id,
                bodyweight: row.body_weight_kg || '',
                total: row.total || ''
            }));

        } catch (error) {
            this.logger.error(`Failed to get existing results: ${error.message}`);
            return [];
        }
    }

    /**
     * Parse scraped CSV data using column names like working database-importer.js
     */
    async _parseScrapedData(csvFile) {
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

            // Helper to match column names fuzzily
            const findVal = (row, keys, ...patterns) => {
                // Try exact match first for speed
                for (const pattern of patterns) {
                    if (row[pattern] !== undefined && row[pattern] !== null && row[pattern] !== '') return row[pattern];
                }

                // Try fuzzy match
                for (const pattern of patterns) {
                    const cleanPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const matchedKey = keys.find(k => {
                        const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                        return cleanKey === cleanPattern || cleanKey.includes(cleanPattern);
                    });
                    if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null) {
                        return row[matchedKey];
                    }
                }
                return '';
            };

            return validRows.map((row, index) => {
                const keys = Object.keys(row);
                return {
                    rowNumber: index + 1,
                    meetName: row.Meet || '',
                    date: row.Date || '',
                    ageCategory: row['Age Category'] || '',
                    weightClass: row['Weight Class'] || '',
                    name: findVal(row, keys, 'Lifter', 'Name', 'Athlete'),
                    bodyweight: findVal(row, keys, 'Body Weight (Kg)', 'Body Weight', 'BW'),

                    snatchLift1: findVal(row, keys, 'Snatch Lift 1', 'Snatch 1', 'Sn 1'),
                    snatchLift2: findVal(row, keys, 'Snatch Lift 2', 'Snatch 2', 'Sn 2'),
                    snatchLift3: findVal(row, keys, 'Snatch Lift 3', 'Snatch 3', 'Sn 3'),
                    bestSnatch: findVal(row, keys, 'Best Snatch', 'Best Sn', 'Snatch'),

                    cjLift1: findVal(row, keys, 'C&J Lift 1', 'CJ Lift 1', 'Clean & Jerk 1'),
                    cjLift2: findVal(row, keys, 'C&J Lift 2', 'CJ Lift 2', 'Clean & Jerk 2'),
                    cjLift3: findVal(row, keys, 'C&J Lift 3', 'CJ Lift 3', 'Clean & Jerk 3'),
                    bestCJ: findVal(row, keys, 'Best C&J', 'Best CJ', 'C&J', 'Clean & Jerk'),

                    total: findVal(row, keys, 'Total', 'Tot'),
                    club: findVal(row, keys, 'Club', 'Team')
                };
            });
        } catch (error) {
            this.logger.error(`Failed to analyze scraped data: ${error.message}`);
            return [];
        }
    }

    /**
     * Identify which results are missing from database
     * Handles duplicate names by comparing multiple attributes
     */
    _identifyMissingAthletes(scrapedAthletes, existingResults) {
        return scrapedAthletes.filter(scrapedAthlete => {
            // For each scraped athlete, check if there's a matching existing result
            const hasMatch = existingResults.some(existingResult => {
                return this._resultsMatch(scrapedAthlete, existingResult);
            });

            return !hasMatch;
        });
    }

    /**
     * Check if a scraped athlete matches an existing result
     * Uses multiple attributes for more precise matching
     */
    _resultsMatch(scrapedAthlete, existingResult) {
        const nameMatch = this._normalizeAthleteName(scrapedAthlete.name) ===
            this._normalizeAthleteName(existingResult.name);

        // If names don't match, definitely not the same
        if (!nameMatch) {
            return false;
        }

        // For duplicate names, require BOTH bodyweight AND total to match
        // This ensures we can distinguish between different results with the same name
        const bodyweightMatch = this._normalizeBodyweight(scrapedAthlete.bodyweight) ===
            this._normalizeBodyweight(existingResult.bodyweight);

        // Check for incomplete DB record (NULL total) when scraped result has a value
        const dbTotal = this._normalizeTotal(existingResult.total);
        const scrapedTotal = this._normalizeTotal(scrapedAthlete.total);

        // If DB is missing total but scraped has one (even '0'), it's a mismatch (needs update)
        if (dbTotal === '' && scrapedTotal !== '') {
            return false;
        }

        const totalMatch = dbTotal === scrapedTotal;

        // Require both bodyweight and total to match for precise identification
        // Note: usage of && ensures that if totals mismatch (e.g. NULL vs 0), it returns false.
        return nameMatch && bodyweightMatch && totalMatch;
    }

    /**
     * Normalize bodyweight for comparison
     */
    _normalizeBodyweight(bodyweight) {
        if (!bodyweight) return '';
        return bodyweight.toString().trim().replace(/[^\d.]/g, '');
    }

    /**
     * Normalize total for comparison
     */
    _normalizeTotal(total) {
        if (total === null || total === undefined || total === '') return '';
        return total.toString().trim().replace(/[^\d]/g, '');
    }

    /**
     * Normalize athlete name for comparison
     */
    _normalizeAthleteName(name) {
        return name.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /**
     * Process only the missing results using existing proven infrastructure
     */
    async _processMissingAthletes(missingAthletes, meetId, meetName) {
        const results = {
            processed: missingAthletes.length,
            imported: 0,
            errors: []
        };

        if (missingAthletes.length === 0) {
            return results;
        }

        try {
            // Create a temporary CSV file with only missing results
            const tempCsvFile = await this._createFilteredCsvFile(missingAthletes, meetId, meetName);

            this.logger.info(`📄 Created filtered CSV with ${missingAthletes.length} missing results`);

            // Use existing proven import infrastructure WITH enhanced Tier 2 verification
            const { processMeetCsvFile } = require('../../production/database-importer-custom');

            this.logger.info(`🔄 Importing missing results using proven infrastructure...`);

            // Import using existing logic (includes athlete matching, Tier 1/2 verification, etc.)
            const importResult = await processMeetCsvFile(tempCsvFile, meetId, meetName);

            // Update results based on import outcome
            results.imported = importResult.processed || 0;
            results.errors = [];

            // If there were errors, create error entries
            if (importResult.errors && importResult.errors > 0) {
                // We don't have detailed error info from processMeetCsvFile, so create generic entries
                const errorCount = Math.min(importResult.errors, missingAthletes.length);
                for (let i = 0; i < errorCount; i++) {
                    results.errors.push({
                        name: missingAthletes[i]?.name || 'Unknown',
                        reason: 'Import failed during processing'
                    });
                }
            }

            // Clean up temporary file
            const fs = require('fs').promises;
            try {
                await fs.unlink(tempCsvFile);
                this.logger.debug(`🗑️ Cleaned up temporary CSV file`);
            } catch (cleanupError) {
                this.logger.warn(`⚠️ Failed to clean up temporary file: ${cleanupError.message}`);
            }

            this.logger.info(`✅ Import completed: ${results.imported} imported, ${results.errors.length} errors`);

            return results;

        } catch (error) {
            this.logger.error(`❌ Batch import failed: ${error.message}`);

            // Mark all as errors
            results.imported = 0;
            results.errors = missingAthletes.map(athlete => ({
                name: athlete.name,
                reason: `Batch import failed: ${error.message}`
            }));

            return results;
        }
    }

    /**
     * Match and import a single athlete using existing logic
     */
    async _matchAndImportAthlete(athlete, meetId, meetName) {
        try {
            // This method is no longer used - we now use batch import via processMeetCsvFile
            // This is kept for backward compatibility but should not be called
            throw new Error('_matchAndImportAthlete is deprecated - use _importMissingAthletesBatch instead');
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Create a temporary CSV file with only missing results in the format expected by processMeetCsvFile
     */
    async _createFilteredCsvFile(missingAthletes, meetId, meetName) {
        const path = require('path');
        const os = require('os');

        // Create temporary file path
        const tempDir = os.tmpdir();
        const timestamp = Date.now();
        const tempFilePath = path.join(tempDir, `missing_results_${meetId}_${timestamp}.csv`);

        // Get meet details for CSV data
        const { data: meetData, error: meetError } = await this.supabase
            .from('usaw_meets')
            .select('Meet, Date')
            .eq('meet_id', meetId)
            .single();

        if (meetError) {
            this.logger.warn(`⚠️ Could not fetch meet details: ${meetError.message}`);
        }

        const meetDate = meetData?.Date || new Date().toISOString().split('T')[0];
        const actualMeetName = meetData?.Meet || meetName;

        // Create CSV header (matching the format expected by processMeetCsvFile)
        const csvHeader = [
            'Meet',
            'Date',
            'Age Category',
            'Weight Class',
            'Lifter',
            'Body Weight (Kg)',
            'Snatch Lift 1',
            'Snatch Lift 2',
            'Snatch Lift 3',
            'Best Snatch',
            'C&J Lift 1',
            'C&J Lift 2',
            'C&J Lift 3',
            'Best C&J',
            'Total',
            'Club',
            'Membership Number',
            'Internal_ID'
        ].join('|');

        // Create CSV rows for missing athletes
        const csvRows = missingAthletes.map(athlete => {
            return [
                athlete.meetName || actualMeetName,    // Meet
                athlete.date || meetDate,              // Date
                athlete.ageCategory || '',             // Age Category (e.g., "Open Men's")
                athlete.weightClass || '',             // Weight Class (e.g., "+105 kg")
                athlete.name,                          // Lifter
                athlete.bodyweight !== undefined && athlete.bodyweight !== null ? athlete.bodyweight : '', // Body Weight (Kg)
                athlete.snatchLift1 !== undefined && athlete.snatchLift1 !== null ? athlete.snatchLift1 : '', // Snatch Lift 1
                athlete.snatchLift2 !== undefined && athlete.snatchLift2 !== null ? athlete.snatchLift2 : '', // Snatch Lift 2
                athlete.snatchLift3 !== undefined && athlete.snatchLift3 !== null ? athlete.snatchLift3 : '', // Snatch Lift 3
                athlete.bestSnatch !== undefined && athlete.bestSnatch !== null ? athlete.bestSnatch : '',    // Best Snatch
                athlete.cjLift1 !== undefined && athlete.cjLift1 !== null ? athlete.cjLift1 : '',             // C&J Lift 1
                athlete.cjLift2 !== undefined && athlete.cjLift2 !== null ? athlete.cjLift2 : '',             // C&J Lift 2
                athlete.cjLift3 !== undefined && athlete.cjLift3 !== null ? athlete.cjLift3 : '',             // C&J Lift 3
                athlete.bestCJ !== undefined && athlete.bestCJ !== null ? athlete.bestCJ : '',                // Best C&J
                (athlete.total !== null && athlete.total !== undefined) ? athlete.total : '', // Total - preserve 0!
                athlete.club || '',                    // Club
                '',                                    // Membership Number (unknown)
                ''                                     // Internal_ID (will be extracted during import)
            ].join('|');
        });

        // Combine header and rows
        const csvContent = [csvHeader, ...csvRows].join('\n');

        // Write to temporary file
        await fs.writeFile(tempFilePath, csvContent, 'utf8');

        this.logger.debug(`📄 Created temporary CSV file: ${tempFilePath}`);

        return tempFilePath;
    }
}

module.exports = { SmartImporter };
