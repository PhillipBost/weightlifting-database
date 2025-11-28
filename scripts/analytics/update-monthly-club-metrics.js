const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function updateMonthlyClubMetrics(targetMonth = null) {
    console.log('🔄 Starting monthly club metrics update...');

    // Default to current month if no target specified
    if (!targetMonth) {
        const now = new Date();
        targetMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
        targetMonth = new Date(targetMonth);
        targetMonth.setDate(1); // Ensure first day of month
    }

    const monthStr = targetMonth.toISOString().substring(0, 7);
    console.log(`📅 Updating metrics for month: ${monthStr}`);

    try {
        // Calculate 12-month window ending at target month
        const windowStart = new Date(targetMonth);
        windowStart.setFullYear(windowStart.getFullYear() - 1);

        const windowStartStr = windowStart.toISOString().substring(0, 10);
        const windowEndStr = targetMonth.toISOString().substring(0, 10);

        console.log(`📊 Calculating 12-month window: ${windowStartStr} to ${windowEndStr}`);

        // Query to calculate metrics for the target month
        const query = `
            SELECT 
                club_name,
                COUNT(DISTINCT lifter_id) as active_members_12mo,
                COUNT(result_id) as total_competitions_12mo,
                COUNT(DISTINCT lifter_id) as unique_lifters_12mo
            FROM meet_results
            WHERE 
                club_name IS NOT NULL 
                AND club_name != ''
                AND date::date >= $1::date
                AND date::date < $2::date
            GROUP BY club_name
            ORDER BY club_name
        `;

        console.log('🔍 Executing metrics calculation...');
        const { data: metrics, error: queryError } = await supabase.rpc('exec_sql_with_params', {
            sql: query,
            params: [windowStartStr, windowEndStr]
        });

        if (queryError) {
            // Fallback to direct query if RPC doesn't work
            console.log('⚠️ RPC failed, using direct query approach...');
            const { data: meetResults, error: directError } = await supabase
                .from('usaw_meet_results')
                .select('club_name, lifter_id, result_id, date')
                .gte('date', windowStartStr)
                .lt('date', windowEndStr)
                .not('club_name', 'is', null)
                .neq('club_name', '');

            if (directError) {
                throw new Error(`Failed to fetch meet results: ${directError.message}`);
            }

            // Process manually
            const clubMetrics = new Map();

            for (const result of meetResults) {
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

            // Convert to expected format
            const processedMetrics = Array.from(clubMetrics.entries()).map(([club, data]) => ({
                club_name: club,
                active_members_12mo: data.lifters.size,
                total_competitions_12mo: data.competitions,
                unique_lifters_12mo: data.lifters.size
            }));

            await upsertMetrics(processedMetrics, targetMonth);
            return;
        }

        if (!metrics || metrics.length === 0) {
            console.log('⚠️ No metrics calculated for this period');
            return;
        }

        console.log(`📈 Calculated metrics for ${metrics.length} clubs`);
        await upsertMetrics(metrics, targetMonth);

    } catch (error) {
        console.error('❌ Error updating monthly club metrics:', error.message);
        throw error;
    }
}

async function upsertMetrics(metrics, targetMonth) {
    const targetMonthStr = targetMonth.toISOString().substring(0, 10);

    // Prepare records for upsert
    const records = metrics.map(metric => ({
        club_name: metric.club_name,
        snapshot_month: targetMonthStr,
        active_members_12mo: metric.active_members_12mo,
        total_competitions_12mo: metric.total_competitions_12mo,
        unique_lifters_12mo: metric.unique_lifters_12mo || metric.active_members_12mo
    }));

    console.log(`💾 Upserting ${records.length} metric records...`);

    // Upsert in batches
    const batchSize = 500;
    let processed = 0;

    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);

        const { error: upsertError } = await supabase
            .from('usaw_club_rolling_metrics')
            .upsert(batch, {
                onConflict: 'club_name,snapshot_month'
            });

        if (upsertError) {
            console.error(`❌ Failed to upsert batch ${Math.floor(i / batchSize) + 1}:`, upsertError.message);
            continue;
        }

        processed += batch.length;
        console.log(`✅ Processed ${processed}/${records.length} records`);
    }

    console.log(`🎉 Successfully updated metrics for ${processed} clubs`);

    // Show top 5 most active clubs for this month
    await showTopClubs(targetMonthStr);
}

async function showTopClubs(monthStr) {
    console.log(`\n🏆 Top 5 Most Active Clubs for ${monthStr}:`);

    try {
        const { data: topClubs, error } = await supabase
            .from('usaw_club_rolling_metrics')
            .select('club_name, active_members_12mo, total_competitions_12mo')
            .eq('snapshot_month', monthStr)
            .order('active_members_12mo', { ascending: false })
            .limit(5);

        if (error) {
            console.error('❌ Failed to fetch top clubs:', error.message);
            return;
        }

        if (topClubs && topClubs.length > 0) {
            console.table(topClubs.map((club, index) => ({
                Rank: index + 1,
                Club: club.club_name,
                'Active Members (12mo)': club.active_members_12mo,
                'Total Competitions (12mo)': club.total_competitions_12mo
            })));
        }

    } catch (error) {
        console.error('❌ Error showing top clubs:', error.message);
    }
}

async function updateLastNMonths(months = 3) {
    console.log(`🔄 Updating metrics for last ${months} months...`);

    const now = new Date();
    const promises = [];

    for (let i = 0; i < months; i++) {
        const targetMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
        promises.push(updateMonthlyClubMetrics(targetMonth));
    }

    try {
        await Promise.all(promises);
        console.log(`✅ Successfully updated metrics for last ${months} months`);
    } catch (error) {
        console.error(`❌ Error updating last ${months} months:`, error.message);
        throw error;
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: node update-monthly-club-metrics.js [options]

Options:
  --month YYYY-MM    Update metrics for specific month (default: current month)
  --last-n N         Update metrics for last N months (default: 1)
  --help, -h         Show this help message

Examples:
  node update-monthly-club-metrics.js                    # Update current month
  node update-monthly-club-metrics.js --month 2024-03   # Update March 2024
  node update-monthly-club-metrics.js --last-n 6        # Update last 6 months
        `);
        return;
    }

    try {
        const monthIndex = args.indexOf('--month');
        const lastNIndex = args.indexOf('--last-n');

        if (lastNIndex !== -1 && lastNIndex + 1 < args.length) {
            const months = parseInt(args[lastNIndex + 1]);
            if (isNaN(months) || months < 1) {
                throw new Error('Invalid number of months specified');
            }
            await updateLastNMonths(months);
        } else if (monthIndex !== -1 && monthIndex + 1 < args.length) {
            const monthStr = args[monthIndex + 1];
            if (!/^\d{4}-\d{2}$/.test(monthStr)) {
                throw new Error('Invalid month format. Use YYYY-MM');
            }
            const targetMonth = new Date(monthStr + '-01');
            await updateMonthlyClubMetrics(targetMonth);
        } else {
            await updateMonthlyClubMetrics();
        }

        console.log('✅ Monthly club metrics update completed successfully');
        process.exit(0);

    } catch (error) {
        console.error('❌ Script failed:', error.message);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = {
    updateMonthlyClubMetrics,
    updateLastNMonths
};