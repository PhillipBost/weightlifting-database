/**
 * Meet Completeness Engine
 * 
 * Identifies incomplete meets by comparing result counts between Sport80 and database.
 * Handles meet filtering, completeness analysis, and result count comparison.
 */

const { ReImportLogger } = require('./re-import-logger');

class MeetCompletenessEngine {
    constructor(supabaseClient, options = {}) {
        this.supabase = supabaseClient;
        this.logger = new ReImportLogger('MeetCompletenessEngine');
        this.options = {
            batchSize: options.batchSize || 50,
            ...options
        };
    }

    /**
     * Get incomplete meets based on filter criteria
     * @param {Object} filters - Filter criteria for meet selection
     * @param {string[]} filters.meetIds - Specific meet IDs to check
     * @param {string} filters.startDate - Start date for date range filter
     * @param {string} filters.endDate - End date for date range filter
     * @param {number} filters.limit - Maximum number of meets to return
     * @returns {Promise<Array>} Array of incomplete meet records
     */
    async getIncompleteMeets(filters = {}) {
        console.log('[MeetCompletenessEngine] Native Log: Starting incomplete meet identification', filters);
        this.logger.info('Starting incomplete meet identification', { filters });

        try {
            // Get candidate meets from database
            const candidateMeets = await this._getCandidateMeets(filters);
            this.logger.info(`Found ${candidateMeets.length} candidate meets to analyze`);

            // Analyze each meet for completeness
            const incompleteMeets = [];
            const totalCandidates = candidateMeets.length;
            let processedCount = 0;

            for (const meet of candidateMeets) {
                processedCount++;
                const completenessResult = await this.analyzeMeetCompleteness(meet.id);

                this.logger.info(`Meet number ${meet.id} analysis complete (meet ${processedCount} out of ${totalCandidates})`);

                // If force is enabled or meet is incomplete, add it to the list
                if (this.options.force || !completenessResult.isComplete) {
                    if (this.options.force && completenessResult.isComplete) {
                        this.logger.info(`Force enabled - including complete meet ${meet.id}`);
                    }

                    incompleteMeets.push({
                        ...meet,
                        completenessResult
                    });
                }
            }

            this.logger.info(`Identified ${incompleteMeets.length} incomplete meets`);
            return incompleteMeets;

        } catch (error) {
            this.logger.error('Failed to get incomplete meets', { error: error.message, filters });
            throw error;
        }
    }

