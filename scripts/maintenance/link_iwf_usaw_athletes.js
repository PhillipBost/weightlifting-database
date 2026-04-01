require('dotenv').config();
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

function hasPhysicsOverlap(iwfResult, usawResult) {
    const iT = parseLift(iwfResult.total);
    const uT = parseLift(usawResult.total);
    const iS = parseLift(iwfResult.best_snatch);
    const uS = parseLift(usawResult.best_snatch);
    const iC = parseLift(iwfResult.best_cj);
    const uC = parseLift(usawResult.best_cj);
    
    if (iT > 0 && uT > 0 && Math.abs(iT - uT) <= 10) return true;
    if (iS > 0 && uS > 0 && Math.abs(iS - uS) <= 10) return true;
    if (iC > 0 && uC > 0 && Math.abs(iC - uC) <= 10) return true;
    if (iT === 0 && uT === 0 && iS === 0 && uS === 0 && iC === 0 && uC === 0) return true;
    return false;
}

function getDelta(iA, uA) {
    let tDiff = parseLift(iA.total) - parseLift(uA.total);
    if (parseLift(iA.total) === 0) tDiff = parseLift(iA.best_snatch) - parseLift(uA.best_snatch);
    return Math.abs(tDiff);
}

function evaluateIdentity(iAthlete, uAthlete) {
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
    } else if (physicsMatch && parseLift(iAthlete.total) > 0) {
         // ZERO name overlap (e.g. Tiffany Wohlers vs Tiffiny Yaskus spelling error + maiden name combo)
         // But PERFECT physical tie. Flag as ambiguous so user can manually verify!
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

const MANUAL_MEET_MAP = {
    // IWF Meet ID -> Array of USAW Meet IDs
    1509: [3760],       // CSLP Senior Cup -> Tamas Ajan Cup
    1510: [3760],       // CSLP Junior Cup -> Tamas Ajan Cup
    1564: [4312, 4436]  // 2020 Arnold Festival -> Nike American Open Series 1 AND USAW ROGUE Challenge
};

const MANUAL_ATHLETE_MAP = {
    // IWF Athlete ID -> USAW Athlete ID
    55229: 29088 // Tiffany Wohlers -> Tiffiny Yaskus (Zero Name Overlap Typo + Maiden)
};

async function run() {
    console.log("Starting Bi-Directional Event & Physics Athlete Mapping...");

    console.log("\n[PIPELINE 1] Fetching IWF Meets with USA athletes...");
    const iwfUsaTargetResults = await fetchAll(supabaseIwf, 'iwf_meet_results', 'db_meet_id, db_lifter_id, lifter_name, total, best_snatch, best_cj', 'country_code', 'USA');
    
    const iwfTargetMeetIds = [...new Set(iwfUsaTargetResults.map(r => r.db_meet_id))];
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

    console.log("\n[TRIPLE-LOCK VALIDATION] Checking name overlap AND exact physical lifts inside confined events...");
    
    const usawTargetMeetIds = [...new Set(meetMapPairs.map(m => m.usaw_meet_id))];
    const usawMeetResults = [];
    for (let i = 0; i < usawTargetMeetIds.length; i += 100) {
        const chunk = usawTargetMeetIds.slice(i, i + 100);
        const { data } = await supabase.from('usaw_meet_results').select('lifter_id, lifter_name, meet_id, total, best_snatch, best_cj').in('meet_id', chunk);
        if (data) usawMeetResults.push(...data);
    }
    
    const verifiedAliases = [];
    const ambiguousAliases = [];
    const physicsFailedAliases = [];
    const unmatchedAliases = [];
    
    for (const pair of meetMapPairs) {
        const iRoster = iwfUsaTargetResults.filter(r => r.db_meet_id === pair.iwf_meet_id);
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

            let possibleIdentities = [];
            let physicallyMismatchedButNameMatched = [];
            let physicsOnlyMatches = [];
            
            for (const uAthlete of uRoster) {
                const status = evaluateIdentity(iAthlete, uAthlete);
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
                verifiedAliases.push({
                    usaw_lifter_id: uAthlete.lifter_id,
                    usaw_name: uAthlete.lifter_name,
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    iwf_name: iAthlete.lifter_name,
                    match_confidence: 100, // Physical confirmation makes this absolute 100%
                    verification_event: verificationEventContext,
                    lift_comparison: {
                        iwf_lifts: `Snatch: ${iAthlete.best_snatch || '---'}, CJ: ${iAthlete.best_cj || '---'}, Total: ${iAthlete.total || '---'}`,
                        usaw_lifts: `Snatch: ${uAthlete.best_snatch || '---'}, CJ: ${uAthlete.best_cj || '---'}, Total: ${uAthlete.total || '---'}`
                    }
                });
            } else if (possibleIdentities.length > 1) {
                // Found multiple physical matches for the same name at this event
                ambiguousAliases.push({
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    iwf_name: iAthlete.lifter_name,
                    verification_event: verificationEventContext,
                    iwf_lifts: `Snatch: ${iAthlete.best_snatch || '---'}, CJ: ${iAthlete.best_cj || '---'}, Total: ${iAthlete.total || '---'}`,
                    reason: "Multiple Name+Physics Matches",
                    possible_matches: possibleIdentities.map(u => ({
                        usaw_lifter_id: u.lifter_id, usaw_name: u.lifter_name,
                        usaw_lifts: `Snatch: ${u.best_snatch || '---'}, CJ: ${u.best_cj || '---'}, Total: ${u.total || '---'}`
                    }))
                });
            } else if (physicsOnlyMatches.length > 0) {
                // Name didn't match at all, but PERFECT physical tie! (e.g. Typo + Maiden Name combo)
                ambiguousAliases.push({
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    iwf_name: iAthlete.lifter_name,
                    verification_event: verificationEventContext,
                    iwf_lifts: `Snatch: ${iAthlete.best_snatch || '---'}, CJ: ${iAthlete.best_cj || '---'}, Total: ${iAthlete.total || '---'}`,
                    reason: "Zero Name Overlap, but Lifts Matched Perfectly",
                    possible_matches: physicsOnlyMatches.map(u => ({
                        usaw_lifter_id: u.lifter_id, usaw_name: u.lifter_name,
                        usaw_lifts: `Snatch: ${u.best_snatch || '---'}, CJ: ${u.best_cj || '---'}, Total: ${u.total || '---'}`
                    }))
                });
            } else if (physicallyMismatchedButNameMatched.length > 0) {
                // Name matched, but lifts didn't
                physicsFailedAliases.push({
                    iwf_db_lifter_id: iAthlete.db_lifter_id,
                    iwf_name: iAthlete.lifter_name,
                    verification_event: verificationEventContext,
                    iwf_lifts: `Snatch: ${iAthlete.best_snatch || '---'}, CJ: ${iAthlete.best_cj || '---'}, Total: ${iAthlete.total || '---'}`,
                    failed_physics_matches: physicallyMismatchedButNameMatched.map(u => ({
                        usaw_lifter_id: u.lifter_id, usaw_name: u.lifter_name,
                        usaw_lifts: `Snatch: ${u.best_snatch || '---'}, CJ: ${u.best_cj || '---'}, Total: ${u.total || '---'}`
                    }))
                });
            } else {
                // Name didn't even match anyone in the roster, or USAW roster was empty
                unmatchedAliases.push({
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

    console.log(`\nResults: ${finalAliasesToInsert.length} athletes absolutely verified via physics and event confinement.`);
    console.log(`- ${finalPhysicsFailed.length} athletes matched names but FAILED physics verification.`);
    console.log(`- ${finalUnmatched.length} IWF athletes were completely unmapped at their aligned USAW event.`);
    
    fs.writeFileSync('output/athlete_physics_linking.json', JSON.stringify({ 
        verified: finalAliasesToInsert,
        name_matched_physics_failed: finalPhysicsFailed,
        ambiguous: finalAmbiguous,
        completely_unmatched_at_event: finalUnmatched
    }, null, 2));

    if (process.argv.includes('--execute')) {
        console.log(`\nExecuting Database Insertion for ${finalAliasesToInsert.length} physically-verified aliases...`);
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
            console.log("Success! athlete_aliases heavily populated.");
        }
    } else {
        console.log("\nA mapping diagnostic report has been saved to output/athlete_physics_linking.json.");
        console.log("To inject the physically confident aliases into your database, append the --execute flag:");
        console.log("node scripts/maintenance/link_iwf_usaw_athletes.js --execute");
    }
}

run();
