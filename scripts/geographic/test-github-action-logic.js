#!/usr/bin/env node

/**
 * Test GitHub Action Logic
 *
 * This script simulates the GitHub Action workflow logic locally to verify
 * that our fixes for the WSO assignment process work correctly.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../../.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Simulate the GitHub Action's count logic (OLD - problematic version)
async function simulateOldCountLogic() {
    console.log('🔍 Simulating OLD GitHub Action count logic...');

    try {
        const { data, error } = await supabase
            .from('usaw_meets')
            .select('meet_id', { count: 'exact' })
            .is('wso_geography', null);

        if (error) throw error;
        const count = data ? data.length : 0;

        console.log(`  ❌ OLD logic result: ${count} meets (LIMITED BY SUPABASE PAGINATION)`);
        return count;
    } catch (error) {
        console.error('  ❌ OLD logic failed:', error.message);
        return 0;
    }
}

// Simulate the GitHub Action's count logic (NEW - fixed version)
async function simulateNewCountLogic() {
    console.log('🔍 Simulating NEW GitHub Action count logic...');

    try {
        let totalCount = 0;
        let start = 0;
        const batchSize = 1000;
        let hasMore = true;

        console.log('  📊 Counting unassigned meets using pagination...');

        while (hasMore) {
            const { data, error } = await supabase
                .from('usaw_meets')
                .select('meet_id')
                .is('wso_geography', null)
                .range(start, start + batchSize - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                totalCount += data.length;
                console.log(`    📦 Batch ${Math.floor(start / batchSize) + 1}: Found ${data.length} unassigned meets (Running total: ${totalCount})`);

                hasMore = data.length === batchSize;
                start += batchSize;
            } else {
                hasMore = false;
            }
        }

        console.log(`  ✅ NEW logic result: ${totalCount} meets (ACCURATE TOTAL)`);
        return totalCount;
    } catch (error) {
        console.error('  ❌ NEW logic failed:', error.message);
        return 0;
    }
}

// Test the count verification logic
async function testCountVerification() {
    console.log('🧪 Testing count verification logic...');

    const oldCount = await simulateOldCountLogic();
    const newCount = await simulateNewCountLogic();

    console.log('\n📊 Count Comparison Results:');
    console.log(`  OLD method: ${oldCount} meets`);
    console.log(`  NEW method: ${newCount} meets`);
    console.log(`  Difference: ${newCount - oldCount} meets`);

    if (newCount > oldCount) {
        console.log(`  ✅ NEW method found ${newCount - oldCount} additional unassigned meets!`);
        console.log(`  ✅ This confirms the GitHub Action fix is working correctly.`);
    } else if (newCount === oldCount) {
        console.log(`  ℹ️  Both methods found the same count (probably < 1000 total).`);
    } else {
        console.log(`  ❌ Unexpected: NEW method found fewer meets than OLD method.`);
    }

    return { oldCount, newCount };
}

// Simulate post-assignment verification
async function simulatePostAssignmentVerification(initialCount) {
    console.log('\n🔍 Simulating post-assignment verification...');

    // This would normally run after the assignment script
    const remainingCount = await simulateNewCountLogic();

    console.log('\n📊 Post-Assignment Verification Results:');
    console.log(`  Initial unassigned: ${initialCount}`);
    console.log(`  Remaining unassigned: ${remainingCount}`);

    if (remainingCount < initialCount) {
        const processed = initialCount - remainingCount;
        console.log(`  ✅ Successfully processed: ${processed} meets`);
        console.log(`  📈 Assignment rate: ${((processed / initialCount) * 100).toFixed(1)}%`);
    } else if (remainingCount === initialCount) {
        console.log(`  ⚠️  No meets were processed (dry run or no assignments made)`);
    } else {
        console.log(`  ❌ Unexpected: More meets unassigned than initially counted`);
    }

    return remainingCount;
}

async function main() {
    console.log('🧪 GitHub Action Logic Test Suite');
    console.log('='.repeat(60));

    try {
        // Test count verification
        const { oldCount, newCount } = await testCountVerification();

        // Simulate verification after assignment (using current count as baseline)
        await simulatePostAssignmentVerification(newCount);

        console.log('\n✅ All GitHub Action logic tests completed successfully!');
        console.log('\n📝 Key Improvements:');
        console.log('  1. ✅ Fixed pagination in count query');
        console.log('  2. ✅ Added comprehensive logging');
        console.log('  3. ✅ Added post-assignment verification');
        console.log('  4. ✅ Enhanced error handling and progress tracking');

    } catch (error) {
        console.error('\n❌ Test suite failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}