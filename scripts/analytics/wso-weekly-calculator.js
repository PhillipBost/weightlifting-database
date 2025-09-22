/**
 * WSO Weekly Analytics Calculator
 * 
 * Calculates and updates weekly metrics for each WSO region:
 * - Number of barbell clubs associated
 * - Number of recent meets (past 2 years)
 * - Number of active lifters (past 2 years)
 * - Estimated population within boundaries
 * 
 * Designed to run weekly via GitHub Actions cron job
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Calculate date range for "recent" (current year + previous 2 full years)
const currentYear = new Date().getFullYear();
const startYear = currentYear - 2; // Two years back
const cutoffDate = `${startYear}-01-01`; // Start of that year

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

/**
 * Paginated query helper to handle Supabase's 1000-record limit
 * @param {string} tableName - The table to query
 * @param {string} selectFields - Fields to select
 * @param {Function} queryBuilder - Function that builds the query filters
 * @param {Object} options - Options for pagination
 * @returns {Array} All results across all pages
 */
async function paginatedQuery(tableName, selectFields, queryBuilder, options = {}) {
    const batchSize = options.batchSize || 1000;
    const maxRecords = options.maxRecords || 50000; // Safety limit
    const logProgress = options.logProgress !== false; // Default to true

    let allResults = [];
    let start = 0;
    let hasMore = true;
    let batchCount = 0;

    if (logProgress) {
        log(`   📄 Starting paginated query on ${tableName} (batch size: ${batchSize})`);
    }

    while (hasMore && allResults.length < maxRecords) {
        batchCount++;

        // Build base query
        let query = supabase
            .from(tableName)
            .select(selectFields);

        // Apply filters using the query builder function
        if (queryBuilder) {
            query = queryBuilder(query);
        }

        // Add pagination
        query = query.range(start, start + batchSize - 1);

        const { data: batchData, error } = await query;

        if (error) {
            throw new Error(`Paginated query failed on ${tableName}: ${error.message}`);
        }

        if (batchData && batchData.length > 0) {
            allResults.push(...batchData);

            if (logProgress && batchCount > 1) { // Only log after first batch to avoid spam
                log(`   📄 Batch ${batchCount}: Found ${batchData.length} records (Total: ${allResults.length})`);
            }

            // Check if we got a full batch (indicates more records might exist)
            hasMore = batchData.length === batchSize;
            start += batchSize;
        } else {
            hasMore = false;
        }

        // Safety check
        if (allResults.length >= maxRecords) {
            log(`   ⚠️ Reached maximum record limit (${maxRecords}) for ${tableName} query`);
            break;
        }
    }

    if (logProgress && batchCount > 1) {
        log(`   ✅ Paginated query complete: ${allResults.length} total records from ${batchCount} batches`);
    }

    return allResults;
}

async function getAllWSOs() {
    log('📋 Fetching all WSO regions...');
    
    const { data: wsos, error } = await supabase
        .from('wso_information')
        .select('name')
        .order('name');
    
    if (error) {
        throw new Error(`Failed to fetch WSOs: ${error.message}`);
    }
    
    log(`✅ Found ${wsos.length} WSO regions`);
    return wsos;
}

async function calculateBarbelClubsCount(wsoName) {
    log(`🏋️ Calculating barbell clubs count for ${wsoName}...`);
    
    // For California WSOs, we need to count clubs by county, not by wso_geography
    if (wsoName.includes('California')) {
        return await calculateCaliforniaClubsCount(wsoName);
    }
    
    const { data: clubs, error } = await supabase
        .from('clubs')
        .select('club_name')
        .eq('wso_geography', wsoName);
    
    if (error) {
        throw new Error(`Failed to count clubs for ${wsoName}: ${error.message}`);
    }
    
    const count = clubs ? clubs.length : 0;
    log(`   Found ${count} barbell clubs in ${wsoName}`);
    return count;
}

