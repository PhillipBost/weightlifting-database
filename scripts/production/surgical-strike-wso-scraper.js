#!/usr/bin/env node

/**
 * WSO Scraper - Modernized Version
 * 
 * Targets meet results missing WSO data using a tiered search strategy
 * with duplicate name detection to prevent data pollution.
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

// Import system components
const { SimpleLogger } = require('../meet-re-import/lib/simple-logger');

// =================================================================
// CONFIGURATION CLASS
// =================================================================

class WsoScraperConfiguration {
    constructor(options = {}) {
        // Environment configuration (with CLI args taking precedence)
        this.startDate = options.startDate || null;
        this.endDate = options.endDate || null;
        this.genderFilter = options.genderFilter || null;
        this.maxResults = options.maxResults || null;
        this.dryRun = options.dryRun || false;
        this.meetIds = options.meetIds || null;
        this.athleteName = options.athleteName || null;
        this.force = options.force || false;

        // Scraping settings
        this.headless = options.headless !== undefined ? options.headless : true;
        this.dateWindowDays = options.dateWindowDays || 5;

        // Paths
        this.unresolvedPath = options.unresolvedPath || path.join(__dirname, '../../logs/surgical-strike-wso-unresolved.json');
        this.updatesLogPath = options.updatesLogPath || path.join(__dirname, `../../logs/surgical-strike-wso-updates-${new Date().toISOString().split('T')[0]}.csv`);
        this.divisionCodesPath = options.divisionCodesPath || path.join(__dirname, '../../division_base64_codes.json');
    }

    /**
     * Validate configuration
     * @returns {Array} Array of validation errors
     */
    validate() {
        const errors = [];

        if (this.dateWindowDays <= 0) {
            errors.push('dateWindowDays must be greater than 0');
        }

        if (this.genderFilter && !['M', 'F'].includes(this.genderFilter)) {
            errors.push('genderFilter must be "M" or "F"');
        }

        if (this.maxResults !== null && this.maxResults <= 0) {
            errors.push('maxResults must be greater than 0');
        }

        if (this.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(this.startDate)) {
            errors.push('startDate must be in YYYY-MM-DD format');
        }

        if (this.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(this.endDate)) {
            errors.push('endDate must be in YYYY-MM-DD format');
        }

        if (this.meetIds && !Array.isArray(this.meetIds) && typeof this.meetIds !== 'string') {
            errors.push('meetIds must be a string or array');
        }

        return errors;
    }
}

// =================================================================
// SESSION TRACKING
// =================================================================

class WsoScraperSession {
    constructor(sessionId = null) {
        this.sessionId = sessionId || this._generateSessionId();
        this.startTime = new Date();
        this.endTime = null;
        this.processed = 0;
        this.updated = 0;
        this.skipped = 0;
        this.unresolved = 0;
        this.errors = 0;
        this.summary = '';
    }

    complete(summary = '') {
        this.endTime = new Date();
        this.summary = summary;
    }

    getDuration() {
        const endTime = this.endTime || new Date();
        return endTime - this.startTime;
    }

    getDurationMinutes() {
        return (this.getDuration() / (1000 * 60)).toFixed(2);
    }

    _generateSessionId() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const random = Math.random().toString(36).substring(2, 8);
        return `wso-scraper-${timestamp}-${random}`;
    }
}

