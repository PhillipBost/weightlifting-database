#!/usr/bin/env node

/**
 * Cleanup Duplicate Results Automatically
 *
 * For each (db_meet_id, db_lifter_id) pair with duplicates:
 * - Keeps the record with a valid total (non-zero, non "---")
 * - If multiple have valid totals, keeps the one with the largest total
 * - If none have valid totals, keeps the oldest record
 * - Deletes all other duplicates
 *
 * Usage:
 *   node cleanup-duplicate-results.js --dry-run      # Show what would be deleted
 *   node cleanup-duplicate-results.js --execute      # Actually delete duplicates
 */

const config = require('../production/iwf-config');

async function cleanupDuplicates(dryRun = true) {
    console.log('\n' + '='.repeat(80));
    console.log(dryRun ? 'DRY RUN: DUPLICATE CLEANUP' : 'EXECUTING: DUPLICATE CLEANUP');
    console.log('='.repeat(80));

    try {
        // Fetch ALL results with pagination (Supabase has 1000 record default limit)
        let allResults = [];
        let pageSize = 1000;
        let offset = 0;

        console.log('📥 Fetching all results from database...');

        while (true) {
            const { data, error } = await config.supabaseIWF
                .from('iwf_meet_results')
                .select('db_result_id, db_meet_id, db_lifter_id, date, total, weight_class, created_at, updated_at')
                .range(offset, offset + pageSize - 1);

            if (error) {
                console.error(`❌ Error fetching results: ${error.message}`);
                process.exit(1);
            }

            if (!data || data.length === 0) {
                break;
            }

            allResults = allResults.concat(data);
            console.log(`   ... fetched ${allResults.length} records so far`);

            if (data.length < pageSize) {
                break;
            }

            offset += pageSize;
        }

        console.log(`\n📊 Total records: ${allResults?.length || 0}`);

        // Group by (db_meet_id, db_lifter_id)
        const groups = {};
        for (const result of allResults || []) {
            const key = `${result.db_meet_id},${result.db_lifter_id}`;
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(result);
        }

        // Find duplicates
        const duplicates = Object.entries(groups)
            .filter(([_, results]) => results.length > 1)
            .sort((a, b) => b[1].length - a[1].length);

        if (duplicates.length === 0) {
            console.log('✅ No duplicates found!');
            process.exit(0);
        }

        console.log(`\n⚠️  Found ${duplicates.length} duplicate pairs\n`);

        const toDelete = [];
        let duplicateRecordCount = 0;

        // Process each duplicate group
        for (const [key, results] of duplicates) {
            const [meetId, lifterId] = key.split(',');

            // Sort by created_at to track oldest
            results.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            // Find which record to keep
            const withValidTotal = results.filter(r =>
                r.total && r.total !== '0' && r.total !== '---'
            );

            let recordToKeep;
            if (withValidTotal.length > 0) {
                // Keep record with largest total
                recordToKeep = withValidTotal.reduce((prev, current) =>
                    parseInt(current.total) > parseInt(prev.total) ? current : prev
                );
            } else {
                // Keep oldest record
                recordToKeep = results[0];
            }

            // Mark others for deletion
            for (const result of results) {
                if (result.db_result_id !== recordToKeep.db_result_id) {
                    toDelete.push(result);
                    duplicateRecordCount++;
                }
            }

            // Log the group
            const hasTotal = recordToKeep.total && recordToKeep.total !== '0' && recordToKeep.total !== '---';
            const reason = withValidTotal.length > 0 ? '(valid total)' : '(oldest)';
            console.log(`📍 db_meet_id=${meetId}, db_lifter_id=${lifterId}: ${results.length} records → Keep ID ${recordToKeep.db_result_id} ${reason}`);
            for (const result of results) {
                const isKeep = result.db_result_id === recordToKeep.db_result_id ? '✓ KEEP' : '✗ DELETE';
                const totalMarker = result.total && result.total !== '0' && result.total !== '---' ? '✓' : '✗';
                console.log(`   ${isKeep}: db_result_id=${result.db_result_id} | total=${result.total || 'null'} [${totalMarker}] | created=${new Date(result.created_at).toISOString().split('T')[0]}`);
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log(`SUMMARY: ${duplicateRecordCount} duplicate records to delete`);
        console.log(`${'='.repeat(80)}`);

        if (dryRun) {
            console.log(`\n✅ DRY RUN ONLY - No changes made`);
            console.log(`\nTo execute cleanup, run:`);
            console.log(`  node scripts/maintenance/cleanup-duplicate-results.js --execute`);
            process.exit(0);
        }

        // Execute deletion
        console.log(`\nDeleting ${toDelete.length} records...`);

        let deleted = 0;
        let errors = 0;

        for (const result of toDelete) {
            const { error } = await config.supabaseIWF
                .from('iwf_meet_results')
                .delete()
                .eq('db_result_id', result.db_result_id);

            if (error) {
                console.error(`❌ Failed to delete db_result_id=${result.db_result_id}: ${error.message}`);
                errors++;
            } else {
                deleted++;
                if (deleted % 50 === 0) {
                    console.log(`  ... deleted ${deleted}/${toDelete.length}`);
                }
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('CLEANUP COMPLETE');
        console.log(`${'='.repeat(80)}`);
        console.log(`✅ Successfully deleted: ${deleted} records`);
        if (errors > 0) {
            console.log(`❌ Failed to delete: ${errors} records`);
        }

        if (errors === 0) {
            console.log(`\n✅ All duplicates cleaned! You can now apply the migration:`);
            console.log(`  psql -f scripts/sql/fix-iwf-results-unique-constraint.sql`);
        }

        process.exit(errors > 0 ? 1 : 0);

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    }
}

// Parse arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

if (dryRun) {
    console.log(`\n⚠️  Running in DRY-RUN mode (no changes will be made)`);
}

cleanupDuplicates(dryRun);
