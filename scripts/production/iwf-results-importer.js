/**
 * IWF Results Importer Module
 *
 * Imports International Weightlifting Federation (IWF) competition results into database.
 * Handles field mapping, YTD calculations, batch processing, and error recovery.
 *
 * Key Features:
 * - Map scraper output to database schema
 * - Calculate retrospective YTD bests (best performance at time of competition)
 * - Batch insert with duplicate handling
 * - Comprehensive error logging and recovery
 *
 * @module iwf-results-importer
 */

const config = require('./iwf-config');
const lifterManager = require('./iwf-lifter-manager');

// ============================================================================
// YTD CALCULATION
// ============================================================================

/**
 * Calculate Year-to-Date (YTD) best performances for a lifter
 * This is RETROSPECTIVE: finds best performance in same calendar year BEFORE this meet
 *
 * @param {number} lifterId - IWF lifter ID
 * @param {string} meetDate - Meet date (YYYY-MM-DD format)
 * @param {Object} currentResults - Current competition results (for comparison)
 * @returns {Object} - { best_snatch_ytd, best_cj_ytd, best_total_ytd }
 */
async function calculateYTDBests(lifterId, meetDate, currentResults) {
    const ytdBests = {
        best_snatch_ytd: null,
        best_cj_ytd: null,
        best_total_ytd: null
    };

    if (!lifterId || !meetDate) {
        return ytdBests;
    }

    try {
        // Parse meet date to get year
        const meetDateObj = new Date(meetDate);
        const meetYear = meetDateObj.getFullYear();

        // Query all previous results for same lifter in same calendar year
        // Note: iwf_lifter_id is the FK in iwf_meet_results that references iwf_lifters.db_lifter_id
        const { data: previousResults, error } = await config.supabaseIWF
            .from('iwf_meet_results')
            .select('best_snatch, best_cj, total, date')
            .eq('iwf_lifter_id', lifterId)  // lifterId is db_lifter_id from lifters table
            .gte('date', `${meetYear}-01-01`)
            .lt('date', meetDate);  // BEFORE this meet date

        if (error) {
            console.error(`  ⚠️ Error calculating YTD bests: ${error.message}`);
            return ytdBests;
        }

        // If no previous results this year, YTD remains null
        if (!previousResults || previousResults.length === 0) {
            return ytdBests;
        }

        // Find maximum values from previous results
        let maxSnatch = null;
        let maxCJ = null;
        let maxTotal = null;

        for (const result of previousResults) {
            // Parse best_snatch (handle "---" and other non-numeric values)
            if (result.best_snatch && result.best_snatch !== '---') {
                const snatch = parseInt(result.best_snatch);
                if (!isNaN(snatch) && (maxSnatch === null || snatch > maxSnatch)) {
                    maxSnatch = snatch;
                }
            }

            // Parse best_cj
            if (result.best_cj && result.best_cj !== '---') {
                const cj = parseInt(result.best_cj);
                if (!isNaN(cj) && (maxCJ === null || cj > maxCJ)) {
                    maxCJ = cj;
                }
            }

            // Parse total
            if (result.total && result.total !== '---') {
                const total = parseInt(result.total);
                if (!isNaN(total) && (maxTotal === null || total > maxTotal)) {
                    maxTotal = total;
                }
            }
        }

        ytdBests.best_snatch_ytd = maxSnatch;
        ytdBests.best_cj_ytd = maxCJ;
        ytdBests.best_total_ytd = maxTotal;

        return ytdBests;

    } catch (error) {
        console.error(`  ⚠️ Error in calculateYTDBests: ${error.message}`);
        return ytdBests;
    }
}

// ============================================================================
// FIELD MAPPING
// ============================================================================

/**
 * Map athlete data from scraper format to database format
 * Converts field names and formats to match iwf_meet_results schema
 *
 * @param {Object} athlete - Athlete data from scraper (enriched with analytics)
 * @param {number} meetId - IWF meet ID
 * @param {number} lifterId - IWF lifter ID
 * @param {Object} meetInfo - Meet context (date, name, etc.)
 * @returns {Object} - Database-ready result record
 */
