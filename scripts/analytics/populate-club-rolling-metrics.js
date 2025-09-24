const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function populateClubRollingMetrics() {
    console.log('🎯 Starting club rolling metrics population...');
    console.log('📅 Calculating 12-month rolling windows with 6-month snapshots from 2012-01-01 to present');
    
    try {
        // First, let's see how many clubs we're dealing with
        const { data: clubCount, error: countError } = await supabase
            .from('meet_results')
            .select('club_name', { count: 'exact' })
            .not('club_name', 'is', null);
            
        if (countError) {
            throw new Error(`Failed to count clubs: ${countError.message}`);
        }
        
        console.log(`📊 Found data for clubs in meet_results table`);
        
        // Execute the corrected CTE query to calculate rolling metrics
        const query = `
            WITH semiannual_snapshots AS (
                SELECT generate_series(
                    '2012-01-01'::date,
                    date_trunc('month', CURRENT_DATE),
                    '6 months'::interval
                )::date AS snapshot_month
            ),
            club_metrics AS (
                SELECT 
                    clubs.club_name,
                    ms.snapshot_month,
                    COUNT(DISTINCT mr.lifter_id) as active_members_12mo,
                    COUNT(mr.result_id) as total_competitions_12mo
                FROM semiannual_snapshots ms
                CROSS JOIN (
                    SELECT DISTINCT club_name 
                    FROM meet_results 
                    WHERE club_name IS NOT NULL 
                    AND club_name != ''
                ) clubs
                LEFT JOIN meet_results mr ON 
                    mr.club_name = clubs.club_name AND
                    mr.date::date >= (ms.snapshot_month - interval '12 months') AND
                    mr.date::date < ms.snapshot_month
                GROUP BY clubs.club_name, ms.snapshot_month
            )
            SELECT 
                club_name,
                snapshot_month,
                active_members_12mo,
                total_competitions_12mo,
                active_members_12mo as unique_lifters_12mo -- Same value for clarity
            FROM club_metrics
            WHERE club_name IS NOT NULL
            ORDER BY club_name, snapshot_month
        `;
        
        console.log('🔄 Executing rolling metrics calculation query...');
        const { data: rollingMetrics, error: queryError } = await supabase.rpc('exec_sql', {
            sql: query
        });
        
        if (queryError) {
            // If RPC doesn't work, try direct query
            console.log('⚠️ RPC failed, trying direct query...');

            // Use a different approach: process clubs individually
            console.log('📊 Using club-by-club processing approach...');

            // First get all unique clubs
            const { data: allClubsData, error: clubsError } = await supabase.rpc('exec_sql', {
                sql: 'SELECT DISTINCT club_name FROM meet_results WHERE club_name IS NOT NULL AND club_name != \'\' ORDER BY club_name'
            });

            let allClubs;
            if (clubsError || !allClubsData) {
                // Fallback: try to get clubs using regular query (will be limited but better than nothing)
                console.log('⚠️ RPC for clubs failed, using fallback method...');
                const { data: clubsFallback, error: clubsFallbackError } = await supabase
                    .from('meet_results')
                    .select('club_name')
                    .not('club_name', 'is', null)
                    .neq('club_name', '');

                if (clubsFallbackError) {
                    throw new Error(`Failed to get clubs: ${clubsFallbackError.message}`);
                }

                allClubs = [...new Set(clubsFallback.map(c => c.club_name))].sort();
            } else {
                allClubs = allClubsData.map(row => row.club_name);
            }

            console.log(`🏢 Found ${allClubs.length} unique clubs to process`);

            // Now process each club individually with its own date ranges
            console.log('📊 Processing clubs with individual queries...');
            return await processClubsIndividually(allClubs);
        }
        
        if (!rollingMetrics || rollingMetrics.length === 0) {
            console.log('⚠️ No rolling metrics data returned');
            return;
        }
        
        console.log(`📈 Calculated ${rollingMetrics.length} rolling metric records`);
        
        // Insert in batches to avoid overwhelming the database
        const batchSize = 1000;
        let inserted = 0;
        
        for (let i = 0; i < rollingMetrics.length; i += batchSize) {
            const batch = rollingMetrics.slice(i, i + batchSize);
            
            console.log(`💾 Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(rollingMetrics.length / batchSize)} (${batch.length} records)...`);
            
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
            console.log(`✅ Successfully inserted batch. Total: ${inserted}/${rollingMetrics.length}`);
        }
        
        console.log('🎉 Club rolling metrics population completed!');
        console.log(`📊 Total records inserted: ${inserted}`);
        
        // Show some sample results
        await showSampleResults();
        
    } catch (error) {
        console.error('❌ Error populating club rolling metrics:', error.message);
        throw error;
    }
}

