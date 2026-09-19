#!/usr/bin/env node
/**
 * PRODUCTION: Scan USAW Name Changes & Marriages
 *
 * Runs as Step 8 in daily_scraper.js to automatically detect when a newly scraped
 * lifter shares a membership number with an existing lifter but under a different surname.
 * Staged candidates land in public.admin_review_queue under category = 'name_change_merge'.
 *
 * Usage:
 *   node scripts/production/scan-usaw-name-changes.js [--dry-run]
 */

require('dotenv').config();
const minimist = require('minimist');
const { createClient } = require('@supabase/supabase-js');

const args = minimist(process.argv.slice(2));
const isDryRun = args['dry-run'] === true;

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
    console.log(`============================================================`);
    console.log(`[USAW NAME CHANGE SCANNER] Dry-Run: ${isDryRun}`);
    console.log(`============================================================\n`);

    console.log('1. Scanning usaw_lifters for shared membership numbers...');
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

    console.log(`   Fetched ${allLifters.length} lifters with membership numbers.`);

    // Group by membership number
    const byMember = new Map();
    for (const l of allLifters) {
        if (!byMember.has(l.membership_number)) byMember.set(l.membership_number, []);
        byMember.get(l.membership_number).push(l);
    }

    const conflictGroups = [];
    for (const [mem, group] of byMember.entries()) {
        const uniqueNames = [...new Set(group.map(g => g.athlete_name.trim().toLowerCase()))];
        if (uniqueNames.length > 1) {
            conflictGroups.push({ membership_number: mem, group });
        }
    }

    console.log(`   Found ${conflictGroups.length} total name conflict groups.`);

    // 2. Check which ones are already in admin_review_queue
    console.log('2. Checking existing admin_review_queue for already staged members...');
    const { data: existing, error: qErr } = await supabase
        .from('admin_review_queue')
        .select('evidence')
        .eq('category', 'name_change_merge');

    if (qErr) {
        console.error('❌ Error reading admin_review_queue:', qErr.message);
        process.exit(1);
    }

    const existingMembers = new Set(
        (existing || [])
            .map(e => e.evidence?.membership_number)
            .filter(Boolean)
    );

    console.log(`   Found ${existingMembers.size} conflict groups already staged in queue.`);

    // 3. Filter for NEW conflict groups
    const newConflicts = conflictGroups.filter(c => !existingMembers.has(c.membership_number));

    if (newConflicts.length === 0) {
        console.log('\n✅ No new unrecorded name conflicts found. Queue is 100% up-to-date.');
        process.exit(0);
    }

    console.log(`\n🎯 Found ${newConflicts.length} NEW unrecorded name conflict(s) to stage!`);

    const recordsToInsert = [];
    for (const item of newConflicts) {
        const group = item.group;
        group.sort((a, b) => a.lifter_id - b.lifter_id);
        const primary = group[0];
        const candidate = group[1];

        recordsToInsert.push({
            category: 'name_change_merge',
            status: 'PENDING',
            title: `Name Change: "${primary.athlete_name}" ↔ "${candidate.athlete_name}" (Member #${item.membership_number})`,
            primary_entity_type: 'usaw_lifters',
            primary_entity_id: primary.lifter_id,
            candidate_entity_type: 'usaw_lifters',
            candidate_entity_id: candidate.lifter_id,
            confidence_score: 95,
            evidence: {
                membership_number: item.membership_number,
                primary_name: primary.athlete_name,
                candidate_name: candidate.athlete_name,
                internal_ids: group.map(g => g.internal_id).filter(Boolean),
                lifter_count: group.length,
                detected_at: new Date().toISOString()
            }
        });
    }

    if (isDryRun) {
        console.log(`[DRY RUN] Would insert ${recordsToInsert.length} new items into admin_review_queue:`);
        console.log(JSON.stringify(recordsToInsert.slice(0, 3), null, 2));
    } else {
        const { error: insErr } = await supabase.from('admin_review_queue').insert(recordsToInsert);
        if (insErr) {
            console.error('❌ Error inserting new review items:', insErr.message);
            process.exit(1);
        }
        console.log(`✅ Successfully inserted ${recordsToInsert.length} new name conflict items into admin_review_queue!`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
