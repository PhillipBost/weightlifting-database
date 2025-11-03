#!/usr/bin/env node

/**
 * Verify Duplicate Detection Fix
 *
 * Checks for existing duplicates before and after fix
 * Helps validate that unique constraint is working correctly
 *
 * Usage:
 *   node verify-duplicate-fix.js --check-before    # Before applying migration
 *   node verify-duplicate-fix.js --check-after     # After applying migration
 *   node verify-duplicate-fix.js --full-report     # Comprehensive analysis
 */

const config = require('../production/iwf-config');

/**
 * Check for duplicate (db_meet_id, db_lifter_id) pairs
 * These would violate the new UNIQUE constraint
 */
async function checkDuplicates() {
    console.log('\n' + '='.repeat(80));
    console.log('CHECKING FOR DUPLICATE (db_meet_id, db_lifter_id) PAIRS');
    console.log('='.repeat(80));

    try {
        // Use raw SQL for GROUP BY (Supabase JS client doesn't support group_by)
        const { data: duplicates, error } = await config.supabaseIWF.rpc('check_duplicate_results', {});

        // Fallback: Fetch all results and check in JavaScript
        if (error || !duplicates) {
            console.log('ℹ️  Using JavaScript-based duplicate check...');

            const { data: allResults, error: fetchError } = await config.supabaseIWF
                .from('iwf_meet_results')
                .select('db_meet_id, db_lifter_id');

            if (fetchError) {
                console.error(`❌ Database error: ${fetchError.message}`);
                return { success: false, duplicateCount: 0 };
            }

            // Group by (db_meet_id, db_lifter_id) in JavaScript
            const groups = {};
            for (const result of allResults || []) {
                const key = `${result.db_meet_id},${result.db_lifter_id}`;
                groups[key] = (groups[key] || 0) + 1;
            }

            // Find duplicates
            const duplicatePairs = Object.entries(groups)
                .filter(([_, count]) => count > 1)
                .map(([key, count]) => {
                    const [meetId, lifterId] = key.split(',');
                    return { db_meet_id: parseInt(meetId), db_lifter_id: parseInt(lifterId), cnt: count };
                });

            if (duplicatePairs.length === 0) {
                console.log('✅ No duplicates found! (db_meet_id, db_lifter_id) pairs are unique');
                return { success: true, duplicateCount: 0, totalRecords: allResults?.length || 0 };
            }

            console.log(`⚠️  Found ${duplicatePairs.length} duplicate pairs:`);
            for (const dup of duplicatePairs.slice(0, 10)) {
                console.log(`   - db_meet_id=${dup.db_meet_id}, db_lifter_id=${dup.db_lifter_id}: ${dup.cnt} results`);
            }

            if (duplicatePairs.length > 10) {
                console.log(`   ... and ${duplicatePairs.length - 10} more`);
            }

            return { success: false, duplicateCount: duplicatePairs.length, totalRecords: allResults?.length || 0 };
        }

        if (!duplicates || duplicates.length === 0) {
            console.log('✅ No duplicates found! (db_meet_id, db_lifter_id) pairs are unique');
            return { success: true, duplicateCount: 0 };
        }

        console.log(`⚠️  Found ${duplicates.length} duplicate pairs:`);
        for (const dup of duplicates.slice(0, 10)) {
            console.log(`   - db_meet_id=${dup.db_meet_id}, db_lifter_id=${dup.db_lifter_id}: ${dup.cnt} results`);
        }

        if (duplicates.length > 10) {
            console.log(`   ... and ${duplicates.length - 10} more`);
        }

        return { success: false, duplicateCount: duplicates.length };

    } catch (error) {
        console.error(`❌ Error checking duplicates: ${error.message}`);
        return { success: false, duplicateCount: 0 };
    }
}

/**
 * Check current unique constraint definition
 */
async function checkConstraint() {
    console.log('\n' + '='.repeat(80));
    console.log('CHECKING UNIQUE CONSTRAINT');
    console.log('='.repeat(80));

    try {
        // For Supabase, we need to check the actual table info
        const { data: indexInfo, error } = await config.supabaseIWF
            .from('information_schema.indexes')
            .select('indexname, indexdef')
            .like('indexname', '%unique%')
            .like('tablename', 'iwf_meet_results');

        if (error) {
            console.log(`⚠️  Could not query constraint info (may be permission issue)`);
            console.log(`   Please verify manually:`)
            console.log(`   SELECT constraint_name FROM information_schema.table_constraints`);
            console.log(`   WHERE table_name = 'iwf_meet_results' AND constraint_type = 'UNIQUE'`);
            return { success: false };
        }

        if (indexInfo && indexInfo.length > 0) {
            console.log('✅ Unique constraints found:');
            for (const idx of indexInfo) {
                console.log(`   ${idx.indexname}: ${idx.indexdef}`);
            }
            return { success: true, indexCount: indexInfo.length };
        } else {
            console.log('⚠️  No unique constraints found');
            return { success: false, indexCount: 0 };
        }

    } catch (error) {
        console.log(`⚠️  Could not query constraint info: ${error.message}`);
        return { success: false };
    }
}

/**
 * Analyze weight_class distribution (for educational purposes)
 */
