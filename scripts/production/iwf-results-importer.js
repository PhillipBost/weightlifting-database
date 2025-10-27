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
// YTD CALCULATION (DEPRECATED - Use Database Trigger Instead)
// ============================================================================
// NOTE: YTD calculation is now handled by database trigger calculate_iwf_ytd_bests()
// This function is kept for reference but is no longer called during import.

/**
 * @deprecated YTD is now calculated by database trigger calculate_iwf_ytd_bests()
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
            .eq('db_lifter_id', lifterId)  // lifterId is db_lifter_id from lifters table
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
function mapAthleteToResultRecord(athlete, meetId, lifter, meetInfo) {
    return {
        // Foreign keys
        db_meet_id: meetId,
        db_lifter_id: lifter.db_lifter_id,
        iwf_meet_id: meetInfo.iwf_meet_id,

        // Competition context
        meet_name: meetInfo.Meet || null,
        date: meetInfo.Date || null,
        age_category: athlete.age_category || 'Senior',  // Default to Senior if not specified
        weight_class: athlete.weight_class || null,
        lifter_name: lifter.athlete_name || null,
        body_weight_kg: athlete.body_weight || null,

        // Lift attempts (stored as text to preserve format)
        snatch_lift_1: athlete.snatch_1 !== undefined && athlete.snatch_1 !== null ? String(athlete.snatch_1) : '0',
        snatch_lift_2: athlete.snatch_2 !== undefined && athlete.snatch_2 !== null ? String(athlete.snatch_2) : '0',
        snatch_lift_3: athlete.snatch_3 !== undefined && athlete.snatch_3 !== null ? String(athlete.snatch_3) : '0',
        best_snatch: athlete.best_snatch !== undefined && athlete.best_snatch !== null ? String(athlete.best_snatch) : '0',
        cj_lift_1: athlete.cj_1 !== undefined && athlete.cj_1 !== null ? String(athlete.cj_1) : '0',
        cj_lift_2: athlete.cj_2 !== undefined && athlete.cj_2 !== null ? String(athlete.cj_2) : '0',
        cj_lift_3: athlete.cj_3 !== undefined && athlete.cj_3 !== null ? String(athlete.cj_3) : '0',
        best_cj: athlete.best_cj !== undefined && athlete.best_cj !== null ? String(athlete.best_cj) : '0',
        total: athlete.total !== undefined && athlete.total !== null ? String(athlete.total) : '0',

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

        // Competition-specific data (not denormalized from lifters table)
        competition_age: athlete.competition_age || null,
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
            .select('*')
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
        const lifter = await lifterManager.findOrCreateLifter(
            athlete.name,
            athlete.nation,
            athlete.birth_year,
            athlete.gender,
            athlete.iwf_lifter_id,
            athlete.iwf_athlete_url
        );

        // Step 2: Map athlete data to result record
        const resultRecord = mapAthleteToResultRecord(athlete, meetId, lifter, meetInfo);

        // Step 3: Insert result record (YTD is calculated by database trigger)
        // Note: best_snatch_ytd, best_cj_ytd, best_total_ytd are calculated automatically
        // by the database trigger calculate_iwf_ytd_bests() on INSERT/UPDATE
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
    const limit = options.limit || null;
    
    // Apply limit if specified
    const athletesToProcess = limit ? athletes.slice(0, limit) : athletes;
    const limitApplied = limit && limit < athletes.length;

    const summary = {
        totalAthletes: athletes.length,
        limitApplied: limitApplied,
        limitValue: limit,
        processedAthletes: athletesToProcess.length,
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
                console.log(`  📊 Progress: ${i + 1}/${athletesToProcess.length} (${Math.round((i + 1) / athletesToProcess.length * 100)}%)`);
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

    // Collect all athletes from both genders
    const mensAthletes = (mensWeightClasses && mensWeightClasses.weight_classes) 
        ? mensWeightClasses.weight_classes.flatMap(wc => wc.athletes || [])
        : [];
    const womensAthletes = (womensWeightClasses && womensWeightClasses.weight_classes)
        ? womensWeightClasses.weight_classes.flatMap(wc => wc.athletes || [])
        : [];

    // Apply limit across BOTH genders if specified
    const limit = options.limit || null;
    let mensToImport = mensAthletes;
    let womensToImport = womensAthletes;
    
    if (limit) {
        const totalAvailable = mensAthletes.length + womensAthletes.length;
        console.log(`
⚠️  LIMIT APPLIED: ${limit} of ${totalAvailable} total athletes`);
        
        if (limit <= mensAthletes.length) {
            // Limit fits entirely within men's results
            mensToImport = mensAthletes.slice(0, limit);
            womensToImport = [];
        } else {
            // Import all men, remaining from women
            mensToImport = mensAthletes;
            const remainingLimit = limit - mensAthletes.length;
            womensToImport = womensAthletes.slice(0, remainingLimit);
        }
    }

    // Import men's results
    if (mensToImport.length > 0) {
        console.log(`
=== IMPORTING MEN'S RESULTS ===`);
        combinedSummary.mens = await batchImportResults(
            mensToImport, 
            meetId, 
            meetInfo, 
            { ...options, limit: null }  // Don't apply limit again in batch
        );
    }

    // Import women's results
    if (womensToImport.length > 0) {
        console.log(`
=== IMPORTING WOMEN'S RESULTS ===`);
        combinedSummary.womens = await batchImportResults(
            womensToImport, 
            meetId, 
            meetInfo, 
            { ...options, limit: null }  // Don't apply limit again in batch
        );
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
