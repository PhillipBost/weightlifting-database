#!/usr/bin/env node
/**
 * IWF Database Importer - Main Orchestrator Script
 *
 * Coordinates complete IWF results import workflow:
 * 1. Scrape event results
 * 2. Upsert meet and location records
 * 3. Import athlete results with YTD calculations
 * 4. Generate comprehensive summary
 *
 * Usage:
 *   # Single event import
 *   node iwf-database-importer.js --event-id 661 --year 2025 --date "2025-06-01"
 *
 *   # Force re-import (overwrite existing)
 *   node iwf-database-importer.js --event-id 661 --year 2025 --force
 *
 *   # Batch import from events file
 *   node iwf-database-importer.js --events-file output/iwf_events_2024.json
 *
 *   # Dry run (scrape but don't import)
 *   node iwf-database-importer.js --event-id 661 --year 2025 --dry-run
 *
 * @module iwf-database-importer
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const meetManager = require('./iwf-meet-manager');
const resultsImporter = require('./iwf-results-importer');
const config = require('./iwf-config');

// ============================================================================
// SCRAPER INTEGRATION
// ============================================================================

/**
 * Run IWF results scraper as child process
 * Returns scraped data from scraper module
 *
 * @param {string} eventId - IWF event ID
 * @param {number} year - Event year
 * @param {string} eventDate - Event date (YYYY-MM-DD)
 * @returns {Promise<Object>} - Scraper result data
 */
async function runScraper(eventId, year, eventDate) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SCRAPING EVENT ${eventId}`);
    console.log('='.repeat(80));

    // Import scraper module and run it
    const scraper = require('./iwf-results-scraper');

    try {
        // Initialize browser
        await scraper.initializeBrowser();

        // Scrape event results
        const result = await scraper.scrapeEventResults(eventId, year, eventDate, null);

        // Close browser
        await scraper.closeBrowser();

        if (!result.success) {
            throw new Error('Scraper failed to complete successfully');
        }

        return result;

    } catch (error) {
        console.error(`❌ Scraper error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// IMPORT WORKFLOW
// ============================================================================

/**
 * Import single event to database
 * Main workflow orchestrator
 *
 * @param {string} eventId - IWF event ID
 * @param {number} year - Event year
 * @param {string} eventDate - Event date (YYYY-MM-DD)
 * @param {Object} options - Import options
 * @returns {Promise<Object>} - Import summary
 */
