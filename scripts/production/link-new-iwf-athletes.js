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
const { MANUAL_ATHLETE_MAP, BLACKLIST_ATHLETE_MAP, IWF_DUPLICATE_MAP, MANUAL_MEET_MAP } = require('../shared/athlete-mappings.js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const supabaseIwf = process.env.SUPABASE_IWF_URL
    ? createClient(process.env.SUPABASE_IWF_URL, process.env.SUPABASE_IWF_SECRET_KEY)
    : supabase;


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

function parseLift(val) {
    if (!val || val === '---') return 0;
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
}

function parseAttempt(val) {
    if (!val || val === '---' || val === '0') return null;
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return null;
    return Math.abs(num);
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
        return validSlots.every(([i, u]) => Math.abs(i - u) <= 1);
    }
    return validSlots.filter(([i, u]) => Math.abs(i - u) <= 1).length >= 4;
}

function getDelta(iA, uA) {
    let tDiff = parseLift(iA.total) - parseLift(uA.total);
    if (parseLift(iA.total) === 0) tDiff = parseLift(iA.best_snatch) - parseLift(uA.best_snatch);
    return Math.abs(tDiff);
}

function evaluateIdentity(iAthlete, uAthlete, isUsaAthlete) {
    const iwfTokens = tokenize(iAthlete.lifter_name);
    const usawTokens = tokenize(uAthlete.lifter_name);
    if (iAthlete.lifter_name.toLowerCase().trim() === uAthlete.lifter_name.toLowerCase().trim()) return 'MATCH';
    const overlap = usawTokens.filter(t => iwfTokens.includes(t));
    const physicsMatch = hasPhysicsOverlap(iAthlete, uAthlete);
    const strongNameMatch = overlap.length >= 2 || (overlap.length === 1 && overlap[0] === usawTokens[usawTokens.length - 1]);
    const weakNameMatch = overlap.length === 1 && overlap[0] !== usawTokens[usawTokens.length - 1];
    if (strongNameMatch) return physicsMatch ? 'MATCH' : 'PHYSICS_FAILED';
    if (weakNameMatch) return physicsMatch ? 'MATCH' : 'NO_MATCH';
    if (isUsaAthlete && physicsMatch && parseLift(iAthlete.total) > 0) return 'AMBIGUOUS_PHYSICS_ONLY';
    return 'NO_MATCH';
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
    const lookbackDays = parseInt(args.days) || 3;
    const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    console.log(`\n[IWF ATHLETE LINKER] Starting production run`);
    console.log(`  Lookback window: ${lookbackDays} days (since ${cutoffDate.toISOString().split('T')[0]})`);

    // Verify credentials
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
        console.error('ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
        process.exit(1);
    }
    // Step 1: Find IWF meets and lifters recently updated (scoped anchor)
    console.log(`\n[1/5] Finding IWF meets updated in last ${lookbackDays} days...`);
    const { data: recentResults, error: recentErr } = await supabaseIwf
        .from('iwf_meet_results')
        .select('db_meet_id, db_lifter_id')
        .gte('updated_at', cutoffDate.toISOString());

    if (recentErr) {
        console.error('ERROR fetching recent IWF results:', recentErr.message);
        process.exit(1);
    }

    const recentMeetIds = [...new Set((recentResults || []).map(r => r.db_meet_id))];
    const recentLifterIds = [...new Set((recentResults || []).map(r => r.db_lifter_id))];

    if (recentMeetIds.length === 0) {
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
            .select('db_meet_id, db_lifter_id, lifter_name, country_code, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total')
            .in('db_meet_id', chunk);
        if (data) iwfAllMeetResults.push(...data);
    }

    const usawTargetMeetIds = [...new Set(meetMapPairs.map(m => m.usaw_meet_id))];
    const usawMeetResults = [];
    for (let i = 0; i < usawTargetMeetIds.length; i += 100) {
        const chunk = usawTargetMeetIds.slice(i, i + 100);
        const { data } = await supabase.from('usaw_meet_results')
            .select('lifter_id, lifter_name, meet_id, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total')
            .in('meet_id', chunk);
        if (data) usawMeetResults.push(...data);
    }

    const verifiedAliases = [];

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
                if (evaluateIdentity(iAthlete, uAthlete, isUsaAthlete) === 'MATCH') {
                    possibleIdentities.push(uAthlete);
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
                    match_confidence: 100
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

    // Deduplicate
    const uniqueAliasMap = new Map();
    for (const a of verifiedAliases) {
        const key = `${a.usaw_lifter_id}-${a.iwf_db_lifter_id}`;
        if (!uniqueAliasMap.has(key)) uniqueAliasMap.set(key, a);
    }
    const finalAliases = Array.from(uniqueAliasMap.values());

    console.log(`  Verified ${finalAliases.length} new athlete aliases.`);

    if (finalAliases.length === 0) {
        console.log('No new links found. athlete_aliases unchanged.');
        process.exit(0);
    }

    // Step 5: Upsert into athlete_aliases
    console.log(`\n[5/5] Inserting ${finalAliases.length} aliases into athlete_aliases...`);
    const { error: insertError } = await supabase
        .from('athlete_aliases')
        .upsert(finalAliases, { onConflict: 'usaw_lifter_id,iwf_db_lifter_id' });

    if (insertError) {
        console.error('ERROR inserting aliases:', insertError.message, insertError.code);
        process.exit(1);
    }

    console.log(`\n✓ Successfully upserted ${finalAliases.length} athlete aliases.`);
    console.log('[IWF ATHLETE LINKER] Done.\n');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
