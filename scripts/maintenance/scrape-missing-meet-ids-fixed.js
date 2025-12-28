#!/usr/bin/env node

/**
 * Gap Scraper - Modernized Version
 * 
 * Identifies gaps in the sequential meet_internal_id sequence
 * and scrapes the missing meets from Sport80 with enhanced functionality.
 */

// Check for help/version flags FIRST, before loading any heavy dependencies
const minimist = require('minimist');
if (require.main === module) {
    const quickArgs = minimist(process.argv.slice(2), {
        boolean: ['help', 'version', 'h', 'v'],
        alias: { 'h': 'help', 'v': 'version' }
    });
    
    if (quickArgs.help || quickArgs.h) {
        console.log(`
Gap Scraper - Missing Meet ID Gap Recovery

Usage: node scrape-missing-meet-ids-fixed.js [options]

Options:
  --dry-run, -d           Show what would be done without actually doing it
  --max-gaps <n>          Maximum number of gaps to process (default: 5)
  --start-id <n>          Start ID filter (only process gaps >= this ID)
  --end-id <n>            End ID filter (only process gaps <= this ID)
  --log-level <level>     Log level: error, warn, info, debug (default: info)
  --no-metadata         Skip tiered metadata scraping after import
  --date-window <n>     Date window in days for metadata lookup (default: 5)
  --help, -h              Show this help message
  --version, -v           Show version information

Environment Variables (used as fallback if CLI args not provided):
  DRY_RUN                 Set to 'true' for dry run mode
  MAX_GAPS                Maximum number of gaps to process
  START_ID                Start ID filter
  END_ID                  End ID filter

Examples:
  # Process first 10 gaps
  node scrape-missing-meet-ids-fixed.js --max-gaps=10

  # Process gaps in a specific range
  node scrape-missing-meet-ids-fixed.js --start-id=1000 --end-id=2000

  # Dry run to see what would be processed
  node scrape-missing-meet-ids-fixed.js --dry-run --max-gaps=5

  # Process with debug logging
  node scrape-missing-meet-ids-fixed.js --max-gaps=3 --log-level=debug
        `);
        process.exit(0);
    }
    
    if (quickArgs.version || quickArgs.v) {
        try {
            const packageJson = require('../../package.json');
            console.log(`Gap Scraper v${packageJson.version}`);
        } catch (e) {
            console.log('Gap Scraper v1.0.0');
        }
        process.exit(0);
    }
}
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { scrapeOneMeet } = require('../production/scrapeOneMeet.js');
const { 
    getExistingMeetIds, 
    upsertMeetsToDatabase, 
    processMeetCsvFile,
    extractMeetInternalId
} = require('../production/database-importer-custom.js');

/**
 * Scrape Missing Meet ID Gaps - Enhanced Version
 * 
 * This script identifies gaps in the sequential meet_internal_id sequence
 * and scrapes the missing meets from Sport80 with enhanced functionality:
 * 
 * Enhanced Features:
 * - Extracts athlete internal_ids during scraping process
 * - Integrates base64 lookup fallback for missing internal_ids
 * - Provides internal_id coverage statistics
 * - Uses enhanced athlete matching in database import
 * - Maintains backward compatibility with existing command-line parameters
 * 
 * Requirements covered: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3
 */

async function findGaps(existingIds) {
    if (existingIds.size === 0) return [];
    
    const ids = Array.from(existingIds).sort((a, b) => a - b);
    const min = ids[0];
    const max = ids[ids.length - 1];
    const gaps = [];
    
    console.log(`🔍 Checking gaps between ID ${min} and ${max}...`);
    
    for (let i = min; i <= max; i++) {
        if (!existingIds.has(i)) {
            gaps.push(i);
        }
    }
    
    return gaps;
}

async function getMeetMetadataFromCsv(filePath, internalId) {
    const csvContent = fs.readFileSync(filePath, 'utf8');
    const parsed = Papa.parse(csvContent, {
        header: true,
        delimiter: '|',
        skipEmptyLines: true
    });
    
    if (parsed.data && parsed.data.length > 0) {
        const firstRow = parsed.data[0];
        
        // Count athletes with internal_ids for enhanced reporting
        const athletesWithInternalIds = parsed.data.filter(row => 
            row.Internal_ID && row.Internal_ID !== 'null' && row.Internal_ID !== ''
        ).length;
        
        console.log(`📊 Meet ${internalId}: ${parsed.data.length} total athletes, ${athletesWithInternalIds} with internal_ids`);
        
        return {
            meet_id: internalId, // Using internal_id as meet_id for consistency
            Meet: firstRow.Meet || `Meet ${internalId}`,
            Date: firstRow.Date || null,
            URL: `https://usaweightlifting.sport80.com/public/rankings/results/${internalId}`,
            Level: firstRow.Level || 'Unknown',
            Results: parsed.data.length,
            batch_id: 'gap-recovery-' + new Date().toISOString().split('T')[0],
            scraped_date: new Date().toISOString(),
            athletes_with_internal_ids: athletesWithInternalIds
        };
    }
    return null;
}

