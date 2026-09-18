#!/usr/bin/env node
/**
 * PRODUCTION: USAW → OWLCMS Athlete Alias Linker
 *
 * Runs automatically after USAW meet results ingestion or scraping.
 * Matches newly scraped or updated USAW lifters to existing OWLCMS lifters
 * (owlcms_lifters) and registers pairwise edges in public.athlete_aliases.
 *
 * Enforces:
 *   1. Universal Demographic Anchoring: Strict (gender, birth_year) match gate.
 *   2. Token-Based Name Matching: Handles first, middle, compound last names.
 *   3. Performance Delta: Verifies totals against OWLCMS meet results.
 *   4. Pairwise Edge Integrity: check_alias_type = 2 (usaw_lifter_id + owlcms_lifter_id).
 *
 * Usage:
 *   node scripts/production/link-new-usaw-athletes.js --days 3           # Default: last 3 days
 *   node scripts/production/link-new-usaw-athletes.js --meet-ids 7011,7012 # Post-scrape hook
 *   node scripts/production/link-new-usaw-athletes.js --dry-run          # Preview without DB writes
 *   node scripts/production/link-new-usaw-athletes.js --all              # Full historical scan
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const minimist = require('minimist');
const { OWLCMS_MANUAL_MAP, OWLCMS_BLACKLIST_MAP } = require('../shared/athlete-mappings.js');
const { generateAthlete } = require('./assembler.js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// ============================================================================
// UTILITIES
// ============================================================================

function tokenize(name) {
    if (!name || typeof name !== 'string') return [];
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/-/g, ' ')
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(x => x.length >= 2);
}

function parseLift(val) {
    if (val === null || val === undefined || val === '' || val === '---') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
}

function extractCountryCode(owlcmsLifter) {
    if (owlcmsLifter.country_code && owlcmsLifter.country_code.trim().length === 3) {
        return owlcmsLifter.country_code.trim().toUpperCase();
    }
    const club = (owlcmsLifter.club_name || '').trim().toUpperCase();
    if (club.length === 3) return club;
    const canadianProvinces = [
        'ONTARIO', 'QUÉBEC', 'QUEBEC', 'ALBERTA', 'BRITISH COLUMBIA',
        'SASKATCHEWAN', 'MANITOBA', 'NOVA SCOTIA', 'NEW BRUNSWICK', 'NEWFOUNDLAND', 'PEI'
    ];
    if (canadianProvinces.includes(club)) return 'CAN';
    if (club === 'USA' || club.includes('USA')) return 'USA';
    return null;
}

function calculateNameScore(nameA, nameB) {
    const tokensA = tokenize(nameA);
    const tokensB = tokenize(nameB);
    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    const strA = tokensA.join(' ');
    const strB = tokensB.join(' ');
    if (strA === strB) return 80;

    const overlap = tokensA.filter(t => tokensB.includes(t));
    const overlapCount = overlap.length;

    if (overlapCount >= 2) return 65;

    const isLastNameMatch = overlapCount === 1 && (
        overlap[0] === tokensA[tokensA.length - 1] || 
        overlap[0] === tokensB[tokensB.length - 1]
    );
    if (isLastNameMatch) return 35;

    return 0;
}

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
        allData = allData.concat(data);
        if (data.length < PAGE_SIZE) break;
        page++;
    }
    return allData;
}

function evaluateMatch(uLifter, oLifter, uResults = [], oResults = []) {
    // 1. Strict Demographic Anchoring: Birth Year
    if (uLifter.birth_year && oLifter.birth_year) {
        if (uLifter.birth_year !== oLifter.birth_year) {
            return { status: 'NO_MATCH', score: 0, reason: 'Birth year mismatch' };
        }
    }

    // 2. Strict Demographic Anchoring: Gender
    if (uLifter.gender && oLifter.gender) {
        if (uLifter.gender.toUpperCase() !== oLifter.gender.toUpperCase()) {
            return { status: 'NO_MATCH', score: 0, reason: 'Gender mismatch' };
        }
    }

    let score = 0;
    const breakdown = [];

    // Name match score
    const nameScore = calculateNameScore(uLifter.athlete_name, oLifter.athlete_name);
    if (nameScore === 0) {
        return { status: 'NO_MATCH', score: 0, reason: 'Name tokens do not overlap' };
    }
    score += nameScore;
    breakdown.push(`Name: +${nameScore}`);

    // Birth year exact bonus
    if (uLifter.birth_year && oLifter.birth_year && uLifter.birth_year === oLifter.birth_year) {
        score += 20;
        breakdown.push('Birth Year: +20');
    }

    // Country match: USAW athletes are USA
    const oCountry = extractCountryCode(oLifter);
    if (oCountry) {
        if (oCountry === 'USA') {
            score += 15;
            breakdown.push('Country Match (USA): +15');
        } else {
            score -= 15;
            breakdown.push(`Country Divergence (${oCountry} vs USA): -15`);
        }
    }

    // Performance & Total delta check
    const uTotals = uResults.map(r => parseLift(r.total)).filter(t => t !== null && t > 0);
    const oTotals = oResults.map(r => parseLift(r.total)).filter(t => t !== null && t > 0);

    if (uTotals.length > 0 && oTotals.length > 0) {
        let minDelta = 9999;
        for (const ut of uTotals) {
            for (const ot of oTotals) {
                const diff = Math.abs(ut - ot);
                if (diff < minDelta) minDelta = diff;
            }
        }
        if (minDelta <= 10) {
            score += 15;
            breakdown.push(`Performance Delta (${minDelta}kg): +15`);
        } else if (minDelta <= 25) {
            score += 5;
            breakdown.push(`Performance Delta (${minDelta}kg): +5`);
        } else {
            score -= 10;
            breakdown.push(`Performance Divergence (${minDelta}kg): -10`);
        }
    }

    const finalScore = Math.min(Math.max(score, 0), 100);
    return {
        status: finalScore >= 80 ? 'HIGH_CONFIDENCE' : (finalScore >= 60 ? 'REVIEW_NEEDED' : 'NO_MATCH'),
        score: finalScore,
        breakdown: breakdown.join(', ')
    };
}

// ============================================================================
// MAIN
// ============================================================================

async function run() {
    const args = minimist(process.argv.slice(2), {
        default: { days: 3, 'min-score': 80 }
    });

    const isDryRun = args['dry-run'] || args.d || false;
    const isAll = args.all || false;
    const isVerbose = args.verbose || args.v || false;
    const lookbackDays = parseInt(args.days, 10) || 3;
    const meetIdsArg = args['meet-ids'] ? args['meet-ids'].toString().split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean) : [];
    const targetLifterId = args['lifter-id'] ? parseInt(args['lifter-id'], 10) : null;
    const minScore = parseInt(args['min-score'], 10) || 80;

    console.log(`\n============================================================`);
    console.log(`[USAW → OWLCMS ATHLETE LINKER] Starting Production Run`);
    if (isDryRun) console.log(`  MODE: DRY RUN (Database writes disabled)`);
    if (isVerbose) console.log(`  VERBOSITY: Verbose logging enabled`);
    console.log(`  Minimum Score Threshold: ${minScore}`);
    console.log(`============================================================\n`);

    // 1. Fetch existing USAW <-> OWLCMS pairwise alias edges
    console.log(`[1/4] Loading existing USAW ↔ OWLCMS alias records...`);
    const existingAliases = await fetchAll(
        supabase,
        'athlete_aliases',
        'id, usaw_lifter_id, owlcms_lifter_id',
        q => q.not('usaw_lifter_id', 'is', null).not('owlcms_lifter_id', 'is', null)
    );

    const existingPairSet = new Set(
        existingAliases.map(a => `${a.usaw_lifter_id}-${a.owlcms_lifter_id}`)
    );
    console.log(`  Found ${existingPairSet.size} existing USAW ↔ OWLCMS pairwise edge(s).`);

    // 2. Fetch all OWLCMS lifters with demographics
    console.log(`\n[2/4] Fetching all OWLCMS lifters for demographic matching...`);
    const { data: owlcmsLifters, error: oErr } = await supabase
        .from('owlcms_lifters')
        .select(`
            lifter_id,
            athlete_name,
            gender,
            birth_year,
            country_code,
            club_name,
            link_status,
            rejected_candidate_ids
        `);

    if (oErr) {
        console.error('ERROR fetching OWLCMS lifters:', oErr.message);
        process.exit(1);
    }

    if (!owlcmsLifters || owlcmsLifters.length === 0) {
        console.log('No OWLCMS lifters found in database.');
        process.exit(0);
    }

    // Index OWLCMS lifters by demographic anchor: (gender, birth_year)
    const owlcmsByDemographic = new Map();
    for (const o of owlcmsLifters) {
        if (!o.birth_year || !o.gender) continue;
        const key = `${o.gender.toUpperCase()}_${o.birth_year}`;
        if (!owlcmsByDemographic.has(key)) owlcmsByDemographic.set(key, []);
        owlcmsByDemographic.get(key).push({
            ...o,
            tokens: tokenize(o.athlete_name)
        });
    }
    console.log(`  Loaded ${owlcmsLifters.length} OWLCMS lifters (${owlcmsByDemographic.size} demographic pools).`);

    // Fetch OWLCMS meet results for performance comparison
    const { data: owlcmsResults } = await supabase
        .from('owlcms_meet_results')
        .select('lifter_id, total, body_weight_kg');

    const owlcmsResultsMap = new Map();
    for (const r of owlcmsResults || []) {
        if (!owlcmsResultsMap.has(r.lifter_id)) owlcmsResultsMap.set(r.lifter_id, []);
        owlcmsResultsMap.get(r.lifter_id).push(r);
    }

    // 3. Resolve target USAW lifters
    console.log(`\n[3/4] Resolving target USAW lifters...`);
    let targetLifterIds = [];

    if (targetLifterId) {
        targetLifterIds = [targetLifterId];
        console.log(`  Targeting single lifter ID: ${targetLifterId}`);
    } else if (meetIdsArg.length > 0) {
        console.log(`  Targeting meets: ${meetIdsArg.join(', ')}`);
        const { data: mResults, error: mErr } = await supabase
            .from('usaw_meet_results')
            .select('lifter_id')
            .in('meet_id', meetIdsArg);

        if (mErr) {
            console.error('ERROR fetching meet results:', mErr.message);
            process.exit(1);
        }
        targetLifterIds = [...new Set((mResults || []).map(r => r.lifter_id))];
    } else if (isAll) {
        console.log(`  Targeting ALL USAW lifters present in usaw_meet_results...`);
        const distinctView = await fetchAll(
            supabase,
            'distinct_usaw_lifters_view',
            'lifter_id, lifter_name, birth_year, gender'
        );
        targetLifterIds = distinctView.map(v => v.lifter_id);
    } else {
        const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
        console.log(`  Lookback window: ${lookbackDays} days (since ${cutoffDate.toISOString().split('T')[0]})`);

        // Query meets with recent dates or recently inserted results
        const { data: recentResults, error: rErr } = await supabase
            .from('usaw_meet_results')
            .select('lifter_id')
            .gte('date', cutoffDate.toISOString().split('T')[0]);

        if (rErr) {
            console.error('ERROR fetching recent USAW results:', rErr.message);
            process.exit(1);
        }
        targetLifterIds = [...new Set((recentResults || []).map(r => r.lifter_id))];
    }

    console.log(`  Found ${targetLifterIds.length} target USAW lifter(s) to evaluate.`);

    if (targetLifterIds.length === 0) {
        console.log('No USAW lifters to process within the selected scope.');
        process.exit(0);
    }

    // Fetch details for target USAW lifters
    console.log(`\n[4/4] Evaluating candidates under universal demographic anchor...`);
    const verifiedAliases = [];
    const newlyLinkedAthletes = [];
    let reviewedCount = 0;

    let statsEvaluated = 0;
    let statsWithDemo = 0;
    let statsMissingDemo = 0;
    let statsInPool = 0;
    let statsDemoIsolated = 0;
    let statsComparisons = 0;

    for (let i = 0; i < targetLifterIds.length; i += 1000) {
        const chunk = targetLifterIds.slice(i, i + 1000);

        // 1. Bulk resolve established demographics from canonical view
        const { data: establishedProfiles, error: viewErr } = await supabase
            .from('distinct_usaw_lifters_view')
            .select('lifter_id, lifter_name, birth_year, gender')
            .in('lifter_id', chunk);

        if (viewErr) {
            console.error('  ❌ ERROR fetching distinct_usaw_lifters_view:', viewErr.message);
            process.exit(1);
        }

        const establishedMap = new Map(
            (establishedProfiles || []).map(p => [p.lifter_id, p])
        );

        // 2. Fetch meet results for performance comparison
        const { data: uResults, error: uErr } = await supabase
            .from('usaw_meet_results')
            .select('lifter_id, lifter_name, total, body_weight_kg, date')
            .in('lifter_id', chunk);

        if (uErr) {
            console.error('  ❌ ERROR fetching USAW results:', uErr.message);
            process.exit(1);
        }

        // Group results by lifter_id
        const resultsByLifter = new Map();
        for (const r of uResults || []) {
            if (!resultsByLifter.has(r.lifter_id)) resultsByLifter.set(r.lifter_id, []);
            resultsByLifter.get(r.lifter_id).push(r);
        }

        for (const targetId of chunk) {
            statsEvaluated++;
            const established = establishedMap.get(targetId);
            const lifterResults = resultsByLifter.get(targetId) || [];
            const primaryName = established?.lifter_name || lifterResults[0]?.lifter_name || `Lifter ${targetId}`;

            // Case A: Lifter has NO established demographics in USAW history (e.g. debut bomb-out)
            if (!established || !established.birth_year || !established.gender) {
                statsMissingDemo++;
                const uTokens = tokenize(primaryName);

                if (uTokens.length >= 2) {
                    // Check for unlinked OWLCMS lifters with matching name
                    for (const oLifter of owlcmsLifters) {
                        if (oLifter.link_status === 'LINKED') continue;
                        const oTokens = tokenize(oLifter.athlete_name);
                        if (oTokens.length < 2) continue;

                        const nameScore = calculateNameScore(primaryName, oLifter.athlete_name);
                        if (nameScore >= 65) {
                            console.log(`  ⚠️ REVIEW (Zero-Total USAW Debut): USAW[${targetId}] "${primaryName}" ── OWLCMS[${oLifter.lifter_id}] "${oLifter.athlete_name}" (Name score: ${nameScore})`);
                            reviewedCount++;
                            if (!isDryRun) {
                                await supabase
                                    .from('owlcms_lifters')
                                    .update({
                                        link_status: 'REVIEW_NEEDED',
                                        review_candidate: {
                                            type: 'USAW',
                                            candidate_id: targetId,
                                            candidate_name: primaryName,
                                            score: nameScore,
                                            reason: 'High-confidence name match; USAW entrant has unverified demographics (no posted total in USAW history)'
                                        }
                                    })
                                    .eq('lifter_id', oLifter.lifter_id);
                            }
                        }
                    }
                }

                if (isVerbose) {
                    console.log(`  ⚪ [USAW ${targetId}] "${primaryName}": Unestablished demographics (no posted totals in USAW history)`);
                }
                continue;
            }

            // Case B: Lifter has established demographics in USAW
            statsWithDemo++;
            const uLifter = {
                lifter_id: targetId,
                athlete_name: established.lifter_name,
                birth_year: established.birth_year,
                gender: established.gender.toUpperCase(),
                results: lifterResults
            };

            const demoKey = `${uLifter.gender}_${uLifter.birth_year}`;
            const candidateOwlcms = owlcmsByDemographic.get(demoKey) || [];

            if (candidateOwlcms.length === 0) {
                statsDemoIsolated++;
                if (isVerbose) {
                    console.log(`  ⚪ [USAW ${uLifter.lifter_id}] "${uLifter.athlete_name}" (${demoKey}): 0 OWLCMS athletes in cohort`);
                }
                continue;
            }

            statsInPool++;

            if (isVerbose) {
                console.log(`  🔍 [USAW ${uLifter.lifter_id}] "${uLifter.athlete_name}" (${demoKey}): Comparing against ${candidateOwlcms.length} OWLCMS candidate(s)...`);
            }

            for (const oLifter of candidateOwlcms) {
                statsComparisons++;
                const pairKey = `${uLifter.lifter_id}-${oLifter.lifter_id}`;

                if (existingPairSet.has(pairKey)) {
                    if (isVerbose) {
                        console.log(`     ✓ Edge already exists: USAW[${uLifter.lifter_id}] ── OWLCMS[${oLifter.lifter_id}]`);
                    }
                    continue;
                }

                // Check manual map / blacklists
                const blacklist = (OWLCMS_BLACKLIST_MAP && OWLCMS_BLACKLIST_MAP[oLifter.lifter_id]) || [];
                const dbRejected = Array.isArray(oLifter.rejected_candidate_ids) ? oLifter.rejected_candidate_ids : [];
                if (blacklist.includes(uLifter.lifter_id) || dbRejected.includes(uLifter.lifter_id)) {
                    if (isVerbose) {
                        console.log(`     ✕ Pair blacklisted: USAW[${uLifter.lifter_id}] ── OWLCMS[${oLifter.lifter_id}]`);
                    }
                    continue;
                }

                // Check manual whitelist override
                const manualOverride = OWLCMS_MANUAL_MAP && OWLCMS_MANUAL_MAP[oLifter.lifter_id];
                const isWhitelisted = manualOverride && manualOverride.type === 'USAW' && manualOverride.id === uLifter.lifter_id;

                let evalResult;
                if (isWhitelisted) {
                    evalResult = { status: 'HIGH_CONFIDENCE', score: 100, breakdown: 'Manual Override' };
                } else {
                    const oResults = owlcmsResultsMap.get(oLifter.lifter_id) || [];
                    evalResult = evaluateMatch(uLifter, oLifter, uLifter.results, oResults);
                }

                if (evalResult.score >= minScore) {
                    console.log(`  🎯 MATCH: USAW[${uLifter.lifter_id}] "${uLifter.athlete_name}" ── OWLCMS[${oLifter.lifter_id}] "${oLifter.athlete_name}" (Score: ${evalResult.score})`);
                    console.log(`     Evidence: ${evalResult.breakdown}`);

                    verifiedAliases.push({
                        usaw_lifter_id: uLifter.lifter_id,
                        iwf_db_lifter_id: null,
                        owlcms_lifter_id: oLifter.lifter_id,
                        match_confidence: evalResult.score,
                        manual_override: isWhitelisted
                    });

                    existingPairSet.add(pairKey);
                    newlyLinkedAthletes.push({
                        usaw_id: uLifter.lifter_id,
                        owlcms_id: oLifter.lifter_id,
                        name: oLifter.athlete_name
                    });
                } else if (evalResult.score >= 60 && oLifter.link_status !== 'LINKED') {
                    console.log(`  ⚠️ REVIEW: USAW[${uLifter.lifter_id}] "${uLifter.athlete_name}" ── OWLCMS[${oLifter.lifter_id}] "${oLifter.athlete_name}" (Score: ${evalResult.score})`);
                    if (!isDryRun) {
                        await supabase
                            .from('owlcms_lifters')
                            .update({
                                link_status: 'REVIEW_NEEDED',
                                review_candidate: {
                                    type: 'USAW',
                                    candidate_id: uLifter.lifter_id,
                                    candidate_name: uLifter.athlete_name,
                                    score: evalResult.score,
                                    evidence: evalResult.breakdown
                                }
                            })
                            .eq('lifter_id', oLifter.lifter_id);
                    }
                    reviewedCount++;
                } else if (isVerbose) {
                    console.log(`     vs OWLCMS[${oLifter.lifter_id}] "${oLifter.athlete_name}": ${evalResult.reason || `Score: ${evalResult.score}/100`}`);
                }
            }
        }
    }

    console.log(`\n============================================================`);
    console.log(`Evaluation Summary & Diagnostics:`);
    console.log(`  Target USAW Lifters Evaluated:         ${statsEvaluated}`);
    console.log(`  With Established Demographics:         ${statsWithDemo}`);
    console.log(`  Zero-Total Entrants (No Demographics): ${statsMissingDemo}`);
    console.log(`  Lifters with OWLCMS Age/Sex Cohorts:   ${statsInPool} (cohort members exist to compare)`);
    console.log(`  Demographic Isolates (0 in OWLCMS):    ${statsDemoIsolated}`);
    console.log(`  Candidate Name Comparisons Computed:   ${statsComparisons}`);
    console.log(`  ------------------------------------------------------------`);
    console.log(`  NEW Pairwise Athlete Links Formed:     ${verifiedAliases.length}`);
    console.log(`  Review Candidates Staged:              ${reviewedCount}`);
    console.log(`============================================================\n`);

    if (verifiedAliases.length === 0) {
        console.log('No new USAW ↔ OWLCMS links found. athlete_aliases unchanged.');
        process.exit(0);
    }

    if (!isDryRun) {
        console.log(`Inserting ${verifiedAliases.length} pairwise alias row(s) into athlete_aliases...`);
        for (const pair of verifiedAliases) {
            const { error: insErr } = await supabase.from('athlete_aliases').insert(pair);
            if (insErr) {
                console.error(`  ❌ Error inserting USAW[${pair.usaw_lifter_id}] ── OWLCMS[${pair.owlcms_lifter_id}]:`, insErr.message);
            } else {
                console.log(`  ✅ Inserted edge: USAW[${pair.usaw_lifter_id}] ── OWLCMS[${pair.owlcms_lifter_id}]`);
            }
        }

        // Update OWLCMS link status
        const linkedOwlcmsIds = [...new Set(newlyLinkedAthletes.map(a => a.owlcms_id))];
        if (linkedOwlcmsIds.length > 0) {
            await supabase
                .from('owlcms_lifters')
                .update({ link_status: 'LINKED', review_candidate: null })
                .in('lifter_id', linkedOwlcmsIds);
        }

        // Trigger static shard generation
        console.log(`\n📦 Triggering static shard generation for ${newlyLinkedAthletes.length} athlete(s)...`);
        for (const athlete of newlyLinkedAthletes) {
            try {
                if (!process.env.DB_HOST && !process.env.DATABASE_URL) break;
                await generateAthlete({
                    usaw_id: athlete.usaw_id,
                    owlcms_id: athlete.owlcms_id
                });
            } catch (shardErr) {
                console.warn(`  ⚠️ Shard generation skipped for "${athlete.name}": ${shardErr.message}`);
            }
        }
    } else {
        console.log(`[DRY RUN] Would insert ${verifiedAliases.length} USAW ↔ OWLCMS aliases.`);
    }

    console.log(`\n[USAW → OWLCMS ATHLETE LINKER] Done.\n`);
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
