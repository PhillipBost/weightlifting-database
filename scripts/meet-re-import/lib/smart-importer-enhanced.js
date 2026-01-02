/**
 * Smart Importer - Only processes missing athletes with athlete name filtering support
 * 
 * Compares scraped data against database and only processes what's actually missing
 * Supports filtering to only process specific athletes when specified
 */

const fs = require('fs').promises;
const csv = require('csv-parser');
const { createReadStream } = require('fs');

class SmartImporterEnhanced {
    constructor(supabaseClient, logger) {
        this.supabase = supabaseClient;
        this.logger = logger;
    }

    /**
     * Import only missing results from a meet
     * @param {string} csvFile - Path to scraped CSV file
     * @param {number} meetId - Database meet ID
     * @param {string} meetName - Meet name
     * @param {string} athleteName - Optional athlete name to filter for
     * @param {boolean} force - If true, re-import matching athletes even if they exist
     */
    async importMissingAthletes(csvFile, meetId, meetName, athleteName = null, force = false) {
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
            if (athleteName) {
                const normalizedTargetName = this._normalizeAthleteName(athleteName);
                const originalCount = scrapedAthletes.length;
                scrapedAthletes = scrapedAthletes.filter(athlete => {
                    const athleteNameNormalized = this._normalizeAthleteName(athlete.name);
                    return athleteNameNormalized === normalizedTargetName;
                });

                this.logger.info(`🎯 Applied athlete filter: "${athleteName}" - found ${scrapedAthletes.length} of ${originalCount} athletes matching`);

                if (scrapedAthletes.length === 0) {
                    this.logger.warn(`⚠️ No athletes found matching name "${athleteName}"`);
                    return {
                        processed: 0,
                        imported: 0,
                        skipped: originalCount,
                        errors: [{
                            name: athleteName,
                            reason: `No athlete found with name "${athleteName}"`
                        }]
                    };
                }
            }

            // Step 4: Identify missing results (or force all if force=true)
            const missingAthletes = this._identifyMissingAthletes(scrapedAthletes, existingResults, force);

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

            // Step 5: Process only missing results
            const results = await this._processMissingAthletes(missingAthletes, meetId, meetName);

            // Step 6: Summary
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

            return validRows.map((row, index) => {
                return {
                    rowNumber: index + 1,
                    meetName: row.Meet || '',                           // Meet name
                    date: row.Date || '',                               // Date
                    ageCategory: row['Age Category'] || '',             // Age Category (e.g., "Open Men's")
                    weightClass: row['Weight Class'] || '',             // Weight Class (e.g., "+105 kg")
                    name: row.Lifter || 'Unknown',                      // Lifter name
                    bodyweight: row['Body Weight (Kg)'] || '',          // Body Weight (Kg)
                    snatchLift1: row['Snatch Lift 1'] || '',            // Snatch Lift 1
                    snatchLift2: row['Snatch Lift 2'] || '',            // Snatch Lift 2
                    snatchLift3: row['Snatch Lift 3'] || '',            // Snatch Lift 3
                    bestSnatch: row['Best Snatch'] || '',               // Best Snatch
                    cjLift1: row['C&J Lift 1'] || '',                  // C&J Lift 1
                    cjLift2: row['C&J Lift 2'] || '',                  // C&J Lift 2
                    cjLift3: row['C&J Lift 3'] || '',                  // C&J Lift 3
                    bestCJ: row['Best C&J'] || '',                      // Best C&J
                    total: row.Total || '',                             // Total
                    club: row.Club || ''                                // Club
                };
            });
        } catch (error) {
            this.logger.error(`Failed to analyze scraped data: ${error.message}`);
            return [];
        }
    }

    * Identify which results are missing from database
        * Handles duplicate names by comparing multiple attributes
            * @param { Array } scrapedAthletes
                * @param { Array } existingResults
                    * @param { boolean } force - If true, treats all scraped athletes as "missing" (needs import)
     */
_identifyMissingAthletes(scrapedAthletes, existingResults, force = false) {
    if (force) {
        this.logger.info('⚠️ Force mode enabled: treating all matching athletes as missing/needing update');
        return scrapedAthletes;
    }

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

    const totalMatch = this._normalizeTotal(scrapedAthlete.total) ===
        this._normalizeTotal(existingResult.total);

    // Require both bodyweight and total to match for precise identification
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
    if (!total) return '';
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
            athlete.total !== undefined && athlete.total !== null ? athlete.total : '',                   // Total
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

module.exports = { SmartImporterEnhanced };
