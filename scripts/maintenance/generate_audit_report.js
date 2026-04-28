require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { MANUAL_ATHLETE_MAP, BLACKLIST_ATHLETE_MAP } = require('../shared/athlete-mappings');

async function run() {
    console.log('Generating CSV audit report...');
    const JSON_PATH = 'output/athlete_linking_international.json';
    if (!fs.existsSync(JSON_PATH)) return console.error('No athlete_linking_international.json found. Run the maintenance script first.');
    
    const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

    // Helper to check if a pairing is already resolved in athlete-mappings.js
    const isAlreadyResolved = (iwfId, usawId, iwfBirthYear, usawBirthYear) => {
        // --- HARD REFUTE: Birth Year Mismatch ---
        // If both have birth years and they don't match, it's a hard NO.
        if (iwfBirthYear && usawBirthYear && Number(iwfBirthYear) !== Number(usawBirthYear)) {
            return true; 
        }

        // Check if manually mapped to this USAW ID
        if (MANUAL_ATHLETE_MAP[iwfId] === usawId) return true;
        
        // Check if blacklisted for this USAW ID
        const blacklist = BLACKLIST_ATHLETE_MAP[iwfId];
        if (blacklist && blacklist.includes(usawId)) return true;
        
        return false;
    };

    // Flatten candidates from ambiguous matches and filter out resolved pairs
    const ambiguousFlattened = (raw.ambiguous || []).flatMap(m => 
        (m.possible_matches || [])
            .filter(cand => !isAlreadyResolved(m.iwf_db_lifter_id, cand.usaw_lifter_id, m.birth_year, cand.birth_year))
            .map(cand => ({
                usaw_lifter_id: cand.usaw_lifter_id,
                usaw_name: cand.usaw_name,
                iwf_db_lifter_id: m.iwf_db_lifter_id,
                iwf_name: m.iwf_name
            }))
    );

    // Flatten candidates from physics failed and filter out resolved pairs
    const failedFlattened = (raw.name_matched_physics_failed || []).flatMap(m => 
        (m.failed_physics_matches || [])
            .filter(cand => !isAlreadyResolved(m.iwf_db_lifter_id, cand.usaw_lifter_id, m.birth_year, cand.birth_year))
            .map(cand => ({
                usaw_lifter_id: cand.usaw_lifter_id,
                usaw_name: cand.usaw_name,
                iwf_db_lifter_id: m.iwf_db_lifter_id,
                iwf_name: m.iwf_name
            }))
    );

    // Combine ALL categories into flat pairs
    // FILTER: Remove anyone already resolved in athlete-mappings.js
    const allMatches = [
        ...(raw.verified || []).map(v => ({
            usaw_lifter_id: v.usaw_lifter_id,
            usaw_name: v.usaw_name,
            iwf_db_lifter_id: v.iwf_db_lifter_id,
            iwf_name: v.iwf_name,
            source_category: 'verified'
        })),
        ...ambiguousFlattened.map(m => ({ ...m, source_category: 'ambiguous' })),
        ...failedFlattened.map(m => ({ ...m, source_category: 'physics_failed' }))
    ].filter(m => !isAlreadyResolved(m.iwf_db_lifter_id, m.usaw_lifter_id));

    console.log(`Loaded ${allMatches.length} unresolved international pairings from athlete_linking_international.json.`);
    const matches = allMatches;
    const csvRows = ['USAW_ID,IWF_ID,IWF_NAME,USAW_NAME,SOURCE,DATE,MEET,WEIGHT_CLASS,BW,BIRTH_YEAR,COMP_AGE,SN1,SN2,SN3,BEST_SN,CJ1,CJ2,CJ3,BEST_CJ,TOTAL,COUNTRY'];
    const esc = (v) => {
        if (v == null) return '';
        v = String(v);
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    };

    console.log(`Processing ${matches.length} matches in batches...`);
    
    const batchSize = 25;
    for (let i = 0; i < matches.length; i += batchSize) {
        const batch = matches.slice(i, i + batchSize);
        const uIds = batch.map(m => m.usaw_lifter_id);
        const iIds = batch.map(m => m.iwf_db_lifter_id);
        
        const [uRes, iRes] = await Promise.all([
            supabase.from('usaw_meet_results')
                .select('lifter_id, date, meet_name, weight_class, body_weight_kg, birth_year, competition_age, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total')
                .in('lifter_id', uIds)
                .order('date', { ascending: true }),
            supabase.from('iwf_meet_results')
                .select('db_lifter_id, weight_class, body_weight_kg, birth_year, competition_age, snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch, cj_lift_1, cj_lift_2, cj_lift_3, best_cj, total, country_code, iwf_meets(date, meet)')
                .in('db_lifter_id', iIds)
        ]);
        
        if (uRes.error) console.error('USAW Fetch Error:', uRes.error.message);
        if (iRes.error) console.error('IWF Fetch Error:', iRes.error.message);
        
        const uData = uRes.data || [];
        const iData = iRes.data || [];
        
        // Create maps for quick lookup
        const uBirthYearMap = Object.fromEntries(uData.map(r => [r.lifter_id, r.birth_year]));
        const iBirthYearMap = Object.fromEntries(iData.map(r => [r.db_lifter_id, r.birth_year]));

        batch.forEach(m => {
            const uId = m.usaw_lifter_id;
            const iId = m.iwf_db_lifter_id;
            const iName = m.iwf_name;
            const uName = m.usaw_name;

            // --- HARD REFUTE: Birth Year Check ---
            const uBirthYear = uBirthYearMap[uId];
            const iBirthYear = iBirthYearMap[iId];
            
            if (uBirthYear && iBirthYear && Number(uBirthYear) !== Number(iBirthYear)) {
                console.log(`   ⏭️  Skipping mismatch: ${iName} (${iBirthYear}) vs ${uName} (${uBirthYear})`);
                return; // Skip this pair entirely
            }
            
            uData.filter(r => r.lifter_id === uId).forEach(r => {
                csvRows.push([
                    uId, iId, iName, uName,
                    'USAW', r.date, r.meet_name, r.weight_class,
                    r.body_weight_kg, r.birth_year, r.competition_age,
                    r.snatch_lift_1, r.snatch_lift_2, r.snatch_lift_3, r.best_snatch,
                    r.cj_lift_1, r.cj_lift_2, r.cj_lift_3, r.best_cj,
                    r.total, 'USA'
                ].map(esc).join(','));
            });
            
            iData.filter(r => r.db_lifter_id === iId).forEach(r => {
                csvRows.push([
                    uId, iId, iName, uName,
                    'IWF', r.iwf_meets?.date, r.iwf_meets?.meet, r.weight_class,
                    r.body_weight_kg, r.birth_year, r.competition_age,
                    r.snatch_lift_1, r.snatch_lift_2, r.snatch_lift_3, r.best_snatch,
                    r.cj_lift_1, r.cj_lift_2, r.cj_lift_3, r.best_cj,
                    r.total, r.country_code
                ].map(esc).join(','));
            });
        });
        
        console.log(`  Processed ${Math.min(i + batchSize, matches.length)} / ${matches.length}...`);
    }

    const outPath = `output/phase2_audit_international_${Date.now()}.csv`;
    fs.writeFileSync(outPath, csvRows.join('\n'));
    console.log(`\nSuccess! CSV written to ${outPath}`);
}

run().catch(console.error);
