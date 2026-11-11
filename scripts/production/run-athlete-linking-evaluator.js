#!/usr/bin/env node
/**
 * PRODUCTION: Symmetrical Athlete Linking Evaluation Worker
 *
 * Drains and evaluates queued linking tasks from public.athlete_linking_evaluations
 * across all registered federations (USAW, IWF, OWLCMS, and future governing bodies).
 *
 * Architecture Compliance:
 *   1. Decouples operational identity edges (athlete_aliases) from evaluation states.
 *   2. Enforces Universal Demographic Anchoring: (gender, birth_year).
 *   3. Enforces pairwise alias integrity: check_alias_type = 2.
 *   4. Persists complete audit provenance in evidence_breakdown JSONB.
 *   5. Emits machine-parseable JSON summary contract for frontend consumers.
 *
 * Usage:
 *   node scripts/production/run-athlete-linking-evaluator.js [options]
 *
 * Options:
 *   --limit=<number>         Maximum evaluations to process in this run (default: 100)
 *   --dry-run, -d            Preview match calculations without writing to database
 *   --source-fed=<code|uuid> Filter by source federation (e.g. USAW, IWF, OWLCMS)
 *   --target-fed=<code|uuid> Filter by target federation
 *   --athlete-id=<id>        Target single athlete ID in source federation
 *   --re-evaluate            Include VETTED_ISOLATED / REVIEW_NEEDED records
 *   --verbose, -v            Enable verbose candidate comparison logging
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const minimist = require('minimist');
const {
    CORE_FEDERATION_UUIDS,
    ALGORITHM_VERSION,
    evaluateCandidateMatch
} = require('./lib/athlete-evaluator-engine.js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Generic paginated fetch helper to bypass PostgREST 1000-row limits
async function fetchAll(client, table, select, filterFn) {
    let allData = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        let query = client.from(table).select(select).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (filterFn) query = filterFn(query);
        const { data, error } = await query;
        if (error) {
            console.error(`fetchAll error on ${table}:`, error.message);
            break;
        }
        if (!data || data.length === 0) break;
        allData.push(...data);
        if (data.length < PAGE_SIZE) break;
        page++;
    }
    return allData;
}

async function main() {
    const startTime = Date.now();
    const args = minimist(process.argv.slice(2), {
        boolean: ['dry-run', 're-evaluate', 'verbose'],
        alias: { d: 'dry-run', v: 'verbose', r: 're-evaluate' },
        default: { limit: 100 }
    });

    const isDryRun = args['dry-run'];
    const isReEvaluate = args['re-evaluate'];
    const isVerbose = args.verbose;
    const batchLimit = parseInt(args.limit, 10) || 100;
    const sourceFedParam = args['source-fed'];
    const targetFedParam = args['target-fed'];
    const targetAthleteId = args['athlete-id'] ? parseInt(args['athlete-id'], 10) : null;

    console.log(`\n============================================================`);
    console.log(`[ATHLETE LINKING EVALUATOR] Starting Symmetrical Worker`);
    console.log(`Mode: ${isDryRun ? 'DRY-RUN (Preview Only)' : 'LIVE (Database Mutation)'}`);
    console.log(`Batch Limit: ${batchLimit}`);
    if (isReEvaluate) console.log(`Filter: RE-EVALUATE (Including previously isolated/reviewed)`);
    if (sourceFedParam) console.log(`Filter Source Federation: ${sourceFedParam}`);
    if (targetFedParam) console.log(`Filter Target Federation: ${targetFedParam}`);
    if (targetAthleteId) console.log(`Filter Athlete ID: ${targetAthleteId}`);
    console.log(`============================================================\n`);

    // 1. Load Federation Registry Lookups
    const { data: federations, error: fedErr } = await supabase
        .from('federation_registry')
        .select('id, canonical_name, short_code');

    if (fedErr || !federations || federations.length === 0) {
        console.error('ERROR: Failed to load federation_registry:', fedErr?.message);
        process.exit(1);
    }

    const fedByUuid = new Map();
    const fedByCode = new Map();
    for (const f of federations) {
        fedByUuid.set(f.id, f);
        if (f.short_code) fedByCode.set(f.short_code.toUpperCase(), f);
    }

    // Resolve CLI federation filters to UUIDs
    function resolveFedUuid(param) {
        if (!param) return null;
        if (fedByUuid.has(param)) return param;
        const code = param.trim().toUpperCase();
        if (fedByCode.has(code)) return fedByCode.get(code).id;
        return null;
    }

    const sourceFedUuid = resolveFedUuid(sourceFedParam);
    const targetFedUuid = resolveFedUuid(targetFedParam);

    // 2. Query Pending / Targeted Evaluations from Ledger
    let query = supabase
        .from('athlete_linking_evaluations')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(batchLimit);

    if (isReEvaluate) {
        query = query.in('status', ['PENDING', 'REVIEW_NEEDED', 'VETTED_ISOLATED']);
    } else {
        query = query.eq('status', 'PENDING');
    }

    if (sourceFedUuid) query = query.eq('source_federation_id', sourceFedUuid);
    if (targetFedUuid) query = query.eq('target_federation_id', targetFedUuid);
    if (targetAthleteId) query = query.eq('source_athlete_id', targetAthleteId);

    const { data: tasks, error: taskErr } = await query;
    if (taskErr) {
        console.error('ERROR: Failed to fetch evaluation tasks:', taskErr.message);
        process.exit(1);
    }

    if (!tasks || tasks.length === 0) {
        console.log('No eligible evaluations found to process in queue.');
        const summary = {
            evaluationsProcessed: 0,
            matchedCount: 0,
            reviewNeededCount: 0,
            isolatedCount: 0,
            isDryRun,
            executionTimeMs: Date.now() - startTime
        };
        console.log('__ATHLETE_EVALUATOR_SUMMARY_JSON__:' + JSON.stringify(summary));
        process.exit(0);
    }

    console.log(`Found ${tasks.length} evaluation task(s) to process.\n`);

    // In-memory demographic caches to prevent redundant roundtrips
    const demographicCaches = {
        IWF: new Map(),
        USAW: new Map(),
        OWLCMS: new Map()
    };

    let matchedCount = 0;
    let reviewNeededCount = 0;
    let isolatedCount = 0;

    for (const task of tasks) {
        const sourceFed = fedByUuid.get(task.source_federation_id);
        const targetFed = fedByUuid.get(task.target_federation_id);

        const sCode = sourceFed?.short_code?.toUpperCase() || 'UNKNOWN';
        const tCode = targetFed?.short_code?.toUpperCase() || 'UNKNOWN';

        if (isVerbose) {
            console.log(`[Task ${task.evaluation_id}] Evaluating Source [${sCode}] ID ${task.source_athlete_id} -> Target [${tCode}]`);
        }

        // 3. Fetch Source Athlete Profile
        let sourceProfile = null;
        if (sCode === 'IWF') {
            const { data } = await supabase
                .from('iwf_lifters')
                .select('db_lifter_id, athlete_name, gender, birth_year, country_code, country_name')
                .eq('db_lifter_id', task.source_athlete_id)
                .maybeSingle();
            if (data) {
                sourceProfile = {
                    id: data.db_lifter_id,
                    name: data.athlete_name,
                    gender: data.gender,
                    birth_year: data.birth_year,
                    country: data.country_code || data.country_name
                };
            }
        } else if (sCode === 'USAW') {
            const { data } = await supabase
                .from('distinct_usaw_lifters_view')
                .select('lifter_id, lifter_name, gender, birth_year')
                .eq('lifter_id', task.source_athlete_id)
                .maybeSingle();
            if (data) {
                sourceProfile = {
                    id: data.lifter_id,
                    name: data.lifter_name,
                    gender: data.gender,
                    birth_year: data.birth_year,
                    country: 'USA'
                };
            }
        } else if (sCode === 'OWLCMS') {
            const { data } = await supabase
                .from('owlcms_lifters')
                .select('lifter_id, athlete_name, gender, birth_year, country_code, club_name')
                .eq('lifter_id', task.source_athlete_id)
                .maybeSingle();
            if (data) {
                sourceProfile = {
                    id: data.lifter_id,
                    name: data.athlete_name,
                    gender: data.gender,
                    birth_year: data.birth_year,
                    country_code: data.country_code,
                    club_name: data.club_name
                };
            }
        }

        if (!sourceProfile) {
            console.warn(`  ⚠️ Source athlete [${sCode}] ${task.source_athlete_id} not found in database. Skipping.`);
            continue;
        }

        // 4. Demographic Cohort Key
        const genderKey = sourceProfile.gender ? sourceProfile.gender.trim().toUpperCase() : null;
        const birthYearKey = sourceProfile.birth_year ? parseInt(sourceProfile.birth_year, 10) : null;

        if (!genderKey || !birthYearKey) {
            // Cannot evaluate without universal demographic anchor
            console.log(`  ℹ️ Source athlete [${sCode}] "${sourceProfile.name}" missing demographic anchor (gender: ${genderKey}, birthYear: ${birthYearKey}). Marking VETTED_ISOLATED.`);
            if (!isDryRun) {
                await supabase
                    .from('athlete_linking_evaluations')
                    .update({
                        status: 'VETTED_ISOLATED',
                        confidence_score: 0,
                        evidence_breakdown: { reason: 'Missing biographical demographic anchor (gender or birth_year)' },
                        evaluated_at: new Date().toISOString()
                    })
                    .eq('evaluation_id', task.evaluation_id);
            }
            isolatedCount++;
            continue;
        }

        const cohortKey = `${genderKey}_${birthYearKey}`;

        // 5. Fetch Target Candidate Pool (Cached by Demographic Anchor)
        const targetCache = demographicCaches[tCode];
        let candidates = [];

        if (targetCache && targetCache.has(cohortKey)) {
            candidates = targetCache.get(cohortKey);
        } else {
            if (tCode === 'IWF') {
                const { data } = await supabase
                    .from('iwf_lifters')
                    .select('db_lifter_id, athlete_name, gender, birth_year, country_code, country_name')
                    .eq('gender', genderKey)
                    .eq('birth_year', birthYearKey);
                candidates = (data || []).map(d => ({
                    id: d.db_lifter_id,
                    name: d.athlete_name,
                    gender: d.gender,
                    birth_year: d.birth_year,
                    country: d.country_code || d.country_name
                }));
            } else if (tCode === 'USAW') {
                const { data } = await supabase
                    .from('distinct_usaw_lifters_view')
                    .select('lifter_id, lifter_name, gender, birth_year')
                    .eq('gender', genderKey)
                    .eq('birth_year', birthYearKey);
                candidates = (data || []).map(d => ({
                    id: d.lifter_id,
                    name: d.lifter_name,
                    gender: d.gender,
                    birth_year: d.birth_year,
                    country: 'USA'
                }));
            } else if (tCode === 'OWLCMS') {
                const { data } = await supabase
                    .from('owlcms_lifters')
                    .select('lifter_id, athlete_name, gender, birth_year, country_code, club_name')
                    .eq('gender', genderKey)
                    .eq('birth_year', birthYearKey);
                candidates = (data || []).map(d => ({
                    id: d.lifter_id,
                    name: d.athlete_name,
                    gender: d.gender,
                    birth_year: d.birth_year,
                    country_code: d.country_code,
                    club_name: d.club_name
                }));
            }

            if (targetCache) {
                targetCache.set(cohortKey, candidates);
            }
        }

        // Filter out identity collision when evaluating intra-federation duplicate linking
        if (sCode === tCode) {
            candidates = candidates.filter(c => c.id !== sourceProfile.id);
        }

        if (candidates.length === 0) {
            if (isVerbose) {
                console.log(`  ✓ 0 candidates found in [${tCode}] cohort (${cohortKey}). Isolated.`);
            }
            if (!isDryRun) {
                await supabase
                    .from('athlete_linking_evaluations')
                    .update({
                        status: 'VETTED_ISOLATED',
                        confidence_score: 0,
                        evidence_breakdown: {
                            reason: 'Demographic cohort empty in target federation',
                            cohort: cohortKey
                        },
                        evaluated_at: new Date().toISOString()
                    })
                    .eq('evaluation_id', task.evaluation_id);
            }
            isolatedCount++;
            continue;
        }

        // 6. Score All Candidates in Cohort
        let bestCandidate = null;
        let bestScore = 0;
        let bestBreakdown = [];

        for (const candidate of candidates) {
            const result = evaluateCandidateMatch(sourceProfile, candidate, sCode, tCode);
            if (result.score > bestScore) {
                bestScore = result.score;
                bestCandidate = candidate;
                bestBreakdown = result.breakdown;
            }
        }

        // 7. Route Outcome
        if (bestScore >= 80 && bestCandidate) {
            console.log(`  🎯 MATCH: [${sCode}:${sourceProfile.id}] "${sourceProfile.name}" ── [${tCode}:${bestCandidate.id}] "${bestCandidate.name}" (Score: ${bestScore})`);
            console.log(`     Evidence: ${bestBreakdown.join(', ')}`);

            if (!isDryRun) {
                // Determine pairwise columns for athlete_aliases adhering to check_alias_type = 2
                let aliasPayload = {
                    match_confidence: bestScore,
                    manual_override: bestBreakdown.includes('Candidate explicitly whitelisted in shared mappings')
                };

                if (sCode === 'IWF' && tCode === 'USAW') {
                    aliasPayload.iwf_db_lifter_id = sourceProfile.id;
                    aliasPayload.usaw_lifter_id = bestCandidate.id;
                } else if (sCode === 'USAW' && tCode === 'IWF') {
                    aliasPayload.usaw_lifter_id = sourceProfile.id;
                    aliasPayload.iwf_db_lifter_id = bestCandidate.id;
                } else if (sCode === 'USAW' && tCode === 'OWLCMS') {
                    aliasPayload.usaw_lifter_id = sourceProfile.id;
                    aliasPayload.owlcms_lifter_id = bestCandidate.id;
                } else if (sCode === 'OWLCMS' && tCode === 'USAW') {
                    aliasPayload.owlcms_lifter_id = sourceProfile.id;
                    aliasPayload.usaw_lifter_id = bestCandidate.id;
                } else if (sCode === 'IWF' && tCode === 'OWLCMS') {
                    aliasPayload.iwf_db_lifter_id = sourceProfile.id;
                    aliasPayload.owlcms_lifter_id = bestCandidate.id;
                } else if (sCode === 'OWLCMS' && tCode === 'IWF') {
                    aliasPayload.owlcms_lifter_id = sourceProfile.id;
                    aliasPayload.iwf_db_lifter_id = bestCandidate.id;
                } else if (sCode === 'IWF' && tCode === 'IWF') {
                    aliasPayload.iwf_db_lifter_id = sourceProfile.id;
                    aliasPayload.iwf_db_lifter_id_2 = bestCandidate.id;
                } else if (sCode === 'OWLCMS' && tCode === 'OWLCMS') {
                    aliasPayload.owlcms_lifter_id = sourceProfile.id;
                    aliasPayload.owlcms_lifter_id_2 = bestCandidate.id;
                }

                // Insert pairwise edge
                const { error: aliasErr } = await supabase
                    .from('athlete_aliases')
                    .insert(aliasPayload);

                if (aliasErr && aliasErr.code !== '23505') {
                    console.error(`    ⚠️ Failed to insert athlete_aliases row: ${aliasErr.message}`);
                }

                // Update ledger
                await supabase
                    .from('athlete_linking_evaluations')
                    .update({
                        status: 'MATCHED',
                        target_athlete_id: bestCandidate.id,
                        confidence_score: bestScore,
                        evidence_breakdown: {
                            source: sourceProfile,
                            target: bestCandidate,
                            score: bestScore,
                            breakdown: bestBreakdown,
                            cohort: cohortKey
                        },
                        evaluated_at: new Date().toISOString()
                    })
                    .eq('evaluation_id', task.evaluation_id);
            }
            matchedCount++;
        } else if (bestScore >= 60 && bestCandidate) {
            console.log(`  ⚠️ REVIEW: [${sCode}:${sourceProfile.id}] "${sourceProfile.name}" ── [${tCode}:${bestCandidate.id}] "${bestCandidate.name}" (Score: ${bestScore})`);
            console.log(`     Evidence: ${bestBreakdown.join(', ')}`);

            if (!isDryRun) {
                await supabase
                    .from('athlete_linking_evaluations')
                    .update({
                        status: 'REVIEW_NEEDED',
                        target_athlete_id: bestCandidate.id,
                        confidence_score: bestScore,
                        evidence_breakdown: {
                            source: sourceProfile,
                            target: bestCandidate,
                            score: bestScore,
                            breakdown: bestBreakdown,
                            cohort: cohortKey
                        },
                        evaluated_at: new Date().toISOString()
                    })
                    .eq('evaluation_id', task.evaluation_id);
            }
            reviewNeededCount++;
        } else {
            if (isVerbose) {
                console.log(`  ✓ Highest candidate score in [${tCode}] was ${bestScore} (< 60). Isolated.`);
            }
            if (!isDryRun) {
                await supabase
                    .from('athlete_linking_evaluations')
                    .update({
                        status: 'VETTED_ISOLATED',
                        confidence_score: bestScore,
                        evidence_breakdown: {
                            highest_score: bestScore,
                            cohort: cohortKey,
                            candidates_checked: candidates.length
                        },
                        evaluated_at: new Date().toISOString()
                    })
                    .eq('evaluation_id', task.evaluation_id);
            }
            isolatedCount++;
        }
    }

    const summary = {
        evaluationsProcessed: tasks.length,
        matchedCount,
        reviewNeededCount,
        isolatedCount,
        isDryRun,
        isReEvaluate,
        executionTimeMs: Date.now() - startTime
    };

    console.log(`\n[ATHLETE LINKING EVALUATOR] Run Complete:`);
    console.log(`  Evaluations Processed: ${summary.evaluationsProcessed}`);
    console.log(`  Matches Formed:        ${summary.matchedCount}`);
    console.log(`  Staged for Review:     ${summary.reviewNeededCount}`);
    console.log(`  Vetted Isolated:       ${summary.isolatedCount}`);
    console.log(`  Execution Time:        ${summary.executionTimeMs}ms\n`);

    console.log('__ATHLETE_EVALUATOR_SUMMARY_JSON__:' + JSON.stringify(summary));
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal Evaluator Exception:', err);
    process.exit(1);
});

