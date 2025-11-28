/**
 * ADD MEET INTERNAL IDs SCRIPT
 * 
 * Purpose: Updates existing meets in the database to add meet_internal_id
 * extracted from their Sport80 URLs.
 * 
 * Usage:
 *   node add-meet-internal-ids.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Extract meet internal_id from Sport80 URL
function extractMeetInternalId(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }

    // Match pattern: https://usaweightlifting.sport80.com/public/rankings/results/7011
    const match = url.match(/\/rankings\/results\/(\d+)/);
    return match ? parseInt(match[1]) : null;
}

// Get all meets that need meet_internal_id updates
async function getMeetsNeedingInternalIds() {
    console.log('🔍 Finding meets that need internal_id updates...');

    let allMeets = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
        const { data: meets, error } = await supabase
            .from('usaw_meets')
            .select('meet_id, URL, meet_internal_id')
            .is('meet_internal_id', null)
            .not('URL', 'is', null)
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(`Failed to fetch meets: ${error.message}`);
        }

        if (!meets || meets.length === 0) {
            break;
        }

        allMeets.push(...meets);
        from += pageSize;

        console.log(`📄 Found ${allMeets.length} meets needing internal_id updates so far...`);

        if (meets.length < pageSize) {
            break;
        }
    }

    console.log(`📊 Total meets needing updates: ${allMeets.length}`);
    return allMeets;
}

// Update meets with their internal_ids
async function updateMeetInternalIds(meets) {
    console.log(`🔄 Updating ${meets.length} meets with internal_ids...`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process in batches to avoid overwhelming the database
    const batchSize = 100;

    for (let i = 0; i < meets.length; i += batchSize) {
        const batch = meets.slice(i, i + batchSize);
        console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(meets.length / batchSize)} (${batch.length} records)`);

        for (const meet of batch) {
            try {
                const meetInternalId = extractMeetInternalId(meet.URL);

                if (!meetInternalId) {
                    console.log(`⚠️  Skipping meet ${meet.meet_id} - could not extract internal_id from URL: ${meet.URL}`);
                    skippedCount++;
                    continue;
                }

                // Update the meet with its internal_id
                const { error } = await supabase
                    .from('usaw_meets')
                    .update({ meet_internal_id: meetInternalId })
                    .eq('meet_id', meet.meet_id);

                if (error) {
                    console.error(`❌ Failed to update meet ${meet.meet_id}: ${error.message}`);
                    errorCount++;
                } else {
                    console.log(`✅ Updated meet ${meet.meet_id} -> internal_id ${meetInternalId}`);
                    updatedCount++;
                }

            } catch (error) {
                console.error(`❌ Error processing meet ${meet.meet_id}: ${error.message}`);
                errorCount++;
            }
        }

        // Small delay between batches
        if (i + batchSize < meets.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    console.log('\n📊 Update Results:');
    console.log(`   ✅ Successfully updated: ${updatedCount}`);
    console.log(`   ⚠️  Skipped (no internal_id): ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);

    return { updated: updatedCount, skipped: skippedCount, errors: errorCount };
}

// Verify the updates worked
async function verifyUpdates() {
    console.log('\n🔍 Verifying meet internal_id updates...');

    const { data: stats, error } = await supabase
        .from('usaw_meets')
        .select('meet_internal_id')
        .not('URL', 'is', null);

    if (error) {
        throw new Error(`Failed to verify updates: ${error.message}`);
    }

    const totalWithUrls = stats.length;
    const withInternalIds = stats.filter(m => m.meet_internal_id !== null).length;
    const withoutInternalIds = totalWithUrls - withInternalIds;

    console.log(`📊 Verification Results:`);
    console.log(`   Total meets with URLs: ${totalWithUrls}`);
    console.log(`   With internal_ids: ${withInternalIds}`);
    console.log(`   Without internal_ids: ${withoutInternalIds}`);

    const successRate = totalWithUrls > 0 ? ((withInternalIds / totalWithUrls) * 100).toFixed(1) : '0';
    console.log(`   Success rate: ${successRate}%`);

    return { totalWithUrls, withInternalIds, withoutInternalIds, successRate };
}

// Main execution function
async function main() {
    const startTime = Date.now();

    try {
        console.log('🚀 Starting meet internal_id migration');
        console.log('='.repeat(60));

        // Test database connection
        const { error: testError } = await supabase.from('usaw_meets').select('meet_id').limit(1);
        if (testError) {
            throw new Error(`Database connection failed: ${testError.message}`);
        }
        console.log('✅ Database connection successful');

        // Get meets that need updates
        const meets = await getMeetsNeedingInternalIds();

        if (meets.length === 0) {
            console.log('✅ All meets already have internal_ids - no updates needed');
            return;
        }

        // Update the meets
        const updateResult = await updateMeetInternalIds(meets);

        // Verify the results
        await verifyUpdates();

        const totalTime = Date.now() - startTime;
        console.log('\n' + '='.repeat(60));
        console.log('✅ MEET INTERNAL_ID MIGRATION COMPLETE');
        console.log(`   Processing time: ${totalTime}ms`);
        console.log(`   Updated: ${updateResult.updated} meets`);

        if (updateResult.errors > 0) {
            console.log(`⚠️  ${updateResult.errors} errors occurred - check logs above`);
        }

    } catch (error) {
        console.error(`\n❌ Migration failed: ${error.message}`);
        console.error(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Export for potential use by other scripts
module.exports = {
    extractMeetInternalId,
    updateMeetInternalIds,
    main
};

// Run if called directly
if (require.main === module) {
    main();
}