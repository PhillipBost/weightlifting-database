#!/usr/bin/env node
/**
 * PRODUCTION: Symmetrical Athlete Linking Evaluation Worker (v3.0 Strict + Shared-Meet Physics)
 *
 * Drains and evaluates queued linking tasks from public.athlete_linking_evaluations
 * across all registered federations (USAW, IWF, OWLCMS, and future governing bodies).
 *
 * Architecture Compliance:
 *   1. Decouples operational identity edges (athlete_aliases) from evaluation states.
 *   2. Enforces Strict Auto-Link Policy: exact substantive names + demographics, manual
 *      whitelists, or shared-meet 6-attempt signed physics only.
 *   3. Routes multi-candidate ties, extra/missing middle names, 1-2 character typos, and
 *      +/-2 year or missing birth-year matches to REVIEW_NEEDED instead of guessing or isolating.
 *   4. Uses paginated fetchAll() on every cohort and alias query (eliminates 1,000-row truncation).
 *   5. Enforces pairwise alias integrity: check_alias_type = 2.
 *   6. Persists complete audit provenance in evidence_breakdown JSONB and algorithm_version.
 *   7. Emits machine-parseable JSON summary contract for frontend consumers.
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
    ALGORITHM_VERSION,
    MANUAL_MEET_MAP,
    tokenize,
    extractSubstantiveTokens,
    analyzeNameMatch,
    getWhitelistedTargetIds,
    evaluateCandidateMatch,
    evaluateSharedMeetPhysics,
    fetchHistoricalTotals
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

function makeExistingAliasKey(fedA, idA, fedB, idB) {
    const a = parseInt(idA, 10);
    const b = parseInt(idB, 10);
    if (isNaN(a) || isNaN(b)) return null;

    if (fedA === 'IWF' && fedB === 'USAW') return `IWF_USAW:${a}_${b}`;
    if (fedA === 'USAW' && fedB === 'IWF') return `IWF_USAW:${b}_${a}`;
    if (fedA === 'USAW' && fedB === 'OWLCMS') return `USAW_OWLCMS:${a}_${b}`;
    if (fedA === 'OWLCMS' && fedB === 'USAW') return `USAW_OWLCMS:${b}_${a}`;
    if (fedA === 'IWF' && fedB === 'OWLCMS') return `IWF_OWLCMS:${a}_${b}`;
    if (fedA === 'OWLCMS' && fedB === 'IWF') return `IWF_OWLCMS:${b}_${a}`;
    if (fedA === 'IWF' && fedB === 'IWF') return `IWF_IWF:${Math.min(a, b)}_${Math.max(a, b)}`;
    if (fedA === 'OWLCMS' && fedB === 'OWLCMS') return `OWLCMS_OWLCMS:${Math.min(a, b)}_${Math.max(a, b)}`;
    return null;
}

function mapRawRowToProfile(fedCode, row) {
    if (!row) return null;
    if (fedCode === 'IWF') {
        return {
            id: row.db_lifter_id,
            name: row.athlete_name || row.lifter_name,
            gender: row.gender || null,
            birth_year: row.birth_year || null,
            country: row.country_code || row.country_name || null,
            country_code: row.country_code || null
        };
    }
    if (fedCode === 'USAW') {
        return {
            id: row.lifter_id,
            name: row.lifter_name || row.athlete_name,
            gender: row.gender || null,
            birth_year: row.birth_year || null,
            country: 'USA',
            country_code: 'USA'
        };
    }
    if (fedCode === 'OWLCMS') {
        return {
            id: row.lifter_id,
            name: row.athlete_name,
            gender: row.gender || null,
            birth_year: row.birth_year || null,
            country_code: row.country_code || null,
            club_name: row.club_name || null
        };
    }
    return null;
}

async function fetchAthleteProfileById(fedCode, athleteId) {
    const cleanId = parseInt(athleteId, 10);
    if (isNaN(cleanId)) return null;

    if (fedCode === 'IWF') {
        const { data } = await supabase
            .from('iwf_lifters')
            .select('db_lifter_id, athlete_name, gender, birth_year, country_code, country_name')
            .eq('db_lifter_id', cleanId)
            .maybeSingle();
        return mapRawRowToProfile('IWF', data);
    }
    if (fedCode === 'USAW') {
        const { data } = await supabase
            .from('distinct_usaw_lifters_view')
            .select('lifter_id, lifter_name, gender, birth_year')
            .eq('lifter_id', cleanId)
            .maybeSingle();
        if (data) return mapRawRowToProfile('USAW', data);

        // Fallback to usaw_lifters for debut/zero-total lifters omitted from distinct_usaw_lifters_view
        const { data: baseRow } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name')
            .eq('lifter_id', cleanId)
            .maybeSingle();
        return mapRawRowToProfile('USAW', baseRow);
    }
    if (fedCode === 'OWLCMS') {
        const { data } = await supabase
            .from('owlcms_lifters')
            .select('lifter_id, athlete_name, gender, birth_year, country_code, club_name')
            .eq('lifter_id', cleanId)
            .maybeSingle();
        return mapRawRowToProfile('OWLCMS', data);
    }
    return null;
}

async function fetchSourceMeetResultsForPhysics(fedCode, athleteId) {
    const cleanId = parseInt(athleteId, 10);
    if (isNaN(cleanId)) return [];

    if (fedCode === 'IWF') {
        return await fetchAll(
            supabase,
            'iwf_meet_results',
            'db_meet_id, db_lifter_id, lifter_name, gender, birth_year, country_code, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total',
            q => q.eq('db_lifter_id', cleanId)
        );
    }
    if (fedCode === 'USAW') {
        return await fetchAll(
            supabase,
            'usaw_meet_results',
            'meet_id, lifter_id, lifter_name, gender, birth_year, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total',
            q => q.eq('lifter_id', cleanId)
        );
    }
    return [];
}

async function fetchMeetRosterCached(fedCode, meetId, meetRosterCache) {
    const numericId = Number(meetId);
    const cache = meetRosterCache[fedCode];
    if (cache.has(numericId)) return cache.get(numericId);

    let rows = [];
    if (fedCode === 'IWF') {
        rows = await fetchAll(
            supabase,
            'iwf_meet_results',
            'db_meet_id, db_lifter_id, lifter_name, gender, birth_year, country_code, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total',
            q => q.eq('db_meet_id', numericId)
        );
    } else if (fedCode === 'USAW') {
        rows = await fetchAll(
            supabase,
            'usaw_meet_results',
            'meet_id, lifter_id, lifter_name, gender, birth_year, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total',
            q => q.eq('meet_id', numericId)
        );
    }

    const grouped = new Map();
    for (const r of rows) {
        const id = fedCode === 'IWF' ? r.db_lifter_id : r.lifter_id;
        if (id == null) continue;
        if (!grouped.has(id)) {
            grouped.set(id, {
                profile: mapRawRowToProfile(fedCode, r),
                results: []
            });
        }
        grouped.get(id).results.push(r);
    }

    cache.set(numericId, grouped);
    return grouped;
}

async function fetchCohortCandidates(tCode, genderKey, birthYearKey) {
    if (tCode === 'IWF') {
        const data = await fetchAll(
            supabase,
            'iwf_lifters',
            'db_lifter_id, athlete_name, gender, birth_year, country_code, country_name',
            q => q.eq('gender', genderKey).eq('birth_year', birthYearKey)
        );
        return data.map(d => mapRawRowToProfile('IWF', d));
    }
    if (tCode === 'USAW') {
        const data = await fetchAll(
            supabase,
            'distinct_usaw_lifters_view',
            'lifter_id, lifter_name, gender, birth_year',
            q => q.eq('gender', genderKey).eq('birth_year', birthYearKey)
        );
        return data.map(d => mapRawRowToProfile('USAW', d));
    }
    if (tCode === 'OWLCMS') {
        const data = await fetchAll(
            supabase,
            'owlcms_lifters',
            'lifter_id, athlete_name, gender, birth_year, country_code, club_name',
            q => q.eq('gender', genderKey).eq('birth_year', birthYearKey)
        );
        return data.map(d => mapRawRowToProfile('OWLCMS', d));
    }
    return [];
}

/**
 * Lightweight token-filtered candidate lookup for +/-2 year or NULL birth-year review fallback.
 * Filters by gender and the longest substantive name token to avoid scanning full cohorts.
 */