async function calculateRecentMeetsCount(wsoName) {
    log(`📅 Calculating recent meets count for ${wsoName}...`);
    
    // For California WSOs, we need to count meets by county, not by wso_geography  
    if (wsoName.includes('California')) {
        return await calculateCaliforniaMeetsCount(wsoName);
    }
    
    // Query meets within the past 2 years that have WSO assignment matching this region
    const { data: meets, error } = await supabase
        .from('meets')
        .select('meet_id')
        .eq('wso_geography', wsoName)
        .gte('Date', cutoffDate);
    
    if (error) {
        throw new Error(`Failed to count recent meets for ${wsoName}: ${error.message}`);
    }
    
    const count = meets ? meets.length : 0;
    log(`   Found ${count} recent meets in ${wsoName} since ${cutoffDate}`);
    return count;
}

async function calculateActiveLiftersCount(wsoName) {
    log(`🏃 Calculating active lifters count for ${wsoName}...`);
    
    // For California WSOs, we need to count lifters by county, not by wso_geography
    if (wsoName.includes('California')) {
        return await calculateCaliforniaLiftersCount(wsoName);
    }
    
    // Get distinct lifters who competed in recent meets within this WSO
    // Use pagination to handle large WSOs with >1000 lifter participations
    const results = await paginatedQuery(
        'meet_results',
        'lifter_id, meets!inner(wso_geography, Date)',
        (query) => query
            .eq('meets.wso_geography', wsoName)
            .gte('meets.Date', cutoffDate)
    );
    
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
    log(`   Found ${count} active lifters in ${wsoName} since ${cutoffDate}`);
    return count;
}

async function calculateTotalParticipationsCount(wsoName) {
    log(`🎯 Calculating total participations count for ${wsoName}...`);
    
    // For California WSOs, we need to count participations by county, not by wso_geography
    if (wsoName.includes('California')) {
        return await calculateCaliforniaTotalParticipations(wsoName);
    }
    
    // Count ALL meet_results records (not distinct) within this WSO
    // Use pagination to handle large WSOs with >1000 participations
    const results = await paginatedQuery(
        'meet_results',
        'result_id, meets!inner(wso_geography, Date)',
        (query) => query
            .eq('meets.wso_geography', wsoName)
            .gte('meets.Date', cutoffDate)
    );
    
    const count = results ? results.length : 0;
    log(`   Found ${count} total participations in ${wsoName} since ${cutoffDate}`);
    return count;
}

async function calculateEstimatedPopulation(wsoName) {
    log(`🌍 Calculating estimated population for ${wsoName}...`);
    
    try {
        // Get the WSO geographic information to determine which states/counties are included
        const { data: wsoData, error: wsoError } = await supabase
            .from('wso_information')
            .select('states, counties, territory_geojson')
            .eq('name', wsoName)
            .single();
        
        if (wsoError || !wsoData) {
            throw new Error(`Failed to fetch WSO geographic data: ${wsoError?.message || 'No data found'}`);
        }
        
        // For now, use a simplified approach based on state assignments
        // TODO: Implement more sophisticated boundary-based calculation using territory_geojson
        if (!wsoData.states) {
            log(`   No state list found for ${wsoName}, returning 0`);
            return 0;
        }
        
        log(`   States data for ${wsoName}: "${wsoData.states}"`);
        log(`   Counties data for ${wsoName}: "${wsoData.counties}"`);
        
        // Special handling for California WSOs - use county data
        if (wsoName.includes('California')) {
            return await calculateCaliforniaPopulation(wsoName, wsoData.counties);
        }
        
        // Parse state list and calculate population for non-California WSOs
        let totalPopulation = 0;
        let states;
        
        if (typeof wsoData.states === 'string') {
            states = wsoData.states.split(',').map(s => s.trim());
        } else if (Array.isArray(wsoData.states)) {
            states = wsoData.states;
        } else {
            log(`   Unexpected states data type: ${typeof wsoData.states}`);
            return 0;
        }
        
        for (const state of states) {
            const cleanState = state.trim();
            log(`   Looking up population for: "${cleanState}"`);
            try {
                const statePopulation = await getStatePopulation(cleanState);
                totalPopulation += statePopulation;
                log(`   ${cleanState}: ${statePopulation.toLocaleString()}`);
            } catch (error) {
                log(`   Warning: Could not get population for "${cleanState}": ${error.message}`);
            }
        }
        
        log(`   Total estimated population for ${wsoName}: ${totalPopulation.toLocaleString()}`);
        return totalPopulation;
        
    } catch (error) {
        log(`   Error calculating population for ${wsoName}: ${error.message}`);
        return 0;
    }
}

