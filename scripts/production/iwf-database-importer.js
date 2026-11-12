#!/usr/bin/env node
/**
 * IWF Database Importer - Complete Import Pipeline Orchestrator
 *
 * @module iwf-database-importer
 *
 * Coordinates complete IWF results import workflow from scraping through database storage.
 *
 * Pipeline Stages:
 * 1. **Event Results Scraping**: Calls iwf-results-scraper to extract competition data
 * 2. **Analytics Enrichment**: Calculates successful attempts, bounce-back, Q-scores
 * 3. **Lifter Management**: Finds or creates lifter records with name normalization
 * 4. **Meet Management**: Creates meet records with geocoded location data
 * 5. **Location Management**: Geocodes meet cities using Nominatim API
 * 6. **Results Import**: Batch imports results with conflict resolution (upsert)
 * 7. **YTD Calculation**: Calculates year-to-date bests for each lifter chronologically
 * 8. **Summary Generation**: Creates comprehensive import report
 *
 * Key Features:
 * - Intelligent deduplication (finds existing lifters by name/birth year/country)
 * - Batch processing with configurable batch sizes
 * - Comprehensive error handling with retry logic
 * - YTD backfill tracking (returns affected lifters for targeted backfill)
 * - Dry run mode for testing
 * - Force mode to re-import existing events
 *
 * Main Export:
 * - `importEventToDatabase(eventId, year, date, options)` - Complete import pipeline
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
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const meetManager = require('./iwf-meet-manager');
const resultsImporter = require('./iwf-results-importer');
const lifterManager = require('./iwf-lifter-manager');
const LockManager = require('./iwf-lock-manager');
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
async function runScraper(eventId, year, eventDate, endpoint, targetUrl = null) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SCRAPING EVENT ${eventId}`);
    console.log('='.repeat(80));

    // Import scraper module and run it
    const scraper = require('./iwf-results-scraper');

    try {
        // Initialize browser
        await scraper.initBrowser();

        // Scrape event results
        const result = await scraper.scrapeEventResults(eventId, year, eventDate, endpoint, targetUrl);

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
    let lockAcquired = false;

    const summary = {
        iwf_meet_id: eventId ? String(eventId) : null,
        eventId: eventId,
        year: year,
        eventDate: eventDate,
        success: false,
        meet: null,
        importStats: null,
        errors: [],
        executionTimeMs: 0,
        affectedLifters: []  // Will be populated with {db_lifter_id, year} objects
    };

    try {
        LockManager.acquireLock();
        lockAcquired = true;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`IWF DATABASE IMPORT`);
        console.log('='.repeat(80));
        console.log(`Event ID: ${eventId}`);
        console.log(`Year: ${year}`);
        console.log(`Date: ${eventDate}`);
        if (options.force) console.log(`Mode: FORCE RE-IMPORT`);
        if (options.dryRun) console.log(`Mode: DRY RUN (no database changes)`);
        if (options.athleteName) console.log(`Target Athlete Filter: "${options.athleteName}"`);
        if (options.htmlFile) console.log(`Source: HTML File (${options.htmlFile})`);
        console.log('='.repeat(80));

        let scraperResult = null;
        if (options.rawHtml || options.htmlFile) {
            console.log(`\n📄 Parsing meet directly from HTML source...`);
            const htmlContent = options.rawHtml || fs.readFileSync(options.htmlFile, 'utf8');
            const scraper = require('./iwf-results-scraper');
            scraperResult = scraper.parseIwfEventHtml(htmlContent, eventId);
            if (!scraperResult.success) {
                throw new Error('Failed to parse meet results from HTML');
            }
            if (!eventId && scraperResult.event_id) {
                eventId = scraperResult.event_id;
                summary.eventId = eventId;
                summary.iwf_meet_id = String(eventId);
            }
            if (options.meetName) {
                scraperResult.meet_name = options.meetName;
            }
        }

        // Step 1: Check if meet already exists and has results
        const existingMeet = await meetManager.findExistingMeet(eventId);

        if (existingMeet && !options.force) {
            console.log(`\n✓ Meet already exists: ${existingMeet.meet || existingMeet.Meet} (ID: ${existingMeet.iwf_meet_id})`);

            const resultsCheck = await meetManager.checkMeetHasResults(existingMeet.db_meet_id || existingMeet.iwf_meet_id);

            if (resultsCheck.hasResults) {
                console.log(`✓ Meet already has ${resultsCheck.count} results`);
                summary.meet = existingMeet;
                summary.success = true;
                summary.executionTimeMs = Date.now() - startTime;

                if (options.dryRun) {
                    console.log(`⚠️ DRY RUN ADVISORY: Meet ${existingMeet.iwf_meet_id || eventId} already exists with ${resultsCheck.count} results. Live non-forced execution would SKIP scorecard scraping for this meet; downstream cross-federation athlete pairing will proceed. Pass --force to simulate scorecard updates and inserts.`);
                    summary.importStats = {
                        dryRun: true,
                        iwf_meet_id: String(existingMeet.iwf_meet_id || eventId),
                        wouldSkip: true,
                        skipReason: `Meet scorecards already exist in database (${resultsCheck.count} results). Live execution without --force skips scorecard scraping; downstream athlete linking proceeds.`,
                        existingResults: resultsCheck.count,
                        simulatedUpdates: 0,
                        simulatedInserts: 0,
                        simulatedLocked: 0
                    };
                } else {
                    console.log(`\n⏭️  Skipping import (use --force to re-import)`);
                    summary.importStats = {
                        iwf_meet_id: String(existingMeet.iwf_meet_id || eventId),
                        skipped: true,
                        existingResults: resultsCheck.count
                    };
                }

                console.log('__IWF_SUMMARY_JSON__:' + JSON.stringify(summary));
                return summary;
            }

            console.log(`⚠️  Meet exists but has no results - proceeding with import`);
        }

        // Step 2: Extract meet metadata from event discovery data
        console.log(`\n📋 Extracting meet metadata...`);
        let meetMetadata = meetManager.extractMeetMetadata(eventId, year);

        if (!meetMetadata) {
            if (existingMeet) {
                console.log(`✓ Using existing database metadata for meet: ${existingMeet.meet}`);
                meetMetadata = {
                    event_id: eventId,
                    Meet: existingMeet.meet,
                    Level: existingMeet.level || 'International',
                    Date: existingMeet.date || eventDate || null,
                    URL: options.url || existingMeet.url || config.getIwfMeetUrl(eventId, eventDate || existingMeet.date || year)
                };
            } else {
                const resolvedMeetName = options.meetName || null;
                const resolvedDate = eventDate || options.date || null;
                meetMetadata = {
                    event_id: eventId,
                    Meet: resolvedMeetName || `Event ${eventId}`,
                    Level: 'International',
                    Date: resolvedDate,
                    URL: options.url || config.getIwfMeetUrl(eventId, resolvedDate || year)
                };
            }
        } else if (options.url) {
            console.log(`✓ Overriding cached meet URL with user-provided URL: ${options.url}`);
            meetMetadata.URL = options.url;
        }

        // Determine target URL with priority:
        // 1. Explicit CLI --url option
        // 2. Extracted meetMetadata.URL (if valid URL)
        // 3. Fallback to 4-tier chronological getIwfMeetUrl
        const targetScrapeUrl = options.url || meetMetadata?.URL || config.getIwfMeetUrl(eventId, eventDate || meetMetadata?.Date || options.date || year);

        // Step 3: Scrape event results (if not already parsed from HTML)
        if (!scraperResult) {
            console.log(`\n🌐 Scraping event results...`);
            scraperResult = await runScraper(eventId, year, eventDate || meetMetadata?.Date || options.date || null, null, targetScrapeUrl);

            if (!scraperResult.success) {
                throw new Error('Failed to scrape event results');
            }
        }

        const mensResults = scraperResult.mens_weight_classes;
        const womensResults = scraperResult.womens_weight_classes;

        console.log(`\n✓ Scraping complete:`);
        console.log(`  Men's athletes: ${mensResults?.total_athletes || 0}`);
        console.log(`  Women's athletes: ${womensResults?.total_athletes || 0}`);
        console.log(`  Total athletes: ${(mensResults?.total_athletes || 0) + (womensResults?.total_athletes || 0)}`);

        // Synchronize authentic meet metadata from scraper/discovery if present
        if (scraperResult?.meet_metadata) {
            const sm = scraperResult.meet_metadata;
            if (!options.meetName && (!meetMetadata.Meet || meetMetadata.Meet === `Event ${eventId}`)) {
                meetMetadata.Meet = sm.meet_name || meetMetadata.Meet;
            }
            if (!options.date && !eventDate && (!meetMetadata.Date || !meetMetadata.Date.trim())) {
                meetMetadata.Date = sm.date || meetMetadata.Date;
            }
            if (!meetMetadata.location_city && sm.location_city) {
                meetMetadata.location_city = sm.location_city;
            }
            if (!meetMetadata.location_country && sm.location_country) {
                meetMetadata.location_country = sm.location_country;
            }
            console.log(`✓ Synchronized authentic meet metadata: "${meetMetadata.Meet}" (${meetMetadata.Date || 'Date N/A'}), Location: ${meetMetadata.location_city || 'N/A'}, ${meetMetadata.location_country || 'N/A'}`);
        }

        // Dry run mode: stop here (with in-memory --athlete-name filtering & scorecard breakdown)
        if (options.dryRun) {
            console.log(`\n📊 DRY RUN MODE - No database changes made`);
            const meetTotalAthletes = (mensResults?.total_athletes || 0) + (womensResults?.total_athletes || 0);

            // Fetch existing database results for this meet to evaluate simulated actions (UPDATE vs INSERT vs LOCKED_SKIP)
            let existingDbScorecards = [];
            if (existingMeet?.db_meet_id) {
                try {
                    const { data: dbRows, error: dbErr } = await config.supabaseIWF
                        .from('iwf_meet_results')
                        .select('db_result_id, db_lifter_id, lifter_name, weight_class, manual_override, total, snatch_lift_1, snatch_lift_2, snatch_lift_3, cj_lift_1, cj_lift_2, cj_lift_3, best_snatch, best_cj')
                        .eq('db_meet_id', existingMeet.db_meet_id);
                    if (!dbErr && dbRows) {
                        existingDbScorecards = dbRows;
                    }
                } catch (fetchErr) {
                    console.warn(`[Dry Run] Warning: Failed to fetch existing meet scorecards: ${fetchErr.message}`);
                }
            }

            const evaluateScorecardSimulation = (sc) => {
                if (!existingDbScorecards || existingDbScorecards.length === 0) {
                    return {
                        simulatedAction: 'INSERT',
                        existingResultId: null,
                        hasChanges: true,
                        diffFields: []
                    };
                }

                const normWc = (sc.weight_class || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const scTokens = (sc.name || sc.athlete_name || '').trim().toLowerCase().split(/\s+/).filter(Boolean);

                const match = existingDbScorecards.find(r => {
                    const rNormWc = (r.weight_class || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    if (normWc && rNormWc && normWc !== rNormWc) return false;

                    const rName = (r.lifter_name || '').toLowerCase();
                    return scTokens.length > 0 && scTokens.every(tok => rName.includes(tok));
                });

                if (!match) {
                    return {
                        simulatedAction: 'INSERT',
                        existingResultId: null,
                        hasChanges: true,
                        diffFields: []
                    };
                }

                if (match.manual_override === true) {
                    return {
                        simulatedAction: 'LOCKED_SKIP',
                        existingResultId: match.db_result_id,
                        hasChanges: false,
                        diffFields: []
                    };
                }

                const diffFields = [];
                const checkDiff = (field, scVal, dbVal) => {
                    const s1 = scVal != null ? String(scVal).trim() : '';
                    const s2 = dbVal != null ? String(dbVal).trim() : '';
                    if (s1 !== s2) diffFields.push(field);
                };

                checkDiff('snatch_1', sc.snatch_1, match.snatch_lift_1);
                checkDiff('snatch_2', sc.snatch_2, match.snatch_lift_2);
                checkDiff('snatch_3', sc.snatch_3, match.snatch_lift_3);
                checkDiff('best_snatch', sc.best_snatch, match.best_snatch);
                checkDiff('cj_1', sc.cj_1, match.cj_lift_1);
                checkDiff('cj_2', sc.cj_2, match.cj_lift_2);
                checkDiff('cj_3', sc.cj_3, match.cj_lift_3);
                checkDiff('best_cj', sc.best_cj, match.best_cj);
                checkDiff('total', sc.total, match.total);

                return {
                    simulatedAction: 'UPDATE',
                    existingResultId: match.db_result_id,
                    hasChanges: diffFields.length > 0,
                    diffFields: diffFields
                };
            };

            if (options.athleteName) {
                const allMens = (mensResults && mensResults.weight_classes)
                    ? mensResults.weight_classes.flatMap(wc => (wc.athletes || []).map(a => ({ ...a, gender: a.gender || 'M', weight_class: a.weight_class || wc.weight_class })))
                    : [];
                const allWomens = (womensResults && womensResults.weight_classes)
                    ? womensResults.weight_classes.flatMap(wc => (wc.athletes || []).map(a => ({ ...a, gender: a.gender || 'F', weight_class: a.weight_class || wc.weight_class })))
                    : [];
                const allAthletes = [...allMens, ...allWomens];

                const targetTokens = options.athleteName.trim().toLowerCase().split(/\s+/).filter(Boolean);
                const matchesAthlete = (a) => {
                    const rawName = (a.name || '').toLowerCase();
                    const normalized = (lifterManager.normalizeName ? lifterManager.normalizeName(a.name || '') : '').toLowerCase();
                    return targetTokens.every(tok => rawName.includes(tok)) ||
                        (normalized && targetTokens.every(tok => normalized.includes(tok)));
                };

                const matchedScorecards = allAthletes.filter(matchesAthlete);

                if (matchedScorecards.length > 0) {
                    console.log(`\n🎯 DRY RUN TARGETED ATHLETE MATCH ("${options.athleteName}"): ${matchedScorecards.length} scorecard(s) found in IWF Event ${eventId}`);

                    const formattedScorecards = matchedScorecards.map(ath => {
                        const sim = evaluateScorecardSimulation(ath);
                        return {
                            athlete_name: ath.name,
                            name: ath.name,
                            division: (ath.gender === 'F' || ath.gender === 'women' || ath.gender === 'W') ? "Women's Division" : "Men's Division",
                            weight_class: ath.weight_class,
                            nation: ath.nation,
                            birth_year: ath.birth_year,
                            body_weight_kg: ath.body_weight != null ? String(ath.body_weight) : null,
                            snatch_1: ath.snatch_1 != null ? String(ath.snatch_1) : null,
                            snatch_2: ath.snatch_2 != null ? String(ath.snatch_2) : null,
                            snatch_3: ath.snatch_3 != null ? String(ath.snatch_3) : null,
                            best_snatch: ath.best_snatch != null ? String(ath.best_snatch) : null,
                            cj_1: ath.cj_1 != null ? String(ath.cj_1) : null,
                            cj_2: ath.cj_2 != null ? String(ath.cj_2) : null,
                            cj_3: ath.cj_3 != null ? String(ath.cj_3) : null,
                            best_cj: ath.best_cj != null ? String(ath.best_cj) : null,
                            total: ath.total != null ? String(ath.total) : null,
                            rank: ath.rank != null ? String(ath.rank) : null,
                            simulatedAction: sim.simulatedAction,
                            existingResultId: sim.existingResultId,
                            hasChanges: sim.hasChanges,
                            diffFields: sim.diffFields
                        };
                    });

                    formattedScorecards.forEach((ath, idx) => {
                        console.log(`${'-'.repeat(80)}`);
                        console.log(`Scorecard #${idx + 1}: ${ath.name} (${ath.nation || 'N/A'}) | Born: ${ath.birth_year || 'N/A'} | Gender: ${ath.division}`);
                        console.log(`  IWF Meet ID:        ${eventId} (${meetMetadata?.Meet || `Event ${eventId}`})`);
                        console.log(`  Weight Class:       ${ath.weight_class || 'N/A'} | Body Weight: ${ath.body_weight_kg ?? 'N/A'} kg`);
                        console.log(`  Snatch 1-3:         ${ath.snatch_1 ?? '-'} / ${ath.snatch_2 ?? '-'} / ${ath.snatch_3 ?? '-'} | Best Snatch: ${ath.best_snatch ?? '-'}`);
                        console.log(`  C&J 1-3:            ${ath.cj_1 ?? '-'} / ${ath.cj_2 ?? '-'} / ${ath.cj_3 ?? '-'} | Best C&J:    ${ath.best_cj ?? '-'}`);
                        console.log(`  Total / Rank:       ${ath.total ?? '-'} kg (Rank: ${ath.rank ?? 'DNF'})`);
                        console.log(`  Simulation Action:  ${ath.simulatedAction} (Existing Result ID: ${ath.existingResultId || 'None - New Record'})`);
                        if (ath.diffFields && ath.diffFields.length > 0) {
                            console.log(`  Diff Fields:        ${ath.diffFields.join(', ')}`);
                        }
                    });
                    console.log(`${'-'.repeat(80)}`);

                    console.log('###TARGET_ATHLETE_JSON###');
                    console.log(JSON.stringify(formattedScorecards[0], null, 2));
                    console.log('###END_TARGET_ATHLETE_JSON###');

                    const simulatedUpdates = formattedScorecards.filter(s => s.simulatedAction === 'UPDATE').length;
                    const simulatedInserts = formattedScorecards.filter(s => s.simulatedAction === 'INSERT').length;
                    const simulatedLocked = formattedScorecards.filter(s => s.simulatedAction === 'LOCKED_SKIP').length;

                    summary.success = true;
                    summary.importStats = {
                        dryRun: true,
                        iwf_meet_id: String(eventId),
                        wouldSkip: false,
                        athleteName: options.athleteName,
                        athleteFilter: options.athleteName,
                        athleteFound: true,
                        totalAthletes: matchedScorecards.length,
                        simulatedUpdates: simulatedUpdates,
                        simulatedInserts: simulatedInserts,
                        simulatedLocked: simulatedLocked,
                        targetAthlete: formattedScorecards[0],
                        targetAthletes: formattedScorecards,
                        matchedScorecards: formattedScorecards,
                        meetTotalAthletes: meetTotalAthletes
                    };
                } else {
                    // Find close matches (sharing any token >= 3 chars)
                    const significantTokens = targetTokens.filter(t => t.length >= 3);
                    const closeMatches = allAthletes
                        .filter(a => {
                            const rawName = (a.name || '').toLowerCase();
                            return significantTokens.some(tok => rawName.includes(tok));
                        })
                        .slice(0, 10)
                        .map(a => ({
                            name: a.name,
                            nation: a.nation,
                            birth_year: a.birth_year,
                            gender: a.gender,
                            weight_class: a.weight_class
                        }));

                    console.log(`⚠️ Athlete "${options.athleteName}" not found in scraped results for Event ${eventId}.`);
                    console.log(`\n⚠️  DRY RUN TARGETED ATHLETE NOT FOUND: "${options.athleteName}" was not present in IWF Event ${eventId} (searched ${meetTotalAthletes} athletes).`);
                    if (closeMatches.length > 0) {
                        console.log(`  Close matches in Event ${eventId}:`);
                        closeMatches.forEach(cm => {
                            console.log(`    - ${cm.name} (${cm.nation || 'N/A'}, Born: ${cm.birth_year || 'N/A'}, Class: ${cm.weight_class || 'N/A'})`);
                        });
                    }

                    summary.success = true;
                    summary.importStats = {
                        dryRun: true,
                        iwf_meet_id: String(eventId),
                        wouldSkip: false,
                        athleteName: options.athleteName,
                        athleteFilter: options.athleteName,
                        athleteFound: false,
                        totalAthletes: 0,
                        simulatedUpdates: 0,
                        simulatedInserts: 0,
                        simulatedLocked: 0,
                        targetAthlete: null,
                        matchedScorecards: [],
                        closeMatches: closeMatches,
                        meetTotalAthletes: meetTotalAthletes
                    };
                }
            } else {
                const allMens = (mensResults && mensResults.weight_classes)
                    ? mensResults.weight_classes.flatMap(wc => (wc.athletes || []).map(a => ({ ...a, gender: a.gender || 'M', weight_class: a.weight_class || wc.weight_class })))
                    : [];
                const allWomens = (womensResults && womensResults.weight_classes)
                    ? womensResults.weight_classes.flatMap(wc => (wc.athletes || []).map(a => ({ ...a, gender: a.gender || 'F', weight_class: a.weight_class || wc.weight_class })))
                    : [];
                const allAthletes = [...allMens, ...allWomens];

                const allSim = allAthletes.map(evaluateScorecardSimulation);
                const totalUpdates = allSim.filter(s => s.simulatedAction === 'UPDATE').length;
                const totalInserts = allSim.filter(s => s.simulatedAction === 'INSERT').length;
                const totalLocked = allSim.filter(s => s.simulatedAction === 'LOCKED_SKIP').length;

                console.log(`\n📊 Dry-Run Meet Simulation Breakdown (${meetTotalAthletes} total athletes):`);
                console.log(`   Updates: ${totalUpdates}`);
                console.log(`   Inserts: ${totalInserts}`);
                console.log(`   Locked (manual override): ${totalLocked}`);

                summary.success = true;
                summary.importStats = {
                    dryRun: true,
                    iwf_meet_id: String(eventId),
                    wouldSkip: false,
                    totalAthletes: meetTotalAthletes,
                    simulatedUpdates: totalUpdates,
                    simulatedInserts: totalInserts,
                    simulatedLocked: totalLocked,
                    menCount: mensResults?.total_athletes || 0,
                    womenCount: womensResults?.total_athletes || 0
                };
            }

            summary.executionTimeMs = Date.now() - startTime;
            console.log('__IWF_SUMMARY_JSON__:' + JSON.stringify(summary));
            return summary;
        }

        // Step 4: Upsert meet record
        console.log(`\n📝 Upserting meet record...`);
        const meet = await meetManager.upsertIWFMeet(meetMetadata);
        summary.meet = meet;
        summary.iwf_meet_id = String(meet.iwf_meet_id || eventId);

        // Step 5: Upsert location record (if we have location data)
        if (meetMetadata.location_city || meetMetadata.location_country) {
            console.log(`\n📍 Upserting meet location...`);
            const locationData = meetManager.parseLocationData(meetMetadata);
            await meetManager.upsertIWFMeetLocation(meet.iwf_meet_id, locationData);
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
                Level: meet.Level,
                iwf_meet_id: meet.iwf_meet_id  // Pass IWF event ID for correct foreign key
            },
            {
                batchSize: options.batchSize || 100,
                delayMs: options.delayMs || 200,
                athleteName: options.athleteName || null
            }
        );

        importStats.iwf_meet_id = String(meet.iwf_meet_id || eventId);
        summary.importStats = importStats;
        summary.success = true;

        // Populate affected lifters for YTD backfill
        if (importStats.affectedLifterIds && importStats.affectedLifterIds.length > 0) {
            const meetYear = new Date(meet.Date).getFullYear();
            summary.affectedLifters = importStats.affectedLifterIds.map(id => ({
                db_lifter_id: id,
                year: meetYear
            }));
        }

        // Step 6b: Automated Post-Import Anomaly Audit
        if (!options.dryRun && meet.db_meet_id) {
            await auditMeetDuplicates(meet.db_meet_id, meet.Meet, meet.iwf_meet_id || eventId);
        }

        // Step 7: Print summary
        console.log(`\n${'='.repeat(80)}`);
        console.log(`IMPORT SUMMARY`);
        console.log('='.repeat(80));
        console.log(`Event: ${eventId} - ${meet.Meet}`);
        console.log(`IWF Meet ID: ${meet.iwf_meet_id || eventId}`);
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
        console.log('__IWF_SUMMARY_JSON__:' + JSON.stringify(summary));

        return summary;

    } catch (error) {
        console.error(`\n❌ Import failed: ${error.message}`);
        console.error(error.stack);

        summary.success = false;
        summary.errors.push(error.message);
        summary.executionTimeMs = Date.now() - startTime;

        return summary;
    } finally {
        if (lockAcquired) {
            LockManager.releaseLock();
        }
    }
}

/**
 * Automatically audits a meet for athletes competing in multiple weight classes
 * and stages detected anomalies into public.admin_review_queue.
 *
 * @param {number} dbMeetId - Database meet ID
 * @param {string} meetName - Competition name
 * @param {string|number} iwfMeetId - IWF official event ID
 * @returns {Promise<Object>} - Audit results summary
 */
