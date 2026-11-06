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

function normalizeName(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isDataDefectString(name) {
    const s = (name || '').trim();
    return s.includes('@') || /\d/.test(s);
}

function levenshteinDistance(s1, s2) {
    const m = s1.length, n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}

function isAdjacentTransposition(s1, s2) {
    if (s1.length !== s2.length) return false;
    const diffs = [];
    for (let i = 0; i < s1.length; i++) {
        if (s1[i] !== s2[i]) diffs.push(i);
    }
    return (
        diffs.length === 2 &&
        diffs[1] === diffs[0] + 1 &&
        s1[diffs[0]] === s2[diffs[1]] &&
        s1[diffs[1]] === s2[diffs[0]]
    );
}

function isMinorClericalTypo(nameA, nameB) {
    const cleanA = (nameA || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    const cleanB = (nameB || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!cleanA || !cleanB) return false;
    if (cleanA === cleanB) return true; // Punctuation/spacing difference only (e.g. O'Brien vs Obrien)

    const tokensA = normalizeName(nameA).split(' ');
    const tokensB = normalizeName(nameB).split(' ');
    if (tokensA.length >= 2 && tokensB.length >= 2) {
        const firstA = tokensA[0].replace(/[^a-z]/g, '');
        const firstB = tokensB[0].replace(/[^a-z]/g, '');
        const lastA = tokensA[tokensA.length - 1].replace(/[^a-z]/g, '');
        const lastB = tokensB[tokensB.length - 1].replace(/[^a-z]/g, '');

        if (
            firstA === firstB &&
            lastA.length > 0 &&
            lastB.length > 0 &&
            lastA[0] === lastB[0] &&
            Math.max(lastA.length, lastB.length) >= 6 &&
            (levenshteinDistance(lastA, lastB) === 1 || isAdjacentTransposition(lastA, lastB))
        ) {
            return true;
        }
    }
    return false;
}

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
        if (group.length > 1) {
            conflictGroups.push({ membership_number: mem, group });
        }
    }

    console.log(`   Found ${conflictGroups.length} total member collisions (duplicates, typos, and name changes).`);

    // 2. Check which ones are already in admin_review_queue
    console.log('2. Checking existing admin_review_queue for already staged members...');
    const { data: existing, error: qErr } = await supabase
        .from('admin_review_queue')
        .select('evidence')
        .in('category', ['name_change_merge', 'duplicate_profile', 'data_hygiene_typo']);

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

    console.log(`\n🎯 Found ${newConflicts.length} NEW unrecorded collision(s) to stage!`);

    // Fetch meet dates for conflict lifters to compute authentic chronological boundaries
    const conflictLifterIds = [];
    for (const item of newConflicts) {
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

    const recordsToInsert = [];
    for (const item of newConflicts) {
        const group = item.group;
        group.sort((a, b) => a.lifter_id - b.lifter_id);
        const primary = group[0];
        const pNorm = normalizeName(primary.athlete_name);
        const candidate = group.slice(1).find(g => normalizeName(g.athlete_name) !== pNorm) || group[1];
        const cNorm = normalizeName(candidate.athlete_name);

        const pStat = lifterStats.get(primary.lifter_id) || {};
        const cStat = lifterStats.get(candidate.lifter_id) || {};
        const pEarlier = (pStat.minDate || '9999') <= (cStat.minDate || '9999');
        let former = pEarlier ? primary : candidate;
        let formerStat = pEarlier ? pStat : cStat;
        let canonical = pEarlier ? candidate : primary;
        let canonicalStat = pEarlier ? cStat : pStat;

        let category;
        let title;
        let issueType;
        let displayFormerName;

        if (pNorm === cNorm) {
            category = 'duplicate_profile';
            title = `Duplicate Profile Records: ${canonical.athlete_name.trim()} (Member #${item.membership_number})`;
            issueType = 'duplicate_profile';
            displayFormerName = false;
        } else if (
            isDataDefectString(primary.athlete_name) ||
            isDataDefectString(candidate.athlete_name) ||
            isMinorClericalTypo(primary.athlete_name, candidate.athlete_name)
        ) {
            const pDefect = isDataDefectString(primary.athlete_name);
            const cDefect = isDataDefectString(candidate.athlete_name);
            if (pDefect && !cDefect) {
                former = primary; formerStat = pStat;
                canonical = candidate; canonicalStat = cStat;
            } else if (cDefect && !pDefect) {
                former = candidate; formerStat = cStat;
                canonical = primary; canonicalStat = pStat;
            }

            category = 'data_hygiene_typo';
            title = `Data Hygiene Correction: "${former.athlete_name.trim()}" → "${canonical.athlete_name.trim()}" (Member #${item.membership_number})`;
            issueType = 'data_hygiene_typo';
            displayFormerName = false;
        } else {
            category = 'name_change_merge';
            title = `Name Change: "${former.athlete_name.trim()}" → "${canonical.athlete_name.trim()}" (Member #${item.membership_number})`;
            issueType = 'name_change';
            displayFormerName = true;
        }

        recordsToInsert.push({
            category,
            status: 'PENDING',
            title,
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
                issue_type: issueType,
                display_former_name: displayFormerName,
                detected_at: new Date().toISOString(),
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
