/**
 * WSO Weekly Analytics Calculator
 * 
 * Calculates and updates weekly metrics for each WSO region:
 * - Number of barbell clubs associated
 * - Number of recent meets (past 12 months)
 * - Number of active lifters (past 12 months)
 * - Estimated population within boundaries
 * 
 * Designed to run weekly via GitHub Actions cron job
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Calculate date range for "recent" (past 12 months from current date)
const currentDate = new Date();
const cutoffDate = new Date(currentDate);
cutoffDate.setFullYear(currentDate.getFullYear() - 1); // 12 months back
const cutoffDateString = cutoffDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

/**
 * Geographic filtering functions - point-in-polygon tests
 * These match the frontend's geometric filtering approach
 */

// Helper function to check if a point is inside a GeoJSON polygon
function pointInGeoJSON(point, geojson) {
    if (!geojson) return false;

    const [lng, lat] = point;

    // Handle Feature wrapper
    let geometry = geojson;
    if (geojson.type === 'Feature') {
        geometry = geojson.geometry;
    }

    if (!geometry || !geometry.coordinates) return false;

    // Handle both Polygon and MultiPolygon geometries
    if (geometry.type === 'Polygon') {
        return pointInPolygon([lng, lat], geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some((polygon) =>
            pointInPolygon([lng, lat], polygon[0])
        );
    }

    return false;
}

// Ray casting algorithm for point-in-polygon test
function pointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];

        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }

    return inside;
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
    
    // Get WSO territory boundary for geometric filtering
    const { data: wsoData, error: wsoError } = await supabase
        .from('wso_information')
        .select('territory_geojson')
        .eq('name', wsoName)
        .single();
    
    if (wsoError) {
        throw new Error(`Failed to get WSO boundary for ${wsoName}: ${wsoError.message}`);
    }
    
    if (!wsoData || !wsoData.territory_geojson) {
        log(`   No territory boundary found for ${wsoName}, returning 0`);
        return 0;
    }
    
    // Get ALL clubs with coordinates
    const { data: clubs, error } = await supabase
        .from('clubs')
        .select('club_name, latitude, longitude')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);
    
    if (error) {
        throw new Error(`Failed to fetch clubs: ${error.message}`);
    }
    
    // Apply geometric filtering
    const filteredClubs = clubs.filter(club => {
        if (!club.latitude || !club.longitude) return false;
        return pointInGeoJSON([club.longitude, club.latitude], wsoData.territory_geojson);
    });
    
    const count = filteredClubs.length;
    log(`   Found ${count} barbell clubs in ${wsoName} (geometric filtering)`);
    return count;
}

async function calculateRecentMeetsCount(wsoName) {
    log(`📅 Calculating recent meets count for ${wsoName}...`);
    
    // Get WSO territory boundary for geometric filtering
    const { data: wsoData, error: wsoError } = await supabase
        .from('wso_information')
        .select('territory_geojson')
        .eq('name', wsoName)
        .single();
    
    if (wsoError) {
        throw new Error(`Failed to get WSO boundary for ${wsoName}: ${wsoError.message}`);
    }
    
    if (!wsoData || !wsoData.territory_geojson) {
        log(`   No territory boundary found for ${wsoName}, returning 0`);
        return 0;
    }
    
    // Get ALL recent meets with coordinates
    const { data: meets, error } = await supabase
        .from('meets')
        .select('meet_id, latitude, longitude')
        .gte('Date', cutoffDateString)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);
    
    if (error) {
        throw new Error(`Failed to fetch meets: ${error.message}`);
    }
    
    // Apply geometric filtering
    const filteredMeets = meets.filter(meet => {
        if (!meet.latitude || !meet.longitude) return false;
        return pointInGeoJSON([meet.longitude, meet.latitude], wsoData.territory_geojson);
    });
    
    const count = filteredMeets.length;
    log(`   Found ${count} recent meets in ${wsoName} since ${cutoffDateString} (geometric filtering)`);
    return count;
}

