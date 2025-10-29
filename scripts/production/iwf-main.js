#!/usr/bin/env node
/**
 * IWF MAIN ORCHESTRATOR
 *
 * Single entry point for complete IWF scraper pipeline:
 * 1. Event discovery → 2. Results scraping → 3. Database import
 *
 * Usage:
 *   node iwf-main.js --year 2025                    # Single year
 *   node iwf-main.js --event-id 661                 # Single event
 *   node iwf-main.js --from-year 2024 --to-year 2025  # Year range
 *   node iwf-main.js --help                         # Show help
 */

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

const config = require('./iwf-config');
const { log, logError, ensureDirectories } = require('./iwf-logger');
const { importEventToDatabase } = require('./iwf-database-importer');

// ============================================================================
// CONSTANTS
// ============================================================================

const OUTPUT_DIR = config.LOGGING.OUTPUT_DIR;
const EVENT_DELAY_MS = config.TIMING.EVENT_DELAY_MS;

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

function parseArguments() {
    const argv = minimist(process.argv.slice(2), {
        string: ['year', 'event-id', 'from-year', 'to-year', 'date', 'limit'],
        boolean: ['help']
    });

    if (argv.help) {
        printHelp();
        process.exit(0);
    }

    return {
        year: argv.year ? parseInt(argv.year) : null,
        eventId: argv['event-id'],
        fromYear: argv['from-year'] ? parseInt(argv['from-year']) : null,
        toYear: argv['to-year'] ? parseInt(argv['to-year']) : null,
        date: argv.date,
        limit: argv.limit ? parseInt(argv.limit) : null  // Limit number of athletes to import
    };
}

function printHelp() {
    console.log(`
IWF Main Orchestrator - Scrape, Scrape & Import IWF Competition Results

Usage:
  node iwf-main.js --year 2025                    Scrape and import all events from a single year
  node iwf-main.js --event-id 661                 Scrape and import a single event
  node iwf-main.js --from-year 2024 --to-year 2025  Scrape and import events from a year range
  node iwf-main.js --help                         Show this help message

Options:
  --limit <n>              Limit to first N athletes (for testing)

Examples:
  # Import all 2025 events
  node iwf-main.js --year 2025

  # Import single event (requires year context)
  node iwf-main.js --event-id 661 --year 2025

  # Test with only 10 athletes
  node iwf-main.js --event-id 661 --year 2025 --limit 10

  # Import 2024-2025 events
  node iwf-main.js --from-year 2024 --to-year 2025

Environment Variables:
  SUPABASE_IWF_URL          IWF database URL
  SUPABASE_IWF_SECRET_KEY   IWF database secret key
    `);
}

// ============================================================================
// DATABASE VERIFICATION
// ============================================================================

/**
 * Verify IWF database connection and tables exist
 */
async function verifyDatabaseConnection() {
    log('Verifying IWF database connection...', 'INFO');

    // Check environment variables
    if (!process.env.SUPABASE_IWF_URL || !process.env.SUPABASE_IWF_SECRET_KEY) {
        throw new Error(
            'Missing IWF database credentials.\n' +
            'Set SUPABASE_IWF_URL and SUPABASE_IWF_SECRET_KEY environment variables.'
        );
    }

    // Test connection
    try {
        const { data, error } = await config.supabaseIWF
            .from('iwf_meets')
            .select('count')
            .limit(1);

        if (error) {
            throw new Error(`Database connection failed: ${error.message}`);
        }
    } catch (error) {
        throw new Error(`Database connection failed: ${error.message}`);
    }

    // Verify required tables exist
    const requiredTables = ['iwf_meets', 'iwf_meet_locations', 'iwf_lifters', 'iwf_meet_results'];

    for (const table of requiredTables) {
        try {
            await config.supabaseIWF.from(table).select('count').limit(1);
        } catch (error) {
            throw new Error(`Table '${table}' not found. Run database migrations first.`);
        }
    }

    log('✓ Database connection verified', 'INFO');
}

