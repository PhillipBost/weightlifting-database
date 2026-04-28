const { createClient } = require('@supabase/supabase-js');
const { calculateCompetitionAge, getEligibleDivisions } = require('../shared/division-logic');
const args = require('minimist')(process.argv.slice(2));
require('dotenv').config();

// Initialize Supabase client using working .env credentials
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const DRY_RUN = args['dry-run'] || args.d;
const LIMIT = args.limit || args.l;

/**
 * Generates and persists division rankings for a specific meet.
 * @param {number} meetId - The ID of the meet to process
 */
async function generateDivisionRankings(meetId) {
    console.log(`[RANKING ENGINE] Processing Meet ID: ${meetId}`);
    
    // 1. Fetch results for this meet
    const { data: results, error: fetchError } = await supabase
        .from('usaw_meet_results')
        .select('result_id, lifter_id, best_snatch, best_cj, total, body_weight_kg, gender, birth_year, date, weight_class')
        .eq('meet_id', meetId);
    
    if (fetchError) throw fetchError;
    
    if (!results || results.length === 0) {
        console.log(`[RANKING ENGINE] No results found for meet ${meetId}. Skipping.`);
        return;
    }

    const allRankings = [];

    // 2. Map results to divisions
    const resultsByDivision = {};

    results.forEach(r => {
        const age = calculateCompetitionAge(r.date, r.birth_year);
        const eligibleDivisions = getEligibleDivisions(r.gender, age, r.weight_class);
        
        eligibleDivisions.forEach(div => {
            if (!resultsByDivision[div]) resultsByDivision[div] = {};
            const wc = r.weight_class || 'Unknown';
            if (!resultsByDivision[div][wc]) resultsByDivision[div][wc] = [];
            resultsByDivision[div][wc].push(r);
        });
    });

    // 3. Perform triple-sort ranking for each cohort
    for (const [divName, weightClasses] of Object.entries(resultsByDivision)) {
        for (const [wcName, cohort] of Object.entries(weightClasses)) {
            
            const sortByLift = (liftKey) => {
                return [...cohort].sort((a, b) => {
                    const valA = parseFloat(a[liftKey]) || 0;
                    const valB = parseFloat(b[liftKey]) || 0;
                    if (valB !== valA) return valB - valA;
                    return (parseFloat(a.body_weight_kg) || 999) - (parseFloat(b.body_weight_kg) || 999);
                });
            };

            const snatchSorted = sortByLift('best_snatch');
            const cjSorted = sortByLift('best_cj');
            const totalSorted = sortByLift('total');

            cohort.forEach(r => {
                const sRank = snatchSorted.findIndex(s => s.result_id === r.result_id) + 1;
                const cRank = cjSorted.findIndex(c => c.result_id === r.result_id) + 1;
                const tRank = totalSorted.findIndex(t => t.result_id === r.result_id) + 1;

                // Podium-Only Persistence: Only save if at least one category is Rank 1, 2, or 3
                if (sRank <= 3 || cRank <= 3 || tRank <= 3) {
                    allRankings.push({
                        result_id: r.result_id,
                        athlete_id: r.lifter_id,
                        division_name: divName,
                        snatch_rank: sRank,
                        cj_rank: cRank,
                        total_rank: tRank
                    });
                }
            });
        }
    }

    // 4. Persistence
    if (allRankings.length > 0) {
        if (DRY_RUN) {
            console.log(`[DRY RUN] Would save ${allRankings.length} ranking entries for meet ${meetId}`);
            if (allRankings.length > 0) {
                console.log('    Sample Entries:');
                allRankings.slice(0, 5).forEach(rank => {
                    console.log(`      • Division: ${rank.division_name} (Total Rank: ${rank.total_rank})`);
                });
            }
            return;
        }

        // Clear existing rankings for this meet in chunks to avoid "URI too long" errors
        const resultIds = results.map(r => r.result_id);
        for (let j = 0; j < resultIds.length; j += 100) {
            const idChunk = resultIds.slice(j, j + 100);
            const { error: deleteError } = await supabase
                .from('usaw_division_rankings')
                .delete()
                .in('result_id', idChunk);
            if (deleteError) throw deleteError;
        }

        // Bulk insert in chunks
        const CHUNK_SIZE = 500;
        for (let i = 0; i < allRankings.length; i += CHUNK_SIZE) {
            const chunk = allRankings.slice(i, i + CHUNK_SIZE);
            const { error: insertError } = await supabase
                .from('usaw_division_rankings')
                .insert(chunk);
            
            if (insertError) throw insertError;
        }
        
        console.log(`[RANKING ENGINE] Saved ${allRankings.length} ranking entries for meet ${meetId}`);
    }
}

/**
 * Iterates through all meets and runs the ranking engine.
 */
async function processAllMeets() {
    console.log('[RANKING ENGINE] Starting ranking engine (Supabase Mode)...');
    if (DRY_RUN) console.log('🔍 DRY RUN MODE ENABLED - No database changes will be made.');

    try {
        let query = supabase
            .from('usaw_meets')
            .select('meet_id, Meet')
            .order('Date', { ascending: false });

        if (LIMIT) {
            query = query.limit(LIMIT);
        }

        const { data: meets, error: fetchError } = await query;
        if (fetchError) throw fetchError;
        
        console.log(`[RANKING ENGINE] Processing ${meets.length} meets...`);
        
        for (let i = 0; i < meets.length; i++) {
            const meet = meets[i];
            try {
                process.stdout.write(`[${i+1}/${meets.length}] `);
                await generateDivisionRankings(meet.meet_id);
            } catch (err) {
                console.error(`\n[RANKING ENGINE] Error processing meet ${meet.meet_id} (${meet.Meet}):`, err.message);
            }
        }
        
        console.log(`\n[RANKING ENGINE] PROCESSING COMPLETE.`);
    } catch (err) {
        console.error('[RANKING ENGINE] FATAL ERROR:', err);
    }
}

if (require.main === module) {
    processAllMeets().catch(console.error);
}

module.exports = { generateDivisionRankings, processAllMeets };