async function processDataManually(meetResults) {
    console.log('🔧 Processing rolling metrics manually...');
    
    const metrics = new Map();
    const startDate = new Date('2012-01-01');
    const endDate = new Date();
    endDate.setDate(1); // First day of current month
    
    // Generate all months from 2012-01-01 to now
    const currentMonth = new Date(startDate);
    const months = [];
    
    while (currentMonth <= endDate) {
        months.push(new Date(currentMonth));
        currentMonth.setMonth(currentMonth.getMonth() + 6);
    }
    
    console.log(`📅 Processing ${months.length} semi-annual snapshots...`);
    
    // Get unique clubs
    const clubs = [...new Set(meetResults
        .filter(result => result.club_name && result.club_name.trim() !== '')
        .map(result => result.club_name))];
    
    console.log(`🏢 Processing ${clubs.length} clubs...`);
    
    const results = [];
    
    for (const club of clubs) {
        for (const month of months) {
            const monthKey = `${club}|${month.toISOString().substring(0, 7)}`;
            
            // Calculate 12-month window ending at this month
            const windowStart = new Date(month);
            windowStart.setFullYear(windowStart.getFullYear() - 1);
            
            const windowEnd = month;
            
            // Find all results for this club in this window
            const windowResults = meetResults.filter(result => {
                if (result.club_name !== club) return false;
                const resultDate = new Date(result.date);
                return resultDate >= windowStart && resultDate < windowEnd;
            });
            
            const uniqueLifters = new Set(windowResults.map(r => r.lifter_id));
            
            results.push({
                club_name: club,
                snapshot_month: month.toISOString().substring(0, 10),
                active_members_12mo: uniqueLifters.size,
                total_competitions_12mo: windowResults.length,
                unique_lifters_12mo: uniqueLifters.size
            });
        }
    }
    
    console.log(`📈 Calculated ${results.length} rolling metric records manually`);
    
    // Insert in batches
    const batchSize = 1000;
    let inserted = 0;
    
    for (let i = 0; i < results.length; i += batchSize) {
        const batch = results.slice(i, i + batchSize);
        
        console.log(`💾 Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(results.length / batchSize)}...`);
        
        const { error: insertError } = await supabase
            .from('club_rolling_metrics')
            .upsert(batch, {
                onConflict: 'club_name,snapshot_month'
            });
        
        if (insertError) {
            console.error(`❌ Failed to insert batch:`, insertError.message);
            continue;
        }
        
        inserted += batch.length;
    }
    
    console.log(`✅ Manual processing complete. Inserted ${inserted} records.`);
}

async function processClubsIndividually(allClubs) {
    console.log('🔧 Processing clubs individually to avoid data limits...');

    // Generate the 6-month snapshot dates
    const startDate = new Date('2012-01-01');
    const endDate = new Date();
    endDate.setDate(1);

    const currentMonth = new Date(startDate);
    const months = [];

    while (currentMonth <= endDate) {
        months.push(new Date(currentMonth));
        currentMonth.setMonth(currentMonth.getMonth() + 6);
    }

    console.log(`📅 Processing ${months.length} snapshot periods...`);
    console.log(`🏢 Processing ${allClubs.length} clubs...`);

    const results = [];
    let processedClubs = 0;

    for (const club of allClubs) {
        if (processedClubs % 50 === 0) {
            console.log(`🔄 Processing club ${processedClubs + 1}/${allClubs.length}: ${club.substring(0, 30)}...`);
        }

        for (const month of months) {
            // Calculate 12-month window ending at this month
            const windowStart = new Date(month);
            windowStart.setFullYear(windowStart.getFullYear() - 1);
            const windowEnd = month;

            // Query data for this specific club and time window
            const { data: clubData, error: clubError } = await supabase
                .from('meet_results')
                .select('lifter_id, result_id, date')
                .eq('club_name', club)
                .gte('date', windowStart.toISOString().substring(0, 10))
                .lt('date', windowEnd.toISOString().substring(0, 10));

            if (clubError) {
                console.error(`❌ Error fetching data for ${club}:`, clubError.message);
                continue;
            }

            const uniqueLifters = new Set((clubData || []).map(r => r.lifter_id));

            results.push({
                club_name: club,
                snapshot_month: month.toISOString().substring(0, 10),
                active_members_12mo: uniqueLifters.size,
                total_competitions_12mo: (clubData || []).length,
                unique_lifters_12mo: uniqueLifters.size
            });
        }

        processedClubs++;
    }

    console.log(`📈 Calculated ${results.length} rolling metric records for all clubs`);

    // Insert in batches
    const batchSize = 1000;
    let inserted = 0;

    for (let i = 0; i < results.length; i += batchSize) {
        const batch = results.slice(i, i + batchSize);

        console.log(`💾 Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(results.length / batchSize)}...`);

        const { error: insertError } = await supabase
            .from('club_rolling_metrics')
            .upsert(batch, {
                onConflict: 'club_name,snapshot_month'
            });

        if (insertError) {
            console.error(`❌ Failed to insert batch:`, insertError.message);
            continue;
        }

        inserted += batch.length;
    }

    console.log(`✅ Individual club processing complete. Inserted ${inserted} records.`);
}

async function showSampleResults() {
    console.log('\n📊 Sample Results:');
    
    try {
        // Get a sample of results
        const { data: sample, error } = await supabase
            .from('club_rolling_metrics')
            .select('*')
            .order('club_name, snapshot_month')
            .limit(10);
        
        if (error) {
            console.error('❌ Failed to fetch sample results:', error.message);
            return;
        }
        
        if (sample && sample.length > 0) {
            console.table(sample.map(row => ({
                Club: row.club_name,
                Month: row.snapshot_month,
                'Active Members (12mo)': row.active_members_12mo,
                'Total Competitions (12mo)': row.total_competitions_12mo
            })));
        }
        
        // Get summary stats
        const { data: stats, error: statsError } = await supabase
            .from('club_rolling_metrics')
            .select('club_name', { count: 'exact' });
        
        if (!statsError && stats) {
            console.log(`\n📈 Summary: Created rolling metrics for multiple clubs with ${stats.length} total data points`);
        }
        
    } catch (error) {
        console.error('❌ Error showing sample results:', error.message);
    }
}

// Run the population if this script is executed directly
if (require.main === module) {
    populateClubRollingMetrics()
        .then(() => {
            console.log('✅ Script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Script failed:', error.message);
            process.exit(1);
        });
}

module.exports = { populateClubRollingMetrics };