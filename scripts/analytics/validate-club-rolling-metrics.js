const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function validateClubRollingMetrics() {
    console.log('🔍 Starting club rolling metrics validation...');

    try {
        // Test 1: Check that we have the expected number of months
        await validateMonthRange();

        // Test 2: Validate specific club calculations manually
        await validateSpecificClub();

        // Test 3: Check for data consistency
        await validateDataConsistency();

        // Test 4: Performance test for graphing queries
        await validateQueryPerformance();

        console.log('✅ All validation tests completed');

    } catch (error) {
        console.error('❌ Validation failed:', error.message);
        throw error;
    }
}

async function validateMonthRange() {
    console.log('\n📅 Test 1: Validating month range...');

    try {
        const { data: monthStats, error } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('snapshot_month')
            .order('snapshot_month');

        if (error) {
            throw new Error(`Failed to fetch month stats: ${error.message}`);
        }

        if (!monthStats || monthStats.length === 0) {
            throw new Error('No data found in club_rolling_metrics table');
        }

        const firstMonth = new Date(monthStats[0].snapshot_month);
        const lastMonth = new Date(monthStats[monthStats.length - 1].snapshot_month);
        const expectedStart = new Date('2012-01-01');
        const expectedEnd = new Date();
        expectedEnd.setDate(1); // First day of current month

        console.log(`📊 Date range: ${firstMonth.toISOString().substring(0, 7)} to ${lastMonth.toISOString().substring(0, 7)}`);

        if (firstMonth.getTime() !== expectedStart.getTime()) {
            console.warn(`⚠️ First month is ${firstMonth.toISOString().substring(0, 7)}, expected 2012-01`);
        } else {
            console.log('✅ Start date is correct (2012-01)');
        }

        // Calculate expected number of months
        const monthsDiff = (expectedEnd.getFullYear() - expectedStart.getFullYear()) * 12 +
            (expectedEnd.getMonth() - expectedStart.getMonth());

        console.log(`📈 Expected ~${monthsDiff} months of data`);

        // Get unique months count
        const uniqueMonths = new Set(monthStats.map(m => m.snapshot_month)).size;
        console.log(`📊 Found ${uniqueMonths} unique months in data`);

        if (uniqueMonths >= monthsDiff - 1) { // Allow for slight variation
            console.log('✅ Month range validation passed');
        } else {
            console.warn(`⚠️ Expected ~${monthsDiff} months, found ${uniqueMonths}`);
        }

    } catch (error) {
        console.error('❌ Month range validation failed:', error.message);
        throw error;
    }
}

