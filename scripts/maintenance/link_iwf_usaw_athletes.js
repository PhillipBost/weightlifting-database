require('dotenv').config();
const { MANUAL_ATHLETE_MAP, BLACKLIST_ATHLETE_MAP, IWF_DUPLICATE_MAP, MANUAL_MEET_MAP } = require('../shared/athlete-mappings.js');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// We need both databases if they are separated. If IWF is in another project, use SUPABASE_IWF_URL
const supabaseIwf = process.env.SUPABASE_IWF_URL 
    ? createClient(process.env.SUPABASE_IWF_URL, process.env.SUPABASE_IWF_SECRET_KEY)
    : supabase;

// --- UTILITIES ---
function getDaysDiff(d1, d2) {
    if (!d1 || !d2) return 9999;
    const t1 = new Date(d1).getTime();
    const t2 = new Date(d2).getTime();
    if (isNaN(t1) || isNaN(t2)) return 9999;
    return Math.abs(t1 - t2) / (1000 * 60 * 60 * 24);
}

function tokenize(name) {
    if (!name) return [];
    // Replace hyphens with spaces
    return name.toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(x => x.length > 2);
}

function tokenizeMeet(name) {
    if (!name) return [];
    // Strip out numbers completely so years like "2016" do not trigger a false match.
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
    return Math.abs(num); // IWF uses negative values for failed attempts; compare magnitude only
}

function hasPhysicsOverlap(iwfResult, usawResult) {
    // Require at least 4 out of 6 individual attempts to match within 1kg.
    // Only count an attempt slot if BOTH sides recorded a non-zero weight for it.
    const slots = [
        [parseAttempt(iwfResult.snatch_lift_1), parseAttempt(usawResult.snatch_lift_1)],
        [parseAttempt(iwfResult.snatch_lift_2), parseAttempt(usawResult.snatch_lift_2)],
        [parseAttempt(iwfResult.snatch_lift_3), parseAttempt(usawResult.snatch_lift_3)],
        [parseAttempt(iwfResult.cj_lift_1),     parseAttempt(usawResult.cj_lift_1)],
        [parseAttempt(iwfResult.cj_lift_2),     parseAttempt(usawResult.cj_lift_2)],
        [parseAttempt(iwfResult.cj_lift_3),     parseAttempt(usawResult.cj_lift_3)],
    ];

    const validSlots = slots.filter(([i, u]) => i !== null && u !== null);

    // Edge case: bomb-out (athlete recorded nothing in either system)
    if (validSlots.length === 0) {
        const iTotal = parseLift(iwfResult.total);
        const uTotal = parseLift(usawResult.total);
        return iTotal === 0 && uTotal === 0;
    }

    // Need at least 4 matched slots, and at least 4 valid slots to compare
    if (validSlots.length < 4) {
        // Fallback: fewer than 4 recorded attempts on either side — require all valid slots to match
        return validSlots.every(([i, u]) => Math.abs(i - u) <= 1);
    }

    const matchedSlots = validSlots.filter(([i, u]) => Math.abs(i - u) <= 1);
    return matchedSlots.length >= 4;
}

function getDelta(iA, uA) {
    let tDiff = parseLift(iA.total) - parseLift(uA.total);
    if (parseLift(iA.total) === 0) tDiff = parseLift(iA.best_snatch) - parseLift(uA.best_snatch);
    return Math.abs(tDiff);
}