async function auditMeetDuplicates(dbMeetId, meetName, iwfMeetId) {
    if (!dbMeetId) return { audited: false, anomaliesCount: 0 };
    try {
        console.log(`\n🔍 [AUTO-AUDIT] Checking Meet ${dbMeetId} for multi-class scorecards...`);

        const { data: results, error: fetchErr } = await config.supabaseIWF
            .from('iwf_meet_results')
            .select('db_result_id, db_lifter_id, lifter_name, weight_class, birth_year')
            .eq('db_meet_id', dbMeetId);

        if (fetchErr) {
            console.error(`⚠️ [AUTO-AUDIT] Query failed for meet ${dbMeetId}: ${fetchErr.message}`);
            return { audited: false, error: fetchErr.message };
        }

        if (!results || results.length === 0) {
            console.log(`✓ [AUTO-AUDIT] No scorecards found for Meet ${dbMeetId}.`);
            return { audited: true, anomaliesCount: 0 };
        }

        // Group scorecards by athlete
        const lifterGroups = new Map();
        for (const r of results) {
            const key = r.db_lifter_id ? `id_${r.db_lifter_id}` : `name_${(r.lifter_name || '').trim().toLowerCase()}`;
            if (!lifterGroups.has(key)) {
                lifterGroups.set(key, {
                    db_lifter_id: r.db_lifter_id,
                    lifter_name: r.lifter_name,
                    birth_year: r.birth_year,
                    weight_classes: new Set(),
                    scorecard_ids: []
                });
            }
            const group = lifterGroups.get(key);
            if (r.weight_class) group.weight_classes.add(r.weight_class);
            group.scorecard_ids.push(r.db_result_id);
        }

        const anomalies = Array.from(lifterGroups.values()).filter(g => g.weight_classes.size > 1);

        if (anomalies.length === 0) {
            console.log(`✓ [AUTO-AUDIT] Clean: 0 multi-class duplicates found in Meet ${dbMeetId}.`);
            return { audited: true, anomaliesCount: 0 };
        }

        console.log(`⚠️ [AUTO-AUDIT] Detected ${anomalies.length} athlete(s) with multi-class scorecards in Meet ${dbMeetId}:`);

        for (const anom of anomalies) {
            const weightClasses = Array.from(anom.weight_classes);
            console.log(`   - ${anom.lifter_name} (Lifter ID: ${anom.db_lifter_id || 'N/A'}): ${weightClasses.join(', ')}`);

            const reviewRecord = {
                category: 'iwf_duplicate',
                status: 'PENDING',
                title: `IWF Same-Meet Duplicate: ${anom.lifter_name} (${meetName || `Meet ${dbMeetId}`})`,
                primary_entity_type: 'iwf_meet_results',
                primary_entity_id: anom.db_lifter_id || 0,
                candidate_entity_type: 'iwf_lifters',
                candidate_entity_id: anom.db_lifter_id || 0,
                confidence_score: 90,
                evidence: {
                    db_meet_id: String(dbMeetId),
                    iwf_meet_id: String(iwfMeetId || ''),
                    meet_name: meetName,
                    athlete_name: anom.lifter_name,
                    birth_year: anom.birth_year,
                    weight_classes: weightClasses,
                    scorecard_ids: anom.scorecard_ids,
                    note: 'Athlete recorded under multiple weight classes at the exact same international championship.'
                }
            };

            const { error: insertErr } = await config.supabaseIWF
                .from('admin_review_queue')
                .insert([reviewRecord]);

            if (insertErr) {
                if (insertErr.code === '23505' || insertErr.message?.includes('uq_admin_review_iwf_duplicate_pending')) {
                    console.log(`   ℹ️ [AUTO-AUDIT] Review ticket already pending for ${anom.lifter_name} (Meet ${dbMeetId}).`);
                } else {
                    console.error(`   ❌ [AUTO-AUDIT] Failed staging review item for ${anom.lifter_name}: ${insertErr.message}`);
                }
            } else {
                console.log(`   ✅ [AUTO-AUDIT] Successfully staged review ticket for ${anom.lifter_name}.`);
            }
        }

        return { audited: true, anomaliesCount: anomalies.length };
    } catch (err) {
        console.error(`⚠️ [AUTO-AUDIT] Unexpected error during meet audit: ${err.message}`);
        return { audited: false, error: err.message };
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

    let lockAcquired = false;
    try {
        LockManager.acquireLock();
        lockAcquired = true;

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
    } finally {
        if (lockAcquired) {
            LockManager.releaseLock();
        }
    }
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
        athleteName: null,
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
            case '--html-file':
                options.htmlFile = args[++i];
                break;
            case '--meet-name':
                options.meetName = args[++i];
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
            case '--athlete-name':
                options.athleteName = args[++i];
                break;
            case '--url':
                options.url = args[++i];
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
  --url <url>           Full IWF event URL (bypasses endpoint calculation)
  --html-file <path>    Path to saved IWF meet HTML file (bypasses browser scraping)
  --meet-name <name>    Custom meet name override
  --year <year>         Event year (for endpoint selection)
  --date <date>         Event date (YYYY-MM-DD format)
  --events-file <path>  Path to events JSON file for batch import
  --athlete-name <name> Filter import to a specific athlete name
  --force               Force re-import even if event already exists
  --dry-run             Scrape/parse data but don't import to database
  --batch-size <n>      Results batch size (default: 100)
  --delay <ms>          Delay between batches in ms (default: 200)
  --help                Show this help message

EXAMPLES:
  # Single event import from HTML file
  node iwf-database-importer.js --html-file meet.html --event-id 154

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

    if (options.url) {
        if (!options.eventId) {
            const m = options.url.match(/[?&]event_id=(\d+)/i);
            if (m) options.eventId = m[1];
        }
        if (!options.year) {
            if (options.url.includes('2025-2026')) options.year = 2026;
            else if (options.url.includes('2018-2025')) options.year = 2024;
            else if (options.url.includes('upto2018')) options.year = 2018;
            else options.year = new Date().getFullYear();
        }
    }

    // Validate options
    if (!options.eventId && !options.eventsFile && !options.htmlFile && !options.url) {
        console.error('Error: Either --event-id, --events-file, --html-file, or --url must be specified');
        printHelp();
        process.exit(1);
    }

    if (options.eventId && !options.year && !options.htmlFile) {
        console.error('Error: --year is required when using --event-id (without --html-file)');
        printHelp();
        process.exit(1);
    }

    try {
        if (options.eventsFile) {
            // Batch import mode
            const batchResult = await batchImportEvents(options.eventsFile, options);
            if (batchResult && batchResult.failed > 0 && batchResult.successful === 0) {
                throw new Error(`Batch import failed (${batchResult.failed} failed, 0 succeeded)`);
            }
        } else {
            // Single event import mode
            const result = await importEventToDatabase(
                options.eventId,
                options.year,
                options.date,
                options
            );
            if (result && !result.success) {
                const errMsg = result.errors && result.errors.length > 0
                    ? result.errors.join('; ')
                    : 'Event import failed';
                throw new Error(errMsg);
            }
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
    runScraper,
    auditMeetDuplicates
};