    /**
     * Analyze completeness of a specific meet
     * @param {number} meetId - Database meet ID
     * @returns {Promise<Object>} Completeness analysis result
     */
    async analyzeMeetCompleteness(meetId) {
        this.logger.debug(`Analyzing completeness for meet ${meetId}`);

        try {
            // Get meet details from database
            const meetDetails = await this._getMeetDetails(meetId);
            if (!meetDetails) {
                throw new Error(`Meet ${meetId} not found in database`);
            }

            this.logger.debug(`Meet details for ${meetId}:`, {
                name: meetDetails.name,
                date: meetDetails.date,
                sport80_id: meetDetails.sport80_id
            });

            // 1. Check for incomplete results (rows with NULL totals) - FAST DB CHECK
            // We prioritize this because if we have NULLs, the meet is definitely incomplete 
            // and we don't need to waste time scraping Sport80 to count rows.
            const hasIncompleteResults = await this._hasIncompleteResults(meetId);

            if (hasIncompleteResults) {
                this.logger.info(`Meet ${meetId} has incomplete results (NULL values) - marked incomplete without scraping`, { meetName: meetDetails.name });

                // Return early with incomplete status
                return {
                    meetId,
                    meetInternalId: meetDetails.sport80_id,
                    meetName: meetDetails.name,
                    meetDate: meetDetails.date,
                    sport80ResultCount: null, // Skipped
                    databaseResultCount: null, // Skipped (or we could fetch it, but effectively irrelevant if we know it's broken)
                    resultCountMatch: false,
                    hasIncompleteResults: true,
                    isComplete: false,
                    discrepancy: 0,
                    lastCheckedDate: new Date(),
                    status: 'incomplete_metadata', // distinguish
                    errorLog: []
                };
            }

            // 2. Get result counts - SLOW EXTERNAL CHECK
            // Only proceed to scrape Sport80 if we don't have obvious data gaps
            const databaseCount = await this._getDatabaseResultCount(meetId);
            const sport80Count = await this._getSport80ResultCount(meetDetails.sport80_id);

            // Compare counts and determine completeness
            const resultCountMatch = sport80Count === databaseCount;
            // Meet is incomplete if counts don't match OR if we have incomplete (NULL) results (already checked above)
            const isComplete = resultCountMatch;
            const discrepancy = sport80Count - databaseCount;

            // Log discrepancies for analysis
            if (!resultCountMatch) {
                this.logger.info(`Meet ${meetId} has result count discrepancy`, {
                    meetName: meetDetails.name,
                    sport80Count,
                    databaseCount,
                    discrepancy,
                    status: discrepancy > 0 ? 'incomplete' : 'database_has_more'
                });

                // If Sport80 has MORE results, check for duplicates
                // This helps identify if the "missing" results are actually just duplicates 
                // that our import logic correctly de-duplicated
                if (sport80Count > databaseCount) {
                    await this._findDuplicates(meetId, meetDetails.sport80_id);
                }
            } else {
                this.logger.debug(`Meet ${meetId} result counts match and data is complete`, {
                    meetName: meetDetails.name,
                    count: sport80Count
                });
            }

            const result = {
                meetId,
                meetInternalId: meetDetails.sport80_id,
                meetName: meetDetails.name,
                meetDate: meetDetails.date,
                sport80ResultCount: sport80Count,
                databaseResultCount: databaseCount,
                resultCountMatch,
                hasIncompleteResults: false, // We know this is false because we passed the check above
                isComplete,
                discrepancy,
                lastCheckedDate: new Date(),
                status: isComplete ? 'complete' : 'incomplete',
                errorLog: []
            };

            this.logger.debug(`Meet ${meetId} completeness analysis completed`, {
                isComplete,
                sport80Count,
                databaseCount,
                discrepancy
            });

            return result;

        } catch (error) {
            this.logger.error(`Failed to analyze meet ${meetId} completeness`, { error: error.message });
            return {
                meetId,
                meetInternalId: null,
                meetName: 'Unknown',
                meetDate: null,
                sport80ResultCount: 0,
                databaseResultCount: 0,
                resultCountMatch: false,
                isComplete: false,
                discrepancy: 0,
                lastCheckedDate: new Date(),
                status: 'failed',
                errorLog: [error.message]
            };
        }
    }

    /**
     * Check if a meet should be skipped (already complete)
     * @param {number} meetId - Database meet ID
     * @returns {Promise<boolean>} True if meet should be skipped
     */
    async shouldSkipMeet(meetId) {
        try {
            const completenessResult = await this.analyzeMeetCompleteness(meetId);
            return completenessResult.isComplete;
        } catch (error) {
            this.logger.warn(`Error checking skip status for meet ${meetId}, will not skip`, { error: error.message });
            return false;
        }
    }

    /**
     * Get candidate meets from database based on filters
     * @private
     */
    async _getCandidateMeets(filters) {
        let query = this.supabase
            .from('usaw_meets')
            .select('meet_id, Meet, Date, meet_internal_id')
            .not('meet_internal_id', 'is', null);

        // Apply filters
        if (filters.meetIds && filters.meetIds.length > 0) {
            query = query.in('meet_id', filters.meetIds);
        }

        if (filters.startDate) {
            query = query.gte('Date', filters.startDate);
        }

        if (filters.endDate) {
            query = query.lte('Date', filters.endDate);
        }

        if (filters.limit) {
            query = query.limit(filters.limit);
        }

        const { data, error } = await query.order('Date', { ascending: false });

        if (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }

        // Map to expected format
        return (data || []).map(meet => ({
            id: meet.meet_id,
            name: meet.Meet,
            date: meet.Date,
            sport80_id: meet.meet_internal_id
        }));
    }