function mapAthleteToResultRecord(athlete, meetId, lifterId, meetInfo) {
    return {
        // Foreign keys
        iwf_meet_id: meetId,
        iwf_lifter_id: lifterId,

        // Competition context
        meet_name: meetInfo.Meet || null,
        date: meetInfo.Date || null,
        age_category: athlete.age_category || 'Senior',  // Default to Senior if not specified
        weight_class: athlete.weight_class || null,
        lifter_name: athlete.name || null,
        body_weight_kg: athlete.body_weight || null,

        // Lift attempts (stored as text to preserve format)
        snatch_lift_1: athlete.snatch_1 !== undefined ? String(athlete.snatch_1) : null,
        snatch_lift_2: athlete.snatch_2 !== undefined ? String(athlete.snatch_2) : null,
        snatch_lift_3: athlete.snatch_3 !== undefined ? String(athlete.snatch_3) : null,
        best_snatch: athlete.best_snatch !== undefined ? String(athlete.best_snatch) : null,
        cj_lift_1: athlete.cj_1 !== undefined ? String(athlete.cj_1) : null,
        cj_lift_2: athlete.cj_2 !== undefined ? String(athlete.cj_2) : null,
        cj_lift_3: athlete.cj_3 !== undefined ? String(athlete.cj_3) : null,
        best_cj: athlete.best_cj !== undefined ? String(athlete.best_cj) : null,
        total: athlete.total !== undefined ? String(athlete.total) : null,

        // Analytics - Successful attempts
        snatch_successful_attempts: athlete.snatch_successful_attempts || 0,
        cj_successful_attempts: athlete.cj_successful_attempts || 0,
        total_successful_attempts: athlete.total_successful_attempts || 0,

        // Analytics - YTD bests (will be calculated separately)
        best_snatch_ytd: null,  // Calculated after mapping
        best_cj_ytd: null,
        best_total_ytd: null,

        // Analytics - Bounce back
        bounce_back_snatch_2: athlete.bounce_back_snatch_2 !== undefined ? athlete.bounce_back_snatch_2 : null,
        bounce_back_snatch_3: athlete.bounce_back_snatch_3 !== undefined ? athlete.bounce_back_snatch_3 : null,
        bounce_back_cj_2: athlete.bounce_back_cj_2 !== undefined ? athlete.bounce_back_cj_2 : null,
        bounce_back_cj_3: athlete.bounce_back_cj_3 !== undefined ? athlete.bounce_back_cj_3 : null,

        // Athlete data
        gender: athlete.gender || null,
        birth_year: athlete.birth_year || null,
        competition_age: athlete.competition_age || null,
        country: athlete.nation || null,  // 'nation' from scraper → 'country' in DB
        competition_group: athlete.group || null,  // 'group' from scraper → 'competition_group' in DB
        rank: (athlete.rank && athlete.rank !== '---') ? parseInt(athlete.rank) : null,  // DNF athletes have rank "---" → null

        // Q-scores (age-appropriate)
        qpoints: athlete.qpoints || null,
        q_masters: athlete.q_masters || null,
        q_youth: athlete.q_youth || null,

        // System fields
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        manual_override: false
    };
}

// ============================================================================
// RESULT IMPORT
// ============================================================================

/**
 * Insert single result record into database
 * Handles duplicate constraint violations gracefully
 *
 * @param {Object} resultData - Database-ready result record
 * @returns {Object} - { success, result, error, isDuplicate }
 */
async function insertResultRecord(resultData) {
    try {
        const { data, error } = await config.supabaseIWF
            .from('iwf_meet_results')
            .insert(resultData)
            .select('iwf_result_id, iwf_meet_id, iwf_lifter_id, lifter_name')
            .single();

        if (error) {
            // Check for duplicate constraint violation
            if (error.code === '23505') {
                return {
                    success: false,
                    result: null,
                    error: 'Duplicate result',
                    isDuplicate: true
                };
            }

            return {
                success: false,
                result: null,
                error: error.message,
                isDuplicate: false
            };
        }

        return {
            success: true,
            result: data,
            error: null,
            isDuplicate: false
        };

    } catch (error) {
        return {
            success: false,
            result: null,
            error: error.message,
            isDuplicate: false
        };
    }
}

/**
 * Import single athlete result with YTD calculation
 *
 * @param {Object} athlete - Athlete data from scraper
 * @param {number} meetId - IWF meet ID
 * @param {Object} meetInfo - Meet context
 * @returns {Object} - { success, lifter, result, error }
 */
async function importAthleteResult(athlete, meetId, meetInfo) {
    try {
        // Step 1: Find or create lifter
        const lifter = await lifterManager.findOrCreateIWFLifter(
            athlete.name,
            athlete.nation,
            {
                gender: athlete.gender,
                birth_year: athlete.birth_year
            }
        );

        // Step 2: Map athlete data to result record
        const resultRecord = mapAthleteToResultRecord(athlete, meetId, lifter.db_lifter_id, meetInfo);

        // Step 3: Calculate YTD bests
        const ytdBests = await calculateYTDBests(
            lifter.db_lifter_id,
            meetInfo.Date,
            {
                best_snatch: athlete.best_snatch,
                best_cj: athlete.best_cj,
                total: athlete.total
            }
        );

        // Add YTD bests to result record
        resultRecord.best_snatch_ytd = ytdBests.best_snatch_ytd;
        resultRecord.best_cj_ytd = ytdBests.best_cj_ytd;
        resultRecord.best_total_ytd = ytdBests.best_total_ytd;

        // Step 4: Insert result record
        const insertResult = await insertResultRecord(resultRecord);

        return {
            success: insertResult.success,
            lifter: lifter,
            result: insertResult.result,
            isDuplicate: insertResult.isDuplicate,
            error: insertResult.error
        };

    } catch (error) {
        console.error(`  ❌ Error importing result for ${athlete.name}: ${error.message}`);
        return {
            success: false,
            lifter: null,
            result: null,
            isDuplicate: false,
            error: error.message
        };
    }
}