// ============================================================================
// EVENT LOADING
// ============================================================================

/**
 * Load events from JSON file
 * @param {number} year - Year to load
 * @returns {Array} - Array of event objects
 */
function loadEventsFromFile(year) {
    const eventsFile = path.join(OUTPUT_DIR, `iwf_events_${year}.json`);

    if (!fs.existsSync(eventsFile)) {
        throw new Error(
            `Events file not found: ${eventsFile}\n` +
            `Run event discovery first:\n` +
            `  node iwf-event-discovery.js --year ${year}`
        );
    }

    try {
        const fileContent = fs.readFileSync(eventsFile, 'utf8');
        const data = JSON.parse(fileContent);

        if (!data.events || !Array.isArray(data.events)) {
            throw new Error('Invalid events file format');
        }

        return data.events;
    } catch (error) {
        throw new Error(`Failed to load events from ${eventsFile}: ${error.message}`);
    }
}

/**
 * Get events to process based on CLI arguments
 * @param {Object} args - Parsed CLI arguments
 * @returns {Array} - Array of event objects to process
 */
function getEventsToProcess(args) {
    let eventsToProcess = [];

    if (args.eventId) {
        // Single event mode
        if (!args.year) {
            throw new Error('--year is required when using --event-id');
        }

        log(`Single event mode: event_id=${args.eventId}, year=${args.year}`, 'INFO');

        const allEvents = loadEventsFromFile(args.year);
        const event = allEvents.find(e => e.event_id === args.eventId);

        if (!event) {
            throw new Error(
                `Event ${args.eventId} not found in year ${args.year}.\n` +
                `Available events: ${allEvents.map(e => e.event_id).join(', ')}`
            );
        }

        eventsToProcess.push(event);

    } else if (args.year) {
        // Single year mode
        log(`Year mode: ${args.year}`, 'INFO');
        eventsToProcess = loadEventsFromFile(args.year);

    } else if (args.fromYear && args.toYear) {
        // Date range mode
        log(`Range mode: ${args.fromYear} to ${args.toYear}`, 'INFO');

        for (let year = args.fromYear; year <= args.toYear; year++) {
            try {
                const yearEvents = loadEventsFromFile(year);
                eventsToProcess.push(...yearEvents);
            } catch (error) {
                log(`Skipping year ${year}: ${error.message}`, 'WARN');
            }
        }

        if (eventsToProcess.length === 0) {
            throw new Error(`No events found in range ${args.fromYear}-${args.toYear}`);
        }

    } else {
        throw new Error('Must specify --year, --event-id, or --from-year/--to-year');
    }

    return eventsToProcess;
}

// ============================================================================
// ORCHESTRATION
// ============================================================================

/**
 * Process a single event (scrape + import)
 * @param {Object} event - Event object from JSON
 * @param {number} index - Progress index
 * @param {number} total - Total events to process
 * @param {Object} options - Import options (includes limit)
 * @returns {Object} - Result summary
 */
async function processEvent(event, index, total, options = {}) {
    const progressLabel = `[${index + 1}/${total}]`;

    try {
        log(`${progressLabel} Processing: ${event.event_name} (ID: ${event.event_id})`, 'INFO');

        // Call existing importer with event data
        const summary = await importEventToDatabase(
            event.event_id,
            event.year,
            event.date,
            options  // Pass limit and other options
        );

        if (summary.success) {
            log(`${progressLabel} ✓ Imported: ${summary.importStats?.resultCount || 0} results`, 'INFO');
            return { success: true, event, summary };
        } else {
            log(`${progressLabel} ✗ Import failed: ${summary.errors?.[0] || 'Unknown error'}`, 'ERROR');
            return { success: false, event, error: summary.errors?.[0] };
        }

    } catch (error) {
        logError(error, { event_id: event.event_id, event_name: event.event_name });
        log(`${progressLabel} ✗ Error: ${error.message}`, 'ERROR');
        return { success: false, event, error: error.message };
    }
}

