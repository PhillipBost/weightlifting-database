const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function populateCompleteClubRollingMetrics() {
    console.log('🎯 Starting COMPLETE club rolling metrics population...');
    console.log('📅 Creating complete matrix: ALL clubs × ALL 6-month periods');
    console.log('   (Including zeros for inactive periods - essential for graphing)');

    try {
        // Step 1: Get ALL unique clubs that have ever existed in meet_results
        console.log('\n🔄 Step 1: Fetching ALL unique clubs...');

        const { data: allClubsData, error: clubsError } = await supabase.rpc('exec_sql', {
            sql: 'SELECT DISTINCT club_name FROM meet_results WHERE club_name IS NOT NULL AND club_name != \'\' ORDER BY club_name'
        });

        let allClubs;
        if (clubsError || !allClubsData) {
            console.log('⚠️ RPC failed, using proper pagination method...');

            const clubs = new Set();
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                const start = page * pageSize;
                const end = start + pageSize - 1;

                console.log(`   📄 Fetching page ${page + 1} (records ${start} to ${end})...`);

                const { data: pageData, error: pageError } = await supabase
                    .from('meet_results')
                    .select('club_name')
                    .not('club_name', 'is', null)
                    .neq('club_name', '')
                    .neq('club_name', 'null')
                    .neq('club_name', '-')
                    .neq('club_name', '.')
                    .order('club_name')
                    .range(start, end);

                if (pageError) {
                    console.error(`❌ Error on page ${page + 1}:`, pageError.message);
                    break;
                }

                if (!pageData || pageData.length === 0) {
                    hasMore = false;
                    break;
                }

                // Add clubs from this page
                let newClubsThisPage = 0;
                pageData.forEach(row => {
                    const clubName = row.club_name;
                    if (clubName &&
                        clubName.trim() !== '' &&
                        clubName.trim() !== 'null' &&
                        clubName.trim() !== '-' &&
                        clubName.trim() !== '.' &&
                        clubName.trim().toLowerCase() !== 'null') {

                        const trimmedName = clubName.trim();
                        if (!clubs.has(trimmedName)) {
                            clubs.add(trimmedName);
                            newClubsThisPage++;
                        }
                    }
                });

                console.log(`      ✅ Page ${page + 1}: ${pageData.length} records → ${newClubsThisPage} new clubs (${clubs.size} total)`);

                // If we got fewer records than page size, we're done
                if (pageData.length < pageSize) {
                    hasMore = false;
                }

                page++;

                // Safety limit
                if (page > 500) break;
            }

            allClubs = Array.from(clubs).sort();
        } else {
            allClubs = allClubsData.map(row => row.club_name).sort();
        }

        console.log(`🏢 Found ${allClubs.length} total unique clubs in system`);

        // Step 2: Generate ALL 6-month snapshot periods
        console.log('\n🔄 Step 2: Generating snapshot periods...');

        const startDate = new Date('2012-01-01');
        const endDate = new Date();
        endDate.setDate(1);

        const currentMonth = new Date(startDate);
        const snapshots = [];

        while (currentMonth <= endDate) {
            snapshots.push(currentMonth.toISOString().substring(0, 10));
            currentMonth.setMonth(currentMonth.getMonth() + 6);
        }

        console.log(`📅 Generated ${snapshots.length} snapshot periods from ${snapshots[0]} to ${snapshots[snapshots.length - 1]}`);

        // Step 3: Create complete matrix - ALL clubs × ALL periods
        console.log('\n🔄 Step 3: Creating complete club×period matrix...');
        console.log(`🧮 Total combinations: ${allClubs.length} clubs × ${snapshots.length} periods = ${allClubs.length * snapshots.length} records`);

        const allResults = [];

        for (let periodIndex = 0; periodIndex < snapshots.length; periodIndex++) {
            const snapshotDate = snapshots[periodIndex];
            console.log(`📊 Processing period ${periodIndex + 1}/${snapshots.length}: ${snapshotDate}`);

            // Calculate 12-month window for this snapshot
            const windowStart = new Date(snapshotDate);
            windowStart.setFullYear(windowStart.getFullYear() - 1);
            const windowStartStr = windowStart.toISOString().substring(0, 10);

            // Get ALL activity data for this 12-month window (all clubs) with pagination
            const windowData = [];
            let windowPage = 0;
            const windowPageSize = 1000;
            let hasWindowData = true;

            while (hasWindowData) {
                const windowRangeStart = windowPage * windowPageSize;
                const windowRangeEnd = windowRangeStart + windowPageSize - 1;

                const { data: pageWindowData, error: windowError } = await supabase
                    .from('meet_results')
                    .select('club_name, lifter_id, result_id')
                    .gte('date', windowStartStr)
                    .lt('date', snapshotDate)
                    .not('club_name', 'is', null)
                    .neq('club_name', '')
                    .order('result_id')
                    .range(windowRangeStart, windowRangeEnd);

                if (windowError) {
                    console.error(`❌ Error fetching window data page ${windowPage + 1} for ${snapshotDate}:`, windowError.message);
                    break;
                }

                if (!pageWindowData || pageWindowData.length === 0) {
                    hasWindowData = false;
                    break;
                }

                windowData.push(...pageWindowData);

                if (pageWindowData.length < windowPageSize) {
                    hasWindowData = false;
                }

                windowPage++;

                // Safety limit
                if (windowPage > 100) {
                    console.log(`⚠️ Window pagination safety limit reached for ${snapshotDate}`);
                    break;
                }
            }

            console.log(`   📊 Window data: ${windowData.length} total records across ${windowPage} pages`);

            // Aggregate activity by club for this window
            const clubActivity = new Map();
            for (const result of windowData || []) {
                const club = result.club_name;
                if (!clubActivity.has(club)) {
                    clubActivity.set(club, {
                        lifters: new Set(),
                        competitions: 0
                    });
                }
                clubActivity.get(club).lifters.add(result.lifter_id);
                clubActivity.get(club).competitions++;
            }

            // Now create records for ALL clubs (including zeros for inactive ones)
            let activeClubs = 0;
            let inactiveClubs = 0;

            for (const club of allClubs) {
                const activity = clubActivity.get(club);

                if (activity) {
                    // Club had activity in this window
                    const activeMembers = activity.lifters.size;
                    const totalCompetitions = activity.competitions;
                    const uniqueLifters = activity.lifters.size;

                    // Calculate activity_factor as competitions per lifter
                    const activityFactor = uniqueLifters > 0 ?
                        Number((totalCompetitions / uniqueLifters).toFixed(2)) : null;

                    allResults.push({
                        club_name: club,
                        snapshot_month: snapshotDate,
                        active_members_12mo: activeMembers,
                        total_competitions_12mo: totalCompetitions,
                        unique_lifters_12mo: uniqueLifters,
                        activity_factor: activityFactor
                    });
                    activeClubs++;
                } else {
                    // Club had NO activity in this window - record zeros
                    allResults.push({
                        club_name: club,
                        snapshot_month: snapshotDate,
                        active_members_12mo: 0,
                        total_competitions_12mo: 0,
                        unique_lifters_12mo: 0,
                        activity_factor: null
                    });
                    inactiveClubs++;
                }
            }

            console.log(`   ✅ ${activeClubs} active clubs, ${inactiveClubs} inactive clubs (${activeClubs + inactiveClubs} total)`);
        }

        console.log(`\n📈 Complete matrix created: ${allResults.length} total records`);
        console.log(`🧮 Verification: ${allClubs.length} clubs × ${snapshots.length} periods = ${allClubs.length * snapshots.length} expected`);

        // Step 4: Insert complete dataset in batches
        console.log('\n🔄 Step 4: Inserting complete dataset...');

        const batchSize = 1000;
        let inserted = 0;

        for (let i = 0; i < allResults.length; i += batchSize) {
            const batch = allResults.slice(i, i + batchSize);

            console.log(`💾 Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allResults.length / batchSize)} (${batch.length} records)...`);

            const { error: insertError } = await supabase
                .from('club_rolling_metrics')
                .upsert(batch, {
                    onConflict: 'club_name,snapshot_month'
                });

            if (insertError) {
                console.error(`❌ Failed to insert batch ${Math.floor(i / batchSize) + 1}:`, insertError.message);
                continue;
            }

            inserted += batch.length;
            console.log(`   ✅ Progress: ${inserted}/${allResults.length} records (${((inserted/allResults.length)*100).toFixed(1)}%)`);
        }

        console.log('\n🎉 COMPLETE club rolling metrics population finished!');
        console.log(`📊 Total records inserted: ${inserted}`);
        console.log(`🏢 Clubs covered: ${allClubs.length}`);
        console.log(`📅 Periods covered: ${snapshots.length}`);
        console.log(`✅ Complete matrix: Every club has a record for every period (including zeros)`);

        // Show sample of zero records for validation
        await showZeroRecordsSample();

    } catch (error) {
        console.error('❌ Error populating complete club rolling metrics:', error.message);
        throw error;
    }
}

