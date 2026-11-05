#!/usr/bin/env node
/**
 * PRODUCTION: Execute Approved Homonym Splits
 *
 * Consumes approved review items from public.admin_review_queue (category = 'homonym_split', status = 'APPROVED'),
 * executing the triage split plan:
 *   1. Identifies or provisions distinct public.usaw_lifters records for Persons 1..N.
 *   2. Reassigns confirmed scorecards from splits[i].competitions to the designated lifter_id.
 *   3. Reassigns triaged scorecards from unidentifiedCompetitions based on assigned_membership / assigned_to.
 *   4. Enqueues all involved lifter_ids into public.athlete_shard_queue to trigger static shard regeneration.
 *   5. Finalizes the queue record status to 'RESOLVED' with comprehensive execution metrics.
 *
 * Usage:
 *   node scripts/production/execute-approved-homonym-splits.js [--dry-run] [--queue-id=<id>] [--limit=<n>]
 */

require('dotenv').config();
const minimist = require('minimist');
const { createClient } = require('@supabase/supabase-js');

const args = minimist(process.argv.slice(2));
const isDryRun = args['dry-run'] === true || args.d === true;
const targetQueueId = args['queue-id'] ? parseInt(args['queue-id'], 10) : null;
const batchLimit = args.limit ? parseInt(args.limit, 10) : 50;

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Clean athlete name by stripping synthetic "(Person X)" tags if present
 */
function sanitizeAthleteName(rawName) {
    if (!rawName) return '';
    return rawName.replace(/\s*\(Person\s*\d+\)\s*$/i, '').trim();
}

/**
 * Execute a single approved split plan
 */
