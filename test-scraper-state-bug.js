#!/usr/bin/env node
/**
 * TEST SCRIPT: Reproduce Scraper State Contamination Bug
 *
 * Purpose: Test if scraper returns wrong results when processing multiple events sequentially
 *
 * Test Scenario:
 * - Import two events known to have phantom duplicates (e.g., meet IDs 671/672)
 * - Add logging to verify URL navigation
 * - Check if results are identical (indicating bug)
 */

require('dotenv').config();
const scraper = require('./scripts/production/iwf-results-scraper');
const config = require('./scripts/production/iwf-config');

// Known problematic event pairs (from analysis)
const TEST_EVENTS = [
    { event_id: '661', year: 1999, date: '1999-05-01', name: '2nd UNIVERSITY WORLD CUP' },
    { event_id: '621', year: 2005, date: '2005-05-17', name: '31st JUNIOR WORLD CHAMPS' }
];

async function testScraperStateContamination() {
    console.log('='.repeat(80));
    console.log('TEST: Scraper State Contamination Bug Reproduction');
    console.log('='.repeat(80));

    const results = [];

    try {
        // Initialize browser ONCE (simulating orchestrator behavior)
        console.log('\n📦 Initializing browser (ONCE)...');
        await scraper.initBrowser();

        // Process events sequentially (simulating orchestrator loop)
        for (let i = 0; i < TEST_EVENTS.length; i++) {
            const event = TEST_EVENTS[i];

            console.log(`\n${'─'.repeat(80)}`);
            console.log(`Event ${i + 1}/${TEST_EVENTS.length}: ${event.name}`);
            console.log(`Event ID: ${event.event_id}, Year: ${event.year}`);
            console.log('─'.repeat(80));

            // Scrape event
            const result = await scraper.scrapeEventResults(
                event.event_id,
                event.year,
                event.date,
                null  // No endpoint specified
            );

            // Store results for comparison
            results.push({
                event_id: event.event_id,
                event_name: event.name,
                url: result.url,
                success: result.success,
                mens_athletes: result.mens_weight_classes?.total_athletes || 0,
                womens_athletes: result.womens_weight_classes?.total_athletes || 0,
                total_athletes: (result.mens_weight_classes?.total_athletes || 0) +
                               (result.womens_weight_classes?.total_athletes || 0)
            });

            console.log(`\n✓ Scraped: ${results[i].total_athletes} athletes`);
        }

        // Close browser
        console.log('\n🔒 Closing browser...');
        await scraper.closeBrowser();

        // Analysis
        console.log('\n' + '='.repeat(80));
        console.log('RESULTS ANALYSIS');
        console.log('='.repeat(80));

        // Compare athlete counts
        console.log('\nAthlete counts by event:');
        results.forEach((r, idx) => {
            console.log(`  Event ${idx + 1} (${r.event_id}): ${r.total_athletes} athletes`);
        });

        // Check for identical results (SMOKING GUN)
        if (results[0].total_athletes === results[1].total_athletes &&
            results[0].total_athletes > 0) {
            console.log('\n🔴 BUG DETECTED: Both events have identical athlete counts!');
            console.log('   This suggests scraper returned same data for both events.');
            console.log('   Root cause: Browser state contamination or cached navigation');
        } else {
            console.log('\n✓ Results differ - scraper appears to work correctly');
        }

        console.log('\n' + '='.repeat(80));

    } catch (error) {
        console.error(`\n❌ Test failed: ${error.message}`);
        console.error(error.stack);
    }
}

// Run test
testScraperStateContamination()
    .then(() => {
        console.log('\n✓ Test complete');
        process.exit(0);
    })
    .catch(err => {
        console.error(`\n❌ Fatal error: ${err.message}`);
        process.exit(1);
    });
