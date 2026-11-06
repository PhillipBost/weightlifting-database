#!/usr/bin/env node
/**
 * PRODUCTION: Populate Admin Review Queue
 *
 * Ingests historical data quality candidates into public.admin_review_queue:
 *   1. Homonym Collisions (1,103 collapsed USAW lifters from analysis_output/summary_report.json)
 *   2. Name Changes & Marriages (169 active conflict groups sharing membership numbers in usaw_lifters)
 *   3. IWF Multi-Event Duplicates (14 duplicate pairs from DUPLICATE_DATA_CORRECTION.json)
 *
 * Usage:
 *   node scripts/production/populate-admin-review-queue.js [--dry-run] [--category=homonym_split|name_change_merge|iwf_duplicate]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { createClient } = require('@supabase/supabase-js');

const args = minimist(process.argv.slice(2));
const isDryRun = args['dry-run'] === true;
const targetCategory = args.category || null;
const targetQueueId = args['queue-id'] || null;
const targetAthleteName = args['athlete-name'] || null;

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 100;

/**
 * Queries public.usaw_lifters across the entire table using ILIKE to resolve
 * all existing sibling profiles without truncation.
 */
async function resolveHomonymCandidates(athleteName) {
    const siblings = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, membership_number, internal_id')
            .ilike('athlete_name', athleteName.trim())
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) throw new Error(`Failed to query sibling profiles for "${athleteName}": ${error.message}`);
        if (!data || data.length === 0) break;
        siblings.push(...data);
        if (data.length < PAGE_SIZE) break;
        page++;
    }
    return siblings;
}

/**
 * Reconciles candidate records in split_plan.splits with sibling lifter records from usaw_lifters,
 * ensuring zero truncation of sibling profiles and moving identified scorecards out of unidentifiedCompetitions.
 */
function reconcileSplitPlanWithSiblings(athleteName, splitPlan, siblingLifters) {
    if (!splitPlan) return splitPlan;
    
    // Normalize splits array
    if (!Array.isArray(splitPlan.splits) && splitPlan.membershipGroups) {
        splitPlan.splits = Object.entries(splitPlan.membershipGroups).map(([memNum, comps], idx) => ({
            newAthleteName: `${athleteName} (Person ${idx + 1})`,
            membershipNumber: memNum,
            competitionCount: comps.length,
            competitions: comps.map(c => c.meet_id || c)
        }));
    }

    if (!Array.isArray(splitPlan.splits)) {
        splitPlan.splits = [];
    }

    const matchedLifterIds = new Set();

    // Attach lifter_id to existing candidate splits matching membershipNumber
    for (const split of splitPlan.splits) {
        const memStr = split.membershipNumber ? String(split.membershipNumber).trim() : null;
        if (memStr) {
            const sibling = siblingLifters.find(s => s.membership_number && String(s.membership_number).trim() === memStr);
            if (sibling) {
                split.lifter_id = sibling.lifter_id;
                matchedLifterIds.add(sibling.lifter_id);
            }
        }
    }

    // Append omitted sibling profiles from usaw_lifters
    for (const sibling of siblingLifters) {
        if (!matchedLifterIds.has(sibling.lifter_id)) {
            const memStr = sibling.membership_number ? String(sibling.membership_number).trim() : null;
            splitPlan.splits.push({
                newAthleteName: `${athleteName} (Person ${splitPlan.splits.length + 1})`,
                membershipNumber: memStr,
                lifter_id: sibling.lifter_id,
                competitionCount: 0,
                competitions: []
            });
            matchedLifterIds.add(sibling.lifter_id);
        }
    }

    // Reconcile unidentifiedCompetitions against resolved candidate lifter_ids
    if (Array.isArray(splitPlan.unidentifiedCompetitions) && splitPlan.unidentifiedCompetitions.length > 0) {
        const remainingUnidentified = [];
        for (const card of splitPlan.unidentifiedCompetitions) {
            const cardLifterId = card.lifter_id || null;
            const matchedSplit = splitPlan.splits.find(s => s.lifter_id && cardLifterId && s.lifter_id === cardLifterId);

            if (matchedSplit) {
                const meetId = card.meet_id || card;
                if (!matchedSplit.competitions.includes(meetId)) {
                    matchedSplit.competitions.push(meetId);
                    matchedSplit.competitionCount = matchedSplit.competitions.length;
                }
            } else {
                remainingUnidentified.push(card);
            }
        }
        splitPlan.unidentifiedCompetitions = remainingUnidentified;
    }

    return splitPlan;
}

