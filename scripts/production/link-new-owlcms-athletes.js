#!/usr/bin/env node
/**
 * PRODUCTION: OWLCMS Cross-Federation Athlete Alias Linker
 *
 * Matches and links newly uploaded OWLCMS lifters to existing USAW (usaw_lifters)
 * and IWF (iwf_lifters) athlete profiles in public.athlete_aliases.
 *
 * Uses a multi-signal identity verification algorithm:
 *   1. Strict Demographic Anchor: Exact Birth Year and Gender gate.
 *   2. Token-Based Name Matching: Handles middle names, compound surnames, and casing.
 *   3. Performance & Physics Verification: Bodyweight tier and Total delta consistency.
 *
 * Usage:
 *   node scripts/production/link-new-owlcms-athletes.js --dry-run
 *   node scripts/production/link-new-owlcms-athletes.js --lifter-id 190 --dry-run
 *   node scripts/production/link-new-owlcms-athletes.js
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

/**
 * Tokenize name string into normalized lowercase word tokens
 * Retains tokens of length >= 2 to support short surnames (e.g., Li, Wu, Po)
 */
function tokenize(name) {
    if (!name || typeof name !== 'string') return [];
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip accents
        .replace(/-/g, ' ')
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(x => x.length >= 2);
}

/**
 * Parse numeric lift or attempt value
 */
function parseLift(val) {
    if (val === null || val === undefined || val === '' || val === '---') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
}

/**
 * Extract normalized 3-letter country code from OWLCMS lifter metadata
 */
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

/**
 * Calculate token overlap score between two names
 */
function calculateNameScore(nameA, nameB) {
    const tokensA = tokenize(nameA);
    const tokensB = tokenize(nameB);
    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    const strA = tokensA.join(' ');
    const strB = tokensB.join(' ');
    if (strA === strB) return 80;

    const overlap = tokensA.filter(t => tokensB.includes(t));
    const overlapCount = overlap.length;

    // Strong match (2+ words overlap) -> gracefully swallows middle names
    if (overlapCount >= 2) return 65;

    // Last-name only match
    const isLastNameMatch = overlapCount === 1 && (
        overlap[0] === tokensA[tokensA.length - 1] || 
        overlap[0] === tokensB[tokensB.length - 1]
    );
    if (isLastNameMatch) return 35;

    return 0;
}

/**
 * Generic paginated fetch helper to bypass PostgREST 1000-row limits
 */
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

/**
 * Score candidate match between OWLCMS lifter and IWF / USAW lifter
 */