    /**
     * Get meet details from database
     * @private
     */
    async _getMeetDetails(meetId) {
        const { data, error } = await this.supabase
            .from('usaw_meets')
            .select('meet_id, Meet, Date, meet_internal_id')
            .eq('meet_id', meetId)
            .single();

        if (error) {
            throw new Error(`Failed to get meet details: ${error.message}`);
        }

        // Map to expected format
        return {
            id: data.meet_id,
            name: data.Meet,
            date: data.Date,
            sport80_id: data.meet_internal_id
        };
    }

    /**
     * Get result count from database for a meet
     * @private
     */
    async _getDatabaseResultCount(meetId) {
        this.logger.debug(`Querying database result count for meet ${meetId}`);

        const { count, error } = await this.supabase
            .from('usaw_meet_results')
            .select('*', { count: 'exact', head: true })
            .eq('meet_id', meetId);

        if (error) {
            this.logger.error(`Failed to get database result count for meet ${meetId}`, { error: error.message });
            throw new Error(`Failed to get database result count: ${error.message}`);
        }

        const resultCount = count || 0;
        this.logger.debug(`Database result count for meet ${meetId}: ${resultCount}`);

        return resultCount;
    }

    /**
     * Check if meet has incomplete results (NULL values)
     * @private
     */
    async _hasIncompleteResults(meetId) {
        // We consider a result incomplete if Total is NULL (or 0, though database stores 0 correctly now)
        // Strictly searching for NULLs in key fields
        const { count, error } = await this.supabase
            .from('usaw_meet_results')
            .select('*', { count: 'exact', head: true })
            .eq('meet_id', meetId)
            // Check if Total is NULL. 
            // Note: Some bomb-outs might genuinely have 0 Total, but scraped data usually has 0. 
            // If it's NULL, it's definitely an issue.
            .is('total', null);

        if (error) {
            this.logger.error(`Failed to check incomplete results for meet ${meetId}`, { error: error.message });
            return false; // Assume false on error to avoid blocking, or throw?
        }

        return count > 0;
    }

