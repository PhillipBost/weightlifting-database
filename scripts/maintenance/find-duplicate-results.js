#!/usr/bin/env node

/**
 * Find and Report Duplicate Results
 *
 * Identifies all (db_meet_id, db_lifter_id) pairs that have multiple records
 * Shows details to help decide which duplicates to keep/delete
 *
 * Usage:
 *   node find-duplicate-results.js                    # Show all duplicates
 *   node find-duplicate-results.js --detailed         # Show full details
 */

const config = require('../production/iwf-config');

async function findDuplicates() {
    console.log('\n' + '='.repeat(80));
    console.log('FINDING ALL DUPLICATE (db_meet_id, db_lifter_id) PAIRS');
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

        console.log(`\n⚠️  Found ${duplicates.length} duplicate pairs (${duplicates.reduce((sum, [_, r]) => sum + r.length, 0)} total duplicate records)\n`);

        // Show duplicates
        for (const [key, results] of duplicates) {
            const [meetId, lifterId] = key.split(',');
            console.log(`\n📍 db_meet_id=${meetId}, db_lifter_id=${lifterId}: ${results.length} records`);

            // Sort by created_at to show chronological order
            results.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const hasTotal = r.total && r.total !== '0' && r.total !== '---';
                const totalMarker = hasTotal ? '✓' : '✗';
                console.log(`   [${i + 1}] db_result_id=${r.db_result_id} | total=${r.total || 'null'} [${totalMarker}] | weight_class=${r.weight_class} | created=${new Date(r.created_at).toISOString().split('T')[0]}`);
            }

            // Show recommendation
            const withTotal = results.filter(r => r.total && r.total !== '0' && r.total !== '---');
            if (withTotal.length > 0) {
                console.log(`   → Recommend keeping: record [${results.indexOf(withTotal[0]) + 1}] (has valid total)`);
            } else {
                console.log(`   → Recommend keeping: record [1] (oldest)`);
            }
        }

        // Show SQL query for manual verification
        console.log(`\n${'='.repeat(80)}`);
        console.log('SQL QUERY TO VERIFY DUPLICATES:');
        console.log('='.repeat(80));
        console.log(`
SELECT db_meet_id, db_lifter_id, COUNT(*) as cnt
FROM iwf_meet_results
GROUP BY db_meet_id, db_lifter_id
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
        `);

        // Show cleanup suggestions
        console.log(`\n${'='.repeat(80)}`);
        console.log('CLEANUP STRATEGY:');
        console.log('='.repeat(80));
        console.log(`
1. For each duplicate pair, identify which record to KEEP (marked with →)
2. Delete the other records using:
   DELETE FROM iwf_meet_results WHERE db_result_id = [ID_TO_DELETE];

3. Alternative: Run cleanup script (when available):
   node scripts/maintenance/cleanup-duplicate-results.js

4. Then apply the migration:
   psql -f scripts/sql/fix-iwf-results-unique-constraint.sql
        `);

        process.exit(0);

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    }
}

findDuplicates();