/**
 * Targeted repair for a single review item in public.admin_review_queue
 */
async function repairTargetedHomonymItem(queueId, athleteName) {
    console.log(`🔧 Running targeted repair for Queue ID: ${queueId || 'N/A'}, Athlete: "${athleteName || 'N/A'}"...`);
    let query = supabase.from('admin_review_queue').select('*').eq('category', 'homonym_split');
    if (queueId) query = query.eq('id', queueId);
    if (athleteName) query = query.ilike('evidence->>athlete_name', athleteName);

    const { data: items, error } = await query;
    if (error) throw new Error(`Failed to fetch target queue item: ${error.message}`);
    if (!items || items.length === 0) {
        console.log('  ⚠️ No matching homonym_split item found.');
        return;
    }

    for (const item of items) {
        const name = item.evidence?.athlete_name || item.title.split('(')[0].trim();
        const siblingLifters = await resolveHomonymCandidates(name);
        console.log(`  Found ${siblingLifters.length} sibling profile(s) in usaw_lifters for "${name}".`);

        const splitPlan = reconcileSplitPlanWithSiblings(name, item.evidence?.split_plan || {}, siblingLifters);
        const updatedEvidence = {
            ...item.evidence,
            distinct_athletes: splitPlan.splits.length,
            split_plan: splitPlan
        };

        if (isDryRun) {
            console.log(`  [DRY RUN] Would update item ${item.id} with ${splitPlan.splits.length} candidates in split_plan.splits.`);
            console.log(JSON.stringify(splitPlan, null, 2));
        } else {
            const { error: updErr } = await supabase
                .from('admin_review_queue')
                .update({
                    title: `${name} (${splitPlan.splits.length} Distinct Athletes Collapsed)`,
                    confidence_score: Math.min(60 + splitPlan.splits.length * 10, 100),
                    evidence: updatedEvidence,
                    updated_at: new Date().toISOString()
                })
                .eq('id', item.id);

            if (updErr) throw new Error(`Failed to update review queue item ${item.id}: ${updErr.message}`);
            console.log(`  ✅ Successfully updated review item ${item.id} with full candidate pool (${splitPlan.splits.length} candidates).`);
        }
    }
}

async function batchInsert(records) {
    if (records.length === 0) return 0;
    if (isDryRun) {
        console.log(`  [DRY RUN] Would insert ${records.length} records.`);
        return records.length;
    }

    let inserted = 0;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('admin_review_queue').insert(batch);
        if (error) {
            console.error(`  ❌ Error inserting batch at ${i}:`, error.message);
        } else {
            inserted += batch.length;
        }
    }
    return inserted;
}