async function importEventToDatabase(eventId, year, eventDate, options = {}) {
    const startTime = Date.now();

    const summary = {
        eventId: eventId,
        year: year,
        eventDate: eventDate,
        success: false,
        meet: null,
        importStats: null,
        errors: [],
        executionTimeMs: 0
    };

    try {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`IWF DATABASE IMPORT`);
        console.log('='.repeat(80));
        console.log(`Event ID: ${eventId}`);
        console.log(`Year: ${year}`);
        console.log(`Date: ${eventDate}`);
        if (options.force) console.log(`Mode: FORCE RE-IMPORT`);
        if (options.dryRun) console.log(`Mode: DRY RUN (no database changes)`);
        console.log('='.repeat(80));

        // Step 1: Check if meet already exists and has results
        const existingMeet = await meetManager.findExistingMeet(eventId);

        if (existingMeet && !options.force) {
            console.log(`\n✓ Meet already exists: ${existingMeet.Meet} (ID: ${existingMeet.iwf_meet_id})`);

            const resultsCheck = await meetManager.checkMeetHasResults(existingMeet.iwf_meet_id);

            if (resultsCheck.hasResults) {
                console.log(`✓ Meet already has ${resultsCheck.count} results`);
                console.log(`\n⏭️  Skipping import (use --force to re-import)`);

                summary.meet = existingMeet;
                summary.importStats = {
                    skipped: true,
                    existingResults: resultsCheck.count
                };
                summary.success = true;
                summary.executionTimeMs = Date.now() - startTime;
                return summary;
            }

            console.log(`⚠️  Meet exists but has no results - proceeding with import`);
        }

        // Step 2: Extract meet metadata from event discovery data
        console.log(`\n📋 Extracting meet metadata...`);
        let meetMetadata = meetManager.extractMeetMetadata(eventId, year);

        if (!meetMetadata) {
            console.log(`⚠️  No event discovery data found, will use minimal metadata`);
            meetMetadata = {
                event_id: eventId,
                Meet: `Event ${eventId}`,
                Level: 'International',
                Date: eventDate,
                URL: config.buildEventDetailURL(eventId, year, eventDate)
            };
        }

        // Step 3: Scrape event results
        console.log(`\n🌐 Scraping event results...`);
        const scraperResult = await runScraper(eventId, year, eventDate);

        if (!scraperResult.success) {
            throw new Error('Failed to scrape event results');
        }

        const mensResults = scraperResult.mens_weight_classes;
        const womensResults = scraperResult.womens_weight_classes;

        console.log(`\n✓ Scraping complete:`);
        console.log(`  Men's athletes: ${mensResults?.total_athletes || 0}`);
        console.log(`  Women's athletes: ${womensResults?.total_athletes || 0}`);
        console.log(`  Total athletes: ${(mensResults?.total_athletes || 0) + (womensResults?.total_athletes || 0)}`);

        // Dry run mode: stop here
        if (options.dryRun) {
            console.log(`\n📊 DRY RUN MODE - No database changes made`);
            summary.success = true;
            summary.importStats = {
                dryRun: true,
                totalAthletes: (mensResults?.total_athletes || 0) + (womensResults?.total_athletes || 0)
            };
            summary.executionTimeMs = Date.now() - startTime;
            return summary;
        }

        // Step 4: Upsert meet record
        console.log(`\n📝 Upserting meet record...`);
        const meet = await meetManager.upsertIWFMeet(meetMetadata);
        summary.meet = meet;

        // Step 5: Upsert location record (if we have location data)
        if (meetMetadata.location_city || meetMetadata.location_country) {
            console.log(`\n📍 Upserting meet location...`);
            const locationData = meetManager.parseLocationData(meetMetadata);
            await meetManager.upsertIWFMeetLocation(meet.db_meet_id, locationData);
        }

        // Step 6: Import results with YTD calculations
        console.log(`\n💾 Importing competition results...`);
        const importStats = await resultsImporter.importMeetResults(
            mensResults,
            womensResults,
            meet.db_meet_id,
            {
                Meet: meet.Meet,
                Date: meet.Date,
                Level: meet.Level
            },
            {
                batchSize: options.batchSize || 100,
                delayMs: options.delayMs || 200
            }
        );

        summary.importStats = importStats;
        summary.success = true;

        // Step 7: Print summary
        console.log(`\n${'='.repeat(80)}`);
        console.log(`IMPORT SUMMARY`);
        console.log('='.repeat(80));
        console.log(`Event: ${eventId} - ${meet.Meet}`);
        console.log(`Meet ID: ${meet.db_meet_id}`);
        console.log(`\nResults:`);
        console.log(`  Total athletes: ${importStats.total.totalAthletes}`);
        console.log(`  Successfully imported: ${importStats.total.successful}`);
        console.log(`  Duplicates skipped: ${importStats.total.duplicates}`);
        console.log(`  Errors: ${importStats.total.errors}`);
        console.log(`\nLifters:`);
        console.log(`  New lifters created: ${importStats.total.newLifters}`);
        console.log(`  Existing lifters: ${importStats.total.existingLifters}`);

        if (importStats.total.errors > 0) {
            console.log(`\n⚠️  Errors occurred during import:`);
            const errorSample = [
                ...(importStats.mens?.errorDetails || []),
                ...(importStats.womens?.errorDetails || [])
            ].slice(0, 5);

            errorSample.forEach(err => {
                console.log(`  - ${err.athlete} (${err.weightClass}): ${err.error}`);
            });

            if (importStats.total.errors > 5) {
                console.log(`  ... and ${importStats.total.errors - 5} more errors`);
            }
        }

        summary.executionTimeMs = Date.now() - startTime;
        console.log(`\nExecution time: ${(summary.executionTimeMs / 1000).toFixed(2)} seconds`);
        console.log('='.repeat(80));

        return summary;

    } catch (error) {
        console.error(`\n❌ Import failed: ${error.message}`);
        console.error(error.stack);

        summary.success = false;
        summary.errors.push(error.message);
        summary.executionTimeMs = Date.now() - startTime;

        return summary;
    }
}

/**
 * Batch import multiple events from events file
 *
 * @param {string} eventsFilePath - Path to events JSON file
 * @param {Object} options - Import options
 * @returns {Promise<Object>} - Batch import summary
 */