async function calculateActiveLiftersCount(wsoName) {
    log(`🏃 Calculating active lifters count for ${wsoName}...`);
    
    // Get WSO territory boundary for geometric filtering
    const { data: wsoData, error: wsoError } = await supabase
        .from('wso_information')
        .select('territory_geojson')
        .eq('name', wsoName)
        .single();
    
    if (wsoError) {
        throw new Error(`Failed to get WSO boundary for ${wsoName}: ${wsoError.message}`);
    }
    
    if (!wsoData || !wsoData.territory_geojson) {
        log(`   No territory boundary found for ${wsoName}, returning 0`);
        return 0;
    }
    
    // Get ALL recent meets with coordinates
    const { data: meets, error: meetsError } = await supabase
        .from('meets')
        .select('meet_id, latitude, longitude')
        .gte('Date', cutoffDateString)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);
    
    if (meetsError) {
        throw new Error(`Failed to get meets for ${wsoName}: ${meetsError.message}`);
    }
    
    if (!meets || meets.length === 0) {
        log(`   No meets found for ${wsoName} since ${cutoffDateString}`);
        return 0;
    }
    
    // Apply geometric filtering to get meet IDs within WSO boundary
    const filteredMeets = meets.filter(meet => {
        if (!meet.latitude || !meet.longitude) return false;
        return pointInGeoJSON([meet.longitude, meet.latitude], wsoData.territory_geojson);
    });
    
    const meetIds = filteredMeets.map(m => m.meet_id);
    log(`   Found ${meetIds.length} meets within ${wsoName} boundary`);
    
    if (meetIds.length === 0) {
        return 0;
    }
    
    // Batch the meet IDs to avoid URI length limits (max ~200 IDs per batch)
    const batchSize = 200;
    const uniqueLifters = new Set();
    
    for (let i = 0; i < meetIds.length; i += batchSize) {
        const batchMeetIds = meetIds.slice(i, i + batchSize);
        
        // Query meet_results for this batch
        const results = await paginatedQuery(
            'meet_results',
            'lifter_id',
            (query) => query.in('meet_id', batchMeetIds)
        );
        
        // Add lifter IDs to set
        if (results) {
            results.forEach(result => {
                if (result.lifter_id) {
                    uniqueLifters.add(result.lifter_id);
                }
            });
        }
        
        if (meetIds.length > batchSize) {
            log(`   Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(meetIds.length / batchSize)}: ${uniqueLifters.size} unique lifters so far`);
        }
    }
    
    const count = uniqueLifters.size;
    log(`   Found ${count} active lifters in ${wsoName} since ${cutoffDateString} (geometric filtering)`);
    return count;
}

async function calculateTotalParticipationsCount(wsoName) {
    log(`🎯 Calculating total participations count for ${wsoName}...`);
    
    // Get WSO territory boundary for geometric filtering
    const { data: wsoData, error: wsoError } = await supabase
        .from('wso_information')
        .select('territory_geojson')
        .eq('name', wsoName)
        .single();
    
    if (wsoError) {
        throw new Error(`Failed to get WSO boundary for ${wsoName}: ${wsoError.message}`);
    }
    
    if (!wsoData || !wsoData.territory_geojson) {
        log(`   No territory boundary found for ${wsoName}, returning 0`);
        return 0;
    }
    
    // Get ALL recent meets with coordinates
    const { data: meets, error: meetsError } = await supabase
        .from('meets')
        .select('meet_id, latitude, longitude')
        .gte('Date', cutoffDateString)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);
    
    if (meetsError) {
        throw new Error(`Failed to get meets for ${wsoName}: ${meetsError.message}`);
    }
    
    if (!meets || meets.length === 0) {
        log(`   No meets found for ${wsoName} since ${cutoffDateString}`);
        return 0;
    }
    
    // Apply geometric filtering to get meet IDs within WSO boundary
    const filteredMeets = meets.filter(meet => {
        if (!meet.latitude || !meet.longitude) return false;
        return pointInGeoJSON([meet.longitude, meet.latitude], wsoData.territory_geojson);
    });
    
    const meetIds = filteredMeets.map(m => m.meet_id);
    log(`   Found ${meetIds.length} meets within ${wsoName} boundary`);
    
    if (meetIds.length === 0) {
        return 0;
    }
    
    // Batch the meet IDs to avoid URI length limits (max ~200 IDs per batch)
    const batchSize = 200;
    let totalParticipations = 0;
    
    for (let i = 0; i < meetIds.length; i += batchSize) {
        const batchMeetIds = meetIds.slice(i, i + batchSize);
        
        // Query meet_results for this batch
        const results = await paginatedQuery(
            'meet_results',
            'result_id',
            (query) => query.in('meet_id', batchMeetIds)
        );
        
        if (results) {
            totalParticipations += results.length;
        }
        
        if (meetIds.length > batchSize) {
            log(`   Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(meetIds.length / batchSize)}: ${totalParticipations} participations so far`);
        }
    }
    
    log(`   Found ${totalParticipations} total participations in ${wsoName} since ${cutoffDateString} (geometric filtering)`);
    return totalParticipations;
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
        
        // Parse state list and calculate population
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
    log(`📊 Using cutoff date: ${cutoffDateString} (past 12 months from ${currentDate.toISOString().split('T')[0]})`);
    
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

module.exports = {
    calculateBarbelClubsCount,
    calculateRecentMeetsCount,
    calculateActiveLiftersCount,
    calculateTotalParticipationsCount,
    calculateEstimatedPopulation,
    calculateWSOMterics
};