    /**
     * Get result count from Sport80 for a meet
     * @private
     */
    async _getSport80ResultCount(sport80Id) {
        const puppeteer = require('puppeteer');

        this.logger.debug(`Extracting Sport80 result count for meet ${sport80Id}`);

        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--disable-extensions'
                ]
            });

            const page = await browser.newPage();
            await page.setViewport({ width: 1500, height: 1000 });

            const url = `https://usaweightlifting.sport80.com/public/rankings/results/${sport80Id}`;
            this.logger.debug(`Navigating to Sport80 meet page: ${url}`);

            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            // Check if meet exists by looking for the data table
            const tableExists = await page.$('.data-table div div.v-data-table div.v-data-table__wrapper table');
            if (!tableExists) {
                throw new Error(`Meet ${sport80Id} not found or has no results table`);
            }

            // Get pagination info to determine total result count
            const paginationText = await page.$eval(
                ".data-table div div.v-data-table div.v-data-footer div.v-data-footer__pagination",
                x => x.textContent
            ).catch(() => {
                // If no pagination element, check if there are any results at all
                return null;
            });

            if (!paginationText) {
                // No pagination means either no results or very few results
                // Count rows directly
                const rowCount = await page.evaluate(() => {
                    const rows = document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr');
                    // Filter out header rows
                    let validRows = 0;
                    for (const row of rows) {
                        const cells = row.querySelectorAll('td');
                        if (cells.length > 0) {
                            // Check if this is a header row by looking for "Snatch Lift 1" text
                            const isHeaderRow = Array.from(cells).some(cell =>
                                cell.textContent.includes('Snatch Lift 1')
                            );
                            if (!isHeaderRow) {
                                validRows++;
                            }
                        }
                    }
                    return validRows;
                });

                this.logger.debug(`No pagination found, counted ${rowCount} rows directly`);
                return rowCount;
            }

            // Parse pagination text like "1-30 of 150" to get total count
            const totalMatch = paginationText.match(/of (\d+)/);
            if (!totalMatch) {
                throw new Error(`Could not parse pagination text: ${paginationText}`);
            }

            const totalCount = parseInt(totalMatch[1]);
            this.logger.debug(`Extracted total result count: ${totalCount} from pagination: ${paginationText}`);

            return totalCount;

        } catch (error) {
            this.logger.error(`Failed to extract Sport80 result count for meet ${sport80Id}`, {
                error: error.message,
                url: `https://usaweightlifting.sport80.com/public/rankings/results/${sport80Id}`
            });
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    /**
     * Find and log duplicate results from Sport80
     * @private
     */
    async _findDuplicates(meetId, sport80Id) {
        this.logger.info(`🔍 Investigating discrepancies for meet ${meetId}...`);

        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        const { scrapeOneMeet } = require('../../production/scrapeOneMeet');

        const tempDir = os.tmpdir();
        const tempFile = path.join(tempDir, `discrepancy_check_${meetId}_${Date.now()}.csv`);

        try {
            this.logger.info(`   🌐 Scraping Sport80 for duplicate analysis (Meet ${sport80Id})...`);

            // Scrape the meet
            await scrapeOneMeet(sport80Id, tempFile);

            if (!fs.existsSync(tempFile)) {
                this.logger.warn('   ⚠️ Scrape failed - no output file created');
                return;
            }

            // Read and parse the scraped CSV
            const content = fs.readFileSync(tempFile, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());

            if (lines.length < 2) {
                this.logger.warn('   ⚠️ Scraped file is empty or missing headers');
                return;
            }

            const header = lines[0].split('|').map(h => h.trim());
            const rows = lines.slice(1).map((line, index) => {
                const cells = line.split('|').map(c => c.trim());
                const row = {};
                header.forEach((h, i) => {
                    row[h] = cells[i] || '';
                });
                return row;
            });

            this.logger.info(`   📊 Analyzed ${rows.length} scraped records for duplicates...`);

            // Find duplicates using a Map
            const seen = new Map();
            const duplicates = [];

            rows.forEach((row, index) => {
                // Create a unique key for the result
                // Name + Division (Age Category + Weight Class) + Total + Best Snatch + Best CJ
                // This combination is almost certainly unique for a single event

                // Helper to normalize
                const norm = (val) => String(val || '').toLowerCase().trim();

                const key = [
                    norm(row['Name'] || row['Lifter']),
                    norm(row['Age Category']),
                    norm(row['Weight Class']),
                    norm(row['Total']),
                    norm(row['Best Snatch']),
                    norm(row['Best C&J'])
                ].join('||');

                if (seen.has(key)) {
                    duplicates.push({
                        original: seen.get(key),
                        duplicate: { ...row, rowIndex: index + 2 } // +2 for 1-based index including header
                    });
                } else {
                    seen.set(key, { ...row, rowIndex: index + 2 });
                }
            });

            if (duplicates.length > 0) {
                this.logger.info(`   🚨 Found ${duplicates.length} DUPLICATE results on Sport80:`);
                duplicates.forEach((dup, i) => {
                    const r = dup.duplicate;
                    this.logger.info(`      ${i + 1}. ${r['Name'] || r['Lifter']} (${r['Age Category']} / ${r['Weight Class']}) - Total: ${r['Total']} [Rows: ${dup.original.rowIndex} & ${dup.duplicate.rowIndex}]`);
                });
            } else {
                this.logger.info('   ✨ No obvious duplicates found in scraped data (discrepancy might be ghost records in DB)');
            }

        } catch (error) {
            this.logger.error(`   ❌ Failed to analyze duplicates: ${error.message}`);
        } finally {
            // Clean up
            if (fs.existsSync(tempFile)) {
                try {
                    fs.unlinkSync(tempFile);
                } catch (e) {
                    // Ignore cleanup error
                }
            }
        }
    }
}

module.exports = { MeetCompletenessEngine };
