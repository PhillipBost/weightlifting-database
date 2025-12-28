#!/usr/bin/env node

/**
 * Unified Scraper CLI
 * 
 * Consolidates functionality from:
 * 1. re-import-meets.js (Base Architecture)
 * 2. surgical-strike-wso-scraper.js (WSO Metadata Backfill)
 * 3. scrape-missing-meet-ids.js (Gap Recovery)
 */

require('dotenv').config();
const minimist = require('minimist');
const { createClient } = require('@supabase/supabase-js');
const { SimpleLogger } = require('./meet-re-import/lib/simple-logger');
const { UnifiedConfiguration, UnifiedSession } = require('./unified-scraper/lib/shared-config');
const { ReImportEngine } = require('./unified-scraper/lib/engines/reimport-engine');
const { WsoBackfillEngine } = require('./unified-scraper/lib/engines/wso-backfill-engine');
const { GapRecoveryEngine } = require('./unified-scraper/lib/engines/gap-scraper-engine');

class UnifiedScraperCLI {
    constructor() {
        this.logger = new SimpleLogger('UnifiedScraper');
        this.supabase = null;
    }

    async initialize() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
        );
        this.logger.info('Initialized Supabase client');
    }

    parseArguments(argv) {
        return minimist(argv.slice(2), {
            string: ['mode', 'meet-ids', 'start-date', 'end-date', 'athlete-name', 'gender', 'log-level'],
            number: ['batch-size', 'delay', 'limit', 'timeout', 'start-id', 'end-id', 'max-gaps', 'max-results'],
            boolean: ['dry-run', 'force', 'help', 'version', 'analyze-only', 'no-metadata'],
            alias: {
                'm': 'mode',
                'd': 'dry-run',
                'f': 'force',
                'h': 'help'
            },
            default: {
                'mode': 'reimport',
                'batch-size': 10,
                'delay': 2000,
                'log-level': 'info'
            }
        });
    }

    showHelp() {
        console.log(`
Unified Scraper System
======================

Usage: node unified-scraper.js --mode=<mode> [options]

Modes:
  reimport    Find meets with missing results and populate them (Default)
  wso         Backfill missing WSO/Club metadata on existing results
  gaps        Find and scrape missing meet IDs (gaps in sequence)

Common Options:
  --dry-run, -d           Show what would be done without doing it
  --log-level <level>     info, debug, warn, error
  --force, -f             Force operations (overwrite/update even if seems unnecessary)
  --help, -h              Show this help

Mode: reimport
  --meet-ids <ids>        Comma-separated list of meet IDs
  --start-date <date>     YYYY-MM-DD
  --end-date <date>       YYYY-MM-DD
  --athlete-name <name>   Filter by athlete
  --analyze-only          Only analyze, do not import

Mode: wso
  --meet-ids <ids>        Filter by meet ID(s)
  --gender <M|F>          Filter by gender
  --max-results <n>       Limit number of results to process
  --athlete-name <name>   Filter by athlete

Mode: gaps
  --start-id <n>          Start meet ID
  --end-id <n>            End meet ID
  --max-gaps <n>          Max gaps to process
  --no-metadata           Skip separate metadata enrichment step
`);
    }

    async main(argv) {
        try {
            const args = this.parseArguments(argv);

            if (args.help) {
                this.showHelp();
                return;
            }

            // Map some aliases
            args.genderFilter = args.gender;
            args.maxGaps = args['max-gaps'];
            args.startId = args['start-id'];
            args.endId = args['end-id'];
            args.maxResults = args['max-results'];
            args.analyzeOnly = args['analyze-only'];
            args.noMetadata = args['no-metadata'];
            args.startDate = args['start-date'];
            args.endDate = args['end-date'];
            args.athleteName = args['athlete-name'];
            args.dryRun = args['dry-run'];
            args.meetIds = args['meet-ids'] ? args['meet-ids'].split(',').map(Number).filter(n => !isNaN(n)) : null;
            args.batchSize = args['batch-size'];
            args.logLevel = args['log-level'];

            const config = new UnifiedConfiguration(args);
            const validationErrors = config.validate();
            if (validationErrors.length > 0) {
                this.logger.error('Configuration Errors:', validationErrors);
                process.exit(1);
            }

            await this.initialize();

            // Set specific log level
            this.logger.setLogLevel(config.logLevel);

            let engine;
            switch (config.mode) {
                case 'reimport':
                    engine = new ReImportEngine(this.supabase, config, this.logger);
                    break;
                case 'wso':
                    engine = new WsoBackfillEngine(this.supabase, config, this.logger);
                    break;
                case 'gaps':
                    engine = new GapRecoveryEngine(this.supabase, config, this.logger);
                    break;
                default:
                    throw new Error(`Unknown mode: ${config.mode}`);
            }

            const session = new UnifiedSession(config.mode);
            this.logger.info(`Starting session: ${session.id} (Mode: ${config.mode})`);

            await engine.run(session);

            session.complete();
            this.logger.info(`Session completed in ${session.getDuration()}ms`);
            this.logger.info(`Stats: Completed=${session.completed}, Failed=${session.failed}, Skipped=${session.skipped}`);

        } catch (error) {
            this.logger.error('Fatal Error:', error);
            process.exit(1);
        }
    }
}

if (require.main === module) {
    new UnifiedScraperCLI().main(process.argv);
}

module.exports = { UnifiedScraperCLI };