async function executeSplit(queueItem) {
    const queueId = queueItem.id;
    const collapsedLifterId = typeof queueItem.primary_entity_id === 'number' ? queueItem.primary_entity_id : 0;
    const evidence = queueItem.evidence || {};
    const splitPlan = evidence.split_plan;

    if (!splitPlan || !Array.isArray(splitPlan.splits) || splitPlan.splits.length < 2) {
        throw new Error(`Queue ID ${queueId} split_plan is missing or has fewer than 2 candidate splits.`);
    }

    const originalAthleteName = sanitizeAthleteName(
        splitPlan.originalAthleteName || evidence.athlete_name || queueItem.title
    );

    // Resolve donor / anchor lifter ID holding scorecards
    let donorLifterId = evidence.anchor_lifter_id || (collapsedLifterId > 0 ? collapsedLifterId : null);

    console.log(`\n================================================================`);
    console.log(`⚙️  Executing Homonym Split for: "${originalAthleteName}"`);
    console.log(`   Queue ID:             ${queueId}`);
    console.log(`   Collapsed Lifter ID:  ${collapsedLifterId}`);
    console.log(`   Anchor Lifter ID:     ${donorLifterId || 'Unresolved'}`);
    console.log(`   Distinct Persons:     ${splitPlan.splits.length}`);
    console.log(`   Approved By:          ${queueItem.resolved_by || 'Admin'}`);
    console.log(`   Mode:                 ${isDryRun ? 'DRY-RUN (Simulate Only)' : 'LIVE EXECUTION'}`);
    console.log(`================================================================`);

    const targetLifterIds = [];
    const executionDetails = [];

    // Step 1: Resolve or provision distinct usaw_lifters records for Persons 1..N
    for (let i = 0; i < splitPlan.splits.length; i++) {
        const person = splitPlan.splits[i];
        const memNum = person.membershipNumber ? String(person.membershipNumber).trim() : null;
        let targetId = person.lifter_id || null;

        if (i === 0) {
            // Person 1: If collapsedLifterId > 0, retain it as canonical Person 1
            if (!targetId && collapsedLifterId > 0) {
                targetId = collapsedLifterId;
            }

            // Fallback: Check if usaw_lifters already has a record for Person 1
            if (!targetId && memNum) {
                const { data: lookup1 } = await supabase
                    .from('usaw_lifters')
                    .select('lifter_id')
                    .eq('athlete_name', originalAthleteName)
                    .eq('membership_number', memNum)
                    .limit(1);

                if (lookup1 && lookup1.length > 0) {
                    targetId = lookup1[0].lifter_id;
                }
            }

            if (!targetId && donorLifterId) {
                targetId = donorLifterId;
            }

            if (targetId && memNum && !isDryRun) {
                await supabase
                    .from('usaw_lifters')
                    .update({
                        membership_number: memNum,
                        athlete_name: originalAthleteName,
                        updated_at: new Date().toISOString()
                    })
                    .eq('lifter_id', targetId);
            }

            if (!targetId) {
                if (isDryRun) {
                    targetId = 'SIMULATED_NEW_LIFTER_P1';
                } else {
                    const { data: insertRes1, error: insertErr1 } = await supabase
                        .from('usaw_lifters')
                        .insert({
                            athlete_name: originalAthleteName,
                            membership_number: memNum,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        })
                        .select('lifter_id')
                        .single();

                    if (insertErr1) throw new Error(`Failed to create lifter for Person 1: ${insertErr1.message}`);
                    targetId = insertRes1.lifter_id;
                }
            }

            if (!donorLifterId && typeof targetId === 'number') {
                donorLifterId = targetId;
            }
            console.log(`  👤 Person 1 (Index 0): Resolved primary lifter_id ${targetId} (Member #: ${memNum || 'N/A'})`);
        } else {
            // Person 2..N: Check if an existing row matches this person, or insert a new one
            if (!targetId && memNum) {
                const { data: lookup } = await supabase
                    .from('usaw_lifters')
                    .select('lifter_id')
                    .eq('athlete_name', originalAthleteName)
                    .eq('membership_number', memNum)
                    .limit(1);

                if (lookup && lookup.length > 0) {
                    targetId = lookup[0].lifter_id;
                    console.log(`  👤 Person ${i + 1} (Index ${i}): Found existing lifter_id ${targetId} (Member #: ${memNum})`);
                }
            }

            // If no record exists yet for Person N, insert a new usaw_lifters row
            if (!targetId) {
                if (isDryRun) {
                    targetId = `SIMULATED_NEW_LIFTER_P${i + 1}`;
                    console.log(`  👤 Person ${i + 1} (Index ${i}): [DRY RUN] Would create new usaw_lifters row for Member #: ${memNum || 'N/A'}`);
                } else {
                    const { data: insertRes, error: insertErr } = await supabase
                        .from('usaw_lifters')
                        .insert({
                            athlete_name: originalAthleteName,
                            membership_number: memNum,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        })
                        .select('lifter_id')
                        .single();

                    if (insertErr) throw new Error(`Failed to create lifter for Person ${i + 1}: ${insertErr.message}`);
                    targetId = insertRes.lifter_id;
                    console.log(`  👤 Person ${i + 1} (Index ${i}): Created new lifter_id ${targetId} (Member #: ${memNum || 'N/A'})`);
                }
            }
        }

        targetLifterIds.push(targetId);
        executionDetails.push({
            person_index: i + 1,
            split_index: i,
            membership_number: memNum,
            lifter_id: targetId,
            confirmed_meets_reassigned: 0,
            triaged_meets_reassigned: 0
        });
    }

    // Step 2: Reassign confirmed competitions from splits[i].competitions or splits[i].meets
    for (let i = 0; i < splitPlan.splits.length; i++) {
        const targetId = targetLifterIds[i];
        const rawMeets = splitPlan.splits[i].competitions || splitPlan.splits[i].meets || [];
        const competitions = rawMeets.map(m => typeof m === 'object' && m ? m.meet_id : m).filter(Boolean);

        if (competitions.length > 0) {
            if (targetId === donorLifterId) {
                executionDetails[i].confirmed_meets_reassigned = competitions.length;
                console.log(`  📦 Person ${i + 1} (lifter_id: ${targetId}): Retains ${competitions.length} confirmed meet results on anchor lifter.`);
                continue;
            }

            if (isDryRun) {
                executionDetails[i].confirmed_meets_reassigned = competitions.length;
                console.log(`  📦 Person ${i + 1} (lifter_id: ${targetId}): [DRY RUN] Would reassign ${competitions.length} confirmed meet results from donor ${donorLifterId || 'anchor'}.`);
            } else {
                let updateQuery = supabase
                    .from('usaw_meet_results')
                    .update({
                        lifter_id: targetId,
                        updated_at: new Date().toISOString()
                    })
                    .in('meet_id', competitions);

                if (donorLifterId) {
                    updateQuery = updateQuery.eq('lifter_id', donorLifterId);
                } else {
                    updateQuery = updateQuery.ilike('lifter_name', originalAthleteName);
                }

                const { data: updated, error: updateErr } = await updateQuery.select('result_id');
                if (updateErr) throw new Error(`Failed to reassign confirmed meets for Person ${i + 1}: ${updateErr.message}`);
                const count = updated ? updated.length : 0;
                executionDetails[i].confirmed_meets_reassigned = count;
                console.log(`  📦 Person ${i + 1} (lifter_id: ${targetId}): Assigned ${count} confirmed meet results.`);
            }
        }
    }

    // Step 3: Reassign triaged scorecards from unidentifiedCompetitions
    const unidentifiedCompetitions = splitPlan.unidentifiedCompetitions || [];
    let triagedTotalMoved = 0;

    for (const card of unidentifiedCompetitions) {
        let assignedSplitIndex = -1;

        // Resolve by assigned_membership first
        if (card.assigned_membership) {
            const targetMem = String(card.assigned_membership).trim();
            assignedSplitIndex = splitPlan.splits.findIndex(
                s => s.membershipNumber && String(s.membershipNumber).trim() === targetMem
            );
        }

        // Fallback to assigned_to (0-based) or assigned_person (1-based)
        if (assignedSplitIndex === -1) {
            if (typeof card.assigned_to === 'number' && card.assigned_to >= 0 && card.assigned_to < splitPlan.splits.length) {
                assignedSplitIndex = card.assigned_to;
            } else if (typeof card.assigned_person === 'number' && card.assigned_person >= 1 && card.assigned_person <= splitPlan.splits.length) {
                assignedSplitIndex = card.assigned_person - 1;
            }
        }

        if (assignedSplitIndex >= 0) {
            const targetId = targetLifterIds[assignedSplitIndex];
            const meetId = card.meet_id;
            const meetDate = card.date || null;

            if (targetId === donorLifterId) {
                if (isDryRun) {
                    console.log(`  🎯 [DRY RUN] Scorecard Meet ${meetId} assigned to anchor Person ${assignedSplitIndex + 1} (lifter_id: ${targetId}); no movement required.`);
                } else {
                    console.log(`  🎯 Scorecard Meet ${meetId} assigned to anchor Person ${assignedSplitIndex + 1} (lifter_id: ${targetId}); retained on anchor.`);
                }
                executionDetails[assignedSplitIndex].triaged_meets_reassigned += 1;
                triagedTotalMoved += 1;
                continue;
            }

            if (isDryRun) {
                executionDetails[assignedSplitIndex].triaged_meets_reassigned += 1;
                triagedTotalMoved += 1;
                console.log(`  🎯 [DRY RUN] Would reassign scorecard Meet ${meetId} (${meetDate || 'No Date'}) to Person ${assignedSplitIndex + 1} (lifter_id: ${targetId}) from donor ${donorLifterId || 'anchor'}`);
            } else {
                let query = supabase
                    .from('usaw_meet_results')
                    .update({
                        lifter_id: targetId,
                        updated_at: new Date().toISOString()
                    })
                    .eq('meet_id', meetId);

                if (donorLifterId) {
                    query = query.eq('lifter_id', donorLifterId);
                } else {
                    query = query.ilike('lifter_name', originalAthleteName);
                }

                if (meetDate) {
                    query = query.eq('date', meetDate);
                }

                const { data: updatedCard, error: cardErr } = await query.select('result_id');
                if (cardErr) {
                    console.warn(`  ⚠️ Error reassigning scorecard Meet ${meetId}: ${cardErr.message}`);
                } else {
                    const movedCount = updatedCard ? updatedCard.length : 0;
                    executionDetails[assignedSplitIndex].triaged_meets_reassigned += movedCount;
                    triagedTotalMoved += movedCount;
                    console.log(`  🎯 Reassigned ${movedCount} scorecard(s) for Meet ${meetId} (${meetDate || 'No Date'}) to Person ${assignedSplitIndex + 1} (lifter_id: ${targetId})`);
                }
            }
        } else {
            console.warn(`  ⚠️ Scorecard Meet ${card.meet_id} had no valid person assignment; left on anchor lifter_id ${donorLifterId || collapsedLifterId}.`);
        }
    }

    // Step 4: Enqueue all affected lifter_ids into public.athlete_shard_queue
    const allInvolvedIds = [...targetLifterIds, donorLifterId].filter(id => typeof id === 'number' && id > 0);
    const uniqueLifterIds = Array.from(new Set(allInvolvedIds));
    if (!isDryRun && uniqueLifterIds.length > 0) {
        const queueRows = uniqueLifterIds.map(lid => ({
            federation: 'usaw',
            entity_id: lid,
            enqueued_at: new Date().toISOString()
        }));

        const { error: qErr } = await supabase
            .from('athlete_shard_queue')
            .upsert(queueRows, { onConflict: 'federation,entity_id' });

        if (qErr) {
            console.warn('  ⚠️ Failed to enqueue to athlete_shard_queue:', qErr.message);
        } else {
            console.log(`  📢 Enqueued ${uniqueLifterIds.length} athlete IDs to public.athlete_shard_queue for immediate static shard generation.`);
        }
    }

    // Step 5: Mark the queue item as RESOLVED and persist execution summary
    const summaryPayload = {
        executed_at: new Date().toISOString(),
        collapsed_lifter_id: collapsedLifterId,
        donor_lifter_id: donorLifterId,
        distinct_persons_count: splitPlan.splits.length,
        triaged_meets_reassigned: triagedTotalMoved,
        persons: executionDetails
    };

    if (isDryRun) {
        console.log(`  🔄 [DRY RUN] Simulated execution summary:\n`, JSON.stringify(summaryPayload, null, 2));
    } else {
        const updatedEvidence = {
            ...evidence,
            execution_summary: summaryPayload
        };

        const { error: resErr } = await supabase
            .from('admin_review_queue')
            .update({
                status: 'RESOLVED',
                resolved_at: queueItem.resolved_at || new Date().toISOString(),
                evidence: updatedEvidence
            })
            .eq('id', queueId);

        if (resErr) {
            console.error(`  ❌ Failed to update status to RESOLVED for Queue ID ${queueId}:`, resErr.message);
        } else {
            console.log(`  ✅ Successfully finalized Admin Review Queue ID: ${queueId} (Status -> 'RESOLVED').`);
        }
    }

    return summaryPayload;
}

