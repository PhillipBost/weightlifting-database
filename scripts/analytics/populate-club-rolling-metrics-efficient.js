const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function populateClubRollingMetricsEfficient() {
    console.log('🎯 Starting EFFICIENT club rolling metrics population...');
    console.log('📅 Using optimized approach for all clubs with 6-month snapshots');

    try {
        // Generate snapshot periods (6-month intervals)
        const startDate = new Date('2012-01-01');
        const endDate = new Date();
        endDate.setDate(1);

        const currentMonth = new Date(startDate);
        const snapshots = [];

        while (currentMonth <= endDate) {
            snapshots.push(currentMonth.toISOString().substring(0, 10));
            currentMonth.setMonth(currentMonth.getMonth() + 6);
        }

        console.log(`📅 Processing ${snapshots.length} snapshot periods`);

        // Process each snapshot period separately
        const allResults = [];

        for (let i = 0; i < snapshots.length; i++) {
            const snapshotDate = snapshots[i];
            console.log(`🔄 Processing snapshot ${i + 1}/${snapshots.length}: ${snapshotDate}`);

            // Calculate 12-month window for this snapshot
            const windowStart = new Date(snapshotDate);
            windowStart.setFullYear(windowStart.getFullYear() - 1);
            const windowStartStr = windowStart.toISOString().substring(0, 10);

            // Query all club data for this 12-month window
            console.log(`📊 Fetching data for window: ${windowStartStr} to ${snapshotDate}`);

            const { data: windowData, error: windowError } = await supabase
                .from('usaw_meet_results')
                .select('club_name, lifter_id, result_id')
                .gte('date', windowStartStr)
                .lt('date', snapshotDate)
                .not('club_name', 'is', null)
                .neq('club_name', '');

            if (windowError) {
                console.error(`❌ Error fetching data for ${snapshotDate}:`, windowError.message);
                continue;
            }

            console.log(`📈 Fetched ${windowData.length} records for this window`);

            // Aggregate by club for this snapshot period
            const clubMetrics = new Map();

            for (const result of windowData) {
                const club = result.club_name;
                if (!clubMetrics.has(club)) {
                    clubMetrics.set(club, {
                        lifters: new Set(),
                        competitions: 0
                    });
                }

                clubMetrics.get(club).lifters.add(result.lifter_id);
                clubMetrics.get(club).competitions++;
            }

            // Convert to result records
            for (const [club, metrics] of clubMetrics.entries()) {
                allResults.push({
                    club_name: club,
                    snapshot_month: snapshotDate,
                    active_members_12mo: metrics.lifters.size,
                    total_competitions_12mo: metrics.competitions,
                    unique_lifters_12mo: metrics.lifters.size
                });
            }

            console.log(`✅ Processed ${clubMetrics.size} clubs for ${snapshotDate}`);
        }

        console.log(`📊 Total records to insert: ${allResults.length}`);

        // Insert all results in batches
        const batchSize = 1000;
        let inserted = 0;

        for (let i = 0; i < allResults.length; i += batchSize) {
            const batch = allResults.slice(i, i + batchSize);

            console.log(`💾 Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allResults.length / batchSize)} (${batch.length} records)...`);

            const { error: insertError } = await supabase
                .from('usaw_club_rolling_metrics')
                .upsert(batch, {
                    onConflict: 'club_name,snapshot_month'
                });

            if (insertError) {
                console.error(`❌ Failed to insert batch ${Math.floor(i / batchSize) + 1}:`, insertError.message);
                continue;
            }

            inserted += batch.length;
            console.log(`✅ Successfully inserted batch. Total: ${inserted}/${allResults.length}`);
        }

        console.log('🎉 Efficient club rolling metrics population completed!');
        console.log(`📊 Total records inserted: ${inserted}`);

        // Show summary stats
        const uniqueClubs = new Set(allResults.map(r => r.club_name));
        const uniquePeriods = new Set(allResults.map(r => r.snapshot_month));

        console.log(`🏢 Unique clubs processed: ${uniqueClubs.size}`);
        console.log(`📅 Unique periods processed: ${uniquePeriods.size}`);
        console.log(`🧮 Expected total records: ${uniqueClubs.size} × ${uniquePeriods.size} = ${uniqueClubs.size * uniquePeriods.size}`);

        // Show some sample results
        await showSampleResults();

    } catch (error) {
        console.error('❌ Error populating club rolling metrics:', error.message);
        throw error;
    }
}

async function showSampleResults() {
    console.log('\n📊 Sample Results:');

    try {
        // Get a sample of results
        const { data: sample, error } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('*')
            .order('active_members_12mo', { ascending: false })
            .limit(10);

        if (error) {
            console.error('❌ Failed to fetch sample results:', error.message);
            return;
        }

        if (sample && sample.length > 0) {
            console.table(sample.map(row => ({
                Club: row.club_name.substring(0, 25),
                Period: row.snapshot_month,
                'Active Members (12mo)': row.active_members_12mo,
                'Total Competitions (12mo)': row.total_competitions_12mo
            })));
        }

        // Get summary stats
        const { count, error: countError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('*', { count: 'exact', head: true });

        if (!countError && count) {
            console.log(`\n📈 Summary: ${count} total records in rolling metrics table`);
        }

    } catch (error) {
        console.error('❌ Error showing sample results:', error.message);
    }
}

// Run the population if this script is executed directly
if (require.main === module) {
    populateClubRollingMetricsEfficient()
        .then(() => {
            console.log('✅ Script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Script failed:', error.message);
            process.exit(1);
        });
}

module.exports = { populateClubRollingMetricsEfficient };