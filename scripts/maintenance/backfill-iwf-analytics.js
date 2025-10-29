#!/usr/bin/env node

/**
 * IWF Analytics Backfill Script
 *
 * Backfills missing analytics fields in iwf_meet_results
 * Supports pagination since Supabase has a 1000-row limit per query
 *
 * Usage:
 *   node scripts/maintenance/backfill-iwf-analytics.js [--limit 100] [--year 2022]
 *
 * Options:
 *   --limit N    : Process at most N records (for testing)
 *   --year YYYY  : Process only records from specific year
 *   --dry-run    : Show what would be updated without making changes
 */

const config = require('../production/iwf-config');
const analytics = require('../production/iwf-analytics');

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        limit: null,
        year: null,
        dryRun: false
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit' && args[i + 1]) {
            options.limit = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--year' && args[i + 1]) {
            options.year = parseInt(args[i + 1]);
            i++;
        } else if (args[i] === '--dry-run') {
            options.dryRun = true;
        }
    }

    return options;
}

// ============================================================================
// HELPER: DATE PARSING
// ============================================================================

function extractYearFromDate(dateStr) {
    if (!dateStr) return null;
    const commaParts = dateStr.split(',');
    if (commaParts.length >= 2) {
        const yearStr = commaParts[commaParts.length - 1].trim();
        const year = parseInt(yearStr);
        if (!isNaN(year) && year > 1900 && year < 2100) return year;
    }
    if (dateStr && dateStr.length >= 4) {
        const year = parseInt(dateStr.substring(0, 4));
        if (!isNaN(year) && year > 1900 && year < 2100) return year;
    }
    return null;
}

// ============================================================================
// RECORD FETCHING WITH PAGINATION
// ============================================================================

/**
 * Find records with pagination support (Supabase limits to 1000 rows per query)
 */
async function findRecordsNeedingEnrichment(options = {}) {
    try {
        let allResults = [];
        let offset = 0;
        const pageSize = 1000;
        let pageNum = 1;

        console.log('📄 Fetching records (Supabase pagination: 1000 rows per query)...');

        while (true) {
            // Fetch one page
            const { data, error } = await config.supabaseIWF
                .from('iwf_meet_results')
                .select('*')
                .is('gender', null)
                .range(offset, offset + pageSize - 1);

            if (error) {
                console.error('❌ Error fetching records:', error.message);
                break;
            }

            if (!data || data.length === 0) {
                console.log(`  Page ${pageNum}: No more records (end reached)`);
                break;
            }

            // Filter by year if specified
            let pageResults = data;
            if (options.year) {
                pageResults = pageResults.filter(r => extractYearFromDate(r.date) === options.year);
            }

            allResults = allResults.concat(pageResults);
            console.log(`  Page ${pageNum}: Fetched ${data.length} records, ${pageResults.length} match year filter`);

            // Stop if we've reached the requested limit
            if (options.limit && allResults.length >= options.limit) {
                allResults = allResults.slice(0, options.limit);
                break;
            }

            // Stop if this page had fewer than 1000 rows (means we've reached the end)
            if (data.length < pageSize) {
                break;
            }

            offset += pageSize;
            pageNum++;
        }

        return allResults;

    } catch (error) {
        console.error('❌ Error in findRecordsNeedingEnrichment:', error.message);
        return [];
    }
}

/**
 * Fetch lifter data
 */
async function fetchLifter(lifterId) {
    try {
        const { data, error } = await config.supabaseIWF
            .from('iwf_lifters')
            .select('*')
            .eq('db_lifter_id', lifterId)
            .maybeSingle();

        if (error) {
            console.error(`  ⚠️ Error fetching lifter ${lifterId}:`, error.message);
            return null;
        }

        return data;
    } catch (error) {
        console.error(`  ⚠️ Error in fetchLifter: ${error.message}`);
        return null;
    }
}

// ============================================================================
// ENRICHMENT & UPDATE
// ============================================================================

/**
 * Enrich a result record with missing analytics
 */
async function enrichResultRecord(result, lifter) {
    try {
        const athlete = {
            name: result.lifter_name || lifter.athlete_name,
            birth_date: lifter.birth_year ? `01.01.${lifter.birth_year}` : null,
            gender: result.gender || lifter.gender,
            nation: lifter.country_code,
            weight_class: result.weight_class,
            body_weight: result.body_weight_kg,
            age_category: result.age_category,
            group: result.competition_group,
            snatch_1: result.snatch_lift_1,
            snatch_2: result.snatch_lift_2,
            snatch_3: result.snatch_lift_3,
            cj_1: result.cj_lift_1,
            cj_2: result.cj_lift_2,
            cj_3: result.cj_lift_3,
            best_snatch: result.best_snatch,
            best_cj: result.best_cj,
            total: result.total
        };

        const meetInfo = {
            date: result.date,
            meet_name: result.meet_name
        };

        const enriched = await analytics.enrichAthleteWithAnalytics(athlete, meetInfo);

        const updateData = {
            db_result_id: result.db_result_id
        };

        if (enriched.gender && enriched.gender !== result.gender) {
            updateData.gender = enriched.gender;
        }
        if (enriched.birth_year && enriched.birth_year !== result.birth_year) {
            updateData.birth_year = enriched.birth_year;
        }
        if (lifter.country_code && lifter.country_code !== result.country_code) {
            updateData.country_code = lifter.country_code;
        }
        if (lifter.country_name && lifter.country_name !== result.country_name) {
            updateData.country_name = lifter.country_name;
        }
        if (enriched.competition_age && enriched.competition_age !== result.competition_age) {
            updateData.competition_age = enriched.competition_age;
        }
        if (enriched.qpoints && enriched.qpoints !== result.qpoints) {
            updateData.qpoints = enriched.qpoints;
        }
        if (enriched.q_youth && enriched.q_youth !== result.q_youth) {
            updateData.q_youth = enriched.q_youth;
        }
        if (enriched.q_masters && enriched.q_masters !== result.q_masters) {
            updateData.q_masters = enriched.q_masters;
        }

        updateData.updated_at = new Date().toISOString();

        return updateData;

    } catch (error) {
        console.error(`  ❌ Error enriching result ${result.db_result_id}:`, error.message);
        return null;
    }
}