async function fetchBirthYearFallbackCandidates(tCode, genderKey, birthYearKey, sourceName) {
    const substantive = extractSubstantiveTokens(tokenize(sourceName));
    if (substantive.length < 2) return [];

    // Pick longest token (at least 3 chars when available) to maximize index selectivity
    const anchorToken = [...substantive].sort((a, b) => b.length - a.length)[0];
    if (!anchorToken || anchorToken.length < 2) return [];

    const adjacentYears = birthYearKey
        ? [birthYearKey - 2, birthYearKey - 1, birthYearKey + 1, birthYearKey + 2]
        : null;

    const pattern = `%${anchorToken}%`;
    const tableConfig = {
        IWF: {
            table: 'iwf_lifters',
            select: 'db_lifter_id, athlete_name, gender, birth_year, country_code, country_name',
            nameCol: 'athlete_name'
        },
        USAW: {
            table: 'distinct_usaw_lifters_view',
            select: 'lifter_id, lifter_name, gender, birth_year',
            nameCol: 'lifter_name'
        },
        OWLCMS: {
            table: 'owlcms_lifters',
            select: 'lifter_id, athlete_name, gender, birth_year, country_code, club_name',
            nameCol: 'athlete_name'
        }
    }[tCode];

    if (!tableConfig) return [];

    const combined = new Map();
    const addRows = (rows) => {
        for (const row of rows || []) {
            const prof = mapRawRowToProfile(tCode, row);
            if (prof && prof.id != null && !combined.has(prof.id)) {
                combined.set(prof.id, prof);
            }
        }
    };

    if (adjacentYears) {
        const adjRows = await fetchAll(
            supabase,
            tableConfig.table,
            tableConfig.select,
            q => q.eq('gender', genderKey).in('birth_year', adjacentYears).ilike(tableConfig.nameCol, pattern)
        );
        addRows(adjRows);

        const nullYearRows = await fetchAll(
            supabase,
            tableConfig.table,
            tableConfig.select,
            q => q.eq('gender', genderKey).is('birth_year', null).ilike(tableConfig.nameCol, pattern)
        );
        addRows(nullYearRows);
    } else {
        // Source birth_year is NULL: search matching gender + anchor token across any birth year
        const anyYearRows = await fetchAll(
            supabase,
            tableConfig.table,
            tableConfig.select,
            q => q.eq('gender', genderKey).ilike(tableConfig.nameCol, pattern)
        );
        addRows(anyYearRows);
    }

    return Array.from(combined.values());
}

