#!/usr/bin/env node
/**
 * PRODUCTION: IWF → USAW Athlete Alias Linker
 *
 * Runs automatically after the IWF scraper ingests new results.
 * Scopes the matching algorithm to IWF meets that were updated within
 * the last N days (default: 3), so we only process newly ingested data
 * rather than the full historical corpus.
 *
 * Usage:
 *   node link-new-iwf-athletes.js            # Default: last 3 days
 *   node link-new-iwf-athletes.js --days 7   # Custom lookback window
 *
 * Always runs in execute mode — writes verified aliases directly to athlete_aliases.
 * Exits with code 1 on database errors so the GitHub Actions step fails visibly.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const minimist = require('minimist');
const { MANUAL_ATHLETE_MAP, BLACKLIST_ATHLETE_MAP, IWF_DUPLICATE_MAP, MANUAL_MEET_MAP, OWLCMS_MANUAL_MAP, OWLCMS_BLACKLIST_MAP } = require('../shared/athlete-mappings.js');
const { generateAthlete } = require('./assembler.js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const supabaseIwf = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);


// ============================================================================
// UTILITIES (duplicated from maintenance script for standalone production use)
// ============================================================================

function getDaysDiff(d1, d2) {
    if (!d1 || !d2) return 9999;
    const t1 = new Date(d1).getTime();
    const t2 = new Date(d2).getTime();
    if (isNaN(t1) || isNaN(t2)) return 9999;
    return Math.abs(t1 - t2) / (1000 * 60 * 60 * 24);
}

function tokenize(name) {
    if (!name) return [];
    return name.toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(x => x.length > 2);
}

function tokenizeMeet(name) {
    if (!name) return [];
    return name.toLowerCase().replace(/-/g, ' ').replace(/[^a-z\s]/g, '').split(/\s+/).filter(x => x.length > 2);
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

function calculateNameScoreOwlcms(nameA, nameB) {
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

function parseLift(val) {
    if (!val || val === '---') return 0;
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
}

function parseAttempt(val) {
    if (!val || val === '---' || val === '0') return null;
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return null;
    return num; // Keep negative sign to distinguish makes from misses
}

function hasPhysicsOverlap(iwfResult, usawResult) {
    const slots = [
        [parseAttempt(iwfResult.snatch_lift_1), parseAttempt(usawResult.snatch_lift_1)],
        [parseAttempt(iwfResult.snatch_lift_2), parseAttempt(usawResult.snatch_lift_2)],
        [parseAttempt(iwfResult.snatch_lift_3), parseAttempt(usawResult.snatch_lift_3)],
        [parseAttempt(iwfResult.cj_lift_1), parseAttempt(usawResult.cj_lift_1)],
        [parseAttempt(iwfResult.cj_lift_2), parseAttempt(usawResult.cj_lift_2)],
        [parseAttempt(iwfResult.cj_lift_3), parseAttempt(usawResult.cj_lift_3)],
    ];
    const validSlots = slots.filter(([i, u]) => i !== null && u !== null);
    if (validSlots.length === 0) {
        return parseLift(iwfResult.total) === 0 && parseLift(usawResult.total) === 0;
    }
    if (validSlots.length < 4) {
        return validSlots.every(([i, u]) => i === u);
    }
    return validSlots.filter(([i, u]) => i === u).length >= 4;
}

function getDelta(iA, uA) {
    let tDiff = parseLift(iA.total) - parseLift(uA.total);
    if (parseLift(iA.total) === 0) tDiff = parseLift(iA.best_snatch) - parseLift(uA.best_snatch);
    return Math.abs(tDiff);
}

function evaluateIdentity(iAthlete, uAthlete, isUsaAthlete) {
    // 1. Birth Year Validation (Strict Match Enforced)
    if (iAthlete.birth_year && uAthlete.birth_year && iAthlete.birth_year !== uAthlete.birth_year) {
        return { status: 'NO_MATCH', score: 0 };
    }

    let score = 0;
    const iName = (iAthlete.lifter_name || iAthlete.athlete_name || '').toLowerCase().trim();
    const uName = (uAthlete.lifter_name || uAthlete.athlete_name || '').toLowerCase().trim();
    
    const iwfTokens = tokenize(iAthlete.lifter_name || iAthlete.athlete_name);
    const usawTokens = tokenize(uAthlete.lifter_name || uAthlete.athlete_name);

    // 2. Name Match Scoring
    if (iName === uName && iName.length > 0) {
        score += 80;
    } else {
        const overlap = usawTokens.filter(t => iwfTokens.includes(t));
        
        // Strong naming match (2+ words)
        const strongNameMatch = overlap.length >= 2;
        // Last-name-only match (1 token, specifically the last name)
        const lastNameOnlyMatch = overlap.length === 1 && overlap[0] === usawTokens[usawTokens.length - 1];
        // Weak naming match (1 word, but it's just the first name or middle name)
        const weakNameMatch = overlap.length === 1 && overlap[0] !== usawTokens[usawTokens.length - 1];

        if (strongNameMatch) {
            score += 60;
        } else if (lastNameOnlyMatch) {
            score += 40;
        } else if (weakNameMatch) {
            score += 10;
        } else {
            return { status: 'NO_MATCH', score: 0 };
        }
    }

    // 3. Birth Year Match Bonus
    if (iAthlete.birth_year && uAthlete.birth_year && iAthlete.birth_year === uAthlete.birth_year) {
        score += 20;
    }

    // 4. Physical Lift & Total Verification

    // Compare individual attempts exactly (+5 for match, -10 for mismatch)
    const attempts = [
        [parseAttempt(iAthlete.snatch_lift_1), parseAttempt(uAthlete.snatch_lift_1)],
        [parseAttempt(iAthlete.snatch_lift_2), parseAttempt(uAthlete.snatch_lift_2)],
        [parseAttempt(iAthlete.snatch_lift_3), parseAttempt(uAthlete.snatch_lift_3)],
        [parseAttempt(iAthlete.cj_lift_1),     parseAttempt(uAthlete.cj_lift_1)],
        [parseAttempt(iAthlete.cj_lift_2),     parseAttempt(uAthlete.cj_lift_2)],
        [parseAttempt(iAthlete.cj_lift_3),     parseAttempt(uAthlete.cj_lift_3)],
    ];

    for (const [i, u] of attempts) {
        if (i !== null && u !== null) {
            if (i === u) {
                score += 5;
            } else {
                score -= 10;
            }
        }
    }

    const iTotal = parseLift(iAthlete.total);
    const uTotal = parseLift(uAthlete.total);
    
    // Compare non-zero posted Totals (Exact)
    if (iTotal > 0 && uTotal > 0 && iTotal === uTotal) {
        score += 20;
    }

    const iBestSnatch = parseLift(iAthlete.best_snatch);
    const uBestSnatch = parseLift(uAthlete.best_snatch);
    const iBestCj = parseLift(iAthlete.best_cj);
    const uBestCj = parseLift(uAthlete.best_cj);

    // Compare non-zero best lifts (Exact)
    if (iBestSnatch > 0 && uBestSnatch > 0 && iBestSnatch === uBestSnatch) {
        score += 10;
    }
    if (iBestCj > 0 && uBestCj > 0 && iBestCj === uBestCj) {
        score += 10;
    }

    // Cap score at 100
    score = Math.min(score, 100);

    // 5. Determine status
    if (score >= 100) {
        return { status: 'MATCH', score };
    } else if (score >= 70) {
        return { status: 'AMBIGUOUS', score };
    } else {
        return { status: 'NO_MATCH', score };
    }
}

async function fetchAll(client, table, select, filterCol, filterVal) {
    let allData = [];
    let page = 0;
    while (true) {
        let query = client.from(table).select(select).range(page * 1000, (page + 1) * 1000 - 1);
        if (filterCol) query = query.eq(filterCol, filterVal);
        const { data, error } = await query;
        if (error) { console.error(`fetchAll error on ${table}:`, error.message); break; }
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        page++;
    }
    return allData;
}


// ============================================================================
// MAIN
// ============================================================================

async function run() {
    const args = minimist(process.argv.slice(2), { default: { days: 3 } });
    const isDryRun = args['dry-run'] || args.d || false;
    const isAll = args.all || false;
    const isVerbose = args.verbose || args.v || false;
    const lookbackDays = parseInt(args.days) || 3;
    const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    console.log(`\n[IWF ATHLETE LINKER] Starting production run`);
    if (isDryRun) console.log(`  MODE: DRY RUN (no database writes)`);
    if (isVerbose) console.log(`  VERBOSITY: Verbose logging enabled`);
    console.log(`  Lookback window: ${isAll ? 'ALL (Full Historical Corpus)' : `${lookbackDays} days (since ${cutoffDate.toISOString().split('T')[0]})`}`);

    // Verify credentials
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
        console.error('ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
        process.exit(1);
    }
    // Step 1: Find IWF meets and lifters recently updated (scoped anchor)
    console.log(`\n[1/5] Finding IWF meets updated in ${isAll ? 'full database' : `last ${lookbackDays} days`}...`);
    let recentMeetIds = [];
    let recentLifterIds = [];

    if (isAll) {
        const { data: allMeets } = await supabaseIwf.from('iwf_meets').select('db_meet_id');
        recentMeetIds = (allMeets || []).map(m => m.db_meet_id);
        const allLifters = await fetchAll(supabaseIwf, 'iwf_lifters', 'db_lifter_id');
        recentLifterIds = (allLifters || []).map(l => l.db_lifter_id);
    } else {
        const { data: recentResults, error: recentErr } = await supabaseIwf
            .from('iwf_meet_results')
            .select('db_meet_id, db_lifter_id')
            .gte('updated_at', cutoffDate.toISOString());

        if (recentErr) {
            console.error('ERROR fetching recent IWF results:', recentErr.message);
            process.exit(1);
        }

        recentMeetIds = [...new Set((recentResults || []).map(r => r.db_meet_id))];
        recentLifterIds = [...new Set((recentResults || []).map(r => r.db_lifter_id))];
    }

    if (recentMeetIds.length === 0 && !isAll) {
        console.log('No new IWF meet data found within lookback window. Nothing to link.');
        process.exit(0);
    }

    console.log(`  Found ${recentMeetIds.length} recently updated IWF meets.`);

    // Step 2: Get IWF meet metadata for those meets
    console.log(`\n[2/5] Fetching IWF and USAW meet metadata...`);
    const { data: iwfMeetsData } = await supabaseIwf
        .from('iwf_meets')
        .select('db_meet_id, meet, date')
        .in('db_meet_id', recentMeetIds);

    const iwfMeets = iwfMeetsData || [];

    // Also pull all USAW International meets + manual overrides for event mapping
    const manualUsawIds = Object.values(MANUAL_MEET_MAP).flat();
    const { data: usawMeetsData } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, Date')
        .or(`Level.eq.International,meet_id.in.(${manualUsawIds.join(',')})`);

    const usawMeets = usawMeetsData || [];

    // Step 3: Build meet pairs (same logic as maintenance script)
    console.log(`\n[3/5] Mapping IWF meets to USAW meets...`);
    const meetMapPairs = [];

    for (const iMeet of iwfMeets) {
        const explicitOverrides = MANUAL_MEET_MAP[iMeet.db_meet_id];
        if (explicitOverrides) {
            for (const overrideUsawId of explicitOverrides) {
                const explicitUsaw = usawMeets.find(m => m.meet_id === overrideUsawId);
                if (explicitUsaw) {
                    meetMapPairs.push({
                        iwf_meet_id: iMeet.db_meet_id, iwf_meet_name: iMeet.meet, iwf_date: iMeet.date,
                        usaw_meet_id: explicitUsaw.meet_id, usaw_meet_name: explicitUsaw.Meet, usaw_date: explicitUsaw.Date
                    });
                }
            }
            continue;
        }

        const nearbyUsawMeets = usawMeets.filter(uMeet => getDaysDiff(iMeet.date, uMeet.Date) <= 14);
        const iTokens = tokenizeMeet(iMeet.meet);
        let bestUsaw = null;
        let maxOverlap = 0;
        for (const uMeet of nearbyUsawMeets) {
            const uTokens = tokenizeMeet(uMeet.Meet);
            const overlap = uTokens.filter(t => iTokens.includes(t)).length;
            if (overlap > maxOverlap) { maxOverlap = overlap; bestUsaw = uMeet; }
        }
        if (bestUsaw) {
            meetMapPairs.push({
                iwf_meet_id: iMeet.db_meet_id, iwf_meet_name: iMeet.meet, iwf_date: iMeet.date,
                usaw_meet_id: bestUsaw.meet_id, usaw_meet_name: bestUsaw.Meet, usaw_date: bestUsaw.Date
            });
        }
    }

    console.log(`  Mapped ${meetMapPairs.length} IWF meets to USAW meets.`);

    if (meetMapPairs.length === 0) {
        console.log('None of the recently updated IWF meets could be mapped to a USAW meet. No links to create.');
        process.exit(0);
    }

    // Step 4: Fetch rosters and run triple-lock validation
    console.log(`\n[4/5] Fetching rosters and running physics verification...`);
    const mappedIwfMeetIds = [...new Set(meetMapPairs.map(p => p.iwf_meet_id))];
    const iwfAllMeetResults = [];
    for (let i = 0; i < mappedIwfMeetIds.length; i += 100) {
        const chunk = mappedIwfMeetIds.slice(i, i + 100);
        const { data } = await supabaseIwf.from('iwf_meet_results')
            .select('db_meet_id, db_lifter_id, lifter_name, country_code, birth_year, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total')
            .in('db_meet_id', chunk);
        if (data) iwfAllMeetResults.push(...data);
    }

    const usawTargetMeetIds = [...new Set(meetMapPairs.map(m => m.usaw_meet_id))];
    const usawMeetResults = [];
    for (let i = 0; i < usawTargetMeetIds.length; i += 100) {
        const chunk = usawTargetMeetIds.slice(i, i + 100);
        const { data } = await supabase.from('usaw_meet_results')
            .select('lifter_id, lifter_name, meet_id, birth_year, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total')
            .in('meet_id', chunk);
        if (data) usawMeetResults.push(...data);
    }

    const verifiedAliases = [];
    const ambiguousPairs = [];

    for (const pair of meetMapPairs) {
        const iRoster = iwfAllMeetResults.filter(r => r.db_meet_id === pair.iwf_meet_id);
        const uRoster = usawMeetResults.filter(r => r.meet_id === pair.usaw_meet_id);

        for (const iAthlete of iRoster) {
            // Manual override check
            if (MANUAL_ATHLETE_MAP[iAthlete.db_lifter_id]) {
                const targetUsawId = MANUAL_ATHLETE_MAP[iAthlete.db_lifter_id];
                const overrideTarget = uRoster.find(u => u.lifter_id === targetUsawId);
                if (overrideTarget) {
                    verifiedAliases.push({
                        usaw_lifter_id: overrideTarget.lifter_id,
                        iwf_db_lifter_id: iAthlete.db_lifter_id,
                        match_confidence: 100
                    });
                    continue;
                }
            }

            const isUsaAthlete = iAthlete.country_code === 'USA';
            let possibleIdentities = [];

            for (const uAthlete of uRoster) {
                if (BLACKLIST_ATHLETE_MAP[iAthlete.db_lifter_id]?.includes(uAthlete.lifter_id)) {
                    continue;
                }
                const res = evaluateIdentity(iAthlete, uAthlete, isUsaAthlete);
                if (res.status === 'MATCH') {
                    uAthlete.calculated_score = res.score;
                    possibleIdentities.push(uAthlete);
                } else if (res.status === 'AMBIGUOUS') {
                    ambiguousPairs.push({
                        iAthlete,
                        uAthlete,
                        score: res.score
                    });
                }
            }

            // Resolve ties by physics delta
            if (possibleIdentities.length > 1) {
                possibleIdentities.sort((a, b) => getDelta(iAthlete, a) - getDelta(iAthlete, b));
                if (getDelta(iAthlete, possibleIdentities[0]) < getDelta(iAthlete, possibleIdentities[1])) {
                    possibleIdentities = [possibleIdentities[0]];
                } else {
                    const uniqueIds = new Set(possibleIdentities.map(u => u.lifter_id));
                    if (uniqueIds.size === 1) possibleIdentities = [possibleIdentities[0]];
                }
            }

            if (possibleIdentities.length === 1) {
                verifiedAliases.push({
                    usaw_lifter_id: possibleIdentities[0].lifter_id,
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    match_confidence: possibleIdentities[0].calculated_score
                });
            }
        }
    }

    // --- PHASE 2: GLOBAL FALLBACK FOR RECENTLY UPDATED LIFTERS ---
    console.log(`\n[PHASE 2] Global Fallback Matching (Non-USAW flags & missing events)...`);

    // Extracted matched IDs to avoid checking them
    const securedIwfIds = new Set(verifiedAliases.map(a => a.iwf_db_lifter_id));

    try {
        const existingAliases = await fetchAll(supabase, 'athlete_aliases', 'iwf_db_lifter_id, usaw_lifter_id');
        for (const a of existingAliases) securedIwfIds.add(a.iwf_db_lifter_id);

        const unmatchedRecentIwfIds = recentLifterIds.filter(id => !securedIwfIds.has(id));

        if (unmatchedRecentIwfIds.length > 0) {
            console.log(`  Fetching distinct_usaw_lifters_view for name-subset verification...`);
            const usawViewData = await fetchAll(supabase, 'distinct_usaw_lifters_view', 'lifter_id, lifter_name, birth_year');

            console.log(`  Fetching profiles for ${unmatchedRecentIwfIds.length} unmatched recent IWF athletes...`);
            const unmatchedIwfLifters = [];
            for (let i = 0; i < unmatchedRecentIwfIds.length; i += 1000) {
                const chunk = unmatchedRecentIwfIds.slice(i, i + 1000);
                const { data } = await supabaseIwf.from('iwf_lifters')
                    .select('db_lifter_id, athlete_name, birth_year')
                    .in('db_lifter_id', chunk);
                if (data) unmatchedIwfLifters.push(...data);
            }

            // Group and Pre-tokenize USAW lifters by birth_year to avoid regex inside the inner loop
            const usawByBirthYear = {};
            for (const u of usawViewData) {
                if (!usawByBirthYear[u.birth_year]) usawByBirthYear[u.birth_year] = [];
                usawByBirthYear[u.birth_year].push({ ...u, tokens: tokenize(u.lifter_name) });
            }

            let fallbackMatches = 0;
            for (const iAthlete of unmatchedIwfLifters) {
                if (!iAthlete.birth_year) continue;
                const iTokens = tokenize(iAthlete.athlete_name);
                if (iTokens.length < 2) continue;

                const potentialUsaw = usawByBirthYear[iAthlete.birth_year] || [];
                const candidates = [];

                for (const uAthlete of potentialUsaw) {
                    const uTokens = uAthlete.tokens;
                    if (uTokens.length < 2) continue;

                    // Skip blacklisted pairs
                    if (BLACKLIST_ATHLETE_MAP[iAthlete.db_lifter_id]?.includes(uAthlete.lifter_id)) {
                        continue;
                    }

                    const overlap = uTokens.filter(t => iTokens.includes(t));
                    if (overlap.length === uTokens.length) {
                        candidates.push(uAthlete);
                    }
                }

                if (candidates.length === 1) {
                    const uAthlete = candidates[0];
                    verifiedAliases.push({
                        usaw_lifter_id: uAthlete.lifter_id,
                        iwf_db_lifter_id: iAthlete.db_lifter_id,
                        match_confidence: 90
                    });
                    securedIwfIds.add(iAthlete.db_lifter_id);
                    fallbackMatches++;
                }
            }
            console.log(`  ✓ Phase 2 fallback found ${fallbackMatches} new non-intersecting links!`);
        }
    } catch (err) {
        console.error(`  [ERROR] Fallback matching failed: ${err.message}`);
    }

    // --- PHASE 3: OWLCMS CROSS-FEDERATION MATCHING (IWF ↔ OWLCMS) ---
    console.log(`\n[PHASE 3] OWLCMS Cross-Federation Matching (IWF ↔ OWLCMS)...`);
    const verifiedIwfOwlcmsAliases = [];
    const newlyLinkedOwlcmsAthletes = [];
    const ambiguousOwlcmsPairs = [];

    try {
        // Fetch existing IWF <-> OWLCMS pairwise links
        const existingIwfOwlcmsLinks = await fetchAll(
            supabase,
            'athlete_aliases',
            'iwf_db_lifter_id, owlcms_lifter_id'
        );
        const existingPairSet = new Set(
            existingIwfOwlcmsLinks
                .filter(a => a.iwf_db_lifter_id && a.owlcms_lifter_id)
                .map(a => `${a.iwf_db_lifter_id}-${a.owlcms_lifter_id}`)
        );

        // Fetch all OWLCMS lifters with demographics
        const { data: owlcmsLifters, error: oErr } = await supabase
            .from('owlcms_lifters')
            .select('lifter_id, athlete_name, gender, birth_year, country_code, club_name, link_status, rejected_candidate_ids');

        if (oErr) {
            console.error('  [ERROR] Failed to fetch OWLCMS lifters:', oErr.message);
        } else if (owlcmsLifters && owlcmsLifters.length > 0) {
            // Index OWLCMS lifters by dual demographic anchor: gender_birthYear
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

            // Fetch profiles for IWF lifters in the target cohort
            const iwfTargetProfiles = [];
            for (let i = 0; i < recentLifterIds.length; i += 1000) {
                const chunk = recentLifterIds.slice(i, i + 1000);
                const { data } = await supabaseIwf
                    .from('iwf_lifters')
                    .select('db_lifter_id, athlete_name, birth_year, gender, country_code')
                    .in('db_lifter_id', chunk);
                if (data) iwfTargetProfiles.push(...data);
            }

            let phase3Comparisons = 0;
            let phase3InPool = 0;
            let phase3DemoIsolated = 0;

            for (const iAthlete of iwfTargetProfiles) {
                if (!iAthlete.birth_year || !iAthlete.gender) continue;

                const demoKey = `${iAthlete.gender.toUpperCase()}_${iAthlete.birth_year}`;
                const potentialOwlcms = owlcmsByDemographic.get(demoKey) || [];
                if (potentialOwlcms.length === 0) {
                    phase3DemoIsolated++;
                    if (isVerbose) {
                        console.log(`  ⚪ [IWF ${iAthlete.db_lifter_id}] "${iAthlete.athlete_name}" (${demoKey}): 0 OWLCMS in cohort`);
                    }
                    continue;
                }

                phase3InPool++;
                if (isVerbose) {
                    console.log(`  🔍 [IWF ${iAthlete.db_lifter_id}] "${iAthlete.athlete_name}" (${demoKey}): Comparing against ${potentialOwlcms.length} OWLCMS candidate(s)...`);
                }

                for (const oLifter of potentialOwlcms) {
                    phase3Comparisons++;
                    const pairKey = `${iAthlete.db_lifter_id}-${oLifter.lifter_id}`;
                    if (existingPairSet.has(pairKey)) {
                        if (isVerbose) {
                            console.log(`     ✓ Edge already exists: IWF[${iAthlete.db_lifter_id}] ── OWLCMS[${oLifter.lifter_id}]`);
                        }
                        continue;
                    }

                    // Check manual map and blacklists
                    const blacklist = (OWLCMS_BLACKLIST_MAP && OWLCMS_BLACKLIST_MAP[oLifter.lifter_id]) || [];
                    const dbRejected = Array.isArray(oLifter.rejected_candidate_ids) ? oLifter.rejected_candidate_ids : [];
                    if (blacklist.includes(iAthlete.db_lifter_id) || dbRejected.includes(iAthlete.db_lifter_id)) {
                        if (isVerbose) {
                            console.log(`     ✕ Pair blacklisted: IWF[${iAthlete.db_lifter_id}] ── OWLCMS[${oLifter.lifter_id}]`);
                        }
                        continue;
                    }

                    const manualOverride = OWLCMS_MANUAL_MAP && OWLCMS_MANUAL_MAP[oLifter.lifter_id];
                    const isWhitelisted = manualOverride && manualOverride.type === 'IWF' && manualOverride.id === iAthlete.db_lifter_id;

                    let score = 0;
                    let breakdown = [];

                    if (isWhitelisted) {
                        score = 100;
                        breakdown.push('Manual Whitelist Override');
                    } else {
                        const nameScore = calculateNameScoreOwlcms(iAthlete.athlete_name, oLifter.athlete_name);
                        if (nameScore === 0) continue;
                        score += nameScore;
                        breakdown.push(`Name: +${nameScore}`);

                        // Birth year exact bonus
                        score += 20;
                        breakdown.push('Birth Year: +20');

                        // Country comparison
                        const oCountry = extractCountryCode(oLifter);
                        if (iAthlete.country_code && oCountry) {
                            if (iAthlete.country_code === oCountry) {
                                score += 15;
                                breakdown.push(`Country (${oCountry}): +15`);
                            } else {
                                score -= 15;
                                breakdown.push(`Country Divergence (${iAthlete.country_code} vs ${oCountry}): -15`);
                            }
                        }
                    }

                    const finalScore = Math.min(Math.max(score, 0), 100);

                    if (finalScore >= 80) {
                        console.log(`  🎯 MATCH: IWF[${iAthlete.db_lifter_id}] "${iAthlete.athlete_name}" ── OWLCMS[${oLifter.lifter_id}] "${oLifter.athlete_name}" (Score: ${finalScore})`);
                        console.log(`     Evidence: ${breakdown.join(', ')}`);
                        verifiedIwfOwlcmsAliases.push({
                            usaw_lifter_id: null,
                            iwf_db_lifter_id: iAthlete.db_lifter_id,
                            owlcms_lifter_id: oLifter.lifter_id,
                            match_confidence: finalScore,
                            manual_override: isWhitelisted
                        });
                        existingPairSet.add(pairKey);
                        newlyLinkedOwlcmsAthletes.push({
                            iwf_id: iAthlete.db_lifter_id,
                            owlcms_id: oLifter.lifter_id,
                            name: oLifter.athlete_name
                        });
                    } else if (finalScore >= 60 && oLifter.link_status !== 'LINKED') {
                        console.log(`  ⚠️ REVIEW: IWF[${iAthlete.db_lifter_id}] "${iAthlete.athlete_name}" ── OWLCMS[${oLifter.lifter_id}] "${oLifter.athlete_name}" (Score: ${finalScore})`);
                        ambiguousOwlcmsPairs.push({
                            iAthlete,
                            oLifter,
                            score: finalScore,
                            reason: breakdown.join(', ')
                        });
                        if (!isDryRun) {
                            await supabase
                                .from('owlcms_lifters')
                                .update({
                                    link_status: 'REVIEW_NEEDED',
                                    review_candidate: {
                                        type: 'IWF',
                                        candidate_id: iAthlete.db_lifter_id,
                                        candidate_name: iAthlete.athlete_name,
                                        score: finalScore,
                                        reason: breakdown.join(', ')
                                    }
                                })
                                .eq('lifter_id', oLifter.lifter_id);
                        }
                    } else if (isVerbose) {
                        console.log(`     vs OWLCMS[${oLifter.lifter_id}] "${oLifter.athlete_name}": Score ${finalScore} below review threshold`);
                    }
                }
            }
            console.log(`  ✓ Phase 3 checked ${phase3InPool} IWF lifters in OWLCMS cohorts (${phase3Comparisons} pairwise comparisons).`);
            console.log(`  ✓ Phase 3 found ${verifiedIwfOwlcmsAliases.length} new IWF ↔ OWLCMS pairwise links!`);
        }
    } catch (err) {
        console.error(`  [ERROR] OWLCMS cross-federation matching failed: ${err.message}`);
    }

    // Deduplicate USAW <-> IWF aliases
    const uniqueAliasMap = new Map();
    for (const a of verifiedAliases) {
        const key = `${a.usaw_lifter_id}-${a.iwf_db_lifter_id}`;
        if (!uniqueAliasMap.has(key)) uniqueAliasMap.set(key, a);
    }
    const finalAliases = Array.from(uniqueAliasMap.values());

    console.log(`\n  Verified ${finalAliases.length} new USAW ↔ IWF aliases.`);
    console.log(`  Verified ${verifiedIwfOwlcmsAliases.length} new IWF ↔ OWLCMS aliases.`);

    // --- STAGE AMBIGUOUS CROSS-FEDERATION PAIRS TO ADMIN_REVIEW_QUEUE ---
    const allAmbiguousToStage = [];

    for (const item of ambiguousPairs) {
        allAmbiguousToStage.push({
            category: 'cross_federation',
            status: 'PENDING',
            title: `Borderline Match: IWF[${item.iAthlete.db_lifter_id}] "${item.iAthlete.athlete_name}" ↔ USAW[${item.uAthlete.lifter_id}] "${item.uAthlete.athlete_name}" (Score: ${item.score})`,
            primary_entity_type: 'iwf_lifters',
            primary_entity_id: item.iAthlete.db_lifter_id,
            candidate_entity_type: 'usaw_lifters',
            candidate_entity_id: item.uAthlete.lifter_id,
            confidence_score: item.score,
            evidence: {
                federations: ['IWF', 'USAW'],
                iwf_athlete: {
                    db_lifter_id: item.iAthlete.db_lifter_id,
                    athlete_name: item.iAthlete.athlete_name,
                    country_code: item.iAthlete.country_code
                },
                usaw_athlete: {
                    lifter_id: item.uAthlete.lifter_id,
                    athlete_name: item.uAthlete.athlete_name
                },
                score: item.score,
                detected_at: new Date().toISOString()
            }
        });
    }

    for (const item of ambiguousOwlcmsPairs) {
        allAmbiguousToStage.push({
            category: 'cross_federation',
            status: 'PENDING',
            title: `Borderline Match: IWF[${item.iAthlete.db_lifter_id}] "${item.iAthlete.athlete_name}" ↔ OWLCMS[${item.oLifter.lifter_id}] "${item.oLifter.athlete_name}" (Score: ${item.score})`,
            primary_entity_type: 'iwf_lifters',
            primary_entity_id: item.iAthlete.db_lifter_id,
            candidate_entity_type: 'owlcms_lifters',
            candidate_entity_id: item.oLifter.lifter_id,
            confidence_score: item.score,
            evidence: {
                federations: ['IWF', 'OWLCMS'],
                iwf_athlete: {
                    db_lifter_id: item.iAthlete.db_lifter_id,
                    athlete_name: item.iAthlete.athlete_name,
                    country_code: item.iAthlete.country_code
                },
                owlcms_athlete: {
                    lifter_id: item.oLifter.lifter_id,
                    athlete_name: item.oLifter.athlete_name
                },
                reason: item.reason,
                score: item.score,
                detected_at: new Date().toISOString()
            }
        });
    }

    if (allAmbiguousToStage.length > 0) {
        console.log(`\nStaging ${allAmbiguousToStage.length} ambiguous cross-federation candidates to admin_review_queue...`);
        try {
            const { data: existingQ } = await supabase
                .from('admin_review_queue')
                .select('primary_entity_id, candidate_entity_id')
                .eq('category', 'cross_federation');

            const existingSet = new Set(
                (existingQ || []).map(q => `${q.primary_entity_id}-${q.candidate_entity_id}`)
            );

            const queueRecords = allAmbiguousToStage.filter(
                rec => !existingSet.has(`${rec.primary_entity_id}-${rec.candidate_entity_id}`)
            );

            if (queueRecords.length > 0) {
                if (!isDryRun) {
                    const { error: insErr } = await supabase.from('admin_review_queue').insert(queueRecords);
                    if (insErr) {
                        console.error('  ❌ Error inserting ambiguous cross_federation items:', insErr.message);
                    } else {
                        console.log(`  ✅ Staged ${queueRecords.length} new ambiguous cross_federation pairs into admin_review_queue.`);
                    }
                } else {
                    console.log(`  [DRY RUN] Would stage ${queueRecords.length} new ambiguous cross_federation pairs into admin_review_queue.`);
                }
            } else {
                console.log('  ✓ All ambiguous cross-federation pairs already staged in admin_review_queue.');
            }
        } catch (qErr) {
            console.error('  ⚠️ Error checking/staging ambiguous pairs to admin_review_queue:', qErr.message);
        }
    }

    if (finalAliases.length === 0 && verifiedIwfOwlcmsAliases.length === 0) {
        console.log('No new links found across federations. athlete_aliases unchanged.');
        process.exit(0);
    }

    // Step 5: Upsert into athlete_aliases
    if (finalAliases.length > 0) {
        console.log(`\n[5/5] Inserting ${finalAliases.length} USAW ↔ IWF aliases into athlete_aliases...`);
        if (!isDryRun) {
            const { error: insertError } = await supabase
                .from('athlete_aliases')
                .upsert(finalAliases, { onConflict: 'usaw_lifter_id,iwf_db_lifter_id' });

            if (insertError) {
                console.error('ERROR inserting USAW ↔ IWF aliases:', insertError.message, insertError.code);
                process.exit(1);
            }
            console.log(`✓ Successfully upserted ${finalAliases.length} USAW ↔ IWF athlete aliases.`);
        } else {
            console.log(`[DRY RUN] Would insert ${finalAliases.length} USAW ↔ IWF aliases.`);
        }
    }

    if (verifiedIwfOwlcmsAliases.length > 0) {
        console.log(`\nInserting ${verifiedIwfOwlcmsAliases.length} IWF ↔ OWLCMS pairwise aliases into athlete_aliases...`);
        if (!isDryRun) {
            for (const pair of verifiedIwfOwlcmsAliases) {
                const { error: insErr } = await supabase.from('athlete_aliases').insert(pair);
                if (insErr) {
                    console.error(`  ❌ Error inserting IWF[${pair.iwf_db_lifter_id}] ── OWLCMS[${pair.owlcms_lifter_id}]:`, insErr.message);
                } else {
                    console.log(`  ✅ Inserted pairwise edge: IWF[${pair.iwf_db_lifter_id}] ── OWLCMS[${pair.owlcms_lifter_id}]`);
                }
            }

            // Update OWLCMS lifters link_status
            const linkedOwlcmsIds = [...new Set(newlyLinkedOwlcmsAthletes.map(a => a.owlcms_id))];
            if (linkedOwlcmsIds.length > 0) {
                await supabase
                    .from('owlcms_lifters')
                    .update({ link_status: 'LINKED', review_candidate: null })
                    .in('lifter_id', linkedOwlcmsIds);
            }

            // Trigger static shard generation
            console.log(`\n📦 Triggering static shard generation for ${newlyLinkedOwlcmsAthletes.length} linked athlete(s)...`);
            for (const athlete of newlyLinkedOwlcmsAthletes) {
                try {
                    if (!process.env.DB_HOST && !process.env.DATABASE_URL) break;
                    await generateAthlete({
                        iwf_id: athlete.iwf_id,
                        owlcms_id: athlete.owlcms_id
                    });
                } catch (shardErr) {
                    console.warn(`  ⚠️ Shard generation skipped for "${athlete.name}": ${shardErr.message}`);
                }
            }
        } else {
            console.log(`[DRY RUN] Would insert ${verifiedIwfOwlcmsAliases.length} IWF ↔ OWLCMS pairwise aliases.`);
        }
    }

    console.log('\n[IWF ATHLETE LINKER] Done.\n');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