async function getStatePopulation(stateName) {
    // For demo purposes, return estimated populations
    // TODO: Replace with actual Census API calls
    const statePopulations = {
        'Alabama': 5108000,
        'Alaska': 732000,
        'Arizona': 7431000,
        'Arkansas': 3067000,
        'California': 38965000,
        'Colorado': 5917000,
        'Connecticut': 3618000,
        'Delaware': 1031000,
        'Florida': 23244000,
        'Georgia': 11029000,
        'Hawaii': 1435000,
        'Idaho': 1967000,
        'Illinois': 12587000,
        'Indiana': 6862000,
        'Iowa': 3207000,
        'Kansas': 2940000,
        'Kentucky': 4506000,
        'Louisiana': 4573000,
        'Maine': 1423000,
        'Maryland': 6164000,
        'Massachusetts': 7001000,
        'Michigan': 10037000,
        'Minnesota': 5742000,
        'Mississippi': 2940000,
        'Missouri': 6196000,
        'Montana': 1122000,
        'Nebraska': 1978000,
        'Nevada': 3194000,
        'New Hampshire': 1403000,
        'New Jersey': 9290000,
        'New Mexico': 2114000,
        'New York': 19336000,
        'North Carolina': 10835000,
        'North Dakota': 783000,
        'Ohio': 11785000,
        'Oklahoma': 4019000,
        'Oregon': 4233000,
        'Pennsylvania': 12972000,
        'Rhode Island': 1095000,
        'South Carolina': 5373000,
        'South Dakota': 919000,
        'Tennessee': 7126000,
        'Texas': 30503000,
        'Utah': 3423000,
        'Vermont': 647000,
        'Virginia': 8715000,
        'Washington': 7812000,
        'West Virginia': 1770000,
        'Wisconsin': 5910000,
        'Wyoming': 584000
    };
    
    const population = statePopulations[stateName];
    if (!population) {
        throw new Error(`Population data not available for ${stateName}`);
    }
    
    return population;
}

async function updateWSOAnalytics(wsoName, metrics) {
    log(`💾 Updating analytics for ${wsoName}...`);
    
    // Calculate activity_factor
    const activityFactor = metrics.activeLiftersCount > 0 
        ? Math.round((metrics.totalParticipations / metrics.activeLiftersCount) * 100) / 100
        : 0;
    
    const { error } = await supabase
        .from('wso_information')
        .update({
            barbell_clubs_count: metrics.barbelClubsCount,
            recent_meets_count: metrics.recentMeetsCount,
            active_lifters_count: metrics.activeLiftersCount,
            total_participations: metrics.totalParticipations,
            estimated_population: metrics.estimatedPopulation,
            activity_factor: activityFactor
            // analytics_updated_at will be updated automatically by trigger
        })
        .eq('name', wsoName);
    
    if (error) {
        throw new Error(`Failed to update analytics for ${wsoName}: ${error.message}`);
    }
    
    log(`✅ Updated analytics for ${wsoName}: ${metrics.barbelClubsCount} clubs, ${metrics.recentMeetsCount} meets, ${metrics.activeLiftersCount} lifters, ${metrics.totalParticipations} participations, ${metrics.estimatedPopulation} population, ${activityFactor} activity_factor`);
}

