#!/usr/bin/env node

/**
 * Surgical backfill for q_masters using new masters definition
 * - Uses analytics.enrichAthleteWithAnalytics to compute new q_masters
 * - Only updates rows that would change under the new rule (surgical)
 * - Writes audit records to `q_masters_backfill_audit` for rollback
 *
 * Usage:
 *   node scripts/maintenance/backfill-qmasters-surgical.js --batch 500 --limit 5000 --dry-run
 */

const config = require('../production/iwf-config');
const analytics = require('../production/iwf-analytics');

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { batch: 500, limit: null, dryRun: false, verbose: false };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--batch' && args[i + 1]) { opts.batch = parseInt(args[i + 1]); i++; }
        else if (args[i] === '--limit' && args[i + 1]) { opts.limit = parseInt(args[i + 1]); i++; }
        else if (args[i] === '--dry-run') { opts.dryRun = true; }
        else if (args[i] === '--verbose') { opts.verbose = true; }
    }
    return opts;
}

async function fetchCandidatesToSet(batchSize) {
    // q_masters IS NULL but should be set: total/bodyweight present and master-age by gender
    const orFilter = 'and(gender.eq.M,competition_age.gte.31,competition_age.lte.75),and(gender.eq.F,competition_age.gte.31,competition_age.lte.110)';
    const { data, error } = await config.supabaseIWF
        .from('iwf_meet_results')
        .select('*')
        .is('q_masters', null)
        .not('total', 'is', null)
        .not('body_weight_kg', 'is', null)
        .not('competition_age', 'is', null)
        .or(orFilter)
        .limit(batchSize);

    if (error) {
        throw new Error(`Error fetching candidates to set: ${error.message}`);
    }
    return data || [];
}

async function fetchCandidatesToUnset(batchSize) {
    // q_masters IS NOT NULL but should be unset (age/gender outside masters definition)
    const orFilter = 'and(gender.eq.M,competition_age.lt.31),and(gender.eq.M,competition_age.gt.75),and(gender.eq.F,competition_age.lt.31),and(gender.eq.F,competition_age.gt.110),gender.is.null,not(gender.in.(M,F)),competition_age.is.null';
    const { data, error } = await config.supabaseIWF
        .from('iwf_meet_results')
        .select('*')
        .not('q_masters', 'is', null)
        .or(orFilter)
        .limit(batchSize);

    if (error) {
        throw new Error(`Error fetching candidates to unset: ${error.message}`);
    }
    return data || [];
}

async function processBatch(rows, batchTag, dryRun) {
    if (!rows || rows.length === 0) return { updated: 0 };

    const auditInserts = [];
    const updates = [];

    for (const r of rows) {
        try {
            const lifter = { birth_year: r.birth_year };
            const athlete = {
                total: r.total,
                body_weight: r.body_weight_kg,
                gender: r.gender
            };

            // Use analytics to compute q_masters for the row's age
            const enriched = await analytics.enrichAthleteWithAnalytics({ ...athlete, birth_date: r.birth_year ? `01.01.${r.birth_year}` : null }, { date: r.date });
            const newQ = enriched.q_masters || null;

            // Decide whether to update: if different (including null vs value)
            const oldQ = r.q_masters || null;
            const changed = (oldQ === null && newQ !== null) || (oldQ !== null && newQ === null) || (oldQ !== null && newQ !== null && Number(oldQ) !== Number(newQ));

            if (!changed) {
                if (dryRun) continue; // nothing to do
                continue;
            }

            auditInserts.push({
                result_id: r.db_result_id || r.id || null,
                lifter_name: r.lifter_name,
                gender: r.gender,
                competition_age: r.competition_age,
                old_q_masters: oldQ,
                new_q_masters: newQ,
                batch_tag: batchTag
            });

            updates.push({ db_result_id: r.db_result_id, q_masters: newQ });

        } catch (err) {
            console.error(`Error processing row ${r.db_result_id || r.id}: ${err.message}`);
        }
    }

    // Insert audits and perform updates in transaction-like sequence
    if (auditInserts.length > 0) {
        if (!dryRun) {
            const { error: auditErr } = await config.supabaseIWF
                .from('q_masters_backfill_audit')
                .insert(auditInserts);
            if (auditErr) throw new Error(`Error inserting audit rows: ${auditErr.message}`);
        } else {
            console.log(`DRY RUN: Would insert ${auditInserts.length} audit rows`);
        }
    }

    let updatedCount = 0;

    for (const u of updates) {
        if (dryRun) {
            console.log(`DRY RUN: Would update ${u.db_result_id} -> q_masters=${u.q_masters}`);
            updatedCount++;
            continue;
        }

        const { error: upErr } = await config.supabaseIWF
            .from('iwf_meet_results')
            .update({ q_masters: u.q_masters })
            .eq('db_result_id', u.db_result_id);

        if (upErr) {
            console.error(`Error updating result ${u.db_result_id}: ${upErr.message}`);
        } else {
            updatedCount++;
        }
    }

    return { updated: updatedCount };
}

async function run() {
    const opts = parseArgs();
    const batchTag = `surgical-backfill-${new Date().toISOString()}`;
    let totalProcessed = 0;

    console.log(`Starting surgical q_masters backfill (batch=${opts.batch}) dryRun=${opts.dryRun}`);

    // Loop until both fetch lists return empty or we hit limit
    while (true) {
        const setCandidates = await fetchCandidatesToSet(opts.batch);
        const unsetCandidates = await fetchCandidatesToUnset(opts.batch);

        const candidates = (setCandidates || []).concat(unsetCandidates || []);

        if (!candidates || candidates.length === 0) {
            console.log('No more candidates to process.');
            break;
        }

        if (opts.limit && totalProcessed >= opts.limit) break;

        // Process in a single batch (candidates.length <= 2*opts.batch)
        const result = await processBatch(candidates, batchTag, opts.dryRun);
        totalProcessed += result.updated || 0;

        console.log(`Batch processed. Updated: ${result.updated}. Total updated so far: ${totalProcessed}`);

        if (opts.limit && totalProcessed >= opts.limit) {
            console.log('Reached processing limit. Stopping.');
            break;
        }

        // Throttle a bit
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`Surgical backfill complete. Total updated: ${totalProcessed}`);
}

run().catch(err => {
    console.error('Fatal error during surgical backfill:', err.message);
    process.exit(1);
});
