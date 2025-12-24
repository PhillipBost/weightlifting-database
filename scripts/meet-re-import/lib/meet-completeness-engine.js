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
        this.logger.info('Starting incomplete meet identification', { filters });
        
        try {
            // Get candidate meets from database
            const candidateMeets = await this._getCandidateMeets(filters);
            this.logger.info(`Found ${candidateMeets.length} candidate meets to analyze`);

            // Analyze each meet for completeness
            const incompleteMeets = [];
            for (const meet of candidateMeets) {
                const completenessResult = await this.analyzeMeetCompleteness(meet.id);
                if (!completenessResult.isComplete) {
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

            // Get result counts
            const databaseCount = await this._getDatabaseResultCount(meetId);
            const sport80Count = await this._getSport80ResultCount(meetDetails.sport80_id);

            // Compare counts and determine completeness
            const resultCountMatch = sport80Count === databaseCount;
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
            } else {
                this.logger.debug(`Meet ${meetId} result counts match`, {
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
}

module.exports = { MeetCompletenessEngine };