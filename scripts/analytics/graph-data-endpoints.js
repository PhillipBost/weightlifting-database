const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

/**
 * Graph Data Endpoints for Frontend
 * Optimized queries for common graphing scenarios
 */

// 1. Single club time series data
async function getClubTimeSeries(clubName, startDate = '2012-01-01', endDate = null) {
    try {
        let query = supabase
            .from('club_rolling_metrics')
            .select('snapshot_month, active_members_12mo, total_competitions_12mo')
            .eq('club_name', clubName)
            .gte('snapshot_month', startDate)
            .order('snapshot_month');
        
        if (endDate) {
            query = query.lte('snapshot_month', endDate);
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        return {
            success: true,
            data: data.map(row => ({
                month: row.snapshot_month,
                activeMembers: row.active_members_12mo,
                competitions: row.total_competitions_12mo
            })),
            dataPoints: data.length
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            data: []
        };
    }
}

// 2. Top clubs for specific month
async function getTopClubs(month = null, limit = 20) {
    try {
        // Default to current month if not specified
        if (!month) {
            month = new Date().toISOString().substring(0, 7) + '-01';
        }
        
        const { data, error } = await supabase
            .from('club_rolling_metrics')
            .select('club_name, active_members_12mo, total_competitions_12mo')
            .eq('snapshot_month', month)
            .order('active_members_12mo', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        return {
            success: true,
            data: data.map((row, index) => ({
                rank: index + 1,
                clubName: row.club_name,
                activeMembers: row.active_members_12mo,
                competitions: row.total_competitions_12mo
            })),
            month: month,
            totalClubs: data.length
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            data: []
        };
    }
}

// 3. Monthly aggregates for overview charts
async function getMonthlyAggregates(startDate = '2012-01-01', endDate = null) {
    try {
        // This query aggregates across all clubs for each month
        let query = `
            SELECT 
                snapshot_month,
                COUNT(DISTINCT club_name) as active_clubs,
                ROUND(AVG(active_members_12mo), 1) as avg_members_per_club,
                SUM(active_members_12mo) as total_active_members,
                MAX(active_members_12mo) as largest_club_size,
                SUM(total_competitions_12mo) as total_competitions
            FROM club_rolling_metrics
            WHERE snapshot_month >= $1
        `;
        
        const params = [startDate];
        
        if (endDate) {
            query += ` AND snapshot_month <= $2`;
            params.push(endDate);
        }
        
        query += ` GROUP BY snapshot_month ORDER BY snapshot_month`;
        
        const { data, error } = await supabase.rpc('exec_sql_with_params', {
            sql: query,
            params: params
        });
        
        if (error) {
            // Fallback to manual aggregation if RPC fails
            return await getMonthlyAggregatesManual(startDate, endDate);
        }
        
        return {
            success: true,
            data: data || [],
            dataPoints: data?.length || 0
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            data: []
        };
    }
}

// Fallback manual aggregation
async function getMonthlyAggregatesManual(startDate, endDate) {
    try {
        let query = supabase
            .from('club_rolling_metrics')
            .select('snapshot_month, club_name, active_members_12mo, total_competitions_12mo')
            .gte('snapshot_month', startDate)
            .order('snapshot_month');
        
        if (endDate) {
            query = query.lte('snapshot_month', endDate);
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Group by month and calculate aggregates
        const monthlyData = new Map();
        
        data.forEach(row => {
            const month = row.snapshot_month;
            if (!monthlyData.has(month)) {
                monthlyData.set(month, {
                    snapshot_month: month,
                    clubs: new Set(),
                    members: [],
                    competitions: 0
                });
            }
            
            const monthData = monthlyData.get(month);
            monthData.clubs.add(row.club_name);
            monthData.members.push(row.active_members_12mo);
            monthData.competitions += row.total_competitions_12mo;
        });
        
        // Convert to final format
        const aggregates = Array.from(monthlyData.values()).map(monthData => ({
            snapshot_month: monthData.snapshot_month,
            active_clubs: monthData.clubs.size,
            avg_members_per_club: monthData.members.length > 0 ? 
                Math.round(monthData.members.reduce((a, b) => a + b, 0) / monthData.members.length * 10) / 10 : 0,
            total_active_members: monthData.members.reduce((a, b) => a + b, 0),
            largest_club_size: Math.max(...monthData.members),
            total_competitions: monthData.competitions
        })).sort((a, b) => a.snapshot_month.localeCompare(b.snapshot_month));
        
        return {
            success: true,
            data: aggregates,
            dataPoints: aggregates.length
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            data: []
        };
    }
}

// 4. Multi-club comparison for specific time period
async function getMultiClubComparison(clubNames, startDate = '2022-01-01', endDate = null) {
    try {
        let query = supabase
            .from('club_rolling_metrics')
            .select('club_name, snapshot_month, active_members_12mo')
            .in('club_name', clubNames)
            .gte('snapshot_month', startDate)
            .order('snapshot_month');
        
        if (endDate) {
            query = query.lte('snapshot_month', endDate);
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        // Organize data by club for easy charting
        const clubData = {};
        clubNames.forEach(club => {
            clubData[club] = [];
        });
        
        data.forEach(row => {
            if (clubData[row.club_name]) {
                clubData[row.club_name].push({
                    month: row.snapshot_month,
                    activeMembers: row.active_members_12mo
                });
            }
        });
        
        return {
            success: true,
            data: clubData,
            totalDataPoints: data.length
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            data: {}
        };
    }
}

// 5. Multi-club historical line chart data (optimized for 20+ clubs)
async function getMultiClubHistoricalChart(options = {}) {
    const {
        clubCount = 25,           // Number of top clubs to include
        startDate = '2012-01-01', // Full history from 2012
        endDate = null,           // Through present
        minActivityThreshold = 10, // Minimum recent activity to be included
        sortBy = 'peak'           // 'peak', 'recent', or 'average'
    } = options;

    try {
        console.log(`🎯 Getting historical data for top ${clubCount} clubs from ${startDate}...`);
        
        // Step 1: Identify the top clubs based on sorting criteria
        const topClubs = await getTopActiveClubs(clubCount, minActivityThreshold, sortBy);
        
        if (!topClubs.success || topClubs.data.length === 0) {
            return {
                success: false,
                error: 'No active clubs found matching criteria',
                data: []
            };
        }
        
        const clubNames = topClubs.data.map(club => club.name);
        console.log(`📊 Selected clubs: ${clubNames.slice(0, 5).join(', ')}${clubNames.length > 5 ? ` + ${clubNames.length - 5} more` : ''}`);
        
        // Step 2: Get historical data for these clubs
        let query = supabase
            .from('club_rolling_metrics')
            .select('club_name, snapshot_month, active_members_12mo')
            .in('club_name', clubNames)
            .gte('snapshot_month', startDate)
            .order('snapshot_month');
        
        if (endDate) {
            query = query.lte('snapshot_month', endDate);
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        console.log(`📈 Retrieved ${data.length} data points for historical chart`);
        
        // Step 3: Structure data for multi-line chart
        const chartData = structureMultiLineData(data, clubNames);
        
        return {
            success: true,
            data: chartData,
            metadata: {
                clubCount: clubNames.length,
                dataPointsPerClub: chartData.months?.length || 0,
                totalDataPoints: data.length,
                dateRange: {
                    start: startDate,
                    end: endDate || 'present'
                },
                clubs: topClubs.data.map(club => ({
                    name: club.name,
                    peakMembers: club.peakMembers,
                    recentMembers: club.recentMembers
                }))
            }
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            data: []
        };
    }
}

// Helper: Get top active clubs based on different criteria
async function getTopActiveClubs(limit = 25, minActivityThreshold = 10, sortBy = 'peak') {
    try {
        // Get recent activity (last 12 months) and historical peak for each club
        const recentDate = new Date();
        recentDate.setFullYear(recentDate.getFullYear() - 1);
        const recentDateStr = recentDate.toISOString().substring(0, 7) + '-01';
        
        // Query for club performance metrics
        const { data, error } = await supabase
            .from('club_rolling_metrics')
            .select('club_name, snapshot_month, active_members_12mo')
            .gte('active_members_12mo', 1); // Exclude zero-activity periods
        
        if (error) throw error;
        
        // Analyze each club's performance
        const clubStats = new Map();
        
        data.forEach(row => {
            const club = row.club_name;
            const isRecent = row.snapshot_month >= recentDateStr;
            
            if (!clubStats.has(club)) {
                clubStats.set(club, {
                    name: club,
                    peakMembers: 0,
                    recentMembers: 0,
                    totalDataPoints: 0,
                    averageMembers: 0,
                    memberSum: 0
                });
            }
            
            const stats = clubStats.get(club);
            stats.totalDataPoints++;
            stats.memberSum += row.active_members_12mo;
            stats.peakMembers = Math.max(stats.peakMembers, row.active_members_12mo);
            
            if (isRecent) {
                stats.recentMembers = Math.max(stats.recentMembers, row.active_members_12mo);
            }
        });
        
        // Calculate averages and filter
        const clubs = Array.from(clubStats.values())
            .map(club => ({
                ...club,
                averageMembers: Math.round(club.memberSum / club.totalDataPoints * 10) / 10
            }))
            .filter(club => club.recentMembers >= minActivityThreshold);
        
        // Sort based on criteria
        clubs.sort((a, b) => {
            switch (sortBy) {
                case 'recent':
                    return b.recentMembers - a.recentMembers;
                case 'average':
                    return b.averageMembers - a.averageMembers;
                case 'peak':
                default:
                    return b.peakMembers - a.peakMembers;
            }
        });
        
        return {
            success: true,
            data: clubs.slice(0, limit),
            totalClubs: clubs.length
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            data: []
        };
    }
}

// Helper: Structure data for multi-line charting libraries
function structureMultiLineData(rawData, clubNames) {
    // Group data by month to create consistent time series
    const monthMap = new Map();
    
    rawData.forEach(row => {
        const month = row.snapshot_month;
        if (!monthMap.has(month)) {
            monthMap.set(month, { month });
        }
        monthMap.get(month)[row.club_name] = row.active_members_12mo;
    });
    
    // Convert to array and sort by month
    const months = Array.from(monthMap.values())
        .sort((a, b) => a.month.localeCompare(b.month));
    
    // Ensure all clubs have data for all months (fill with null for missing data)
    months.forEach(monthData => {
        clubNames.forEach(club => {
            if (!(club in monthData)) {
                monthData[club] = null; // Chart libraries handle null gracefully
            }
        });
    });
    
    return {
        months: months.map(m => m.month),
        clubs: clubNames,
        series: clubNames.map(club => ({
            name: club,
            data: months.map(monthData => monthData[club])
        })),
        rawData: months // For frameworks that prefer this format
    };
}

// 6. Get available clubs list (for dropdowns)
async function getAvailableClubs(minActivityLevel = 5) {
    try {
        // Get clubs that have had at least minActivityLevel members in recent months
        const { data, error } = await supabase
            .from('club_rolling_metrics')
            .select('club_name, active_members_12mo')
            .gte('snapshot_month', '2023-01-01')
            .gte('active_members_12mo', minActivityLevel)
            .order('club_name');
        
        if (error) throw error;
        
        // Get unique clubs with their peak activity
        const clubMap = new Map();
        data.forEach(row => {
            const existing = clubMap.get(row.club_name);
            if (!existing || row.active_members_12mo > existing.peakMembers) {
                clubMap.set(row.club_name, {
                    name: row.club_name,
                    peakMembers: row.active_members_12mo
                });
            }
        });
        
        const clubs = Array.from(clubMap.values())
            .sort((a, b) => b.peakMembers - a.peakMembers);
        
        return {
            success: true,
            data: clubs,
            totalClubs: clubs.length
        };
        
    } catch (error) {
        return {
            success: false,
            error: error.message,
            data: []
        };
    }
}

// CLI interface for testing
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help')) {
        console.log(`
Graph Data Endpoints - Test CLI

Usage: node graph-data-endpoints.js [command] [options]

Commands:
  club [name]           Get time series for specific club
  top [month] [limit]   Get top clubs for month (default: current, limit: 20)
  aggregates            Get monthly aggregates
  clubs                 Get available clubs list
  compare [club1,club2] Compare multiple clubs
  historical [count] [sort] Get historical multi-line chart data

Examples:
  node graph-data-endpoints.js club "Olympic Weightlifting Club"
  node graph-data-endpoints.js top 2024-06-01 10
  node graph-data-endpoints.js aggregates
  node graph-data-endpoints.js compare "Club A,Club B,Club C"
  node graph-data-endpoints.js historical 25 peak
        `);
        return;
    }
    
    const command = args[0];
    
    try {
        let result;
        
        switch (command) {
            case 'club':
                const clubName = args[1];
                if (!clubName) {
                    console.error('Please specify a club name');
                    return;
                }
                result = await getClubTimeSeries(clubName);
                break;
                
            case 'top':
                const month = args[1];
                const limit = args[2] ? parseInt(args[2]) : 20;
                result = await getTopClubs(month, limit);
                break;
                
            case 'aggregates':
                result = await getMonthlyAggregates();
                break;
                
            case 'clubs':
                result = await getAvailableClubs();
                break;
                
            case 'compare':
                const clubList = args[1];
                if (!clubList) {
                    console.error('Please specify club names separated by commas');
                    return;
                }
                const clubs = clubList.split(',').map(name => name.trim());
                result = await getMultiClubComparison(clubs);
                break;
                
            case 'historical':
                const count = args[1] ? parseInt(args[1]) : 25;
                const sortBy = args[2] || 'peak';
                result = await getMultiClubHistoricalChart({
                    clubCount: count,
                    sortBy: sortBy
                });
                break;
                
            default:
                console.error('Unknown command. Use --help for usage information.');
                return;
        }
        
        console.log(JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Run CLI if executed directly
if (require.main === module) {
    main();
}

module.exports = {
    getClubTimeSeries,
    getTopClubs,
    getMonthlyAggregates,
    getMultiClubComparison,
    getAvailableClubs,
    getMultiClubHistoricalChart,
    getTopActiveClubs
};