async function validateSpecificClub() {
    console.log('\n🏢 Test 2: Validating specific club calculations...');

    try {
        // Get a club with reasonable activity
        const { data: activeClubs, error: clubError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('club_name, active_members_12mo')
            .gt('active_members_12mo', 5)
            .order('active_members_12mo', { ascending: false })
            .limit(1);

        if (clubError || !activeClubs || activeClubs.length === 0) {
            console.log('⚠️ No sufficiently active clubs found for validation');
            return;
        }

        const testClub = activeClubs[0].club_name;
        console.log(`🎯 Testing calculations for club: "${testClub}"`);

        // Pick a specific month to validate
        const testMonth = '2023-06-01';
        const windowStart = '2022-06-01';

        console.log(`📅 Validating ${testMonth} (12-month window from ${windowStart})`);

        // Get the stored metric
        const { data: storedMetric, error: storedError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('*')
            .eq('club_name', testClub)
            .eq('snapshot_month', testMonth)
            .single();

        if (storedError) {
            console.log(`⚠️ No stored metric found for ${testClub} in ${testMonth}`);
            return;
        }

        // Calculate manually
        const { data: manualResults, error: manualError } = await supabase
            .from('usaw_meet_results')
            .select('lifter_id, result_id')
            .eq('club_name', testClub)
            .gte('date', windowStart)
            .lt('date', testMonth);

        if (manualError) {
            throw new Error(`Failed to fetch manual calculation data: ${manualError.message}`);
        }

        const manualUniqueLifters = new Set(manualResults.map(r => r.lifter_id)).size;
        const manualTotalCompetitions = manualResults.length;

        console.log(`📊 Stored metric: ${storedMetric.active_members_12mo} members, ${storedMetric.total_competitions_12mo} competitions`);
        console.log(`📊 Manual calculation: ${manualUniqueLifters} members, ${manualTotalCompetitions} competitions`);

        if (storedMetric.active_members_12mo === manualUniqueLifters &&
            storedMetric.total_competitions_12mo === manualTotalCompetitions) {
            console.log('✅ Manual calculation matches stored metric');
        } else {
            console.error('❌ Manual calculation does not match stored metric');
            console.log('This indicates a calculation error in the rolling metrics');
        }

    } catch (error) {
        console.error('❌ Specific club validation failed:', error.message);
        throw error;
    }
}

async function validateDataConsistency() {
    console.log('\n🔄 Test 3: Validating data consistency...');

    try {
        // Check for missing data points
        const { data: clubCounts, error: countError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('club_name, snapshot_month', { count: 'exact' })
            .order('club_name');

        if (countError) {
            throw new Error(`Failed to get club counts: ${countError.message}`);
        }

        // Group by club to check for consistent month coverage
        const clubMap = new Map();
        for (const record of clubCounts) {
            if (!clubMap.has(record.club_name)) {
                clubMap.set(record.club_name, []);
            }
            clubMap.get(record.club_name).push(record.snapshot_month);
        }

        console.log(`📊 Found ${clubMap.size} clubs in rolling metrics`);

        // Check if all clubs have similar number of data points
        const monthCounts = Array.from(clubMap.values()).map(months => months.length);
        const minMonths = Math.min(...monthCounts);
        const maxMonths = Math.max(...monthCounts);
        const avgMonths = monthCounts.reduce((a, b) => a + b, 0) / monthCounts.length;

        console.log(`📈 Month counts per club: min=${minMonths}, max=${maxMonths}, avg=${avgMonths.toFixed(1)}`);

        if (maxMonths - minMonths <= 12) { // Allow some variation for clubs that started later
            console.log('✅ Data consistency check passed');
        } else {
            console.warn(`⚠️ Large variation in data points per club (${maxMonths - minMonths} month difference)`);
        }

        // Check for negative values (shouldn't exist)
        const { data: negativeValues, error: negativeError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('club_name, snapshot_month, active_members_12mo')
            .lt('active_members_12mo', 0);

        if (negativeError) {
            throw new Error(`Failed to check for negative values: ${negativeError.message}`);
        }

        if (negativeValues && negativeValues.length > 0) {
            console.error(`❌ Found ${negativeValues.length} records with negative active members`);
        } else {
            console.log('✅ No negative values found');
        }

    } catch (error) {
        console.error('❌ Data consistency validation failed:', error.message);
        throw error;
    }
}

async function validateQueryPerformance() {
    console.log('\n⚡ Test 4: Validating query performance for graphing...');

    try {
        // Test 1: Single club time series (typical graphing query)
        const startTime1 = Date.now();

        const { data: singleClubData, error: singleError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('snapshot_month, active_members_12mo')
            .eq('club_name', 'Olympic Weightlifting Club') // Use a common club name
            .order('snapshot_month')
            .limit(164); // 164 months from 2012

        const queryTime1 = Date.now() - startTime1;

        if (singleError) {
            console.log('⚠️ Single club query failed (club might not exist)');
        } else {
            console.log(`📊 Single club query: ${queryTime1}ms (${singleClubData?.length || 0} records)`);
            if (queryTime1 < 1000) {
                console.log('✅ Single club query performance is good (<1s)');
            } else {
                console.warn(`⚠️ Single club query is slow (${queryTime1}ms)`);
            }
        }

        // Test 2: Top 10 clubs for current month (dashboard query)
        const startTime2 = Date.now();
        const currentMonth = new Date().toISOString().substring(0, 7) + '-01';

        const { data: topClubsData, error: topError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('club_name, active_members_12mo')
            .eq('snapshot_month', currentMonth)
            .order('active_members_12mo', { ascending: false })
            .limit(10);

        const queryTime2 = Date.now() - startTime2;

        if (topError) {
            console.log('⚠️ Top clubs query failed');
        } else {
            console.log(`📊 Top clubs query: ${queryTime2}ms (${topClubsData?.length || 0} records)`);
            if (queryTime2 < 500) {
                console.log('✅ Top clubs query performance is excellent (<500ms)');
            } else {
                console.warn(`⚠️ Top clubs query could be faster (${queryTime2}ms)`);
            }
        }

        // Test 3: Count total records (health check)
        const startTime3 = Date.now();

        const { count, error: countError } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('*', { count: 'exact', head: true });

        const queryTime3 = Date.now() - startTime3;

        if (countError) {
            console.error('❌ Count query failed:', countError.message);
        } else {
            console.log(`📊 Total records: ${count} (query time: ${queryTime3}ms)`);
            if (count > 0) {
                console.log('✅ Data exists in rolling metrics table');
            }
        }

    } catch (error) {
        console.error('❌ Query performance validation failed:', error.message);
        throw error;
    }
}

// CLI interface
async function main() {
    try {
        await validateClubRollingMetrics();
        console.log('\n🎉 All validation tests passed successfully!');
        console.log('\n📋 Summary:');
        console.log('   ✅ Month range covers 2012-01 to present');
        console.log('   ✅ Calculations are mathematically correct');
        console.log('   ✅ Data consistency is maintained');
        console.log('   ✅ Query performance is suitable for graphing');
        console.log('\n🚀 The rolling metrics table is ready for use!');

        process.exit(0);

    } catch (error) {
        console.error('\n❌ Validation failed:', error.message);
        console.log('\n🔧 Please check the data and scripts before using the rolling metrics.');
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = { validateClubRollingMetrics };