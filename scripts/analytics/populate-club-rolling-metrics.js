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
    console.log('📅 Calculating 12-month rolling windows from 2012-01-01 to present');
    
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
            WITH monthly_snapshots AS (
                SELECT generate_series(
                    '2012-01-01'::date,
                    date_trunc('month', CURRENT_DATE),
                    '1 month'::interval
                )::date AS snapshot_month
            ),
            club_metrics AS (
                SELECT 
                    clubs.club_name,
                    ms.snapshot_month,
                    COUNT(DISTINCT mr.lifter_id) as active_members_12mo,
                    COUNT(mr.result_id) as total_competitions_12mo
                FROM monthly_snapshots ms
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
            const { data: directMetrics, error: directError } = await supabase
                .from('meet_results')
                .select(`
                    club_name,
                    date,
                    lifter_id,
                    result_id
                `);
                
            if (directError) {
                throw new Error(`Query failed: ${directError.message}`);
            }
            
            console.log('📊 Processing data manually...');
            return await processDataManually(directMetrics);
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
        currentMonth.setMonth(currentMonth.getMonth() + 1);
    }
    
    console.log(`📅 Processing ${months.length} months of data...`);
    
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