async function calculateWSOMterics(wsoName) {
    log(`\n🔢 Calculating metrics for ${wsoName}...`);
    
    try {
        const metrics = {
            barbelClubsCount: await calculateBarbelClubsCount(wsoName),
            recentMeetsCount: await calculateRecentMeetsCount(wsoName),
            activeLiftersCount: await calculateActiveLiftersCount(wsoName),
            totalParticipations: await calculateTotalParticipationsCount(wsoName),
            estimatedPopulation: await calculateEstimatedPopulation(wsoName)
        };

        // Log summary with potential pagination info
        log(`   📊 WSO ${wsoName} metrics: ${metrics.barbelClubsCount} clubs, ${metrics.recentMeetsCount} meets, ${metrics.activeLiftersCount} lifters, ${metrics.totalParticipations} participations`);

        // Warn if participation count is suspiciously close to 1000 (might indicate truncation in old code)
        if (metrics.totalParticipations === 1000) {
            log(`   ⚠️ Total participations exactly 1000 - verify this is accurate and not truncated`);
        }

        await updateWSOAnalytics(wsoName, metrics);
        return { success: true, metrics };
        
    } catch (error) {
        log(`❌ Error calculating metrics for ${wsoName}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function main() {
    log('🚀 Starting WSO Weekly Analytics Calculation...');
    log(`📊 Using cutoff date: ${cutoffDate} (includes ${startYear}, ${startYear + 1}, and ${currentYear})`);
    
    try {
        const wsos = await getAllWSOs();
        const results = {
            successful: 0,
            failed: 0,
            errors: []
        };
        
        // Process each WSO
        for (const wso of wsos) {
            const result = await calculateWSOMterics(wso.name);
            
            if (result.success) {
                results.successful++;
            } else {
                results.failed++;
                results.errors.push({
                    wso: wso.name,
                    error: result.error
                });
            }
        }
        
        // Summary
        log('\n📈 WSO Analytics Calculation Complete!');
        log(`✅ Successfully processed: ${results.successful} WSOs`);
        log(`❌ Failed to process: ${results.failed} WSOs`);
        
        if (results.errors.length > 0) {
            log('\n❌ Errors encountered:');
            results.errors.forEach(err => {
                log(`   ${err.wso}: ${err.error}`);
            });
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

async function getCaliforniaMeetIds(wsoName) {
    // Get all California meets since cutoff date
    const { data: allCaMeets, error } = await supabase
        .from('meets')
        .select('meet_id, location_text')
        .ilike('location_text', '%California%')
        .gte('Date', cutoffDate);
    
    if (error || !allCaMeets) {
        return [];
    }
    
    // Get counties for this WSO
    const { data: wsoData, error: wsoError } = await supabase
        .from('wso_information')
        .select('counties')
        .eq('name', wsoName)
        .single();
    
    if (wsoError || !wsoData?.counties) {
        return [];
    }
    
    // Filter meets by counties
    const counties = Array.isArray(wsoData.counties) ? wsoData.counties : [];
    const matchingMeets = allCaMeets.filter(meet => {
        const location = (meet.location_text || '').toLowerCase();
        return counties.some(county => 
            location.includes(county.toLowerCase()) ||
            location.includes(`${county.toLowerCase()} county`)
        );
    });
    
    return matchingMeets.map(meet => meet.meet_id);
}

async function calculateCaliforniaPopulation(wsoName, countiesData) {
    log(`🌍 Calculating California population for ${wsoName}...`);
    
    if (!countiesData) {
        log(`   No counties data found for ${wsoName}`);
        return 0;
    }
    
    // TODO: Implement county-based population lookup
    // For now, return estimated values based on known CA population distribution
    if (wsoName === 'California North Central') {
        return 15000000; // Rough estimate for Northern California counties
    } else if (wsoName === 'California South') {
        return 24000000; // Rough estimate for Southern California counties  
    }
    
    return 0;
}

async function calculateCaliforniaClubsCount(wsoName) {
    log(`🏋️ Calculating California clubs count for ${wsoName}...`);
    
    // Get counties for this WSO
    const { data: wsoData, error } = await supabase
        .from('wso_information')
        .select('counties')
        .eq('name', wsoName)
        .single();
    
    if (error || !wsoData?.counties) {
        log(`   No counties data found for ${wsoName}`);
        return 0;
    }
    
    log(`   Counties for ${wsoName}: ${JSON.stringify(wsoData.counties)}`);
    log(`   Counties type: ${typeof wsoData.counties}`);
    
    // Get all California clubs and match by county
    const { data: allCaClubs, error: clubsError } = await supabase
        .from('clubs')
        .select('club_name, address, geocode_display_name')
        .or('address.ilike.%California%,geocode_display_name.ilike.%California%');
    
    if (clubsError) {
        throw new Error(`Failed to count clubs for ${wsoName}: ${clubsError.message}`);
    }
    
    if (!allCaClubs) {
        log(`   No California clubs found`);
        return 0;
    }
    
    // Filter clubs by counties for this WSO
    const counties = Array.isArray(wsoData.counties) ? wsoData.counties : [];
    const matchingClubs = allCaClubs.filter(club => {
        const address = club.address || '';
        const geocode = club.geocode_display_name || '';
        const fullAddress = `${address} ${geocode}`.toLowerCase();
        
        // Check if any county name appears in the address
        return counties.some(county => 
            fullAddress.includes(county.toLowerCase()) ||
            fullAddress.includes(`${county.toLowerCase()} county`)
        );
    });
    
    log(`   Found ${allCaClubs.length} total California clubs`);
    log(`   Matched ${matchingClubs.length} clubs to ${wsoName} counties`);
    return matchingClubs.length;
}

async function calculateCaliforniaMeetsCount(wsoName) {
    log(`📅 Calculating California meets count for ${wsoName}...`);
    
    // Get all California meets and match by county
    const { data: allCaMeets, error } = await supabase
        .from('meets')
        .select('meet_id, location_text')
        .ilike('location_text', '%California%')
        .gte('Date', cutoffDate);
    
    if (error) {
        throw new Error(`Failed to count recent meets for ${wsoName}: ${error.message}`);
    }
    
    if (!allCaMeets) {
        log(`   No California meets found since ${cutoffDate}`);
        return 0;
    }
    
    // Get counties for this WSO
    const { data: wsoData, error: wsoError } = await supabase
        .from('wso_information')
        .select('counties')
        .eq('name', wsoName)
        .single();
    
    if (wsoError || !wsoData?.counties) {
        log(`   No counties data found for ${wsoName}`);
        return 0;
    }
    
    // Filter meets by counties for this WSO
    const counties = Array.isArray(wsoData.counties) ? wsoData.counties : [];
    const matchingMeets = allCaMeets.filter(meet => {
        const location = (meet.location_text || '').toLowerCase();
        
        // Check if any county name appears in the location
        return counties.some(county => 
            location.includes(county.toLowerCase()) ||
            location.includes(`${county.toLowerCase()} county`)
        );
    });
    
    log(`   Found ${allCaMeets.length} total California meets since ${cutoffDate}`);
    log(`   Matched ${matchingMeets.length} meets to ${wsoName} counties`);
    return matchingMeets.length;
}

async function calculateCaliforniaLiftersCount(wsoName) {
    log(`🏃 Calculating California lifters count for ${wsoName}...`);
    
    // First get all California meets that match this WSO's counties
    const matchingMeetIds = await getCaliforniaMeetIds(wsoName);
    
    if (matchingMeetIds.length === 0) {
        log(`   No matching California meets found for ${wsoName}`);
        return 0;
    }
    
    // Get lifters from those meets
    // Use pagination to handle cases where there are >1000 results
    const results = await paginatedQuery(
        'meet_results',
        'lifter_id',
        (query) => query.in('meet_id', matchingMeetIds),
        { logProgress: matchingMeetIds.length > 10 } // Only log for large datasets
    );
    
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
    log(`   Found ${count} active lifters in ${wsoName} from ${matchingMeetIds.length} matching meets`);
    return count;
}

async function calculateCaliforniaTotalParticipations(wsoName) {
    log(`🎯 Calculating California total participations for ${wsoName}...`);
    
    // First get all California meets that match this WSO's counties
    const matchingMeetIds = await getCaliforniaMeetIds(wsoName);
    
    if (matchingMeetIds.length === 0) {
        log(`   No matching California meets found for ${wsoName}`);
        return 0;
    }
    
    // Count ALL meet_results records (not distinct) from those meets
    // Use pagination to handle cases where there are >1000 participations
    const results = await paginatedQuery(
        'meet_results',
        'result_id',
        (query) => query.in('meet_id', matchingMeetIds),
        { logProgress: matchingMeetIds.length > 10 } // Only log for large datasets
    );

    const count = results ? results.length : 0;
    log(`   Found ${count} total participations in ${wsoName} from ${matchingMeetIds.length} matching meets`);
    return count;
}

module.exports = {
    calculateBarbelClubsCount,
    calculateRecentMeetsCount,
    calculateActiveLiftersCount,
    calculateTotalParticipationsCount,
    calculateEstimatedPopulation,
    calculateWSOMterics
};