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

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 100;

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
    const summaryPath = path.join(process.cwd(), 'analysis_output', 'summary_report.json');
    if (!fs.existsSync(summaryPath)) {
        console.warn('  ⚠️ summary_report.json not found in analysis_output/. Skipping.');
        return;
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const requireSplit = (summary.splitDetails || []).filter(d => d.distinctAthletes > 1);
    console.log(`  Found ${requireSplit.length} homonym collision cases in summary report.`);

    // Pre-fetch usaw_lifters map by athlete_name
    console.log('  Fetching matching lifter_ids from usaw_lifters...');
    const nameSet = new Set(requireSplit.map(s => s.athleteName.toLowerCase().trim()));
    
    // Query in chunks
    const namesArray = Array.from(nameSet);
    const lifterMap = new Map();
    for (let i = 0; i < namesArray.length; i += 200) {
        const chunk = namesArray.slice(i, i + 200);
        const { data: lifters } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, membership_number, internal_id')
            .in('athlete_name', chunk);
        for (const l of lifters || []) {
            const key = l.athlete_name.toLowerCase().trim();
            if (!lifterMap.has(key)) lifterMap.set(key, l.lifter_id);
        }
    }

    const records = [];
    for (const item of requireSplit) {
        const cleanName = item.athleteName.trim();
        const lifterId = lifterMap.get(cleanName.toLowerCase()) || 0;

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

        records.push({
            category: 'homonym_split',
            status: 'PENDING',
            title: `${cleanName} (${item.distinctAthletes} Distinct Athletes Collapsed)`,
            primary_entity_type: 'usaw_lifters',
            primary_entity_id: lifterId,
            candidate_entity_type: null,
            candidate_entity_id: null,
            confidence_score: Math.min(60 + item.distinctAthletes * 10, 100),
            evidence: {
                athlete_name: cleanName,
                distinct_athletes: item.distinctAthletes,
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

    const records = [];
    for (const [mem, group] of byMember.entries()) {
        const uniqueNames = [...new Set(group.map(g => g.athlete_name.trim().toLowerCase()))];
        if (uniqueNames.length > 1) {
            // Sort to have older/lower ID as primary, newer as candidate
            group.sort((a, b) => a.lifter_id - b.lifter_id);
            const primary = group[0];
            const candidate = group[1];

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
                    note: 'Athletes share identical USAW membership number with different recorded names (e.g. marriage or spelling variation).'
                }
            });
        }
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