/**
 * Update a single result record
 */
async function updateResultRecord(updateData) {
    try {
        const { db_result_id, ...data } = updateData;

        const { error } = await config.supabaseIWF
            .from('iwf_meet_results')
            .update(data)
            .eq('db_result_id', db_result_id);

        if (error) {
            console.error(`  ❌ Error updating result ${db_result_id}:`, error.message);
            return false;
        }

        return true;

    } catch (error) {
        console.error(`  ❌ Error in updateResultRecord: ${error.message}`);
        return false;
    }
}

// ============================================================================
// MAIN BACKFILL PROCESS
// ============================================================================

async function runBackfill(options = {}) {
    console.log('\n🔄 IWF Analytics Backfill Process');
    console.log('='.repeat(50));

    if (options.dryRun) {
        console.log('⚠️  DRY RUN MODE - No changes will be made');
    }
    if (options.limit) {
        console.log(`📊 Processing limit: ${options.limit} records`);
    }
    if (options.year) {
        console.log(`📅 Processing records from year: ${options.year}`);
    }

    console.log('');

    // Fetch records
    console.log('🔍 Finding records needing enrichment...');
    const records = await findRecordsNeedingEnrichment(options);

    if (records.length === 0) {
        console.log('✅ No records found needing enrichment!');
        return;
    }

    console.log(`\n📦 Found ${records.length} records to process\n`);

    const summary = {
        total: records.length,
        updated: 0,
        skipped: 0,
        errors: 0,
        fieldsUpdated: {
            gender: 0, birth_year: 0, country_code: 0, country_name: 0,
            competition_age: 0, qpoints: 0, q_youth: 0, q_masters: 0
        }
    };

    for (let i = 0; i < records.length; i++) {
        const result = records[i];
        const lifter = await fetchLifter(result.db_lifter_id);

        if (!lifter) {
            console.log(`  ⚠️  Record ${result.db_result_id}: No lifter found, skipping`);
            summary.skipped++;
            continue;
        }

        const updateData = await enrichResultRecord(result, lifter);

        if (!updateData) {
            summary.errors++;
            continue;
        }

        const fieldsToUpdate = Object.keys(updateData).filter(k => k !== 'db_result_id' && k !== 'updated_at');

        if (fieldsToUpdate.length === 0) {
            console.log(`  ✓ Record ${result.db_result_id}: Already complete, skipping`);
            summary.skipped++;
            continue;
        }

        console.log(`  📝 Record ${result.db_result_id}: Updating ${fieldsToUpdate.length} fields`);

        fieldsToUpdate.forEach(field => {
            if (summary.fieldsUpdated.hasOwnProperty(field)) {
                summary.fieldsUpdated[field]++;
            }
        });

        if (!options.dryRun) {
            const success = await updateResultRecord(updateData);
            if (success) {
                summary.updated++;
            }
        } else {
            summary.updated++;
        }

        if ((i + 1) % 10 === 0) {
            console.log(`  📊 Progress: ${i + 1}/${records.length} (${Math.round((i + 1) / records.length * 100)}%)`);
        }

        await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('📋 Backfill Summary');
    console.log('='.repeat(50));
    console.log(`Total records processed: ${summary.total}`);
    console.log(`✅ Updated: ${summary.updated}`);
    console.log(`⏭️  Skipped: ${summary.skipped}`);
    console.log(`❌ Errors: ${summary.errors}`);

    if (summary.updated > 0 || options.dryRun) {
        console.log('\nFields Updated:');
        Object.entries(summary.fieldsUpdated).forEach(([field, count]) => {
            if (count > 0) console.log(`  ${field}: ${count}`);
        });
    }

    if (options.dryRun) {
        console.log('\n⚠️  This was a DRY RUN. No changes were made.');
        console.log('Run without --dry-run to apply changes.');
    }

    console.log('');
}

// ============================================================================
// ENTRY POINT
// ============================================================================

const options = parseArguments();

runBackfill(options)
    .then(() => {
        console.log('✨ Backfill complete!');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Fatal error during backfill:', error.message);
        process.exit(1);
    });