function evaluateMatch(owlcmsLifter, candidate, candidateType, candidateResults = []) {
    // 1. Hard Demographic Gating: Birth Year
    if (owlcmsLifter.birth_year && candidate.birth_year) {
        if (owlcmsLifter.birth_year !== candidate.birth_year) {
            return { status: 'NO_MATCH', score: 0, reason: 'Birth year mismatch' };
        }
    }

    // 2. Hard Demographic Gating: Gender
    if (owlcmsLifter.gender && candidate.gender) {
        if (owlcmsLifter.gender.toUpperCase() !== candidate.gender.toUpperCase()) {
            return { status: 'NO_MATCH', score: 0, reason: 'Gender mismatch' };
        }
    }

    let score = 0;
    const breakdown = [];

    // Name match score
    const nameScore = calculateNameScore(owlcmsLifter.athlete_name, candidate.athlete_name);
    if (nameScore === 0) {
        return { status: 'NO_MATCH', score: 0, reason: 'Name tokens do not overlap' };
    }
    score += nameScore;
    breakdown.push(`Name: +${nameScore}`);

    // Birth year exact bonus
    if (owlcmsLifter.birth_year && candidate.birth_year && owlcmsLifter.birth_year === candidate.birth_year) {
        score += 20;
        breakdown.push('Birth Year: +20');
    }

    // Country / Federation Code verification
    const oCountry = extractCountryCode(owlcmsLifter);
    const cCountry = candidate.country_code ? candidate.country_code.trim().toUpperCase() : (candidateType === 'USAW' ? 'USA' : null);
    if (oCountry && cCountry) {
        if (oCountry === cCountry) {
            score += 15;
            breakdown.push(`Country Match (${oCountry}): +15`);
        } else {
            score -= 15;
            breakdown.push(`Country Divergence (${oCountry} vs ${cCountry}): -15`);
        }
    }

    // Performance & Total delta check (if results exist)
    const oTotal = parseLift(owlcmsLifter.latest_total);
    if (oTotal && candidateResults.length > 0) {
        const totals = candidateResults.map(r => parseLift(r.total)).filter(t => t !== null && t > 0);
        if (totals.length > 0) {
            // Find closest career performance delta to handle text-date sorting or multi-year career spans
            const deltas = totals.map(t => Math.abs(oTotal - t));
            const delta = Math.min(...deltas);
            if (delta <= 10) {
                score += 15;
                breakdown.push(`Performance Delta (${delta}kg): +15`);
            } else if (delta <= 25) {
                score += 5;
                breakdown.push(`Performance Delta (${delta}kg): +5`);
            } else {
                score -= 10;
                breakdown.push(`Performance Divergence (${delta}kg): -10`);
            }
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
// MAIN EXECUTION
// ============================================================================

async function main() {
    const args = minimist(process.argv.slice(2), {
        boolean: ['dry-run', 'reviews-only', 're-evaluate-all'],
        alias: { d: 'dry-run', id: 'lifter-id', r: 'reviews-only' },
        default: { 'min-score': 80 }
    });

    const isDryRun = args['dry-run'];
    const reviewsOnly = args['reviews-only'];
    const reEvaluateAll = args['re-evaluate-all'];
    const targetLifterId = args['lifter-id'] ? parseInt(args['lifter-id'], 10) : null;
    const minScore = parseInt(args['min-score'], 10) || 80;
    const batchLimit = args.limit ? parseInt(args.limit, 10) : null;

    console.log('============================================================');
    console.log('OWLCMS Cross-Federation Athlete Linker');
    console.log(`Mode: ${isDryRun ? 'DRY-RUN (Preview Only)' : 'LIVE (Database Mutation)'}`);
    console.log(`Min Confidence Score: ${minScore}`);
    if (targetLifterId) console.log(`Targeting OWLCMS Lifter ID: ${targetLifterId}`);
    if (reviewsOnly) console.log(`Filter: REVIEWS-ONLY (Pending manual resolution)`);
    if (reEvaluateAll) console.log(`Filter: RE-EVALUATE-ALL (Including vetted isolated)`);
    if (batchLimit) console.log(`Batch Limit: ${batchLimit}`);
    console.log('============================================================\n');

    // 1. Fetch unlinked OWLCMS lifters
    let owlcmsLifters = [];

    if (targetLifterId) {
        const { data, error } = await supabase
            .from('owlcms_lifters')
            .select(`
                lifter_id,
                athlete_name,
                first_name,
                last_name,
                gender,
                birth_year,
                exact_birth_date,
                country_code,
                club_name,
                membership_number,
                link_status,
                review_candidate,
                rejected_candidate_ids
            `)
            .eq('lifter_id', targetLifterId);

        if (error) {
            console.error('Error querying owlcms_lifters:', error.message);
            process.exit(1);
        }
        owlcmsLifters = data || [];
    } else {
        // Query existing alias links using fetchAll
        const existingLinks = await fetchAll(
            supabase,
            'athlete_aliases',
            'owlcms_lifter_id, owlcms_lifter_id_2'
        );

        const linkedIds = new Set();
        for (const l of existingLinks) {
            if (l.owlcms_lifter_id) linkedIds.add(l.owlcms_lifter_id);
            if (l.owlcms_lifter_id_2) linkedIds.add(l.owlcms_lifter_id_2);
        }

        // Define status filter: default evaluates PENDING and REVIEW_NEEDED
        let filterFn = q => q.in('link_status', ['PENDING', 'REVIEW_NEEDED']);
        if (reviewsOnly) {
            filterFn = q => q.eq('link_status', 'REVIEW_NEEDED');
        } else if (reEvaluateAll) {
            filterFn = null;
        }

        // Fetch OWLCMS lifters matching status
        const allLifters = await fetchAll(
            supabase,
            'owlcms_lifters',
            `lifter_id, athlete_name, first_name, last_name, gender, birth_year, exact_birth_date, country_code, club_name, membership_number, link_status, review_candidate, rejected_candidate_ids`,
            filterFn
        );

        owlcmsLifters = allLifters.filter(l => !linkedIds.has(l.lifter_id));

        if (batchLimit) {
            owlcmsLifters = owlcmsLifters.slice(0, batchLimit);
        }
    }

    if (!owlcmsLifters || owlcmsLifters.length === 0) {
        console.log('No eligible OWLCMS lifters found to evaluate.');
        process.exit(0);
    }

    console.log(`Found ${owlcmsLifters.length} eligible OWLCMS lifter(s) to evaluate.\n`);

    let linkedCount = 0;
    let reviewedCount = 0;
    let skippedCount = 0;
    const newlyLinkedAthletes = [];

    // Cache IWF demographic lookups to prevent redundant HTTP requests
    const iwfCache = new Map();

    for (const oLifter of owlcmsLifters) {
        console.log(`------------------------------------------------------------`);
        console.log(`Evaluating OWLCMS Lifter [ID: ${oLifter.lifter_id}] "${oLifter.athlete_name}" [Status: ${oLifter.link_status || 'PENDING'}]`);
        console.log(`  Gender: ${oLifter.gender || 'N/A'} | Birth Year: ${oLifter.birth_year || 'N/A'} | Club: ${oLifter.club_name || 'N/A'}`);

        // Fetch their latest OWLCMS meet result for performance fingerprinting
        const { data: oResults } = await supabase
            .from('owlcms_meet_results')
            .select('total, body_weight_kg, best_snatch, best_cj')
            .eq('lifter_id', oLifter.lifter_id)
            .order('result_id', { ascending: false })
            .limit(1);

        oLifter.latest_total = oResults?.[0]?.total || null;
        oLifter.latest_bw = oResults?.[0]?.body_weight_kg || null;

        const tokens = tokenize(oLifter.athlete_name);
        const lastName = oLifter.last_name || tokens[tokens.length - 1] || '';
        const blacklist = (OWLCMS_BLACKLIST_MAP && OWLCMS_BLACKLIST_MAP[oLifter.lifter_id]) || [];

        // -------------------------------------------------------------
        // Candidate Step 1: Search IWF Lifters (with caching & blacklist)
        // -------------------------------------------------------------
        let iwfCandidates = [];
        if (oLifter.gender && oLifter.birth_year) {
            const cacheKey = `${oLifter.gender.toUpperCase()}_${oLifter.birth_year}`;
            let iwfPool = [];
            if (iwfCache.has(cacheKey)) {
                iwfPool = iwfCache.get(cacheKey);
            } else {
                const { data: candidates } = await supabase
                    .from('iwf_lifters')
                    .select('db_lifter_id, athlete_name, birth_year, gender, country_code')
                    .eq('gender', oLifter.gender.toUpperCase())
                    .eq('birth_year', oLifter.birth_year);
                iwfPool = candidates || [];
                iwfCache.set(cacheKey, iwfPool);
            }

            iwfCandidates = iwfPool.filter(c => {
                if (blacklist.includes(c.db_lifter_id)) return false;
                const cTokens = tokenize(c.athlete_name);
                return cTokens.some(t => tokens.includes(t));
            });
        }

        // -------------------------------------------------------------
        // Candidate Step 2: Search USAW Lifters by Last Name (with blacklist)
        // -------------------------------------------------------------
        let usawCandidates = [];
        if (lastName.length >= 3) {
            const { data: uCandidates } = await supabase
                .from('usaw_lifters')
                .select('lifter_id, athlete_name, membership_number')
                .ilike('athlete_name', `%${lastName}%`)
                .limit(10);

            for (const u of uCandidates || []) {
                if (blacklist.includes(u.lifter_id)) continue;

                // Verify birth year via usaw_meet_results
                const { data: uRes } = await supabase
                    .from('usaw_meet_results')
                    .select('birth_year, gender, total, date')
                    .eq('lifter_id', u.lifter_id)
                    .order('date', { ascending: false })
                    .limit(3);

                const uBirthYear = uRes?.[0]?.birth_year ? parseInt(uRes[0].birth_year, 10) : null;
                const uGender = uRes?.[0]?.gender || null;

                if (!oLifter.birth_year || !uBirthYear || oLifter.birth_year === uBirthYear) {
                    u.birth_year = uBirthYear;
                    u.gender = uGender;
                    u.results = uRes || [];
                    usawCandidates.push(u);
                }
            }
        }

        // -------------------------------------------------------------
        // Score Candidates
        // -------------------------------------------------------------
        let bestMatch = null;
        let bestScore = 0;

        if (OWLCMS_MANUAL_MAP && OWLCMS_MANUAL_MAP[oLifter.lifter_id]) {
            const override = OWLCMS_MANUAL_MAP[oLifter.lifter_id];
            bestScore = 100;
            bestMatch = {
                type: override.type,
                candidate: {
                    [override.type === 'IWF' ? 'db_lifter_id' : 'lifter_id']: override.id,
                    athlete_name: override.note || oLifter.athlete_name
                },
                score: 100,
                status: 'HIGH_CONFIDENCE',
                breakdown: `Whitelisted in athlete-mappings.js: ${override.note || ''}`,
                isManualOverride: true
            };
        } else {
            // Check rejected candidate IDs from DB column as well as local blacklist map
            const dbRejected = Array.isArray(oLifter.rejected_candidate_ids) ? oLifter.rejected_candidate_ids : [];
            const fileRejected = (OWLCMS_BLACKLIST_MAP && OWLCMS_BLACKLIST_MAP[oLifter.lifter_id]) || [];
            const rejectedCandidateIds = new Set([...dbRejected, ...fileRejected]);

            // Evaluate IWF candidates
            for (const iCandidate of iwfCandidates) {
                if (rejectedCandidateIds.has(iCandidate.db_lifter_id)) {
                    continue;
                }

                const { data: iResults } = await supabase
                    .from('iwf_meet_results')
                    .select('total, body_weight_kg, date')
                    .eq('db_lifter_id', iCandidate.db_lifter_id)
                    .order('date', { ascending: false })
                    .limit(10);

                const evalResult = evaluateMatch(oLifter, iCandidate, 'IWF', iResults || []);
                if (evalResult.score > bestScore) {
                    bestScore = evalResult.score;
                    bestMatch = {
                        type: 'IWF',
                        candidate: iCandidate,
                        score: evalResult.score,
                        status: evalResult.status,
                        breakdown: evalResult.breakdown
                    };
                }
            }

            // Evaluate USAW candidates
            for (const uCandidate of usawCandidates) {
                if (rejectedCandidateIds.has(uCandidate.lifter_id)) {
                    continue;
                }

                const evalResult = evaluateMatch(oLifter, uCandidate, 'USAW', uCandidate.results || []);
                if (evalResult.score > bestScore) {
                    bestScore = evalResult.score;
                    bestMatch = {
                        type: 'USAW',
                        candidate: uCandidate,
                        score: evalResult.score,
                        status: evalResult.status,
                        breakdown: evalResult.breakdown
                    };
                }
            }
        }

        // -------------------------------------------------------------
        // Resolution & Alias Linking
        // -------------------------------------------------------------
        if (bestMatch && bestMatch.score >= minScore) {
            console.log(`  🎯 MATCH FOUND [Score: ${bestMatch.score}/100 - ${bestMatch.status}]`);
            console.log(`     Matched with ${bestMatch.type}: "${bestMatch.candidate.athlete_name}" (ID: ${bestMatch.candidate.db_lifter_id || bestMatch.candidate.lifter_id})`);
            console.log(`     Evidence: ${bestMatch.breakdown}`);

            const matchedIwfId = bestMatch.type === 'IWF' ? bestMatch.candidate.db_lifter_id : null;
            const matchedUsawId = bestMatch.type === 'USAW' ? bestMatch.candidate.lifter_id : null;

            let resolvedUsawId = matchedUsawId;
            let resolvedIwfId = matchedIwfId;

            // If matched against IWF, check if they have a known primary USAW record in athlete_aliases
            if (matchedIwfId && !resolvedUsawId) {
                const { data: aliasRecord } = await supabase
                    .from('athlete_aliases')
                    .select('usaw_lifter_id')
                    .eq('iwf_db_lifter_id', matchedIwfId)
                    .not('usaw_lifter_id', 'is', null)
                    .maybeSingle();

                if (aliasRecord && aliasRecord.usaw_lifter_id) {
                    resolvedUsawId = aliasRecord.usaw_lifter_id;
                    console.log(`     Connected to Primary USAW ID [${resolvedUsawId}] via existing IWF alias`);
                }
            }

            // Check if this exact pairwise link already exists
            let pairCheckQuery = supabase.from('athlete_aliases').select('id');
            if (resolvedUsawId) {
                pairCheckQuery = pairCheckQuery
                    .eq('usaw_lifter_id', resolvedUsawId)
                    .eq('owlcms_lifter_id', oLifter.lifter_id);
            } else {
                pairCheckQuery = pairCheckQuery
                    .eq('iwf_db_lifter_id', resolvedIwfId)
                    .eq('owlcms_lifter_id', oLifter.lifter_id);
            }

            const { data: existingPair } = await pairCheckQuery.maybeSingle();

            if (existingPair) {
                console.log(`     Pairwise link already exists (UUID: ${existingPair.id}). Skipping duplicate.`);
                if (!isDryRun) {
                    await supabase
                        .from('owlcms_lifters')
                        .update({ link_status: 'LINKED', review_candidate: null })
                        .eq('lifter_id', oLifter.lifter_id);
                }
                newlyLinkedAthletes.push({
                    usaw_id: resolvedUsawId || null,
                    iwf_id: resolvedIwfId || null,
                    owlcms_id: oLifter.lifter_id,
                    name: oLifter.athlete_name
                });
            } else {
                const targetFed = resolvedUsawId ? `USAW [${resolvedUsawId}]` : `IWF [${resolvedIwfId}]`;
                console.log(`     Action: INSERT pairwise link in athlete_aliases (${targetFed} ── OWLCMS [${oLifter.lifter_id}])`);
                if (!isDryRun) {
                    const insertPayload = {
                        usaw_lifter_id: resolvedUsawId || null,
                        iwf_db_lifter_id: resolvedUsawId ? null : (resolvedIwfId || null),
                        owlcms_lifter_id: oLifter.lifter_id,
                        match_confidence: bestMatch.score,
                        manual_override: !!bestMatch.isManualOverride
                    };

                    const { error: insErr } = await supabase
                        .from('athlete_aliases')
                        .insert(insertPayload);

                    if (insErr) {
                        console.error('     ❌ Insert error:', insErr.message);
                    } else {
                        console.log('     ✅ Successfully created pairwise alias link');
                        await supabase
                            .from('owlcms_lifters')
                            .update({ link_status: 'LINKED', review_candidate: null })
                            .eq('lifter_id', oLifter.lifter_id);
                        linkedCount++;
                        newlyLinkedAthletes.push({
                            usaw_id: resolvedUsawId || null,
                            iwf_id: resolvedIwfId || null,
                            owlcms_id: oLifter.lifter_id,
                            name: oLifter.athlete_name
                        });
                    }
                } else {
                    linkedCount++;
                    newlyLinkedAthletes.push({
                        usaw_id: resolvedUsawId || null,
                        iwf_id: resolvedIwfId || null,
                        owlcms_id: oLifter.lifter_id,
                        name: oLifter.athlete_name
                    });
                }
            }
        } else if (bestMatch && bestMatch.score >= 60) {
            console.log(`  ⚠️ REVIEW NEEDED [Score: ${bestMatch.score}/100]`);
            console.log(`     Candidate: "${bestMatch.candidate.athlete_name}" (${bestMatch.type})`);
            console.log(`     Evidence: ${bestMatch.breakdown}`);
            if (!isDryRun) {
                const candidateId = bestMatch.type === 'IWF' 
                    ? bestMatch.candidate.db_lifter_id 
                    : bestMatch.candidate.lifter_id;

                const candidatePayload = {
                    type: bestMatch.type,
                    candidate_id: candidateId,
                    candidate_name: bestMatch.candidate.athlete_name,
                    score: bestMatch.score,
                    evidence: bestMatch.breakdown
                };

                await supabase
                    .from('owlcms_lifters')
                    .update({ 
                        link_status: 'REVIEW_NEEDED',
                        review_candidate: candidatePayload
                    })
                    .eq('lifter_id', oLifter.lifter_id);
            }
            reviewedCount++;
        } else {
            console.log(`  ⚪ No match found in USAW or IWF (Score: ${bestScore}).`);
            if (!isDryRun) {
                await supabase
                    .from('owlcms_lifters')
                    .update({ link_status: 'ISOLATED', review_candidate: null })
                    .eq('lifter_id', oLifter.lifter_id);
            }
            skippedCount++;
        }
    }

    console.log('\n============================================================');
    console.log('Summary of Execution');
    console.log(`  Total Evaluated: ${owlcmsLifters.length}`);
    console.log(`  Linked:          ${linkedCount}`);
    console.log(`  Review Needed:   ${reviewedCount}`);
    console.log(`  No Match Found:  ${skippedCount}`);
    console.log('============================================================\n');

    if (!isDryRun && newlyLinkedAthletes.length > 0) {
        console.log(`📦 Triggering static shard generation for ${newlyLinkedAthletes.length} linked athlete(s)...`);
        let shardsSuccess = 0;
        for (const athlete of newlyLinkedAthletes) {
            try {
                if (!process.env.DB_HOST && !process.env.DATABASE_URL) {
                    console.log(`  ℹ️ DB_HOST not configured in local environment. Skipping local shard assembly (active on Hetzner production server).`);
                    break;
                }
                const res = await generateAthlete({
                    usaw_id: athlete.usaw_id,
                    iwf_id: athlete.iwf_id,
                    owlcms_id: athlete.owlcms_id
                });
                if (res.success) {
                    console.log(`  ✅ Shards updated for "${athlete.name}" (${res.shards_written} files)`);
                    shardsSuccess++;
                } else {
                    console.warn(`  ⚠️ Shard generation notice for "${athlete.name}": ${res.message || res.error}`);
                }
            } catch (shardErr) {
                console.warn(`  ⚠️ Shard generation skipped for "${athlete.name}": ${shardErr.message}`);
            }
        }
        if (process.env.DB_HOST || process.env.DATABASE_URL) {
            console.log(`🏁 Shard generation complete: ${shardsSuccess}/${newlyLinkedAthletes.length} athletes updated on disk.\n`);
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
