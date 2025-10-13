/**
 * Club Weekly Analytics Calculator
 *
 * Calculates and updates weekly metrics for each club:
 * - Number of recent meets (past 24 months) where club members participated
 * - Number of active lifters (past 24 months) associated with the club
 * - Total participations (past 24 months)
 *
 * Designed to run weekly via GitHub Actions cron job
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Calculate date range for all metrics (past 24 months from current date)
const currentDate = new Date();
const cutoffDate = new Date(currentDate);
cutoffDate.setFullYear(currentDate.getFullYear() - 2); // 24 months back
const cutoffDateString = cutoffDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

async function getAllClubs() {
    log('📋 Fetching all clubs...');
    
    let allClubs = [];
    let from = 0;
    const pageSize = 1000;
    
    while (true) {
        const { data: clubs, error } = await supabase
            .from('clubs')
            .select('club_name')
            .range(from, from + pageSize - 1)
            .order('club_name');
        
        if (error) {
            throw new Error(`Failed to fetch clubs: ${error.message}`);
        }
        
        if (!clubs || clubs.length === 0) {
            break;
        }
        
        allClubs.push(...clubs);
        from += pageSize;
        
        if (clubs.length < pageSize) {
            break; // Last page
        }
    }
    
    log(`✅ Found ${allClubs.length} clubs`);
    return allClubs;
}

async function calculateClubRecentMeets(clubName) {
    log(`📅 Calculating recent meets count for "${clubName}"...`);
    
    // Count distinct meet_ids from meet_results where club_name matches
    // and the meet date is within our cutoff period
    const { data: results, error } = await supabase
        .from('meet_results')
        .select('meet_id, meets!inner(Date)')
        .eq('club_name', clubName)
        .gte('meets.Date', cutoffDateString);
    
    if (error) {
        throw new Error(`Failed to count recent meets for ${clubName}: ${error.message}`);
    }
    
    // Get unique meet IDs
    const uniqueMeetIds = new Set();
    if (results) {
        results.forEach(result => {
            if (result.meet_id) {
                uniqueMeetIds.add(result.meet_id);
            }
        });
    }
    
    const count = uniqueMeetIds.size;
    log(`   Found ${count} recent meets for "${clubName}" since ${cutoffDateString}`);
    return count;
}

async function calculateClubActiveLifters(clubName) {
    log(`🏃 Calculating active lifters count for "${clubName}"...`);

    // Count distinct lifter_ids from meet_results where club_name matches
    // and the meet date is within our 24-month cutoff period
    const { data: results, error } = await supabase
        .from('meet_results')
        .select('lifter_id, meets!inner(Date)')
        .eq('club_name', clubName)
        .gte('meets.Date', cutoffDateString);

    if (error) {
        throw new Error(`Failed to count active lifters for ${clubName}: ${error.message}`);
    }

    // Get unique lifter IDs
    const uniqueLifters = new Set();
    if (results) {
        results.forEach(result => {
            if (result.lifter_id) {
                uniqueLifters.add(result.lifter_id);
            }
        });
    }

    const count = uniqueLifters.size;
    log(`   Found ${count} active lifters for "${clubName}" since ${cutoffDateString}`);
    return count;
}

async function calculateClubTotalParticipations(clubName) {
    log(`🎯 Calculating total participations count for "${clubName}"...`);
    
    // Count ALL meet_results records (not distinct) where club_name matches
    // and the meet date is within our cutoff period
    const { data: results, error } = await supabase
        .from('meet_results')
        .select('result_id, meets!inner(Date)')
        .eq('club_name', clubName)
        .gte('meets.Date', cutoffDateString);
    
    if (error) {
        throw new Error(`Failed to count total participations for ${clubName}: ${error.message}`);
    }
    
    const count = results ? results.length : 0;
    log(`   Found ${count} total participations for "${clubName}" since ${cutoffDateString}`);
    return count;
}

async function updateClubAnalytics(clubName, metrics) {
    log(`💾 Updating analytics for "${clubName}"...`);
    
    // Calculate activity_factor
    const activityFactor = metrics.activeLiftersCount > 0 
        ? Math.round((metrics.totalParticipations / metrics.activeLiftersCount) * 100) / 100
        : 0;
    
    const { error } = await supabase
        .from('clubs')
        .update({
            recent_meets_count: metrics.recentMeetsCount,
            active_lifters_count: metrics.activeLiftersCount,
            total_participations: metrics.totalParticipations,
            activity_factor: activityFactor
            // analytics_updated_at will be updated automatically by trigger
        })
        .eq('club_name', clubName);
    
    if (error) {
        throw new Error(`Failed to update analytics for ${clubName}: ${error.message}`);
    }
    
    log(`✅ Updated analytics for "${clubName}": ${metrics.recentMeetsCount} meets, ${metrics.activeLiftersCount} lifters, ${metrics.totalParticipations} participations, ${activityFactor} activity_factor`);
}

async function calculateClubMetrics(clubName) {
    log(`\n🔢 Calculating metrics for "${clubName}"...`);
    
    try {
        const metrics = {
            recentMeetsCount: await calculateClubRecentMeets(clubName),
            activeLiftersCount: await calculateClubActiveLifters(clubName),
            totalParticipations: await calculateClubTotalParticipations(clubName)
        };
        
        await updateClubAnalytics(clubName, metrics);
        return { success: true, metrics };
        
    } catch (error) {
        log(`❌ Error calculating metrics for "${clubName}": ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function main() {
    log('🚀 Starting Club Weekly Analytics Calculation...');
    log(`📊 Using cutoff date: ${cutoffDateString} (past 24 months from today)`);

    try {
        const clubs = await getAllClubs();
        
        if (clubs.length === 0) {
            log('⚠️ No clubs found in database');
            return;
        }
        
        const results = {
            successful: 0,
            failed: 0,
            errors: []
        };
        
        // Process each club
        for (let i = 0; i < clubs.length; i++) {
            const club = clubs[i];
            
            // Progress indicator for large datasets
            if (i % 50 === 0) {
                log(`📈 Processing club ${i + 1}/${clubs.length}...`);
            }
            
            const result = await calculateClubMetrics(club.club_name);
            
            if (result.success) {
                results.successful++;
            } else {
                results.failed++;
                results.errors.push({
                    club: club.club_name,
                    error: result.error
                });
            }
            
            // Small delay to be nice to the database
            if (i % 10 === 0 && i > 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Summary
        log('\n📈 Club Analytics Calculation Complete!');
        log(`✅ Successfully processed: ${results.successful} clubs`);
        log(`❌ Failed to process: ${results.failed} clubs`);
        
        if (results.errors.length > 0) {
            log('\n❌ Errors encountered:');
            results.errors.slice(0, 10).forEach(err => { // Show max 10 errors
                log(`   "${err.club}": ${err.error}`);
            });
            
            if (results.errors.length > 10) {
                log(`   ... and ${results.errors.length - 10} more errors`);
            }
        }
        
        // Exit with error code if any failures occurred
        if (results.failed > 0) {
            process.exit(1);
        }
        
    } catch (error) {
        log(`💥 Fatal error: ${error.message}`);
        process.exit(1);
    }
}

// Handle command line execution
if (require.main === module) {
    main();
}

module.exports = {
    calculateClubRecentMeets,
    calculateClubActiveLifters,
    calculateClubTotalParticipations,
    calculateClubMetrics
};