/**
 * Main Runner
 */
async function main() {
    console.log('================================================================');
    console.log('🏛️  HOMONYM SPLIT EXECUTION ENGINE');
    console.log(`   Execution Mode:    ${isDryRun ? 'DRY-RUN (Simulation Only)' : 'LIVE EXECUTION'}`);
    if (targetQueueId) console.log(`   Target Queue ID:   ${targetQueueId}`);
    console.log(`   Batch Limit:       ${batchLimit}`);
    console.log('================================================================');

    try {
        let query = supabase
            .from('admin_review_queue')
            .select('id, category, status, title, primary_entity_type, primary_entity_id, resolved_by, resolved_at, evidence')
            .eq('category', 'homonym_split')
            .eq('status', 'APPROVED');

        if (targetQueueId) {
            query = query.eq('id', targetQueueId);
        } else {
            query = query.order('resolved_at', { ascending: true }).limit(batchLimit);
        }

        const { data: rows, error: fetchErr } = await query;

        if (fetchErr) {
            throw new Error(`Failed to fetch approved homonym splits: ${fetchErr.message}`);
        }

        console.log(`\n📋 Found ${rows ? rows.length : 0} approved homonym split(s) ready for execution.`);

        if (!rows || rows.length === 0) {
            console.log('✨ No approved homonym splits pending execution.');
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const item of rows) {
            try {
                await executeSplit(item);
                successCount++;
            } catch (splitErr) {
                console.error(`  ❌ Error processing Queue ID ${item.id}:`, splitErr.message);
                errorCount++;
            }
        }

        console.log('\n================================================================');
        console.log('🏁 EXECUTION SUMMARY');
        console.log(`   Processed:   ${rows.length}`);
        console.log(`   Successful:  ${successCount}`);
        console.log(`   Failed:      ${errorCount}`);
        console.log('================================================================\n');

    } catch (err) {
        console.error('💥 Fatal engine error:', err.message);
    }
}

if (require.main === module) {
    main();
}

module.exports = { executeSplit };