// ----------------------------------------------------------------------------
// 1. INGEST HOMONYM SPLITS (analysis_output/summary_report.json)
// ----------------------------------------------------------------------------
async function ingestHomonymSplits() {
    console.log('\n--- 1. Processing Homonym Collisions (Contaminated Profiles) ---');

    // If targeted repair mode is active for a specific queue item or athlete name
    if (targetQueueId || targetAthleteName) {
        await repairTargetedHomonymItem(targetQueueId, targetAthleteName);
        return;
    }

    const summaryPath = path.join(process.cwd(), 'analysis_output', 'summary_report.json');
    if (!fs.existsSync(summaryPath)) {
        console.warn('  ⚠️ summary_report.json not found in analysis_output/. Skipping.');
        return;
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const requireSplit = (summary.splitDetails || []).filter(d => d.distinctAthletes > 1);
    console.log(`  Found ${requireSplit.length} homonym collision cases in summary report.`);

    const records = [];
    for (const item of requireSplit) {
        const cleanName = item.athleteName.trim();
        const siblingLifters = await resolveHomonymCandidates(cleanName);
        const lifterId = siblingLifters.length > 0 ? siblingLifters[0].lifter_id : 0;

        // Try to load detailed split plan file if present
        let splitDetail = null;
        const safeName = cleanName.replace(/[^a-zA-Z0-9]/g, '_');
        const candidateFiles = fs.readdirSync(path.join(process.cwd(), 'analysis_output'))
            .filter(f => f.startsWith(`athlete_analysis_${safeName}_`));
        
        if (candidateFiles.length > 0) {
            try {
                const fullPath = path.join(process.cwd(), 'analysis_output', candidateFiles[0]);
                const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                splitDetail = raw.splitPlan || raw.analysis;
            } catch (e) {}
        }

        if (splitDetail) {
            splitDetail = reconcileSplitPlanWithSiblings(cleanName, splitDetail, siblingLifters);
        } else if (siblingLifters.length > 1) {
            splitDetail = {
                action: 'SPLIT_REQUIRED',
                originalAthleteName: cleanName,
                splits: siblingLifters.map((sibling, idx) => ({
                    newAthleteName: `${cleanName} (Person ${idx + 1})`,
                    membershipNumber: sibling.membership_number ? String(sibling.membership_number).trim() : null,
                    lifter_id: sibling.lifter_id,
                    competitionCount: 0,
                    competitions: []
                })),
                unidentifiedCompetitions: []
            };
        }

        const distinctCount = splitDetail?.splits?.length || item.distinctAthletes;

        records.push({
            category: 'homonym_split',
            status: 'PENDING',
            title: `${cleanName} (${distinctCount} Distinct Athletes Collapsed)`,
            primary_entity_type: 'usaw_lifters',
            primary_entity_id: lifterId,
            candidate_entity_type: null,
            candidate_entity_id: null,
            confidence_score: Math.min(60 + distinctCount * 10, 100),
            evidence: {
                athlete_name: cleanName,
                distinct_athletes: distinctCount,
                total_competitions: item.totalCompetitions,
                split_plan: splitDetail
            }
        });
    }

    const count = await batchInsert(records);
    console.log(`  ✅ Successfully staged ${count} homonym collision review items.`);
}

// ----------------------------------------------------------------------------
// 2. INGEST NAME CHANGES & MARRIAGES (Shared membership, different names)
// ----------------------------------------------------------------------------
async function ingestNameChanges() {
    console.log('\n--- 2. Processing Name Changes & Marriage Mergers ---');
    console.log('  Scanning usaw_lifters for shared membership numbers with divergent names...');

    let allLifters = [];
    let page = 0;
    const PAGE_SIZE = 10000;
    while (true) {
        const { data, error } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, membership_number, internal_id')
            .not('membership_number', 'is', null)
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (error || !data || data.length === 0) break;
        allLifters.push(...data);
        if (data.length < PAGE_SIZE) break;
        page++;
    }

    const byMember = new Map();
    for (const l of allLifters) {
        if (!byMember.has(l.membership_number)) byMember.set(l.membership_number, []);
        byMember.get(l.membership_number).push(l);
    }

    const conflictGroups = [];
    for (const [mem, group] of byMember.entries()) {
        const uniqueNames = [...new Set(group.map(g => g.athlete_name.trim().toLowerCase()))];
        if (uniqueNames.length > 1) {
            conflictGroups.push({ mem, group });
        }
    }

    // Fetch meet dates for conflict lifters to compute authentic chronological boundaries
    const conflictLifterIds = [];
    for (const item of conflictGroups) {
        conflictLifterIds.push(...item.group.map(g => g.lifter_id));
    }

    const lifterStats = new Map();
    const ID_CHUNK_SIZE = 500;
    for (let i = 0; i < conflictLifterIds.length; i += ID_CHUNK_SIZE) {
        const chunk = conflictLifterIds.slice(i, i + ID_CHUNK_SIZE);
        const { data: meetDates, error: mErr } = await supabase
            .from('usaw_meet_results')
            .select('lifter_id, date')
            .in('lifter_id', chunk)
            .not('date', 'is', null);

        if (!mErr && meetDates) {
            for (const r of meetDates) {
                const d = r.date ? new Date(r.date) : null;
                const year = (d && !isNaN(d.getTime())) ? d.getFullYear() : null;
                if (!lifterStats.has(r.lifter_id)) {
                    lifterStats.set(r.lifter_id, {
                        minDate: r.date,
                        maxDate: r.date,
                        startYear: year,
                        endYear: year,
                        count: 0
                    });
                }
                const s = lifterStats.get(r.lifter_id);
                s.count++;
                if (r.date < s.minDate) { s.minDate = r.date; s.startYear = year; }
                if (r.date > s.maxDate) { s.maxDate = r.date; s.endYear = year; }
            }
        }
    }

    const records = [];
    for (const { mem, group } of conflictGroups) {
        // Sort to have older/lower ID as primary, newer as candidate
        group.sort((a, b) => a.lifter_id - b.lifter_id);
        const primary = group[0];
        const candidate = group[1];

        const pStat = lifterStats.get(primary.lifter_id) || {};
        const cStat = lifterStats.get(candidate.lifter_id) || {};
        const pEarlier = (pStat.minDate || '9999') <= (cStat.minDate || '9999');
        const former = pEarlier ? primary : candidate;
        const formerStat = pEarlier ? pStat : cStat;
        const canonical = pEarlier ? candidate : primary;
        const canonicalStat = pEarlier ? cStat : pStat;

        records.push({
            category: 'name_change_merge',
            status: 'PENDING',
            title: `Name Change: "${primary.athlete_name}" ↔ "${candidate.athlete_name}" (Member #${mem})`,
            primary_entity_type: 'usaw_lifters',
            primary_entity_id: primary.lifter_id,
            candidate_entity_type: 'usaw_lifters',
            candidate_entity_id: candidate.lifter_id,
            confidence_score: 95,
            evidence: {
                membership_number: mem,
                primary_name: primary.athlete_name,
                candidate_name: candidate.athlete_name,
                internal_ids: group.map(g => g.internal_id).filter(Boolean),
                lifter_count: group.length,
                note: 'Athletes share identical USAW membership number with different recorded names (e.g. marriage or spelling variation).',
                timeline: {
                    former_name: former.athlete_name,
                    former_start_year: formerStat.startYear || null,
                    former_end_year: formerStat.endYear || null,
                    canonical_name: canonical.athlete_name,
                    canonical_start_year: canonicalStat.startYear || null,
                    former_meet_count: formerStat.count || 0,
                    canonical_meet_count: canonicalStat.count || 0
                }
            }
        });
    }

    console.log(`  Found ${records.length} active name conflict groups.`);
    const count = await batchInsert(records);
    console.log(`  ✅ Successfully staged ${count} name change review items.`);
}

// ----------------------------------------------------------------------------
// 3. INGEST IWF SAME-MEET DUPLICATES (DUPLICATE_DATA_CORRECTION.json)
// ----------------------------------------------------------------------------
async function ingestIwfDuplicates() {
    console.log('\n--- 3. Processing IWF Multi-Class / Same-Meet Anomalies ---');
    const dupPath = path.join(process.cwd(), 'DUPLICATE_DATA_CORRECTION.json');
    if (!fs.existsSync(dupPath)) {
        console.warn('  ⚠️ DUPLICATE_DATA_CORRECTION.json not found. Skipping.');
        return;
    }

    const dupData = JSON.parse(fs.readFileSync(dupPath, 'utf8'));
    const pairs = dupData.duplicate_pairs || [];
    console.log(`  Found ${pairs.length} duplicate result pairs in JSON.`);

    const records = [];
    for (const p of pairs) {
        records.push({
            category: 'iwf_duplicate',
            status: 'PENDING',
            title: `IWF Same-Meet Duplicate: ${p.athlete_name} (${p.meet_name || `Meet ${p.db_meet_id}`})`,
            primary_entity_type: 'iwf_meet_results',
            primary_entity_id: p.db_lifter_id || 0,
            candidate_entity_type: 'iwf_lifters',
            candidate_entity_id: p.db_lifter_id || 0,
            confidence_score: 90,
            evidence: {
                pair_id: p.pair_id,
                db_meet_id: p.db_meet_id,
                meet_name: p.meet_name,
                athlete_name: p.athlete_name,
                birth_year: p.birth_year,
                note: 'Athlete recorded under multiple weight classes at the exact same international championship.'
            }
        });
    }

    const count = await batchInsert(records);
    console.log(`  ✅ Successfully staged ${count} IWF duplicate review items.`);
}

// ----------------------------------------------------------------------------
// MAIN EXECUTION
// ----------------------------------------------------------------------------
async function main() {
    console.log(`============================================================`);
    console.log(`[ADMIN REVIEW QUEUE POPULATOR] Dry-Run: ${isDryRun}`);
    console.log(`============================================================`);

    if (!targetCategory || targetCategory === 'homonym_split') {
        await ingestHomonymSplits();
    }
    if (!targetCategory || targetCategory === 'name_change_merge') {
        await ingestNameChanges();
    }
    if (!targetCategory || targetCategory === 'iwf_duplicate') {
        await ingestIwfDuplicates();
    }

    console.log(`\n============================================================`);
    console.log(`✅ Queue population complete!`);
    console.log(`============================================================\n`);
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