// =================================================================
// UTILITY FUNCTIONS
// =================================================================

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function formatDate(date) {
    if (typeof date === 'string') {
        return date;
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

// =================================================================
// MAIN CLI CLASS
// =================================================================

class WsoScraperCLI {
    constructor() {
        this.logger = new SimpleLogger('WsoScraperCLI');
        this.supabase = null;
        this.config = null;
        this.session = null;
    }

    /**
     * Initialize the CLI application
     */
    async initialize() {
        try {
            // Initialize Supabase client
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
            );

            this.logger.info('Initialized Supabase client');

        } catch (error) {
            this.logger.error(`Failed to initialize CLI: ${error.message}`);
            throw error;
        }
    }

    /**
     * Parse command line arguments
     * @param {Array} argv - Command line arguments
     * @returns {Object} Parsed arguments
     */
    parseArguments(argv) {
        const args = minimist(argv.slice(2), {
            string: ['start-date', 'end-date', 'gender', 'gender-filter', 'max-results', 'log-level', 'meet-ids', 'athlete-name'],
            number: ['max-results'],
            boolean: ['dry-run', 'help', 'version', 'force'],
            alias: {
                'h': 'help',
                'v': 'version',
                'd': 'dry-run',
                'f': 'force'
            },
            default: {
                'log-level': 'info'
            }
        });

        return args;
    }

    /**
     * Show help information
     */
    showHelp() {
        console.log(`
WSO Scraper - Surgical Strike WSO Data Scraper

Usage: node surgical-strike-wso-scraper.js [options]

Options:
  --start-date <date>     Start date for filtering results (YYYY-MM-DD)
  --end-date <date>       End date for filtering results (YYYY-MM-DD)
  --gender <M|F>          Filter by gender (M for Male, F for Female)
  --max-results <n>       Maximum number of results to process
  --meet-ids <ids>        Comma-separated list of specific meet IDs to process
  --athlete-name <name>   Filter by specific athlete name
  --force, -f             Force processing even if WSO data already exists
  --dry-run, -d           Show what would be done without actually doing it
  --log-level <level>     Log level: error, warn, info, debug (default: info)
  --help, -h              Show this help message
  --version, -v           Show version information

Environment Variables (used as fallback if CLI args not provided):
  START_DATE              Start date (YYYY-MM-DD)
  END_DATE                End date (YYYY-MM-DD)
  GENDER_FILTER           Gender filter (M or F)
  MAX_RESULTS             Maximum number of results
  MEET_IDS                Comma-separated list of meet IDs
  ATHLETE_NAME            Athlete name filter
  DRY_RUN                 Set to 'true' for dry run mode
  FORCE                   Set to 'true' to force processing

Examples:
  # Scrape WSO data for results in date range
  node surgical-strike-wso-scraper.js --start-date=2024-01-01 --end-date=2024-12-31

  # Process specific meet IDs
  node surgical-strike-wso-scraper.js --meet-ids=2755,2595,3000

  # Process specific athlete
  node surgical-strike-wso-scraper.js --athlete-name="Holly Arrow"

  # Force re-process even if WSO exists
  node surgical-strike-wso-scraper.js --meet-ids=2755 --force

  # Dry run to see what would be processed
  node surgical-strike-wso-scraper.js --dry-run --max-results=10

  # Process with gender filter
  node surgical-strike-wso-scraper.js --gender=M --max-results=50
        `);
    }

    /**
     * Show version information
     */
    showVersion() {
        const packageJson = require('../../package.json');
        console.log(`WSO Scraper v${packageJson.version}`);
    }

    /**
     * Create configuration from arguments and environment
     * @param {Object} args - Parsed command line arguments
     * @returns {WsoScraperConfiguration}
     */
    createConfiguration(args) {
        // Parse meet IDs from comma-separated string
        let meetIds = null;
        if (args['meet-ids']) {
            meetIds = args['meet-ids'].split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        } else if (process.env.MEET_IDS) {
            meetIds = process.env.MEET_IDS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        }

        return new WsoScraperConfiguration({
            startDate: args['start-date'] || process.env.START_DATE || null,
            endDate: args['end-date'] || process.env.END_DATE || null,
            genderFilter: args.gender || args['gender-filter'] || process.env.GENDER_FILTER || null,
            maxResults: args['max-results'] ? parseInt(args['max-results']) : (process.env.MAX_RESULTS ? parseInt(process.env.MAX_RESULTS) : null),
            meetIds: meetIds,
            athleteName: args['athlete-name'] || process.env.ATHLETE_NAME || null,
            force: args.force || args.f || process.env.FORCE === 'true',
            dryRun: args['dry-run'] || process.env.DRY_RUN === 'true',
            headless: true,
            dateWindowDays: 5
        });
    }

    /**
     * Load unresolved list from file
     */
    loadUnresolvedList() {
        if (fs.existsSync(this.config.unresolvedPath)) {
            try {
                const data = fs.readFileSync(this.config.unresolvedPath, 'utf8');
                const unresolvedList = JSON.parse(data);
                this.logger.info(`Loaded ${unresolvedList.length} unresolved results from skip list`);
                return new Set(unresolvedList.map(r => r.result_id));
            } catch (error) {
                this.logger.warn(`Failed to load unresolved list: ${error.message}`);
                return new Set();
            }
        }
        this.logger.info('No existing unresolved list found');
        return new Set();
    }

    /**
     * Save unresolved result to file
     */
    saveUnresolvedResult(unresolvedResult) {
        if (this.config.dryRun) return;

        ensureDirectoryExists(path.dirname(this.config.unresolvedPath));

        let existing = [];
        if (fs.existsSync(this.config.unresolvedPath)) {
            try {
                existing = JSON.parse(fs.readFileSync(this.config.unresolvedPath, 'utf8'));
            } catch (error) {
                this.logger.warn(`Failed to load existing unresolved list: ${error.message}`);
            }
        }

        const existingIds = new Set(existing.map(r => r.result_id));
        if (existingIds.has(unresolvedResult.result_id)) {
            return;
        }

        existing.push(unresolvedResult);
        fs.writeFileSync(this.config.unresolvedPath, JSON.stringify(existing, null, 2));
        this.logger.info(`Saved unresolved result ${unresolvedResult.result_id} to skip list (total: ${existing.length})`);
    }

    /**
     * Get division gender from division name
     */
    getDivisionGender(divisionName) {
        if (!divisionName) return null;
        const lower = divisionName.toLowerCase();
        if (lower.includes("women")) return 'F';
        if (lower.includes("men") && !lower.includes("women")) return 'M';
        return null;
    }

    /**
     * Load and filter divisions by gender
     */
    loadAndFilterDivisions(targetGender) {
        this.logger.info('Loading division codes...');

        if (!fs.existsSync(this.config.divisionCodesPath)) {
            throw new Error(`Division codes file not found: ${this.config.divisionCodesPath}`);
        }

        const divisionData = JSON.parse(fs.readFileSync(this.config.divisionCodesPath, 'utf8'));
        const allDivisions = divisionData.division_codes;

        this.logger.info(`Total divisions in file: ${Object.keys(allDivisions).length}`);

        if (!targetGender) {
            this.logger.info('No gender filter applied - using all divisions');
            return allDivisions;
        }

        const filtered = {};
        for (const [divisionName, code] of Object.entries(allDivisions)) {
            const gender = this.getDivisionGender(divisionName);
            if (gender === targetGender) {
                filtered[divisionName] = code;
            }
        }

        const genderLabel = targetGender === 'M' ? "Men's" : "Women's";
        this.logger.info(`Filtered to ${Object.keys(filtered).length} ${genderLabel} divisions`);

        return filtered;
    }

    /**
     * Query incomplete results from database
     */
    async queryIncompleteResults(skipList) {
        if (this.config.force) {
            this.logger.info('Querying database for results (force mode - including results with WSO and total=0)...');
        } else {
            this.logger.info('Querying database for results missing WSO (excluding total=0)...');
        }

        let query = this.supabase
            .from('usaw_meet_results')
            .select('result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, competition_age, wso, club_name, total')
            .not('age_category', 'is', null)
            .not('weight_class', 'is', null)
            .not('meet_id', 'is', null);

        // Only filter by total > 0 if not in force mode (force mode includes results with total=0)
        if (!this.config.force) {
            query = query.filter('total', 'gt', '0');
        }

        // Only filter by missing WSO if not in force mode
        if (!this.config.force) {
            query = query.is('wso', null);
        }

        // Filter by meet IDs if specified
        if (this.config.meetIds && this.config.meetIds.length > 0) {
            query = query.in('meet_id', this.config.meetIds);
            this.logger.info(`Filtering: meet_id IN (${this.config.meetIds.join(', ')})`);
        }

        // Filter by athlete name if specified
        if (this.config.athleteName) {
            query = query.eq('lifter_name', this.config.athleteName);
            this.logger.info(`Filtering: lifter_name = "${this.config.athleteName}"`);
        }

        if (this.config.startDate) {
            query = query.gte('date', this.config.startDate);
            this.logger.info(`Filtering: date >= ${this.config.startDate}`);
        }
        if (this.config.endDate) {
            query = query.lte('date', this.config.endDate);
            this.logger.info(`Filtering: date <= ${this.config.endDate}`);
        }

        if (this.config.genderFilter) {
            query = query.eq('gender', this.config.genderFilter);
            const genderLabel = this.config.genderFilter === 'M' ? 'Male' : 'Female';
            this.logger.info(`Filtering: gender = ${genderLabel}`);
        } else {
            this.logger.info('No gender filter - including results with NULL gender');
        }

        if (this.config.maxResults) {
            query = query.limit(this.config.maxResults);
            this.logger.info(`Limiting to ${this.config.maxResults} results`);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }

        if (this.config.force) {
            this.logger.info(`Found ${data.length} results${this.config.meetIds ? ` for specified meet(s)` : ''}${this.config.athleteName ? ` for "${this.config.athleteName}"` : ''}`);
        } else {
            this.logger.info(`Found ${data.length} results missing WSO`);
        }

        // Get unique meet_ids to fetch correct dates
        const meetIds = [...new Set(data.map(r => r.meet_id))];
        this.logger.info(`Fetching dates for ${meetIds.length} unique meets...`);

        const BATCH_SIZE = 100;
        const allMeets = [];

        for (let i = 0; i < meetIds.length; i += BATCH_SIZE) {
            const batch = meetIds.slice(i, i + BATCH_SIZE);
            const { data: meets, error: meetsError } = await this.supabase
                .from('usaw_meets')
                .select('meet_id, Date, Meet')
                .in('meet_id', batch);

            if (meetsError) {
                throw new Error(`Failed to fetch meet dates (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${meetsError.message}`);
            }

            allMeets.push(...meets);
        }

        this.logger.info(`Fetched ${allMeets.length} meet dates`);

        const meetDates = new Map(allMeets.map(m => [m.meet_id, m.Date]));
        const meetNames = new Map(allMeets.map(m => [m.meet_id, m.Meet]));

        const resultsWithDates = data.map(result => ({
            ...result,
            date: meetDates.get(result.meet_id) || null,
            meet_name: meetNames.get(result.meet_id) || null
        })).sort((a, b) => {
            const dateA = new Date(a.date || '9999-12-31');
            const dateB = new Date(b.date || '9999-12-31');
            return dateA - dateB;
        });

        const filtered = resultsWithDates.filter(r => !skipList.has(r.result_id));
        const skipped = resultsWithDates.length - filtered.length;

        if (skipped > 0) {
            this.logger.info(`Skipped ${skipped} results from unresolved list`);
        }
        this.logger.info(`Processing ${filtered.length} results`);

        return filtered;
    }

    /**
     * Check if multiple different athletes (different lifter_ids) exist with the same name
     * This determines if we need Tier 2 verification to identify which athlete it is
     */
    async hasDuplicateNames(lifterName) {
        try {
            const { data, error } = await this.supabase
                .from('usaw_lifters')
                .select('lifter_id')
                .eq('athlete_name', lifterName);

            if (error) {
                this.logger.warn(`Failed to check for duplicate names: ${error.message}`);
                return false; // Conservative: assume no duplicates on error
            }

            // If there are 2 or more different lifters with the same name, we have duplicates
            const uniqueLifterIds = new Set(data.map(l => l.lifter_id));
            const hasDuplicates = uniqueLifterIds.size > 1;

            if (hasDuplicates) {
                this.logger.debug(`Found ${uniqueLifterIds.size} different athlete(s) with name "${lifterName}"`);
            }

            return hasDuplicates;
        } catch (error) {
            this.logger.warn(`Error checking for duplicate names: ${error.message}`);
            return false;
        }
    }

    /**
     * Build rankings URL
     */
    buildRankingsURL(divisionCode, startDate, endDate) {
        const filters = {
            date_range_start: formatDate(startDate),
            date_range_end: formatDate(endDate),
            weight_class: divisionCode
        };

        const jsonStr = JSON.stringify(filters);
        const base64Encoded = Buffer.from(jsonStr).toString('base64');
        const fullUrl = `https://usaweightlifting.sport80.com/public/rankings/all?filters=${encodeURIComponent(base64Encoded)}`;

        // Log base64 URL every time it's generated
        this.logger.info(`Base64 URL: ${fullUrl}`);

        return fullUrl;
    }

    /**
     * Scrape athlete-specific date from meet results page
     */
    async scrapeAthleteSpecificDate(page, meetId, lifterName) {
        try {
            const url = `https://usaweightlifting.sport80.com/public/rankings/results/${meetId}`;
            this.logger.debug(`Scraping athlete date from official results: ${url}`);

            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            await new Promise(resolve => setTimeout(resolve, 3000));

            const meetName = await page.evaluate(() => {
                const h1 = document.querySelector('h1');
                const h2 = document.querySelector('h2');
                const title = document.querySelector('.meet-title, .event-title, .competition-title');
                if (title) return title.textContent.trim();
                if (h1) return h1.textContent.trim();
                if (h2) return h2.textContent.trim();
                return 'Unknown Meet';
            });

            this.logger.debug(`Meet: ${meetName}`);

            let hasMorePages = true;
            let currentPage = 1;

            while (hasMorePages) {
                const athleteData = await page.evaluate((targetName) => {
                    const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                        .map(th => th.textContent.trim().toLowerCase());

                    const athleteNameIdx = headers.findIndex(h =>
                        h.includes('athlete') || h.includes('lifter') || h.includes('name')
                    );
                    const dateIdx = headers.findIndex(h => h.includes('date'));

                    const nameIdx = athleteNameIdx !== -1 ? athleteNameIdx : 1;
                    const dateColIdx = dateIdx !== -1 ? dateIdx : 3;

                    const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));

                    for (const row of rows) {
                        const cells = Array.from(row.querySelectorAll('td'));
                        if (cells.length > Math.max(nameIdx, dateColIdx)) {
                            const athleteName = cells[nameIdx]?.textContent?.trim() || '';
                            const athleteDate = cells[dateColIdx]?.textContent?.trim() || '';

                            if (athleteName === targetName && athleteDate) {
                                return {
                                    name: athleteName,
                                    date: athleteDate
                                };
                            }
                        }
                    }

                    return null;
                }, lifterName);

                if (athleteData) {
                    this.logger.info(`Found athlete date: ${athleteData.date} (page ${currentPage})`);
                    return athleteData.date;
                }

                const nextPageExists = await page.evaluate(() => {
                    const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                        return true;
                    }
                    return false;
                });

                if (nextPageExists) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    currentPage++;
                } else {
                    hasMorePages = false;
                }
            }

            this.logger.debug(`Athlete "${lifterName}" not found in meet results (searched ${currentPage} page${currentPage > 1 ? 's' : ''})`);
            return null;

        } catch (error) {
            this.logger.error(`Error scraping athlete date: ${error.message}`);
            return null;
        }
    }

    /**
     * Find all lifters with the same name in database
     * Returns array of {lifter_id, athlete_name, internal_id}
     */
    async findLiftersWithSameName(athleteName) {
        try {
            const { data: lifters, error } = await this.supabase
                .from('usaw_lifters')
                .select('lifter_id, athlete_name, internal_id')
                .eq('athlete_name', athleteName)
                .not('internal_id', 'is', null);

            if (error) {
                this.logger.error(`Error querying lifters with same name: ${error.message}`);
                return [];
            }

            this.logger.info(`   Found ${lifters.length} lifter(s) in database with name "${athleteName}" and internal_id`);
            return lifters || [];

        } catch (error) {
            this.logger.error(`Error finding lifters with same name: ${error.message}`);
            return [];
        }
    }

    /**
     * Scrape competition history from athlete member page
     * Returns array of competition objects with meet name, date, division, total, etc.
     * Handles pagination to get all competitions
     */
    async scrapeAthleteMemberPage(page, internalId) {
        try {
            const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${internalId}`;
            this.logger.debug(`   Scraping member page: ${memberUrl}`);

            await page.goto(memberUrl, {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            await new Promise(resolve => setTimeout(resolve, 2000));

            let allCompetitions = [];
            let hasMorePages = true;
            let currentPage = 1;

            while (hasMorePages) {
                // Scrape competition history table from current page
                const pageCompetitions = await page.evaluate(() => {
                    const competitions = [];
                    const tables = document.querySelectorAll('table');

                    if (tables.length === 0) {
                        return competitions;
                    }

                    // Process the main results table
                    const resultsTable = tables[0];
                    const rows = resultsTable.querySelectorAll('tr');

                    // Skip header row (index 0), process data rows
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const cells = row.querySelectorAll('td');

                        if (cells.length >= 10) {
                            const competition = {
                                meet_name: cells[0]?.textContent?.trim() || null,
                                date: cells[1]?.textContent?.trim() || null,
                                division: cells[2]?.textContent?.trim() || null,
                                lifter_name: cells[3]?.textContent?.trim() || null,
                                body_weight_kg: cells[4]?.textContent?.trim() || null,
                                snatch_1: cells[5]?.textContent?.trim() || null,
                                snatch_2: cells[6]?.textContent?.trim() || null,
                                snatch_3: cells[7]?.textContent?.trim() || null,
                                cj_1: cells[8]?.textContent?.trim() || null,
                                cj_2: cells[9]?.textContent?.trim() || null,
                                cj_3: cells[10]?.textContent?.trim() || null,
                                best_snatch: cells[11]?.textContent?.trim() || null,
                                best_cj: cells[12]?.textContent?.trim() || null,
                                total: cells[13]?.textContent?.trim() || null
                            };

                            // Only add if we have essential data
                            if (competition.date && competition.division) {
                                // Validate date format
                                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                                if (dateRegex.test(competition.date)) {
                                    competitions.push(competition);
                                }
                            }
                        }
                    }

                    return competitions;
                });

                allCompetitions = allCompetitions.concat(pageCompetitions);
                this.logger.debug(`   Page ${currentPage}: Found ${pageCompetitions.length} competitions`);

                // Check if there's a next page
                const nextPageExists = await page.evaluate(() => {
                    const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                        return true;
                    }
                    return false;
                });

                if (nextPageExists) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    currentPage++;
                } else {
                    hasMorePages = false;
                }
            }

            this.logger.debug(`   Found ${allCompetitions.length} total competitions across ${currentPage} page(s) for internal_id ${internalId}`);
            return allCompetitions;

        } catch (error) {
            this.logger.error(`Error scraping athlete member page: ${error.message}`);
            return [];
        }
    }

    /**
     * Compare competition history entry to database result
     * Returns true if competition matches the result (meet name, date, and optionally total)
     */
    compareCompetitionToResult(competition, result) {
        // Compare meet name (case-insensitive, allow partial matches)
        let meetNameMatch = false;
        if (result.meet_name && competition.meet_name) {
            const resultMeet = result.meet_name.toLowerCase().trim();
            const compMeet = competition.meet_name.toLowerCase().trim();
            meetNameMatch = resultMeet === compMeet || 
                           resultMeet.includes(compMeet) || 
                           compMeet.includes(resultMeet);
        }

        // Compare date
        const dateMatch = result.date && competition.date &&
            formatDate(result.date) === competition.date;

        // If we have total in both, compare it (allowing for slight differences in formatting)
        let totalMatch = true;
        if (result.total && competition.total) {
            const resultTotal = parseFloat(String(result.total).replace(/[^\d.]/g, ''));
            const compTotal = parseFloat(String(competition.total).replace(/[^\d.]/g, ''));
            totalMatch = Math.abs(resultTotal - compTotal) < 0.01; // Allow small floating point differences
        }

        const isMatch = meetNameMatch && dateMatch && totalMatch;
        
        if (!isMatch && result.meet_name && competition.meet_name && result.date && competition.date) {
            this.logger.debug(`   Comparison: meet="${competition.meet_name}" vs "${result.meet_name}" (${meetNameMatch}), date="${competition.date}" vs "${formatDate(result.date)}" (${dateMatch}), total="${competition.total}" vs "${result.total}" (${totalMatch})`);
        }

        return isMatch;
    }

    /**
     * Scrape division rankings with automatic date-range splitting
     */
    async scrapeDivisionRankingsWithSplitting(page, divisionName, divisionCode, startDate, endDate, lifterName, depth = 0) {
        const maxDepth = 3;
        const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        
        try {
            const athletes = await this.scrapeDivisionRankings(page, divisionName, divisionCode, startDate, endDate, lifterName);
            
            if (!lifterName && athletes.length === 0 && daysDiff > 365 && depth < maxDepth) {
                this.logger.warn(`0 athletes in ${daysDiff}-day range - likely API failure. Splitting...`);
                throw new Error('Suspected API failure - empty results on large range');
            }
            
            return athletes;
        } catch (error) {
            if (depth >= maxDepth || daysDiff <= 1) {
                this.logger.warn(`Failed to load data (depth ${depth}, ${daysDiff} days). Skipping this range.`);
                return [];
            }
            
            this.logger.info(`Splitting ${daysDiff}-day range into smaller chunks...`);
            const midpoint = new Date((startDate.getTime() + endDate.getTime()) / 2);
            
            const earlierAthletes = await this.scrapeDivisionRankingsWithSplitting(
                page, divisionName, divisionCode, startDate, midpoint, lifterName, depth + 1
            );
            
            if (lifterName && earlierAthletes.length > 0) {
                this.logger.info(`Found athlete in earlier period - skipping later period`);
                return earlierAthletes;
            }
            
            const laterAthletes = await this.scrapeDivisionRankingsWithSplitting(
                page, divisionName, divisionCode, midpoint, endDate, lifterName, depth + 1
            );
            
            if (!lifterName) {
                const allAthletes = [...earlierAthletes, ...laterAthletes];
                const seen = new Set();
                return allAthletes.filter(athlete => {
                    const key = `${athlete.athleteName}-${athlete.liftDate}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            }
            
            return laterAthletes;
        }
    }

    /**
     * Scrape division rankings from Sport80
     */
    async scrapeDivisionRankings(page, divisionName, divisionCode, startDate, endDate, lifterName) {
        try {
            const url = this.buildRankingsURL(divisionCode, startDate, endDate);

            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
            await new Promise(resolve => setTimeout(resolve, 2000));

            const initialStats = await page.evaluate(() => {
                const totalText = document.querySelector('.v-data-footer__pagination')?.textContent || '';
                const match = totalText.match(/of (\d+)/);
                const totalResults = match ? parseInt(match[1]) : null;
                const visibleRows = document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
                return { totalResults, visibleRows };
            });
            
            if (initialStats.totalResults) {
                this.logger.debug(`Loaded ${initialStats.totalResults} total results (${initialStats.visibleRows} visible on page 1)`);
            }

            // Input athlete name into search field if provided
            if (lifterName) {
                try {
                    await page.waitForSelector('.v-text-field input', { timeout: 5000 });
                    await page.evaluate(() => {
                        const searchInput = document.querySelector('.v-text-field input');
                        searchInput.value = '';
                        searchInput.focus();
                    });
                    await page.type('.v-text-field input', lifterName);
                    
                    this.logger.debug(`Filtering for athlete: "${lifterName}"...`);
                    
                    const initialRowCount = await page.evaluate(() => {
                        return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
                    });
                    
                    const checkInterval = 200;
                    const maxIterations = 200;
                    const stabilityChecks = 10;
                    
                    let firstChangeDetected = false;
                    let previousCount = initialRowCount;
                    let stableCount = 0;
                    
                    for (let i = 0; i < maxIterations; i++) {
                        await new Promise(resolve => setTimeout(resolve, checkInterval));
                        
                        const currentCount = await page.evaluate(() => {
                            return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
                        });
                        
                        if (!firstChangeDetected && currentCount !== initialRowCount) {
                            firstChangeDetected = true;
                            this.logger.debug(`Filtering detected at ${((i + 1) * checkInterval / 1000).toFixed(1)}s (${initialRowCount} → ${currentCount} rows)`);
                        }
                        
                        if (firstChangeDetected) {
                            if (currentCount === previousCount) {
                                stableCount++;
                                if (stableCount >= stabilityChecks) {
                                    this.logger.debug(`Table stable after ${((i + 1) * checkInterval / 1000).toFixed(1)}s`);
                                    break;
                                }
                            } else {
                                stableCount = 0;
                            }
                        }
                        
                        previousCount = currentCount;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (searchError) {
                    this.logger.warn(`Search field not found or failed, continuing with unfiltered results`);
                }

                const searchStatus = await page.evaluate(() => {
                    const searchInput = document.querySelector('.v-text-field input');
                    return {
                        exists: !!searchInput,
                        value: searchInput?.value || '',
                        rowCount: document.querySelectorAll('.v-data-table__wrapper tbody tr').length
                    };
                });
                
                this.logger.debug(`Search field value: "${searchStatus.value}" (${searchStatus.rowCount} rows visible)`);
                
                if (lifterName && searchStatus.exists && searchStatus.value !== lifterName) {
                    this.logger.warn(`Search was cleared! Re-applying filter...`);
                    await page.evaluate((name) => {
                        const searchInput = document.querySelector('.v-text-field input');
                        searchInput.value = name;
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }, lifterName);
                    
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }

                const finalStatus = await page.evaluate(() => {
                    const rowCount = document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
                    const firstRow = document.querySelector('.v-data-table__wrapper tbody tr');
                    let isEmptyState = false;
                    
                    if (firstRow && rowCount === 1) {
                        const firstCell = firstRow.querySelector('td');
                        const text = firstCell?.textContent?.trim() || '';
                        isEmptyState = text.toLowerCase().includes('please select');
                    }
                    
                    return { rowCount, isEmptyState };
                });
                
                if (finalStatus.isEmptyState) {
                    this.logger.debug(`No results found for athlete "${lifterName}" in this division/date range (0 matches)`);
                    return [];
                }
                
                this.logger.debug(`Extracting from ${finalStatus.rowCount} table row(s)...`);
            }

            // Extract athletes from results
            let allAthletes = [];
            let hasMorePages = true;
            let currentPage = 1;

            while (hasMorePages) {
                const pageAthletes = await page.evaluate(() => {
                    const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                        .map(th => th.textContent.trim().toLowerCase());

                    const lifterAgeIdx = (() => {
                        const lifterAge = headers.findIndex(h => h.includes('lifter') && h.includes('age'));
                        if (lifterAge !== -1) return lifterAge;
                        const compAge = headers.findIndex(h => h.includes('comp') && h.includes('age') && !h.includes('category'));
                        if (compAge !== -1) return compAge;
                        const ageOnly = headers.findIndex(h => h.includes('age') && !h.includes('category'));
                        return ageOnly;
                    })();

                    const colMap = {
                        nationalRank: headers.findIndex(h => h.includes('rank')),
                        athleteName: headers.findIndex(h => h.includes('athlete') || h.includes('lifter') && !h.includes('age')),
                        total: headers.findIndex(h => h.includes('total')),
                        gender: headers.findIndex(h => h.includes('gender')),
                        lifterAge: lifterAgeIdx,
                        club: headers.findIndex(h => h.includes('club') || h.includes('team')),
                        membershipId: headers.findIndex(h => h.includes('member') || h.includes('id')),
                        liftDate: headers.findIndex(h => h.includes('date')),
                        wso: headers.findIndex(h => h.includes('wso') || h.includes('lws') || h.includes('state'))
                    };

                    // Fallback indices
                    if (colMap.athleteName === -1) colMap.athleteName = 3;
                    if (colMap.total === -1) colMap.total = 2;
                    if (colMap.gender === -1) colMap.gender = 4;
                    if (colMap.club === -1) colMap.club = 6;
                    if (colMap.membershipId === -1) colMap.membershipId = 7;
                    if (colMap.liftDate === -1) colMap.liftDate = 9;
                    if (colMap.wso === -1) colMap.wso = 12;
                    if (colMap.nationalRank === -1) colMap.nationalRank = 0;

                    const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                    
                    const athletes = rows.map(row => {
                        const cells = Array.from(row.querySelectorAll('td'));
                        const cellTexts = cells.map(cell => cell.textContent?.trim() || '');

                        if (cellTexts.length < 5) return null;

                        const rawAge = colMap.lifterAge > -1 ? cellTexts[colMap.lifterAge] : '';
                        const numericAge = rawAge.match(/\d{1,3}/)?.[0] || '';

                        return {
                            athleteName: colMap.athleteName > -1 ? cellTexts[colMap.athleteName] : '',
                            lifterAge: numericAge,
                            club: colMap.club > -1 ? cellTexts[colMap.club] : '',
                            liftDate: colMap.liftDate > -1 ? cellTexts[colMap.liftDate] : '',
                            wso: colMap.wso > -1 ? cellTexts[colMap.wso] : '',
                            gender: colMap.gender > -1 ? cellTexts[colMap.gender] : ''
                        };
                    }).filter(a => a && a.athleteName);
                    
                    return { athletes };
                });

                allAthletes = allAthletes.concat(pageAthletes.athletes);

                if (pageAthletes.athletes.length > 0) {
                    this.logger.debug(`Page ${currentPage}: Extracted ${pageAthletes.athletes.length} athlete(s)`);
                }

                const nextPageExists = await page.evaluate(() => {
                    const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                        return true;
                    }
                    return false;
                });

                if (nextPageExists) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    currentPage++;
                } else {
                    hasMorePages = false;
                }
            }

            return allAthletes;

        } catch (error) {
            if (error.message.includes('timeout') || 
                error.message.includes('Navigation') ||
                error.message.includes('net::ERR') ||
                error.message.includes('ERR_FAILED') ||
                error.message.includes('empty state') ||
                error.message.includes('API likely failed')) {
                this.logger.error(`Dataset too large or API failed: ${error.message}`);
                throw error;
            }
            
            this.logger.error(`Error scraping division: ${error.message}`);
            return [];
        }
    }

    /**
     * Extract weight value from weight class string
     */
    extractWeightValue(weightClass) {
        const match = weightClass.match(/(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }

    /**
     * Get gender from age category
     */
    getGenderFromAgeCategory(ageCategory) {
        const lower = ageCategory.toLowerCase();
        if (lower.includes("women")) return 'F';
        if (lower.includes("men") && !lower.includes("women")) return 'M';
        return null;
    }

    /**
     * Smart sort divisions by relevance
     */
    smartSortDivisions(divisions, result) {
        const expectedDivision = `${result.age_category} ${result.weight_class}`;
        const expectedInactive = `(Inactive) ${expectedDivision}`;
        const targetWeight = this.extractWeightValue(result.weight_class);
        const inferredGender = result.gender || this.getGenderFromAgeCategory(result.age_category);

        const divisionEntries = Object.entries(divisions);
        const exactMatch = [];
        const inactiveMatch = [];
        const sameGenderSameAge = [];
        const sameGenderNearWeight = [];
        const sameGender = [];
        const oppositeGender = [];

        for (const [name, code] of divisionEntries) {
            if (name === expectedDivision) {
                exactMatch.push([name, code]);
                continue;
            }
            if (name === expectedInactive) {
                inactiveMatch.push([name, code]);
                continue;
            }

            const divisionGender = this.getDivisionGender(name);

            if (divisionGender === inferredGender) {
                const divisionAgeCategory = name.replace(/\s+\d+\+?\s*kg$/i, '').trim();
                const resultAgeCategory = result.age_category.trim();

                if (divisionAgeCategory === resultAgeCategory) {
                    sameGenderSameAge.push([name, code]);
                } else {
                    const divisionWeight = this.extractWeightValue(name);
                    const weightDiff = Math.abs(divisionWeight - targetWeight);

                    if (weightDiff <= 15) {
                        sameGenderNearWeight.push([name, code, weightDiff]);
                    } else {
                        sameGender.push([name, code]);
                    }
                }
            } else {
                oppositeGender.push([name, code]);
            }
        }

        sameGenderNearWeight.sort((a, b) => a[2] - b[2]);
        const sortedNearWeight = sameGenderNearWeight.map(([name, code]) => [name, code]);

        return [
            ...exactMatch,
            ...inactiveMatch,
            ...sameGenderSameAge,
            ...sortedNearWeight,
            ...sameGender,
            ...oppositeGender
        ];
    }

    /**
     * Find and update result using tiered workflow
     */
    async findAndUpdateResult(page, result, divisions) {
        this.logger.info(`\n${'='.repeat(70)}`);
        this.logger.info(`Processing result_id ${result.result_id}: ${result.lifter_name}`);
        this.logger.info(`${'='.repeat(70)}`);

        this.logger.info(`\nCURRENT DATA:`);
        this.logger.info(`   Lifter ID: ${result.lifter_id}`);
        this.logger.info(`   Lifter Name: ${result.lifter_name}`);
        this.logger.info(`   Meet Date: ${result.date}`);
        this.logger.info(`   Meet ID: ${result.meet_id}`);
        this.logger.info(`   Gender: ${result.gender === 'M' ? 'Male' : result.gender === 'F' ? 'Female' : result.gender || 'MISSING'}`);
        this.logger.info(`   Age Category: ${result.age_category}`);
        this.logger.info(`   Weight Class: ${result.weight_class}`);
        this.logger.info(`   Total: ${result.total}kg`);
        this.logger.info(`   Competition Age: ${result.competition_age || 'MISSING'}`);
        this.logger.info(`   WSO: ${result.wso || 'MISSING'}`);
        this.logger.info(`   Club: ${result.club_name || 'MISSING'}`);

        // Check for duplicate names - if found, skip to Tier 2
        const hasDuplicates = await this.hasDuplicateNames(result.lifter_name);
        
        if (hasDuplicates) {
            this.logger.warn(`Duplicate names detected for "${result.lifter_name}" - skipping Tier 1 & 1.5, using Tier 2 first`);
        }

        // Scrape athlete-specific date
        const athleteSpecificDateStr = await this.scrapeAthleteSpecificDate(page, result.meet_id, result.lifter_name);
        const meetDate = new Date(result.date);

        if (athleteSpecificDateStr) {
            this.logger.info(`Athlete-specific date: ${athleteSpecificDateStr}`);
        }
        this.logger.info(`Meet date on file: ${result.date}`);

        // Find division code
        const athleteDivisionName = `${result.age_category} ${result.weight_class}`;
        let athleteDivisionCode;
        
        const activeDivisionCutoff = new Date('2025-06-01');
        const isActiveDivision = meetDate >= activeDivisionCutoff;
        
        if (isActiveDivision) {
            athleteDivisionCode = divisions[athleteDivisionName];
        } else {
            const inactiveName = `(Inactive) ${athleteDivisionName}`;
            athleteDivisionCode = divisions[inactiveName];
            if (athleteDivisionCode) {
                this.logger.info(`Athlete's Division: ${inactiveName} (code: ${athleteDivisionCode}) [Pre-June 2025]`);
            }
        }
        
        if (!athleteDivisionCode) {
            if (isActiveDivision) {
                const inactiveName = `(Inactive) ${athleteDivisionName}`;
                athleteDivisionCode = divisions[inactiveName];
            } else {
                athleteDivisionCode = divisions[athleteDivisionName];
            }
        }
        
        if (athleteDivisionCode && isActiveDivision) {
            this.logger.info(`Athlete's Division: ${athleteDivisionName} (code: ${athleteDivisionCode})`);
        }

        if (!athleteDivisionCode) {
            this.logger.error(`Could not find division code for: ${athleteDivisionName}`);
            this.session.unresolved++;
            this.saveUnresolvedResult({
                result_id: result.result_id,
                lifter_name: result.lifter_name,
                date: result.date,
                gender: result.gender,
                age_category: result.age_category,
                weight_class: result.weight_class,
                timestamp: new Date().toISOString(),
                divisions_searched: Object.keys(divisions).length
            });
            return false;
        }

        // TIERED WORKFLOW STRATEGY
        let matchFound = false;
        let tierUsed = 0;
        let divisionsSearched = 0;

        // TIER 1.5: Exact Division + Athlete's Scraped Date (if available and no duplicates)
        if (!matchFound && !hasDuplicates && athleteSpecificDateStr) {
            this.logger.info(`\nTIER 1.5: Exact Division + Athlete's Scraped Date`);
            const athleteDate = new Date(athleteSpecificDateStr);
            const tier15StartDate = addDays(athleteDate, -this.config.dateWindowDays);
            const tier15EndDate = addDays(athleteDate, this.config.dateWindowDays);
            this.logger.info(`   Date Range: ${formatDate(tier15StartDate)} to ${formatDate(tier15EndDate)} (±${this.config.dateWindowDays} days around athlete date: ${athleteSpecificDateStr})`);

            const tier15Athletes = await this.scrapeDivisionRankings(page, athleteDivisionName, athleteDivisionCode, tier15StartDate, tier15EndDate, result.lifter_name);
            divisionsSearched++;
            this.logger.info(`   Found ${tier15Athletes.length} athletes`);

            for (const athlete of tier15Athletes) {
                if (athlete.athleteName === result.lifter_name) {
                    this.logger.info(`MATCH FOUND in TIER 1.5!`);
                    matchFound = await this.processMatch(result, athlete, athleteDivisionName, divisionsSearched);
                    tierUsed = 1.5;
                    break;
                }
            }
        } else if (!matchFound && !hasDuplicates && !athleteSpecificDateStr) {
            this.logger.info(`\nTIER 1.5: Skipped (no athlete-specific date found)`);
        }

        // TIER 2: Verify athlete by checking member pages (when duplicates detected)
        // After assignment is confirmed, Tier 1 can continue
        let tier2Confirmed = false;
        if (!matchFound && hasDuplicates) {
            this.logger.info(`\nTIER 2: Athlete Verification via Member Pages (duplicates detected)`);
            this.logger.info(`   Finding all lifters with name: "${result.lifter_name}" in database`);

            // Find all lifters with the same name in database
            const liftersWithSameName = await this.findLiftersWithSameName(result.lifter_name);

            if (liftersWithSameName.length === 0) {
                this.logger.warn(`   No lifters found with name "${result.lifter_name}" and internal_id in database`);
            } else {
                this.logger.info(`   Checking ${liftersWithSameName.length} lifter(s) for match with meet result`);

                // For each lifter, check their member page for competition history
                for (const lifter of liftersWithSameName) {
                    this.logger.info(`   Checking lifter: ${lifter.athlete_name} (lifter_id: ${lifter.lifter_id}, internal_id: ${lifter.internal_id})`);

                    // Scrape competition history from member page
                    const competitionHistory = await this.scrapeAthleteMemberPage(page, lifter.internal_id);

                    if (competitionHistory.length > 0) {
                        this.logger.info(`   Found ${competitionHistory.length} competition(s) in member page`);
                        
                        // Log competitions near the target date for debugging
                        const targetDate = formatDate(result.date);
                        const nearbyCompetitions = competitionHistory.filter(comp => {
                            if (!comp.date) return false;
                            const compDate = new Date(comp.date);
                            const resultDate = new Date(result.date);
                            const daysDiff = Math.abs(compDate - resultDate) / (1000 * 60 * 60 * 24);
                            return daysDiff <= 30; // Within 30 days
                        });
                        
                        if (nearbyCompetitions.length > 0) {
                            this.logger.info(`   Competitions near target date (${targetDate}):`);
                            nearbyCompetitions.forEach(comp => {
                                this.logger.info(`      - ${comp.meet_name} on ${comp.date} (division: ${comp.division}, total: ${comp.total})`);
                            });
                        }
                    }

                    // Find competition that matches our target meet result
                    const matchingCompetition = competitionHistory.find(comp => 
                        this.compareCompetitionToResult(comp, result)
                    );

                    if (matchingCompetition) {
                        this.logger.info(`   ✅ MATCH FOUND in TIER 2!`);
                        this.logger.info(`      Lifter: ${lifter.athlete_name} (lifter_id: ${lifter.lifter_id}, internal_id: ${lifter.internal_id})`);
                        this.logger.info(`      Competition: ${matchingCompetition.meet_name} on ${matchingCompetition.date}`);
                        this.logger.info(`      Division: ${matchingCompetition.division}`);
                        this.logger.info(`   Assignment confirmed - Tier 1 can now proceed`);
                        tier2Confirmed = true;
                        break;
                    }
                }

                if (!tier2Confirmed) {
                    this.logger.warn(`   No matching competition found in any lifter's member page`);
                }
            }
        }

        // After Tier 2 confirms assignment (or if no duplicates), allow Tier 1 to proceed
        if (!matchFound && (tier2Confirmed || !hasDuplicates)) {
            this.logger.info(`\nTIER 1: Exact Division + Meet Date ${tier2Confirmed ? '(after Tier 2 confirmation)' : ''}`);
            const tier1StartDate = addDays(meetDate, -this.config.dateWindowDays);
            const tier1EndDate = addDays(meetDate, this.config.dateWindowDays);
            this.logger.info(`   Date Range: ${formatDate(tier1StartDate)} to ${formatDate(tier1EndDate)} (±${this.config.dateWindowDays} days around meet date)`);

            const tier1Athletes = await this.scrapeDivisionRankingsWithSplitting(page, athleteDivisionName, athleteDivisionCode, tier1StartDate, tier1EndDate, null);
            divisionsSearched++;
            this.logger.info(`   Found ${tier1Athletes.length} athletes`);

            // Check for multi-athlete updates
            const tier1Matches = await this.findAthleteMatchesInScrapedData(tier1Athletes, result, tier1StartDate, tier1EndDate);
            if (tier1Matches.length > 0) {
                this.logger.info(`Processing ${tier1Matches.length} additional athletes from this division...`);
                await this.batchUpdateAthletes(tier1Matches, athleteDivisionName, divisionsSearched);
            }

            const targetAthlete = tier1Athletes.find(a => {
                // Exact name match
                if (a.athleteName !== result.lifter_name) return false;
                
                // Verify date matches exactly (within the date window)
                if (a.liftDate) {
                    const athleteDate = new Date(a.liftDate);
                    const resultDate = new Date(result.date);
                    const dateDiff = Math.abs(athleteDate - resultDate);
                    const daysDiff = dateDiff / (1000 * 60 * 60 * 24);
                    
                    // Date must be within the window (already filtered, but double-check)
                    if (daysDiff > this.config.dateWindowDays) {
                        return false;
                    }
                }
                
                return true;
            });
            
            if (targetAthlete) {
                this.logger.info(`MATCH FOUND in TIER 1!`);
                this.logger.info(`   Exact match verified: Name="${targetAthlete.athleteName}", Date="${targetAthlete.liftDate}"`);
                this.logger.info(`   WSO: ${targetAthlete.wso}, Club: ${targetAthlete.club}, Age: ${targetAthlete.lifterAge}`);
                matchFound = await this.processMatch(result, targetAthlete, athleteDivisionName, divisionsSearched);
                tierUsed = tier2Confirmed ? 2 : 1;
            }
        }

        if (!matchFound) {
            this.logger.warn(`No match found after all search tiers (${divisionsSearched} divisions total)`);
            this.session.unresolved++;
            return false;
        }

        this.logger.info(`Match found using Tier ${tierUsed} after searching ${divisionsSearched} division(s)`);
        return true;
    }

    /**
     * Process a successful match and update database
     */
    async processMatch(result, athlete, divisionName, divisionsSearched) {
        const updateData = {};
        if ((!result.competition_age || this.config.force) && athlete.lifterAge) {
            updateData.competition_age = parseInt(athlete.lifterAge);
        }
        if ((!result.wso || this.config.force) && athlete.wso) {
            updateData.wso = athlete.wso;
        }
        if ((!result.club_name || this.config.force) && athlete.club) {
            updateData.club_name = athlete.club;
        }
        if ((!result.gender || this.config.force) && athlete.gender) {
            updateData.gender = athlete.gender;
        }

        if (Object.keys(updateData).length === 0) {
            this.logger.info(`No new data to update`);
            this.session.skipped++;
            return true;
        }

        this.logUpdate(result, updateData, divisionName, divisionsSearched);

        if (!this.config.dryRun) {
            const { error } = await this.supabase
                .from('usaw_meet_results')
                .update(updateData)
                .eq('result_id', result.result_id);

            if (error) {
                this.logger.error(`Database update failed: ${error.message}`);
                this.session.errors++;
                return false;
            }

            this.logger.info(`Database updated successfully`);
            this.session.updated++;
        } else {
            this.logger.info(`DRY RUN - would update with:`, updateData);
            this.session.updated++;
        }

        return true;
    }

    /**
     * Find athlete matches in scraped data for batch updates
     */
    async findAthleteMatchesInScrapedData(allAthletes, targetResult, startDate, endDate) {
        this.logger.info(`Checking ${allAthletes.length} athletes from scraped data for missing data...`);

        if (allAthletes.length === 0) {
            return [];
        }

        const athleteNames = allAthletes.map(a => a.athleteName).filter(name => name);

        if (athleteNames.length === 0) {
            return [];
        }

        let query = this.supabase
            .from('usaw_meet_results')
            .select('result_id, lifter_id, lifter_name, wso, club_name, competition_age, gender, total')
            .in('lifter_name', athleteNames)
            .gte('date', formatDate(startDate))
            .lte('date', formatDate(endDate));

        if (targetResult.age_category) {
            query = query.eq('age_category', targetResult.age_category);
        }
        if (targetResult.weight_class) {
            query = query.eq('weight_class', targetResult.weight_class);
        }

        const { data: potentialResults, error } = await query;

        if (error) {
            this.logger.warn(`Failed to query for missing athletes: ${error.message}`);
            return [];
        }

        this.logger.info(`Found ${potentialResults.length} potential matches within date range`);

        const matches = [];
        for (const dbResult of potentialResults) {
            const scrapedAthlete = allAthletes.find(a => 
                a.athleteName.toLowerCase() === dbResult.lifter_name.toLowerCase()
            );

            if (scrapedAthlete) {
                const hasNewData = this.config.force || (
                    (!dbResult.competition_age && scrapedAthlete.lifterAge) ||
                    (!dbResult.club_name && scrapedAthlete.club) ||
                    (!dbResult.wso && scrapedAthlete.wso) ||
                    (!dbResult.gender && scrapedAthlete.gender) ||
                    (!dbResult.total && scrapedAthlete.total)
                );

                if (hasNewData) {
                    matches.push({
                        dbResult,
                        scrapedData: scrapedAthlete
                    });
                }
            }
        }

        this.logger.info(`${matches.length} athletes have new data to update`);
        return matches;
    }

    /**
     * Batch update athletes from scraped data
     */
    async batchUpdateAthletes(matches, divisionName, divisionsSearched) {
        for (const { dbResult, scrapedData } of matches) {
            try {
                const updateData = {};
                if ((!dbResult.competition_age || this.config.force) && scrapedData.lifterAge) {
                    updateData.competition_age = parseInt(scrapedData.lifterAge);
                }
                if ((!dbResult.club_name || this.config.force) && scrapedData.club) {
                    updateData.club_name = scrapedData.club;
                }
                if ((!dbResult.wso || this.config.force) && scrapedData.wso) {
                    updateData.wso = scrapedData.wso;
                }
                if ((!dbResult.gender || this.config.force) && scrapedData.gender) {
                    updateData.gender = scrapedData.gender;
                }
                if ((!dbResult.total || this.config.force) && scrapedData.total) {
                    updateData.total = scrapedData.total;
                }

                if (Object.keys(updateData).length === 0) {
                    this.session.skipped++;
                    continue;
                }

                this.logUpdate(dbResult, updateData, divisionName, divisionsSearched);

                if (!this.config.dryRun) {
                    const { error } = await this.supabase
                        .from('usaw_meet_results')
                        .update(updateData)
                        .eq('result_id', dbResult.result_id);

                    if (error) {
                        this.logger.error(`Failed to update ${dbResult.lifter_name}: ${error.message}`);
                        this.session.errors++;
                    } else {
                        this.logger.info(`Updated: ${dbResult.lifter_name} (${Object.keys(updateData).join(', ')})`);
                        this.session.updated++;
                    }
                } else {
                    this.logger.info(`DRY RUN: Would update ${dbResult.lifter_name} with:`, updateData);
                    this.session.updated++;
                }

            } catch (error) {
                this.logger.error(`Error updating ${dbResult.lifter_name}: ${error.message}`);
                this.session.errors++;
            }
        }
    }

    /**
     * Log update to CSV file
     */
    logUpdate(result, updateData, divisionName, divisionsSearched) {
        ensureDirectoryExists(path.dirname(this.config.updatesLogPath));

        if (!fs.existsSync(this.config.updatesLogPath)) {
            const headers = [
                'timestamp',
                'result_id',
                'lifter_name',
                'date',
                'division_matched',
                'divisions_searched',
                'competition_age_before',
                'competition_age_after',
                'wso_before',
                'wso_after',
                'club_name_before',
                'club_name_after',
                'dry_run'
            ];
            fs.writeFileSync(this.config.updatesLogPath, headers.join(',') + '\n');
        }

        const row = [
            new Date().toISOString(),
            result.result_id,
            escapeCSV(result.lifter_name),
            result.date,
            escapeCSV(divisionName),
            divisionsSearched,
            result.competition_age || '',
            updateData.competition_age || result.competition_age || '',
            escapeCSV(result.wso || ''),
            escapeCSV(updateData.wso || result.wso || ''),
            escapeCSV(result.club_name || ''),
            escapeCSV(updateData.club_name || result.club_name || ''),
            this.config.dryRun
        ];

        fs.appendFileSync(this.config.updatesLogPath, row.join(',') + '\n');
    }

    /**
     * Run the scraping process
     */
    async runScraping() {
        try {
            this.logger.logSessionStart(this.session.sessionId);

            // Display configuration
            this.logger.info(`Configuration:`);
            this.logger.info(`   Date Range: ${this.config.startDate || 'ALL'} to ${this.config.endDate || 'ALL'}`);
            this.logger.info(`   Gender Filter: ${this.config.genderFilter ? (this.config.genderFilter === 'M' ? 'Male' : 'Female') : 'ALL'}`);
            this.logger.info(`   Max Results: ${this.config.maxResults || 'UNLIMITED'}`);
            this.logger.info(`   Date Window: ±${this.config.dateWindowDays} days`);
            this.logger.info(`   Mode: ${this.config.dryRun ? 'DRY RUN (preview only)' : 'LIVE (will update database)'}`);

            // Load skip list
            const skipList = this.loadUnresolvedList();

            // Query incomplete results
            const incompleteResults = await this.queryIncompleteResults(skipList);

            if (incompleteResults.length === 0) {
                this.logger.info(`No results missing WSO to process!`);
                return;
            }

            // Load and filter divisions
            const divisions = this.loadAndFilterDivisions(this.config.genderFilter);

            if (Object.keys(divisions).length === 0) {
                this.logger.error(`No divisions available for gender filter: ${this.config.genderFilter}`);
                return;
            }

            // Launch browser
            this.logger.info(`Launching browser...`);
            const browser = await puppeteer.launch({
                headless: this.config.headless,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });

            this.logger.info(`\n${'='.repeat(70)}`);
            this.logger.info(`Processing ${incompleteResults.length} results missing WSO`);
            this.logger.info(`${'='.repeat(70)}`);

            // Process each incomplete result
            for (const result of incompleteResults) {
                this.session.processed++;

                const matchFound = await this.findAndUpdateResult(page, result, divisions);

                if (!matchFound) {
                    this.saveUnresolvedResult({
                        result_id: result.result_id,
                        lifter_name: result.lifter_name,
                        date: result.date,
                        gender: result.gender,
                        age_category: result.age_category,
                        weight_class: result.weight_class,
                        timestamp: new Date().toISOString(),
                        divisions_searched: Object.keys(divisions).length
                    });
                }

                // Progress update every 5 results
                if (this.session.processed % 5 === 0) {
                    this.logger.info(`\nProgress: ${this.session.processed}/${incompleteResults.length} results processed`);
                    this.logger.info(`   Updated: ${this.session.updated}, Skipped: ${this.session.skipped}, Unresolved: ${this.session.unresolved}, Errors: ${this.session.errors}`);
                }
            }

            // Close browser
            await browser.close();

            // Complete session
            this.session.complete('Scraping process completed');
            
            // Display summary
            const summary = {
                durationMinutes: this.session.getDurationMinutes(),
                resultsProcessed: this.session.processed,
                resultsUpdated: this.session.updated,
                resultsSkipped: this.session.skipped,
                resultsUnresolved: this.session.unresolved,
                errors: this.session.errors,
                successRate: this.session.processed > 0 ? ((this.session.updated + this.session.skipped) / this.session.processed * 100).toFixed(1) + '%' : '0%'
            };

            this.logger.info(`\n${'='.repeat(70)}`);
            this.logger.info(`FINAL SUMMARY`);
            this.logger.info(`${'='.repeat(70)}`);
            this.logger.info(`   Total Processed: ${summary.resultsProcessed}`);
            this.logger.info(`   Successfully Updated: ${summary.resultsUpdated}`);
            this.logger.info(`   Skipped (no new data): ${summary.resultsSkipped}`);
            this.logger.info(`   Unresolved (no match): ${summary.resultsUnresolved}`);
            this.logger.info(`   Errors: ${summary.errors}`);
            this.logger.info(`   Success Rate: ${summary.successRate}`);
            this.logger.info(`   Duration: ${summary.durationMinutes} minutes`);
            this.logger.info(`   Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}`);

            if (!this.config.dryRun && this.session.updated > 0) {
                this.logger.info(`\nUpdates logged to: ${this.config.updatesLogPath}`);
            }

            if (this.session.unresolved > 0) {
                this.logger.info(`\nUnresolved results logged to: ${this.config.unresolvedPath}`);
            }

        } catch (error) {
            this.logger.error(`Scraping process failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Main entry point
     * @param {Array} argv - Command line arguments
     */
    async main(argv) {
        try {
            const args = this.parseArguments(argv);

            // Handle help and version
            if (args.help) {
                this.showHelp();
                return;
            }

            if (args.version) {
                this.showVersion();
                return;
            }

            // Initialize system
            await this.initialize();

            // Create configuration
            this.config = this.createConfiguration(args);

            // Validate configuration
            const configErrors = this.config.validate();
            if (configErrors.length > 0) {
                this.logger.error('Configuration validation failed');
                configErrors.forEach(error => this.logger.error(`  - ${error}`));
                process.exit(1);
            }

            // Set log level
            if (args['log-level']) {
                this.logger.setLogLevel(args['log-level']);
            }

            // Create session
            this.session = new WsoScraperSession();

            // Run scraping process
            await this.runScraping();

        } catch (error) {
            this.logger.error(`CLI execution failed: ${error.message}`);
            console.error('Full error:', error);
            process.exit(1);
        }
    }
}

// Run CLI if this file is executed directly
if (require.main === module) {
    const cli = new WsoScraperCLI();
    cli.main(process.argv).catch(error => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { WsoScraperCLI, WsoScraperConfiguration, WsoScraperSession };