async function analyzeWeightClassDistribution() {
    console.log('\n' + '='.repeat(80));
    console.log('WEIGHT CLASS DISTRIBUTION');
    console.log('='.repeat(80));

    try {
        const { data: results, error } = await config.supabaseIWF
            .from('iwf_meet_results')
            .select('db_meet_id, db_lifter_id, weight_class')
            .limit(10000);

        if (error) {
            console.error(`❌ Error fetching results: ${error.message}`);
            return;
        }

        // Group by (db_meet_id, db_lifter_id) and count distinct weight_classes
        const weightClassMap = {};
        for (const result of results || []) {
            const key = `${result.db_meet_id},${result.db_lifter_id}`;
            if (!weightClassMap[key]) {
                weightClassMap[key] = new Set();
            }
            if (result.weight_class) {
                weightClassMap[key].add(result.weight_class);
            }
        }

        // Find cases where same athlete in same meet has multiple weight classes
        const multipleClasses = Object.entries(weightClassMap)
            .filter(([_, classes]) => classes.size > 1);

        console.log(`Analyzed ${Object.keys(weightClassMap).length} meet-lifter pairs`);
        console.log(`Pairs with multiple weight classes: ${multipleClasses.length}`);

        if (multipleClasses.length > 0) {
            console.log('\n⚠️  Examples of same athlete, same meet, different weight class:');
            for (const [key, classes] of multipleClasses.slice(0, 5)) {
                const [meetId, lifterId] = key.split(',');
                console.log(`   Meet ${meetId}, Lifter ${lifterId}: ${Array.from(classes).join(', ')}`);
            }
        }

    } catch (error) {
        console.error(`Error analyzing weight classes: ${error.message}`);
    }
}

/**
 * Check records created on same date (for duplicate detection validation)
 */
async function checkSameDateRecords() {
    console.log('\n' + '='.repeat(80));
    console.log('SAME-DATE RECORDS (Duplicate Detection Test)');
    console.log('='.repeat(80));

    try {
        const { data: results, error } = await config.supabaseIWF
            .from('iwf_meet_results')
            .select('db_meet_id, db_lifter_id, date, created_at');

        if (error) {
            console.log(`Note: Could not fetch records - ${error.message}`);
            return;
        }

        // Group by (db_meet_id, db_lifter_id, date) in JavaScript
        const groups = {};
        for (const result of results || []) {
            const key = `${result.db_meet_id},${result.db_lifter_id},${result.date}`;
            if (!groups[key]) {
                groups[key] = { count: 0, sample: result };
            }
            groups[key].count += 1;
        }

        // Find duplicates (same meet, lifter, date)
        const sameDateDupes = Object.entries(groups)
            .filter(([_, g]) => g.count > 1)
            .map(([key, g]) => {
                const [meetId, lifterId, date] = key.split(',');
                return { db_meet_id: parseInt(meetId), db_lifter_id: parseInt(lifterId), date, count: g.count };
            });

        if (sameDateDupes.length === 0) {
            console.log(`✅ No same-date duplicates found`);
        } else {
            console.log(`⚠️  Found ${sameDateDupes.length} groups with same date/lifter/meet:`);
            for (const dup of sameDateDupes.slice(0, 5)) {
                console.log(`   - db_meet_id=${dup.db_meet_id}, db_lifter_id=${dup.db_lifter_id}, date=${dup.date}: ${dup.count} records`);
            }
            if (sameDateDupes.length > 5) {
                console.log(`   ... and ${sameDateDupes.length - 5} more`);
            }
        }

    } catch (error) {
        console.log(`Note: Same-date check failed - ${error.message}`);
    }
}

/**
 * Main verification flow
 */
async function main() {
    const args = process.argv.slice(2);
    const checkBefore = args.includes('--check-before');
    const checkAfter = args.includes('--check-after');
    const fullReport = args.includes('--full-report');

    console.log(`\n${'='.repeat(80)}`);
    console.log(`IWF Results Duplicate Detection Verification`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(80)}`);

    try {
        // Basic duplicate check (always run)
        const dupCheck = await checkDuplicates();

        if (fullReport) {
            await checkConstraint();
            await analyzeWeightClassDistribution();
            await checkSameDateRecords();
        }

        // Summary
        console.log(`\n${'='.repeat(80)}`);
        console.log('SUMMARY');
        console.log(`${'='.repeat(80)}`);

        if (dupCheck.totalRecords) {
            console.log(`Total records analyzed: ${dupCheck.totalRecords}`);
        }

        if (dupCheck.success) {
            console.log('✅ Database is ready for UNIQUE(db_meet_id, db_lifter_id) constraint');
            console.log('   Safe to apply migration: scripts/sql/fix-iwf-results-unique-constraint.sql');
        } else {
            console.log(`❌ Found ${dupCheck.duplicateCount} duplicate pairs`);
            console.log('   These must be resolved before applying constraint');
            console.log('   Recommend: Manual review or cleanup script');
        }

        process.exit(dupCheck.success ? 0 : 1);

    } catch (error) {
        console.error(`\n❌ Verification failed: ${error.message}`);
        process.exit(1);
    }
}

main();