/**
 * Batch import meet results with progress tracking
 *
 * @param {Array<Object>} athletes - Array of athlete data from scraper
 * @param {number} meetId - IWF meet ID
 * @param {Object} meetInfo - Meet context
 * @param {Object} options - Import options
 * @returns {Object} - Import summary statistics
 */
async function batchImportResults(athletes, meetId, meetInfo, options = {}) {
    const batchSize = options.batchSize || 100;
    const delayMs = options.delayMs || 200;

    const summary = {
        totalAthletes: athletes.length,
        processed: 0,
        successful: 0,
        duplicates: 0,
        errors: 0,
        newLifters: 0,
        existingLifters: 0,
        errorDetails: []
    };

    console.log(`\n📥 Importing ${athletes.length} results...`);

    for (let i = 0; i < athletes.length; i++) {
        const athlete = athletes[i];

        try {
            const importResult = await importAthleteResult(athlete, meetId, meetInfo);

            summary.processed++;

            if (importResult.success) {
                summary.successful++;
                if (importResult.lifter?.isNew) {
                    summary.newLifters++;
                } else {
                    summary.existingLifters++;
                }
            } else if (importResult.isDuplicate) {
                summary.duplicates++;
                console.log(`  ⚠️ Duplicate: ${athlete.name} (${athlete.weight_class})`);
            } else {
                summary.errors++;
                summary.errorDetails.push({
                    athlete: athlete.name,
                    weightClass: athlete.weight_class,
                    error: importResult.error
                });
                console.error(`  ❌ Error: ${athlete.name} - ${importResult.error}`);
            }

            // Progress indicator
            if ((i + 1) % 50 === 0) {
                console.log(`  📊 Progress: ${i + 1}/${athletes.length} (${Math.round((i + 1) / athletes.length * 100)}%)`);
            }

            // Batch delay to avoid overwhelming database
            if ((i + 1) % batchSize === 0 && i < athletes.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

        } catch (error) {
            summary.errors++;
            summary.errorDetails.push({
                athlete: athlete.name,
                weightClass: athlete.weight_class,
                error: error.message
            });
            console.error(`  ❌ Unexpected error for ${athlete.name}: ${error.message}`);
        }
    }

    return summary;
}

/**
 * Import all results from weight classes data structure
 * Handles both men's and women's results
 *
 * @param {Object} mensWeightClasses - Men's weight classes data from scraper
 * @param {Object} womensWeightClasses - Women's weight classes data from scraper
 * @param {number} meetId - IWF meet ID
 * @param {Object} meetInfo - Meet context
 * @param {Object} options - Import options
 * @returns {Object} - Combined import summary
 */
async function importMeetResults(mensWeightClasses, womensWeightClasses, meetId, meetInfo, options = {}) {
    const combinedSummary = {
        mens: null,
        womens: null,
        total: {
            totalAthletes: 0,
            processed: 0,
            successful: 0,
            duplicates: 0,
            errors: 0,
            newLifters: 0,
            existingLifters: 0
        }
    };

    // Import men's results
    if (mensWeightClasses && mensWeightClasses.weight_classes) {
        console.log('\n=== IMPORTING MEN\'S RESULTS ===');
        const mensAthletes = mensWeightClasses.weight_classes.flatMap(wc => wc.athletes || []);
        combinedSummary.mens = await batchImportResults(mensAthletes, meetId, meetInfo, options);
    }

    // Import women's results
    if (womensWeightClasses && womensWeightClasses.weight_classes) {
        console.log('\n=== IMPORTING WOMEN\'S RESULTS ===');
        const womensAthletes = womensWeightClasses.weight_classes.flatMap(wc => wc.athletes || []);
        combinedSummary.womens = await batchImportResults(womensAthletes, meetId, meetInfo, options);
    }

    // Calculate combined totals
    if (combinedSummary.mens) {
        combinedSummary.total.totalAthletes += combinedSummary.mens.totalAthletes;
        combinedSummary.total.processed += combinedSummary.mens.processed;
        combinedSummary.total.successful += combinedSummary.mens.successful;
        combinedSummary.total.duplicates += combinedSummary.mens.duplicates;
        combinedSummary.total.errors += combinedSummary.mens.errors;
        combinedSummary.total.newLifters += combinedSummary.mens.newLifters;
        combinedSummary.total.existingLifters += combinedSummary.mens.existingLifters;
    }

    if (combinedSummary.womens) {
        combinedSummary.total.totalAthletes += combinedSummary.womens.totalAthletes;
        combinedSummary.total.processed += combinedSummary.womens.processed;
        combinedSummary.total.successful += combinedSummary.womens.successful;
        combinedSummary.total.duplicates += combinedSummary.womens.duplicates;
        combinedSummary.total.errors += combinedSummary.womens.errors;
        combinedSummary.total.newLifters += combinedSummary.womens.newLifters;
        combinedSummary.total.existingLifters += combinedSummary.womens.existingLifters;
    }

    return combinedSummary;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Main import functions
    importMeetResults,
    importAthleteResult,
    batchImportResults,

    // YTD calculation
    calculateYTDBests,

    // Utility functions (exported for testing)
    mapAthleteToResultRecord,
    insertResultRecord
};