async function batchImportEvents(eventsFilePath, options = {}) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`BATCH IMPORT FROM FILE`);
    console.log('='.repeat(80));
    console.log(`File: ${eventsFilePath}`);
    console.log('='.repeat(80));

    if (!fs.existsSync(eventsFilePath)) {
        throw new Error(`Events file not found: ${eventsFilePath}`);
    }

    const events = JSON.parse(fs.readFileSync(eventsFilePath, 'utf8'));
    console.log(`Loaded ${events.length} events`);

    const batchSummary = {
        totalEvents: events.length,
        successful: 0,
        failed: 0,
        skipped: 0,
        results: []
    };

    for (let i = 0; i < events.length; i++) {
        const event = events[i];

        console.log(`\n\n${'─'.repeat(80)}`);
        console.log(`Event ${i + 1}/${events.length}: ${event.event_name || event.event_id}`);
        console.log('─'.repeat(80));

        try {
            const result = await importEventToDatabase(
                event.event_id,
                event.year || new Date(event.date).getFullYear(),
                event.date,
                options
            );

            batchSummary.results.push(result);

            if (result.success) {
                if (result.importStats?.skipped) {
                    batchSummary.skipped++;
                } else {
                    batchSummary.successful++;
                }
            } else {
                batchSummary.failed++;
            }

            // Delay between events to avoid overwhelming database
            if (i < events.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

        } catch (error) {
            console.error(`❌ Failed to import event ${event.event_id}: ${error.message}`);
            batchSummary.failed++;
            batchSummary.results.push({
                eventId: event.event_id,
                success: false,
                errors: [error.message]
            });
        }
    }

    // Print batch summary
    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`BATCH IMPORT SUMMARY`);
    console.log('='.repeat(80));
    console.log(`Total events: ${batchSummary.totalEvents}`);
    console.log(`Successful: ${batchSummary.successful}`);
    console.log(`Skipped: ${batchSummary.skipped}`);
    console.log(`Failed: ${batchSummary.failed}`);
    console.log('='.repeat(80));

    return batchSummary;
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

/**
 * Parse command-line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        eventId: null,
        year: null,
        date: null,
        eventsFile: null,
        force: false,
        dryRun: false,
        batchSize: 100,
        delayMs: 200
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--event-id':
                options.eventId = args[++i];
                break;
            case '--year':
                options.year = parseInt(args[++i]);
                break;
            case '--date':
                options.date = args[++i];
                break;
            case '--events-file':
                options.eventsFile = args[++i];
                break;
            case '--force':
                options.force = true;
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--batch-size':
                options.batchSize = parseInt(args[++i]);
                break;
            case '--delay':
                options.delayMs = parseInt(args[++i]);
                break;
            case '--help':
                printHelp();
                process.exit(0);
            default:
                console.error(`Unknown argument: ${args[i]}`);
                printHelp();
                process.exit(1);
        }
    }

    return options;
}

/**
 * Print CLI help message
 */
function printHelp() {
    console.log(`
IWF Database Importer - Import International Weightlifting Federation Results

USAGE:
  node iwf-database-importer.js [OPTIONS]

OPTIONS:
  --event-id <id>       IWF event ID to import
  --year <year>         Event year (for endpoint selection)
  --date <date>         Event date (YYYY-MM-DD format)
  --events-file <path>  Path to events JSON file for batch import
  --force               Force re-import even if event already exists
  --dry-run             Scrape data but don't import to database
  --batch-size <n>      Results batch size (default: 100)
  --delay <ms>          Delay between batches in ms (default: 200)
  --help                Show this help message

EXAMPLES:
  # Single event import (MODERN endpoint)
  node iwf-database-importer.js --event-id 661 --year 2025 --date "2025-06-01"

  # Single event import (HISTORICAL endpoint)
  node iwf-database-importer.js --event-id 438 --year 2009

  # Force re-import existing event
  node iwf-database-importer.js --event-id 661 --year 2025 --force

  # Dry run (no database changes)
  node iwf-database-importer.js --event-id 661 --year 2025 --dry-run

  # Batch import from events file
  node iwf-database-importer.js --events-file output/iwf_events_2024.json

  # Batch import with custom batch size
  node iwf-database-importer.js --events-file output/iwf_events_2024.json --batch-size 50
`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    const options = parseArgs();

    // Validate options
    if (!options.eventId && !options.eventsFile) {
        console.error('Error: Either --event-id or --events-file must be specified');
        printHelp();
        process.exit(1);
    }

    if (options.eventId && !options.year) {
        console.error('Error: --year is required when using --event-id');
        printHelp();
        process.exit(1);
    }

    try {
        if (options.eventsFile) {
            // Batch import mode
            await batchImportEvents(options.eventsFile, options);
        } else {
            // Single event import mode
            await importEventToDatabase(
                options.eventId,
                options.year,
                options.date,
                options
            );
        }

        console.log(`\n✅ Import completed successfully\n`);
        process.exit(0);

    } catch (error) {
        console.error(`\n❌ Import failed: ${error.message}\n`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    importEventToDatabase,
    batchImportEvents,
    runScraper
};