function evaluateIdentity(iAthlete, uAthlete, isUsaAthlete) {
    const iwfTokens = tokenize(iAthlete.lifter_name);
    const usawTokens = tokenize(uAthlete.lifter_name);
    
    if (iAthlete.lifter_name.toLowerCase().trim() === uAthlete.lifter_name.toLowerCase().trim()) return "MATCH";

    const overlap = usawTokens.filter(t => iwfTokens.includes(t));
    const physicsMatch = hasPhysicsOverlap(iAthlete, uAthlete);
    
    // Strong naming match (2+ words, or 1 word that is specifically the last name)
    const strongNameMatch = overlap.length >= 2 || (overlap.length === 1 && overlap[0] === usawTokens[usawTokens.length - 1]);
    
    // Weak naming match (1 word, but it's just the first name or middle name)
    const weakNameMatch = overlap.length === 1 && overlap[0] !== usawTokens[usawTokens.length - 1];

    if (strongNameMatch) {
         if (physicsMatch) return "MATCH";
         else return "PHYSICS_FAILED";
    } else if (weakNameMatch) {
         // E.g. Anna Sierra / Anna Rucker (Maiden Name Change)
         if (physicsMatch) return "MATCH";
         else return "NO_MATCH";  // Ignore mismatched random people sharing a first name
    } else if (isUsaAthlete && physicsMatch && parseLift(iAthlete.total) > 0) {
         // ZERO name overlap but PERFECT physical tie.
         // Only flag for USA athletes — for international athletes this is almost certainly a coincidence
         // (hundreds of lifters at a World Championships, lift-value collisions are random noise).
         return "AMBIGUOUS_PHYSICS_ONLY";
    }
    
    return "NO_MATCH";
}

async function fetchAll(client, table, select, filterCol, filterVal) {
    let allData = [];
    let page = 0;
    while (true) {
        let query = client.from(table).select(select).range(page * 1000, (page + 1) * 1000 - 1);
        if (filterCol) query = query.eq(filterCol, filterVal);
        const { data, error } = await query;
        if (error) break;
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        page++;
    }
    return allData;
}