/**
 * Main orchestration function
 */
async function main() {
    const startTime = Date.now();
    let exitCode = 0;

    try {
        ensureDirectories();

        log('\n' + '='.repeat(80));
        log('IWF MAIN ORCHESTRATOR - STARTED');
        log('='.repeat(80));

        // Parse CLI arguments
        const args = parseArguments();

        // Verify database
        await verifyDatabaseConnection();

        // Get events to process
        log('\nLoading events...', 'INFO');
        const eventsToProcess = getEventsToProcess(args);
        log(`Found ${eventsToProcess.length} event(s) to process`, 'INFO');

        // Process each event
        log('\nProcessing events...', 'INFO');
        log('='.repeat(80));

        const results = {
            timestamp: new Date().toISOString(),
            mode: null,
            events_requested: 0,
            events_processed: 0,
            events_successful: 0,
            events_failed: 0,
            total_results_imported: 0,
            results: [],
            errors: []
        };

        // Determine mode
        if (args.eventId) {
            results.mode = 'single_event';
        } else if (args.year) {
            results.mode = 'single_year';
        } else {
            results.mode = 'year_range';
        }

        results.events_requested = eventsToProcess.length;

        // Prepare options to pass through
        const importOptions = {
            limit: args.limit || null
        };

        // Process each event
        for (let i = 0; i < eventsToProcess.length; i++) {
            const event = eventsToProcess[i];

            const result = await processEvent(event, i, eventsToProcess.length, importOptions);
            results.results.push(result);

            if (result.success) {
                results.events_successful += 1;
                if (result.summary?.importStats?.resultCount) {
                    results.total_results_imported += result.summary.importStats.resultCount;
                }
            } else {
                results.events_failed += 1;
                results.errors.push({
                    event_id: event.event_id,
                    event_name: event.event_name,
                    error: result.error
                });
            }

            results.events_processed += 1;

            // Rate limiting between events (except after last event)
            if (i < eventsToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, EVENT_DELAY_MS));
            }
        }

        // Generate summary
        log('\n' + '='.repeat(80));
        log('ORCHESTRATION SUMMARY');
        log('='.repeat(80));
        log(`Mode: ${results.mode}`, 'INFO');
        log(`Events processed: ${results.events_processed}/${results.events_requested}`, 'INFO');
        log(`Events successful: ${results.events_successful}`, 'INFO');
        log(`Events failed: ${results.events_failed}`, 'INFO');
        log(`Total results imported: ${results.total_results_imported}`, 'INFO');

        const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
        log(`Execution time: ${elapsedSeconds} seconds`, 'INFO');

        // Save summary report
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const summaryFile = path.join(OUTPUT_DIR, `iwf-orchestrator-summary-${timestamp}.json`);

        results.execution_time_seconds = parseFloat(elapsedSeconds);

        fs.writeFileSync(summaryFile, JSON.stringify(results, null, 2));
        log(`Summary saved to: ${summaryFile}`, 'INFO');

        log('='.repeat(80));
        log('IWF MAIN ORCHESTRATOR - COMPLETED', 'INFO');
        log('='.repeat(80) + '\n');

        // Set exit code based on results
        if (results.events_failed > 0) {
            log(`⚠️  ${results.events_failed} event(s) failed. Review errors above.`, 'WARN');
            exitCode = 1;
        } else {
            log('✓ All events processed successfully', 'INFO');
            exitCode = 0;
        }

    } catch (error) {
        logError(error, { stage: 'main' });
        log('\n' + '='.repeat(80));
        log('❌ ORCHESTRATION FAILED', 'ERROR');
        log('='.repeat(80));
        log(`Error: ${error.message}\n`, 'ERROR');
        exitCode = 1;
    }

    process.exit(exitCode);
}

// ============================================================================
// RUN
// ============================================================================

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    verifyDatabaseConnection,
    loadEventsFromFile,
    getEventsToProcess,
    processEvent
};
