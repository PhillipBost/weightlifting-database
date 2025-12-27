#!/usr/bin/env node

/**
 * Meet Re-Import System - Command Line Interface
 * 
 * Main script for running meet re-import operations with various filtering
 * and configuration options.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const minimist = require('minimist');

// Import system components
const { MeetCompletenessEngine } = require('./lib/meet-completeness-engine');
const { MeetSkipManager } = require('./lib/meet-skip-manager');
const { DetailedReImportOrchestrator } = require('./lib/detailed-orchestrator');
const { ProgressReporter } = require('./lib/progress-reporter');
const { SimpleLogger } = require('./lib/simple-logger');

// Import types
const { 
    MeetFilterCriteria, 
    ReImportConfiguration,
    ReImportSession 
} = require('./types');

class MeetReImportCLI {
    constructor() {
        this.logger = new SimpleLogger('MeetReImportCLI');
        this.supabase = null;
        this.completenessEngine = null;
        this.skipManager = null;
        this.orchestrator = null;
        this.progressReporter = null;
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
                process.env.SUPABASE_SERVICE_ROLE_KEY
            );

            this.logger.info('Initialized Supabase client');

        } catch (error) {
            this.logger.error('Failed to initialize CLI', { error: error.message });
            throw error;
        }
    }

    /**
     * Parse command line arguments
     * @param {Array} argv - Command line arguments
     * @returns {Object} Parsed arguments and configuration
     */
    parseArguments(argv) {
        const args = minimist(argv.slice(2), {
            string: ['meet-ids', 'start-date', 'end-date', 'athlete-name', 'log-level'],
            number: ['batch-size', 'delay', 'limit', 'timeout', 'date-window'],
            boolean: ['dry-run', 'force', 'help', 'version', 'analyze-only'],
            alias: {
                'h': 'help',
                'v': 'version',
                'd': 'dry-run',
                'f': 'force',
                'b': 'batch-size',
                'l': 'limit'
            },
            default: {
                'batch-size': 10,
                'delay': 2000,
                'timeout': 30000,
                'log-level': 'info',
                'date-window': 5
            }
        });

        // Parse meet IDs if provided
        if (args['meet-ids']) {
            args.meetIds = args['meet-ids'].split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        }

        return args;
    }

    /**
     * Show help information
     */
    showHelp() {
        console.log(`
Meet Re-Import System - Command Line Interface

Usage: node re-import-meets.js [options]

Options:
  --analyze-only          Only analyze what's missing, don't import
  --meet-ids <ids>        Comma-separated list of specific meet IDs to re-import
  --start-date <date>     Start date for date range filter (YYYY-MM-DD)
  --end-date <date>       End date for date range filter (YYYY-MM-DD)
  --athlete-name <name>   Re-import meets containing specific athlete
  --batch-size <n>        Number of meets to process in each batch (default: 10)
  --delay <ms>            Delay between meets in milliseconds (default: 2000)
  --limit <n>             Maximum number of meets to process
  --timeout <ms>          Timeout for each meet operation (default: 30000)
  --date-window <n>       Date window in days for base64 URL lookups (default: 5)
  --log-level <level>     Log level: error, warn, info, debug (default: info)
  --dry-run, -d           Show what would be done without actually doing it
  --force, -f             Force re-import even for complete meets
  --help, -h              Show this help message
  --version, -v           Show version information

Examples:
  # Re-import specific meets
  node re-import-meets.js --meet-ids=2308,2357,2369

  # Re-import meets from date range
  node re-import-meets.js --start-date=2024-01-01 --end-date=2024-12-31

  # Re-import meets containing specific athlete
  node re-import-meets.js --athlete-name="Alvin Tajima"

  # Dry run to see what would be processed
  node re-import-meets.js --dry-run --meet-ids=2308

  # Process with custom batch size and delay
  node re-import-meets.js --batch-size=5 --delay=3000 --limit=50

  # Expand date window for base64 URL lookups to 15 days
  node re-import-meets.js --meet-ids=2308 --date-window=15

  # Narrow date window to 1 day for precise matching
  node re-import-meets.js --meet-ids=2308 --date-window=1
        `);
    }

    /**
     * Show version information
     */
    showVersion() {
        const packageJson = require('../../package.json');
        console.log(`Meet Re-Import System v${packageJson.version}`);
    }

    /**
     * Create filter criteria from arguments
     * @param {Object} args - Parsed command line arguments
     * @returns {MeetFilterCriteria}
     */
    createFilterCriteria(args) {
        return new MeetFilterCriteria({
            meetIds: args.meetIds || null,
            startDate: args['start-date'] || null,
            endDate: args['end-date'] || null,
            athleteName: args['athlete-name'] || null,
            limit: args.limit || null
        });
    }

    /**
     * Create configuration from arguments
     * @param {Object} args - Parsed command line arguments
     * @returns {ReImportConfiguration}
     */
    createConfiguration(args) {
        // Set date window as environment variable for database-importer to use
        if (args['date-window']) {
            process.env.DATE_WINDOW_DAYS = args['date-window'].toString();
        }

        return new ReImportConfiguration({
            batchSize: args['batch-size'],
            delayBetweenMeets: args.delay,
            maxRetries: 3,
            timeoutMs: args.timeout,
            logLevel: args['log-level'],
            dryRun: args['dry-run'],
            forceReImport: args.force,
            analyzeOnly: args['analyze-only'], // Add analyze-only flag
            dateWindow: args['date-window'] || parseInt(process.env.DATE_WINDOW_DAYS) || 5
        });
    }

    /**
     * Initialize system components with configuration
     * @param {ReImportConfiguration} config
     */
    initializeComponents(config) {
        this.completenessEngine = new MeetCompletenessEngine(this.supabase, config);
        this.skipManager = new MeetSkipManager(this.supabase, config);
        this.orchestrator = new DetailedReImportOrchestrator(this.supabase, config);
        this.progressReporter = new ProgressReporter(config);
        this.session = new ReImportSession();

        this.logger.setLogLevel(config.logLevel);
        this.logger.info('Initialized system components', { 
            batchSize: config.batchSize,
            delayBetweenMeets: config.delayBetweenMeets,
            dryRun: config.dryRun
        });
    }

    /**
     * Run the re-import process
     * @param {MeetFilterCriteria} filters
     * @param {ReImportConfiguration} config
     */
    async runReImport(filters, config) {
        try {
            this.logger.logSessionStart(this.session.sessionId);

            // Get incomplete meets
            this.logger.info('Identifying incomplete meets...');
            const incompleteMeets = await this.completenessEngine.getIncompleteMeets(filters.toQueryParams());
            
            if (incompleteMeets.length === 0) {
                this.logger.info('No incomplete meets found matching criteria');
                return;
            }

            this.logger.info(`Found ${incompleteMeets.length} incomplete meets to process`);

            if (config.dryRun || config.analyzeOnly) {
                this.logger.info(`${config.analyzeOnly ? 'ANALYZE-ONLY' : 'DRY RUN'} MODE - Would process the following meets:`);
                incompleteMeets.forEach(meet => {
                    const discrepancy = meet.completenessResult.sport80ResultCount - meet.completenessResult.databaseResultCount;
                    console.log(`  📋 Meet ${meet.id}: ${meet.name} (${discrepancy} missing results)`);
                });
                return;
            }

            // Process meets in batches
            const batches = this._createBatches(incompleteMeets, config.batchSize);
            
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                this.logger.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} meets)`);
                
                const batchResult = await this.orchestrator.processMeetBatch(batch);
                
                // Update session with batch results
                batchResult.meetResults.forEach(meetResult => {
                    this.session.addMeetResult(meetResult);
                });

                // Add delay between batches if not the last batch
                if (i < batches.length - 1 && config.delayBetweenMeets > 0) {
                    this.logger.info(`Waiting ${config.delayBetweenMeets/1000}s before next batch...`);
                    await this._delay(config.delayBetweenMeets);
                }
            }

            // Generate final report
            this.session.complete('Re-import process completed');
            const summary = await this.progressReporter.generateSummaryReport(this.session.meetResults);
            
            this.logger.logSessionEnd(this.session.sessionId, summary);

        } catch (error) {
            this.logger.error(`Re-import process failed: ${error.message}`);
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

            // Create configuration and filters
            const config = this.createConfiguration(args);
            const filters = this.createFilterCriteria(args);

            // Validate configuration
            const configErrors = config.validate();
            if (configErrors.length > 0) {
                this.logger.error('Configuration validation failed', { errors: configErrors });
                process.exit(1);
            }

            // Initialize components
            this.initializeComponents(config);

            // Run re-import process
            await this.runReImport(filters, config);

        } catch (error) {
            this.logger.error(`CLI execution failed: ${error.message}`);
            console.error('Full error:', error);
            process.exit(1);
        }
    }

    /**
     * Create batches from array of meets
     * @private
     */
    _createBatches(meets, batchSize) {
        const batches = [];
        for (let i = 0; i < meets.length; i += batchSize) {
            batches.push(meets.slice(i, i + batchSize));
        }
        return batches;
    }

    /**
     * Add delay
     * @private
     */
    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run CLI if this file is executed directly
if (require.main === module) {
    const cli = new MeetReImportCLI();
    cli.main(process.argv).catch(error => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { MeetReImportCLI };