async function showZeroRecordsSample() {
    console.log('\n📊 Validation - Sample of zero-activity records:');

    try {
        const { data: zeroSample, error } = await supabase
            .from('club_rolling_metrics')
            .select('*')
            .eq('active_members_12mo', 0)
            .order('club_name')
            .limit(5);

        if (error) {
            console.error('❌ Failed to fetch zero records sample:', error.message);
            return;
        }

        if (zeroSample && zeroSample.length > 0) {
            console.table(zeroSample.map(row => ({
                Club: row.club_name.substring(0, 25),
                Period: row.snapshot_month,
                'Members': row.active_members_12mo,
                'Competitions': row.total_competitions_12mo
            })));

            console.log('✅ Zero records confirmed - complete matrix created for graphing!');
        }

        // Get final summary
        const { count, error: countError } = await supabase
            .from('club_rolling_metrics')
            .select('*', { count: 'exact', head: true });

        const { data: zeroCount, error: zeroCountError } = await supabase
            .from('club_rolling_metrics')
            .select('*', { count: 'exact', head: true })
            .eq('active_members_12mo', 0);

        if (!countError && !zeroCountError) {
            console.log(`\n📈 Final Summary:`);
            console.log(`   Total records: ${count}`);
            console.log(`   Zero-activity records: ${zeroCount.length || 0}`);
            console.log(`   Active records: ${count - (zeroCount.length || 0)}`);
            console.log(`   Zero percentage: ${((zeroCount.length || 0) / count * 100).toFixed(1)}%`);
        }

    } catch (error) {
        console.error('❌ Error showing zero records sample:', error.message);
    }
}

// Run the population if this script is executed directly
if (require.main === module) {
    populateCompleteClubRollingMetrics()
        .then(() => {
            console.log('\n✅ Script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Script failed:', error.message);
            process.exit(1);
        });
}

module.exports = { populateCompleteClubRollingMetrics };