async function hydrateTotals(fedCode, profile) {
    if (!profile || profile.historical_totals !== undefined) return;
    const { totals, bestTotal } = await fetchHistoricalTotals(supabase, fedCode, profile.id);
    profile.historical_totals = totals;
    profile.best_total = bestTotal;
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
    console.log(`[ATHLETE LINKING EVALUATOR] Starting Symmetrical Worker (${ALGORITHM_VERSION})`);
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
            isReEvaluate,
            executionTimeMs: Date.now() - startTime
        };
        console.log('__ATHLETE_EVALUATOR_SUMMARY_JSON__:' + JSON.stringify(summary));
        process.exit(0);
    }

    console.log(`Found ${tasks.length} evaluation task(s) to process.\n`);

    // 3. Preload existing pairwise edges from public.athlete_aliases (paginated)
    const existingAliasRows = await fetchAll(
        supabase,
        'athlete_aliases',
        'usaw_lifter_id, iwf_db_lifter_id, iwf_db_lifter_id_2, owlcms_lifter_id, owlcms_lifter_id_2'
    );
    const existingAliasesSet = new Set();
    for (const row of existingAliasRows) {
        if (row.iwf_db_lifter_id && row.usaw_lifter_id) {
            existingAliasesSet.add(makeExistingAliasKey('IWF', row.iwf_db_lifter_id, 'USAW', row.usaw_lifter_id));
        }
        if (row.usaw_lifter_id && row.owlcms_lifter_id) {
            existingAliasesSet.add(makeExistingAliasKey('USAW', row.usaw_lifter_id, 'OWLCMS', row.owlcms_lifter_id));
        }
        if (row.iwf_db_lifter_id && row.owlcms_lifter_id) {
            existingAliasesSet.add(makeExistingAliasKey('IWF', row.iwf_db_lifter_id, 'OWLCMS', row.owlcms_lifter_id));
        }
        if (row.iwf_db_lifter_id && row.iwf_db_lifter_id_2) {
            existingAliasesSet.add(makeExistingAliasKey('IWF', row.iwf_db_lifter_id, 'IWF', row.iwf_db_lifter_id_2));
        }
        if (row.owlcms_lifter_id && row.owlcms_lifter_id_2) {
            existingAliasesSet.add(makeExistingAliasKey('OWLCMS', row.owlcms_lifter_id, 'OWLCMS', row.owlcms_lifter_id_2));
        }
    }

    // 4. Preload meet_aliases + MANUAL_MEET_MAP if any task involves IWF <-> USAW
    const hasIwfUsawTask = tasks.some(t => {
        const s = fedByUuid.get(t.source_federation_id)?.short_code?.toUpperCase();
        const tg = fedByUuid.get(t.target_federation_id)?.short_code?.toUpperCase();
        return (s === 'IWF' && tg === 'USAW') || (s === 'USAW' && tg === 'IWF');
    });

    const iwfToUsawMeets = new Map();
    const usawToIwfMeets = new Map();
    const registerMeetPair = (iwfMeetId, usawMeetId) => {
        const iId = Number(iwfMeetId);
        const uId = Number(usawMeetId);
        if (isNaN(iId) || isNaN(uId)) return;
        if (!iwfToUsawMeets.has(iId)) iwfToUsawMeets.set(iId, new Set());
        iwfToUsawMeets.get(iId).add(uId);
        if (!usawToIwfMeets.has(uId)) usawToIwfMeets.set(uId, new Set());
        usawToIwfMeets.get(uId).add(iId);
    };

    if (hasIwfUsawTask) {
        const meetAliasRows = await fetchAll(supabase, 'meet_aliases', 'iwf_meet_id, usaw_meet_id');
        for (const ma of meetAliasRows) {
            registerMeetPair(ma.iwf_meet_id, ma.usaw_meet_id);
        }
        for (const [iwfId, usawIds] of Object.entries(MANUAL_MEET_MAP || {})) {
            for (const uId of usawIds || []) {
                registerMeetPair(iwfId, uId);
            }
        }
        if (isVerbose) {
            console.log(`Loaded ${iwfToUsawMeets.size} mapped IWF meet(s) <-> ${usawToIwfMeets.size} mapped USAW meet(s) for shared-meet physics.`);
        }
    }

    // In-memory caches to prevent redundant roundtrips
    const demographicCaches = {
        IWF: new Map(),
        USAW: new Map(),
        OWLCMS: new Map()
    };
    const meetRosterCache = {
        IWF: new Map(),
        USAW: new Map()
    };

    let matchedCount = 0;
    let reviewNeededCount = 0;
    let isolatedCount = 0;

    for (const task of tasks) {
        const sourceFed = fedByUuid.get(task.source_federation_id);
        const targetFed = fedByUuid.get(task.target_federation_id);

        const sCode = sourceFed?.short_code?.toUpperCase() || 'UNKNOWN';
        const tCode = targetFed?.short_code?.toUpperCase() || 'UNKNOWN';

        const rejectedCandidateIds = new Set(
            (task.evidence_breakdown?.rejected_candidate_ids || []).map(id => parseInt(id, 10)).filter(id => !isNaN(id))
        );

        // Preserve legacy broad-blacklisted rows that have no per-candidate rejection list
        if (isReEvaluate && !targetAthleteId && task.is_blacklisted === true && rejectedCandidateIds.size === 0) {
            if (isVerbose) {
                console.log(`[Task ${task.evaluation_id}] Skipping blacklisted evaluation (is_blacklisted=true, no per-candidate list).`);
            }
            continue;
        }

        if (isVerbose) {
            console.log(`[Task ${task.evaluation_id}] Evaluating Source [${sCode}] ID ${task.source_athlete_id} -> Target [${tCode}]`);
        }

        // Fetch Source Athlete Profile
        const sourceProfile = await fetchAthleteProfileById(sCode, task.source_athlete_id);
        if (!sourceProfile) {
            console.warn(`  ⚠️ Source athlete [${sCode}] ${task.source_athlete_id} not found in database. Skipping.`);
            continue;
        }

        const isIwfUsawPair = (sCode === 'IWF' && tCode === 'USAW') || (sCode === 'USAW' && tCode === 'IWF');
        let sourceMeetResults = [];

        if (isIwfUsawPair) {
            sourceMeetResults = await fetchSourceMeetResultsForPhysics(sCode, sourceProfile.id);
            const totals = sourceMeetResults
                .map(r => parseFloat(r.total))
                .filter(t => !isNaN(t) && t > 0);
            sourceProfile.historical_totals = totals;
            sourceProfile.best_total = totals.length > 0 ? Math.max(...totals) : null;
        } else {
            await hydrateTotals(sCode, sourceProfile);
        }

        const genderKey = sourceProfile.gender ? sourceProfile.gender.trim().toUpperCase() : null;
        const birthYearKey = sourceProfile.birth_year ? parseInt(sourceProfile.birth_year, 10) : null;
        const cohortKey = genderKey && birthYearKey ? `${genderKey}_${birthYearKey}` : `${genderKey || 'NULL'}_${birthYearKey || 'NULL'}`;

        // Collect all qualifying candidates (>= 60) keyed by target candidate ID
        const qualifyingById = new Map();
        const TIER_RANK = {
            EXACT_ORDERED: 6,
            EXACT_SET_REORDERED: 5,
            TOKEN_SUBSET: 4,
            FUZZY_EXACT_OR_SUBSET: 3,
            PARTIAL_OVERLAP_NON_SUBSET: 2,
            SINGLE_SURNAME_ONLY: 1,
            BLACKLISTED: 0,
            NONE: 0
        };
        let nameOverlapCount = 0;
        let closestRejected = null;
        const recordRejectedNearMiss = (candidate, result, quickNameTier = null) => {
            if (!candidate || candidate.id == null || !result || result.score >= 60) return;
            const tier = result.matchTier && result.matchTier !== 'NONE' ? result.matchTier : (quickNameTier || 'NONE');
            const rank = TIER_RANK[tier] || 0;
            const prevRank = closestRejected ? (TIER_RANK[closestRejected.tier] || 0) : -1;
            if (!closestRejected || rank > prevRank || (rank === prevRank && result.score > closestRejected.result.score)) {
                closestRejected = { candidate, result, tier };
            }
        };
        const recordCandidateResult = (candidate, result, quickNameTier = null) => {
            if (!candidate || candidate.id == null || !result) return;
            if (result.score < 60) {
                recordRejectedNearMiss(candidate, result, quickNameTier);
                return;
            }
            const cid = parseInt(candidate.id, 10);
            const existing = qualifyingById.get(cid);
            if (!existing || result.score > existing.result.score || (result.score === existing.result.score && result.status === 'MATCHED' && existing.result.status !== 'MATCHED')) {
                qualifyingById.set(cid, { candidate, result });
            }
        };

        // --- STEP A: Direct Manual Whitelist Resolution (bypasses cohort & name pre-screens) ---
        const whitelistedTargetIds = getWhitelistedTargetIds(sCode, sourceProfile.id, tCode);
        for (const targetId of whitelistedTargetIds) {
            if (sCode === tCode && targetId === sourceProfile.id) continue;
            if (rejectedCandidateIds.has(targetId)) continue;
            const targetProfile = await fetchAthleteProfileById(tCode, targetId);
            if (!targetProfile) continue;
            await hydrateTotals(tCode, targetProfile);
            const wlResult = evaluateCandidateMatch(sourceProfile, targetProfile, sCode, tCode);
            recordCandidateResult(targetProfile, wlResult);
        }

        // --- STEP B: Tier-1 Shared-Meet 6-Attempt Physics Pass (IWF <-> USAW) ---
        if (isIwfUsawPair && sourceMeetResults.length > 0) {
            const meetLookup = sCode === 'IWF' ? iwfToUsawMeets : usawToIwfMeets;
            const mappedTargetMeetIds = new Set();
            for (const r of sourceMeetResults) {
                const smId = Number(sCode === 'IWF' ? r.db_meet_id : r.meet_id);
                const targets = meetLookup.get(smId);
                if (targets) {
                    for (const tmId of targets) mappedTargetMeetIds.add(tmId);
                }
            }

            if (mappedTargetMeetIds.size > 0) {
                const targetResultsByAthlete = new Map();
                for (const tmId of mappedTargetMeetIds) {
                    const roster = await fetchMeetRosterCached(tCode, tmId, meetRosterCache);
                    for (const [candId, entry] of roster.entries()) {
                        if (rejectedCandidateIds.has(parseInt(candId, 10))) continue;
                        if (!targetResultsByAthlete.has(candId)) {
                            targetResultsByAthlete.set(candId, {
                                profile: entry.profile,
                                results: []
                            });
                        }
                        targetResultsByAthlete.get(candId).results.push(...entry.results);
                    }
                }

                for (const [, entry] of targetResultsByAthlete.entries()) {
                    const physicsResult = evaluateSharedMeetPhysics(
                        sourceProfile,
                        sourceMeetResults,
                        entry.profile,
                        entry.results,
                        meetLookup,
                        sCode,
                        tCode
                    );
                    if (physicsResult && physicsResult.score >= 60) {
                        recordCandidateResult(entry.profile, physicsResult);
                    }
                }
            }
        }

        // --- STEP C: Primary Exact Demographic Cohort Evaluation (Paginated fetchAll) ---
        let cohortCandidateCount = 0;
        if (genderKey && birthYearKey) {
            const targetCache = demographicCaches[tCode];
            let candidates = [];
            if (targetCache && targetCache.has(cohortKey)) {
                candidates = targetCache.get(cohortKey);
            } else {
                candidates = await fetchCohortCandidates(tCode, genderKey, birthYearKey);
                if (targetCache) targetCache.set(cohortKey, candidates);
            }

            if (sCode === tCode) {
                candidates = candidates.filter(c => c.id !== sourceProfile.id);
            }
            cohortCandidateCount = candidates.length;

            for (const candidate of candidates) {
                if (rejectedCandidateIds.has(parseInt(candidate.id, 10))) {
                    if (isVerbose) {
                        console.log(`     ⏭️ Skipping candidate [${tCode}:${candidate.id}] "${candidate.name}" (in rejected_candidate_ids)`);
                    }
                    continue;
                }

                // Pre-screen name tier before hydrating totals
                const quickName = analyzeNameMatch(sourceProfile.name, candidate.name);
                if (quickName.tier === 'NONE') continue;
                nameOverlapCount++;

                await hydrateTotals(tCode, candidate);

                const result = evaluateCandidateMatch(sourceProfile, candidate, sCode, tCode);
                recordCandidateResult(candidate, result, quickName.tier);
            }
        }

        // --- STEP D: Bounded Bad or Missing Birth-Year Fallback (+/-2 years or NULL, Review-Only) ---
        const hasMatchedCandidate = Array.from(qualifyingById.values()).some(x => x.result.status === 'MATCHED');
        if (!hasMatchedCandidate && genderKey) {
            const fallbackCandidates = await fetchBirthYearFallbackCandidates(tCode, genderKey, birthYearKey, sourceProfile.name);
            for (const candidate of fallbackCandidates) {
                if (sCode === tCode && candidate.id === sourceProfile.id) continue;
                const cid = parseInt(candidate.id, 10);
                if (rejectedCandidateIds.has(cid) || qualifyingById.has(cid)) continue;

                const quickName = analyzeNameMatch(sourceProfile.name, candidate.name);
                if (quickName.tier !== 'EXACT_ORDERED' && quickName.tier !== 'EXACT_SET_REORDERED') continue;
                nameOverlapCount++;

                await hydrateTotals(tCode, candidate);

                const fbResult = evaluateCandidateMatch(sourceProfile, candidate, sCode, tCode, {
                    allowBirthYearFallback: true
                });
                recordCandidateResult(candidate, fbResult, quickName.tier);
            }
        }

        // --- STEP E: Multi-Candidate Tie Guard & Outcome Routing ---
        const qualifyingList = Array.from(qualifyingById.values()).sort((a, b) => {
            if (b.result.score !== a.result.score) return b.result.score - a.result.score;
            if (a.result.status === 'MATCHED' && b.result.status !== 'MATCHED') return -1;
            if (b.result.status === 'MATCHED' && a.result.status !== 'MATCHED') return 1;
            return parseInt(a.candidate.id, 10) - parseInt(b.candidate.id, 10);
        });

        const autoLinkCandidates = qualifyingList.filter(x => x.result.status === 'MATCHED');

        if (autoLinkCandidates.length === 1) {
            const winner = autoLinkCandidates[0];
            const bestCandidate = winner.candidate;
            const bestScore = winner.result.score;
            const bestBreakdown = winner.result.breakdown;
            const additionalCandidates = qualifyingList
                .slice(1, 6)
                .map(x => ({
                    id: x.candidate.id,
                    name: x.candidate.name,
                    birth_year: x.candidate.birth_year,
                    country: x.candidate.country || x.candidate.country_code || null,
                    score: x.result.score,
                    match_tier: x.result.matchTier,
                    breakdown: x.result.breakdown
                }));

            const aliasKey = makeExistingAliasKey(sCode, sourceProfile.id, tCode, bestCandidate.id);
            const alreadyLinked = aliasKey ? existingAliasesSet.has(aliasKey) : false;

            console.log(`  🎯 MATCH: [${sCode}:${sourceProfile.id}] "${sourceProfile.name}" ── [${tCode}:${bestCandidate.id}] "${bestCandidate.name}" (Score: ${bestScore}${alreadyLinked ? ' | already linked' : ''})`);
            console.log(`     Evidence: ${bestBreakdown.join(', ')}`);

            if (!isDryRun) {
                if (!alreadyLinked) {
                    const aliasPayload = {
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

                    const { error: aliasErr } = await supabase
                        .from('athlete_aliases')
                        .insert(aliasPayload);

                    if (aliasErr && aliasErr.code !== '23505') {
                        console.error(`    ⚠️ Failed to insert athlete_aliases row: ${aliasErr.message}`);
                    } else if (aliasKey) {
                        existingAliasesSet.add(aliasKey);
                    }
                }

                await supabase
                    .from('athlete_linking_evaluations')
                    .update({
                        status: 'MATCHED',
                        target_athlete_id: bestCandidate.id,
                        confidence_score: bestScore,
                        algorithm_version: ALGORITHM_VERSION,
                        evidence_breakdown: {
                            source: sourceProfile,
                            target: bestCandidate,
                            score: bestScore,
                            breakdown: bestBreakdown,
                            match_tier: winner.result.matchTier,
                            candidate_count: qualifyingList.length,
                            additional_candidates: additionalCandidates,
                            cohort: cohortKey,
                            rejected_candidate_ids: Array.from(rejectedCandidateIds)
                        },
                        evaluated_at: new Date().toISOString()
                    })
                    .eq('evaluation_id', task.evaluation_id);
            }
            matchedCount++;
        } else if (qualifyingList.length >= 1) {
            const top = qualifyingList[0];
            const isMultiCandidateTie = autoLinkCandidates.length >= 2;
            const reviewScore = isMultiCandidateTie ? 79 : top.result.score;
            const reviewBreakdown = isMultiCandidateTie
                ? [
                    ...top.result.breakdown,
                    `Multi-candidate tie (${autoLinkCandidates.length} qualifying targets >= 80%): routed to manual review to distinguish duplicate profiles from homonyms`
                ]
                : top.result.breakdown;

            const additionalCandidates = qualifyingList
                .slice(1, 10)
                .map(x => ({
                    id: x.candidate.id,
                    name: x.candidate.name,
                    birth_year: x.candidate.birth_year,
                    country: x.candidate.country || x.candidate.country_code || null,
                    score: x.result.score,
                    match_tier: x.result.matchTier,
                    breakdown: x.result.breakdown
                }));

            console.log(`  ⚠️ REVIEW: [${sCode}:${sourceProfile.id}] "${sourceProfile.name}" ── [${tCode}:${top.candidate.id}] "${top.candidate.name}" (Score: ${reviewScore}${isMultiCandidateTie ? ` | ${autoLinkCandidates.length} tied candidates` : ''})`);
            console.log(`     Evidence: ${reviewBreakdown.join(', ')}`);

            if (!isDryRun) {
                await supabase
                    .from('athlete_linking_evaluations')
                    .update({
                        status: 'REVIEW_NEEDED',
                        target_athlete_id: top.candidate.id,
                        confidence_score: reviewScore,
                        algorithm_version: ALGORITHM_VERSION,
                        evidence_breakdown: {
                            source: sourceProfile,
                            target: top.candidate,
                            score: reviewScore,
                            breakdown: reviewBreakdown,
                            match_tier: isMultiCandidateTie ? 'MULTI_CANDIDATE_TIE' : top.result.matchTier,
                            candidate_count: qualifyingList.length,
                            additional_candidates: additionalCandidates,
                            cohort: cohortKey,
                            rejected_candidate_ids: Array.from(rejectedCandidateIds)
                        },
                        evaluated_at: new Date().toISOString()
                    })
                    .eq('evaluation_id', task.evaluation_id);
            }
            reviewNeededCount++;
        } else {
            const reason = !genderKey
                ? 'Missing biographical demographic anchor (gender)'
                : (!birthYearKey
                    ? 'Missing birth_year with no exact-name fallback candidate found'
                    : (cohortCandidateCount === 0
                        ? 'Demographic cohort empty and no +/-2 year exact-name fallback found'
                        : 'No candidate reached review threshold (>= 60) under strict v3.0 policy'));

            if (isDryRun || isVerbose) {
                const sCountryDisplay = sourceProfile.country || sourceProfile.country_code || 'N/A';
                const sTotalDisplay = sourceProfile.best_total != null ? `${sourceProfile.best_total}kg` : 'no total';
                const overlapText = !genderKey || !birthYearKey
                    ? reason
                    : `Cohort: ${cohortCandidateCount} | ${nameOverlapCount} name-overlap(s)`;
                console.log(`  ⚪ ISOLATED: [${sCode}:${sourceProfile.id}] "${sourceProfile.name}" (${genderKey || '?'}, ${birthYearKey || '?'}, ${sCountryDisplay}, Best: ${sTotalDisplay}) -> [${tCode}] | ${overlapText}`);
                if (closestRejected) {
                    const rc = closestRejected.candidate;
                    const rr = closestRejected.result;
                    const rCountry = rc.country || rc.country_code || 'N/A';
                    const rTotal = rc.best_total != null ? `${rc.best_total}kg` : 'no total';
                    const rejectNote = (rr.breakdown && rr.breakdown.length > 0)
                        ? rr.breakdown[rr.breakdown.length - 1]
                        : (rr.verdict || 'Below review threshold');
                    console.log(`     Closest rejected: [${tCode}:${rc.id}] "${rc.name}" (${rc.birth_year || '?'}, ${rCountry}, Best: ${rTotal}) [${closestRejected.tier}] — ${rejectNote}`);
                }
            }
            if (!isDryRun) {
                await supabase
                    .from('athlete_linking_evaluations')
                    .update({
                        status: 'VETTED_ISOLATED',
                        confidence_score: 0,
                        algorithm_version: ALGORITHM_VERSION,
                        evidence_breakdown: {
                            reason,
                            highest_score: 0,
                            cohort: cohortKey,
                            candidates_checked: cohortCandidateCount,
                            rejected_candidate_ids: Array.from(rejectedCandidateIds)
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

    console.log(`\n[ATHLETE LINKING EVALUATOR] Run Complete (${ALGORITHM_VERSION}):`);
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