async function run() {
    console.log("Starting Bi-Directional Event & Physics Athlete Mapping...");

    // Step 1: Find all IWF meets that had USA athletes — these are the anchor events we can confidently map.
    // We still use USA athletes as the *anchor* to discover relevant meets, because we trust that
    // if a USAW-registered athlete competed at an IWF meet, USAW also logged that event.
    console.log("\n[PIPELINE 1] Discovering IWF meets via USA athletes (anchor step)...");
    const iwfUsaResultsForDiscovery = await fetchAll(supabaseIwf, 'iwf_meet_results', 'db_meet_id', 'country_code', 'USA');
    
    const iwfTargetMeetIds = [...new Set(iwfUsaResultsForDiscovery.map(r => r.db_meet_id))];
    const { data: iwfMeetsData } = await supabaseIwf.from('iwf_meets').select('db_meet_id, meet, date').in('db_meet_id', iwfTargetMeetIds);
    const iwfMeets = iwfMeetsData || [];

    console.log("[PIPELINE 2] Fetching USAW International Meets (and explicitly mapped anomalies)...");
    const manualUsawIds = Object.values(MANUAL_MEET_MAP).flat();
    
    const { data: usawMeetsData } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, Date')
        .or(`Level.eq.International,meet_id.in.(${manualUsawIds.join(',')})`);
        
    const usawMeets = usawMeetsData || [];

    console.log("\n[EVENT CONFINEMENT] Attempting to map meets based on Date bounds (+/- 14 days)...");
    const meetMapPairs = []; 
    
    for (const iMeet of iwfMeets) {
        // ENFORCE EXPLICIT DOMAIN OVERRIDES FIRST (Support One-To-Many mappings)
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
            continue; // Skip the probabilistic matcher so it doesn't guess wrong!
        }

        const nearbyUsawMeets = usawMeets.filter(uMeet => getDaysDiff(iMeet.date, uMeet.Date) <= 14);
        
        // Tiebreaker: ALWAYS require a fuzzy name intersect using meet tokenization (stripping years)
        const iTokens = tokenizeMeet(iMeet.meet);
        let bestUsaw = null;
        let maxOverlap = 0; // MUST share at least 1 significant non-number word
        for (let uMeet of nearbyUsawMeets) {
            const uTokens = tokenizeMeet(uMeet.Meet);
            const overlap = uTokens.filter(t => iTokens.includes(t)).length;
            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                bestUsaw = uMeet;
            }
        }
        if (bestUsaw) {
            meetMapPairs.push({ 
                iwf_meet_id: iMeet.db_meet_id, iwf_meet_name: iMeet.meet, iwf_date: iMeet.date,
                usaw_meet_id: bestUsaw.meet_id, usaw_meet_name: bestUsaw.Meet, usaw_date: bestUsaw.Date
            });
        }
    }
    console.log(`Successfully mapped ${meetMapPairs.length} overarching events strictly by date and text!`);

    // Step 2: Now fetch ALL athletes (any nationality) from just the mapped IWF meets.
    // This is the scope expansion: we no longer restrict to USA-flagged IWF athletes.
    // Event confinement is our integrity boundary — only athletes physically at the same event are compared.
    console.log("\n[FULL ROSTER FETCH] Fetching all athletes from mapped IWF meets (any nationality)...");
    const mappedIwfMeetIds = [...new Set(meetMapPairs.map(p => p.iwf_meet_id))];
    const iwfAllMeetResults = [];
    for (let i = 0; i < mappedIwfMeetIds.length; i += 100) {
        const chunk = mappedIwfMeetIds.slice(i, i + 100);
        const { data } = await supabaseIwf.from('iwf_meet_results').select('db_meet_id, db_lifter_id, lifter_name, country_code, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total').in('db_meet_id', chunk);
        if (data) iwfAllMeetResults.push(...data);
    }
    console.log(`Loaded ${iwfAllMeetResults.length} IWF results across ${mappedIwfMeetIds.length} meets.`);

    console.log("\n[TRIPLE-LOCK VALIDATION] Checking name overlap AND exact physical lifts inside confined events...");
    
    const usawTargetMeetIds = [...new Set(meetMapPairs.map(m => m.usaw_meet_id))];
    const usawMeetResults = [];
    for (let i = 0; i < usawTargetMeetIds.length; i += 100) {
        const chunk = usawTargetMeetIds.slice(i, i + 100);
        const { data } = await supabase.from('usaw_meet_results').select('lifter_id, lifter_name, meet_id, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total').in('meet_id', chunk);
        if (data) usawMeetResults.push(...data);
    }
    
    const verifiedAliases = [];
    const ambiguousAliases = [];
    const physicsFailedAliases = [];
    const unmatchedAliases = [];
    
    for (const pair of meetMapPairs) {
        const iRoster = iwfAllMeetResults.filter(r => r.db_meet_id === pair.iwf_meet_id);
        const uRoster = usawMeetResults.filter(r => r.meet_id === pair.usaw_meet_id);
        
        for (const iAthlete of iRoster) {
            
            // EXTERNAL OVERRIDE
            if (MANUAL_ATHLETE_MAP[iAthlete.db_lifter_id]) {
                const targetUsawId = MANUAL_ATHLETE_MAP[iAthlete.db_lifter_id];
                const overrideTarget = uRoster.find(u => u.lifter_id === targetUsawId);
                if (overrideTarget) {
                    verifiedAliases.push({
                        usaw_lifter_id: overrideTarget.lifter_id,
                        usaw_name: overrideTarget.lifter_name,
                        iwf_db_lifter_id: iAthlete.db_lifter_id,
                        iwf_name: iAthlete.lifter_name,
                        match_confidence: 100,
                        verification_event: { iwf_meet: pair.iwf_meet_name, usaw_meet: pair.usaw_meet_name },
                        lift_comparison: { iwf_lifts: "MANUAL OVERRIDE", usaw_lifts: "MANUAL OVERRIDE" }
                    });
                    continue; // Lock bypass!
                }
            }

            const isUsaAthlete = iAthlete.country_code === 'USA';

            let possibleIdentities = [];
            let physicallyMismatchedButNameMatched = [];
            let physicsOnlyMatches = [];
            
            for (const uAthlete of uRoster) {
                const status = evaluateIdentity(iAthlete, uAthlete, isUsaAthlete);
                if (status === "MATCH") possibleIdentities.push(uAthlete);
                else if (status === "PHYSICS_FAILED") physicallyMismatchedButNameMatched.push(uAthlete);
                else if (status === "AMBIGUOUS_PHYSICS_ONLY") physicsOnlyMatches.push(uAthlete);
            }
            
            const verificationEventContext = {
                iwf_meet: `${pair.iwf_date} | ${pair.iwf_meet_name} (ID: ${pair.iwf_meet_id})`,
                usaw_meet: `${pair.usaw_date} | ${pair.usaw_meet_name} (ID: ${pair.usaw_meet_id})`
            };

            // Deduplicate and resolve ambiguous math ties (e.g. multiple entries for same athlete, or completely different athletes)
            if (possibleIdentities.length > 1) {
                // Sort by physical delta proximity
                possibleIdentities.sort((a, b) => getDelta(iAthlete, a) - getDelta(iAthlete, b));
                
                // If there's a clear mathematical winner (e.g. 0 delta vs 5 delta), isolate them
                if (getDelta(iAthlete, possibleIdentities[0]) < getDelta(iAthlete, possibleIdentities[1])) {
                    possibleIdentities = [possibleIdentities[0]];
                } else {
                    // Tie exists. Check if they are just the exact same USAW athlete listed twice (duplicates)
                    const uniqueUsawIds = new Set(possibleIdentities.map(u => u.lifter_id));
                    if (uniqueUsawIds.size === 1) {
                        possibleIdentities = [possibleIdentities[0]];
                    }
                }
            }

            if (possibleIdentities.length === 1) {
                const uAthlete = possibleIdentities[0];
                // Skip blacklisted pairs (applies to both Phase 1 and Phase 2)
                if (BLACKLIST_ATHLETE_MAP[iAthlete.db_lifter_id]?.includes(uAthlete.lifter_id)) {
                    unmatchedAliases.push({
                        iwf_country: iAthlete.country_code,
                        iwf_db_lifter_id: iAthlete.db_lifter_id,
                        iwf_name: iAthlete.lifter_name,
                        verification_event: verificationEventContext
                    });
                } else {
                    verifiedAliases.push({
                        iwf_country: iAthlete.country_code,
                        usaw_lifter_id: uAthlete.lifter_id,
                        usaw_name: uAthlete.lifter_name,
                        iwf_db_lifter_id: iAthlete.db_lifter_id,
                        iwf_name: iAthlete.lifter_name,
                        match_confidence: 100,
                        verification_event: verificationEventContext,
                        lift_comparison: {
                            iwf_lifts: `S1:${iAthlete.snatch_lift_1||'--'} S2:${iAthlete.snatch_lift_2||'--'} S3:${iAthlete.snatch_lift_3||'--'} | CJ1:${iAthlete.cj_lift_1||'--'} CJ2:${iAthlete.cj_lift_2||'--'} CJ3:${iAthlete.cj_lift_3||'--'} | Best: ${iAthlete.best_snatch}/${iAthlete.best_cj}/${iAthlete.total}`,
                            usaw_lifts: `S1:${uAthlete.snatch_lift_1||'--'} S2:${uAthlete.snatch_lift_2||'--'} S3:${uAthlete.snatch_lift_3||'--'} | CJ1:${uAthlete.cj_lift_1||'--'} CJ2:${uAthlete.cj_lift_2||'--'} CJ3:${uAthlete.cj_lift_3||'--'} | Best: ${uAthlete.best_snatch}/${uAthlete.best_cj}/${uAthlete.total}`
                        }
                    });
                }
            } else if (possibleIdentities.length > 1) {
                ambiguousAliases.push({
                    iwf_country: iAthlete.country_code,
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    iwf_name: iAthlete.lifter_name,
                    verification_event: verificationEventContext,
                    iwf_lifts: `S1:${iAthlete.snatch_lift_1||'--'} S2:${iAthlete.snatch_lift_2||'--'} S3:${iAthlete.snatch_lift_3||'--'} | CJ1:${iAthlete.cj_lift_1||'--'} CJ2:${iAthlete.cj_lift_2||'--'} CJ3:${iAthlete.cj_lift_3||'--'}`,
                    reason: "Multiple Name+Physics Matches",
                    possible_matches: possibleIdentities.map(u => ({
                        usaw_lifter_id: u.lifter_id, usaw_name: u.lifter_name,
                        usaw_lifts: `S1:${u.snatch_lift_1||'--'} S2:${u.snatch_lift_2||'--'} S3:${u.snatch_lift_3||'--'} | CJ1:${u.cj_lift_1||'--'} CJ2:${u.cj_lift_2||'--'} CJ3:${u.cj_lift_3||'--'}`
                    }))
                });
            } else if (physicsOnlyMatches.length > 0) {
                ambiguousAliases.push({
                    iwf_country: iAthlete.country_code,
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    iwf_name: iAthlete.lifter_name,
                    verification_event: verificationEventContext,
                    iwf_lifts: `S1:${iAthlete.snatch_lift_1||'--'} S2:${iAthlete.snatch_lift_2||'--'} S3:${iAthlete.snatch_lift_3||'--'} | CJ1:${iAthlete.cj_lift_1||'--'} CJ2:${iAthlete.cj_lift_2||'--'} CJ3:${iAthlete.cj_lift_3||'--'}`,
                    reason: "Zero Name Overlap, but Lifts Matched Perfectly",
                    possible_matches: physicsOnlyMatches.map(u => ({
                        usaw_lifter_id: u.lifter_id, usaw_name: u.lifter_name,
                        usaw_lifts: `S1:${u.snatch_lift_1||'--'} S2:${u.snatch_lift_2||'--'} S3:${u.snatch_lift_3||'--'} | CJ1:${u.cj_lift_1||'--'} CJ2:${u.cj_lift_2||'--'} CJ3:${u.cj_lift_3||'--'}`
                    }))
                });
            } else if (physicallyMismatchedButNameMatched.length > 0) {
                physicsFailedAliases.push({
                    iwf_country: iAthlete.country_code,
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    iwf_name: iAthlete.lifter_name,
                    verification_event: verificationEventContext,
                    iwf_lifts: `S1:${iAthlete.snatch_lift_1||'--'} S2:${iAthlete.snatch_lift_2||'--'} S3:${iAthlete.snatch_lift_3||'--'} | CJ1:${iAthlete.cj_lift_1||'--'} CJ2:${iAthlete.cj_lift_2||'--'} CJ3:${iAthlete.cj_lift_3||'--'}`,
                    failed_physics_matches: physicallyMismatchedButNameMatched.map(u => ({
                        usaw_lifter_id: u.lifter_id, usaw_name: u.lifter_name,
                        usaw_lifts: `S1:${u.snatch_lift_1||'--'} S2:${u.snatch_lift_2||'--'} S3:${u.snatch_lift_3||'--'} | CJ1:${u.cj_lift_1||'--'} CJ2:${u.cj_lift_2||'--'} CJ3:${u.cj_lift_3||'--'}`
                    }))
                });
            } else {
                unmatchedAliases.push({
                    iwf_country: iAthlete.country_code,
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    iwf_name: iAthlete.lifter_name,
                    verification_event: verificationEventContext
                });
            }
        }
    }

    // Deduplicate array based on iwf_db_lifter_id if an athlete went to multiple mapped events
    const uniqueAliasMap = new Map();
    for (const a of verifiedAliases) {
        const key = `${a.usaw_lifter_id}-${a.iwf_db_lifter_id}`;
        if (!uniqueAliasMap.has(key)) {
            uniqueAliasMap.set(key, a);
        }
    }
    const finalAliasesToInsert = Array.from(uniqueAliasMap.values());
    const securedIwfIds = new Set(finalAliasesToInsert.map(a => a.iwf_db_lifter_id));

    const finalPhysicsFailed = physicsFailedAliases.filter(a => !securedIwfIds.has(a.iwf_db_lifter_id));
    const finalAmbiguous = ambiguousAliases.filter(a => !securedIwfIds.has(a.iwf_db_lifter_id));
    const finalUnmatched = unmatchedAliases.filter(a => !securedIwfIds.has(a.iwf_db_lifter_id));

    // --- PHASE 2: GLOBAL FALLBACK (NON-USAW FLAGS) ---
    console.log(`\n[PHASE 2] Global Fallback Matching (Non-USAW flags & missing events)...`);
    try {
        const existingAliases = await fetchAll(supabase, 'athlete_aliases', 'iwf_db_lifter_id, usaw_lifter_id');
        const existingIwfSet = new Set(existingAliases.map(a => a.iwf_db_lifter_id));
        for (const a of finalAliasesToInsert) existingIwfSet.add(a.iwf_db_lifter_id);

        console.log(`  Fetching distinct_usaw_lifters_view...`);
        const usawViewData = await fetchAll(supabase, 'distinct_usaw_lifters_view', 'lifter_id, lifter_name, birth_year');
        
        console.log(`  Fetching full IWF roster...`);
        const iwfLifters = await fetchAll(supabaseIwf, 'iwf_lifters', 'db_lifter_id, athlete_name, birth_year, country_code');
        
        const unmatchedIwf = iwfLifters.filter(i => !existingIwfSet.has(i.db_lifter_id) && i.birth_year);
        
        console.log(`  Scanning ${unmatchedIwf.length} unmatched IWF athletes against ${usawViewData.length} USAW combinations...`);
        let fallbackMatches = 0;
        
        // Group and Pre-tokenize USAW lifters by birth_year to avoid regex inside the inner loop
        const usawByBirthYear = {};
        for (const u of usawViewData) {
             if (!usawByBirthYear[u.birth_year]) usawByBirthYear[u.birth_year] = [];
             usawByBirthYear[u.birth_year].push({ ...u, tokens: tokenize(u.lifter_name) });
        }
        
        for (const iAthlete of unmatchedIwf) {
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
                finalAliasesToInsert.push({
                    usaw_lifter_id: uAthlete.lifter_id,
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    match_confidence: 90, // Indicates secondary heuristic match (Name + DOB subset)
                    verification_event: { note: "Phase 2 Fallback: Exact birth_year + identical name token subset" },
                    iwf_country: iAthlete.country_code,
                    usaw_name: uAthlete.lifter_name,
                    iwf_name: iAthlete.athlete_name
                });
                securedIwfIds.add(iAthlete.db_lifter_id);
                fallbackMatches++;
            }
        }
        
        console.log(`  ✓ Phase 2 fallback found ${fallbackMatches} new non-intersecting links!`);
        
        // Purge newly found ones from final physics failed / unmatched lists so they don't pollute diagnostics
        const remP = finalPhysicsFailed.filter(a => !securedIwfIds.has(a.iwf_db_lifter_id));
        finalPhysicsFailed.length = 0; finalPhysicsFailed.push(...remP);
        
        const remA = finalAmbiguous.filter(a => !securedIwfIds.has(a.iwf_db_lifter_id));
        finalAmbiguous.length = 0; finalAmbiguous.push(...remA);

        const remU = finalUnmatched.filter(a => !securedIwfIds.has(a.iwf_db_lifter_id));
        finalUnmatched.length = 0; finalUnmatched.push(...remU);

    } catch (err) {
        console.log(`  [SKIPPED] Fallback matching requires distinct_usaw_lifters_view. Error: ${err.message}`);
    }

    // Split all result arrays by USA vs international for separate diagnostic files
    const split = (arr) => ({
        usa: arr.filter(a => a.iwf_country === 'USA'),
        international: arr.filter(a => a.iwf_country !== 'USA')
    });

    const vSplit = split(finalAliasesToInsert);
    const pfSplit = split(finalPhysicsFailed);
    const aSplit = split(finalAmbiguous);
    const uSplit = split(finalUnmatched);

    console.log(`\nResults: ${finalAliasesToInsert.length} athletes verified (${vSplit.usa.length} USA, ${vSplit.international.length} international).`);
    console.log(`- Physics Failed: ${finalPhysicsFailed.length} (${pfSplit.usa.length} USA, ${pfSplit.international.length} intl)`);
    console.log(`- Ambiguous: ${finalAmbiguous.length} (${aSplit.usa.length} USA, ${aSplit.international.length} intl)`);
    console.log(`- Unmatched/Ghosted: ${finalUnmatched.length} (${uSplit.usa.length} USA, ${uSplit.international.length} intl)`);

    fs.writeFileSync('output/athlete_linking_usa.json', JSON.stringify({
        verified: vSplit.usa,
        name_matched_physics_failed: pfSplit.usa,
        ambiguous: aSplit.usa
    }, null, 2));

    fs.writeFileSync('output/athlete_linking_international.json', JSON.stringify({
        verified: vSplit.international,
        name_matched_physics_failed: pfSplit.international,
        ambiguous: aSplit.international
    }, null, 2));

    console.log('\nOutput written to:');
    console.log('  output/athlete_linking_usa.json');
    console.log('  output/athlete_linking_international.json');

    if (process.argv.includes('--execute')) {
        console.log(`\nExecuting Database Insertion for ${finalAliasesToInsert.length} physically-verified cross-federation aliases...`);
        const { error: insertError } = await supabase
            .from('athlete_aliases')
            .upsert(
                finalAliasesToInsert.map(link => ({
                    usaw_lifter_id: link.usaw_lifter_id,
                    iwf_db_lifter_id: link.iwf_db_lifter_id,
                    match_confidence: link.match_confidence
                })),
                { onConflict: 'usaw_lifter_id,iwf_db_lifter_id' }
            );

        if (insertError) {
            console.error("Failed to insert aliases into Supabase:", insertError);
        } else {
            console.log("Success! athlete_aliases populated.");
        }

        // Upsert IWF Duplicate Identities
        const iwfDuplicates = [];
        for (const [primaryId, duplicates] of Object.entries(IWF_DUPLICATE_MAP)) {
            for (const duplicateId of duplicates) {
                iwfDuplicates.push({
                    usaw_lifter_id: null,
                    iwf_db_lifter_id: parseInt(primaryId),
                    iwf_db_lifter_id_2: duplicateId,
                    match_confidence: 100,
                    manual_override: true
                });
            }
        }

        if (iwfDuplicates.length > 0) {
            console.log(`\nExecuting Database Insertion for ${iwfDuplicates.length} IWF duplicate identities...`);
            for (const dup of iwfDuplicates) {
                await supabase.from('athlete_aliases')
                              .delete()
                              .eq('iwf_db_lifter_id', dup.iwf_db_lifter_id)
                              .eq('iwf_db_lifter_id_2', dup.iwf_db_lifter_id_2);
            }
    
            const { error: dupError } = await supabase
                .from('athlete_aliases')
                .insert(iwfDuplicates);
            
            if (dupError) {
                console.error('ERROR during IWF duplicates insert:', dupError.message);
            } else {
                console.log("Success! IWF identity pairs registered.");
            }
        }
    } else {
        console.log("\nTo inject the verified aliases into the database, append the --execute flag:");
        console.log("node scripts/maintenance/link_iwf_usaw_athletes.js --execute");
    }
}

run();
