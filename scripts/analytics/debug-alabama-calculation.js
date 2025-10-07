/**
 * Debug Alabama Active Lifters Calculation
 * 
 * Deep dive into why Alabama WSO shows 0 active_lifters_count
 * even though territory_geojson exists.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const currentDate = new Date();
const cutoffDate = new Date(currentDate);
cutoffDate.setFullYear(currentDate.getFullYear() - 1);
const cutoffDateString = cutoffDate.toISOString().split('T')[0];

function log(message) {
    console.log(message);
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

function pointInGeoJSON(point, geojson) {
    if (!geojson) return false;

    const [lng, lat] = point;

    let geometry = geojson;
    if (geojson.type === 'Feature') {
        geometry = geojson.geometry;
    }

    if (!geometry || !geometry.coordinates) return false;

    if (geometry.type === 'Polygon') {
        return pointInPolygon([lng, lat], geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some((polygon) =>
            pointInPolygon([lng, lat], polygon[0])
        );
    }

    return false;
}

async function debugAlabama() {
    log('=== Debug Alabama Active Lifters Calculation ===\n');
    
    // 1. Get Alabama WSO data
    log('Step 1: Fetching Alabama WSO data...');
    const { data: wsoData, error: wsoError } = await supabase
        .from('wso_information')
        .select('name, territory_geojson, active_lifters_count, recent_meets_count, analytics_updated_at')
        .eq('name', 'Alabama')
        .single();
    
    if (wsoError) {
        log(`❌ Error: ${wsoError.message}`);
        return;
    }
    
    log(`✅ Found Alabama WSO`);
    log(`   Current active_lifters_count: ${wsoData.active_lifters_count}`);
    log(`   Current recent_meets_count: ${wsoData.recent_meets_count}`);
    log(`   Last analytics update: ${wsoData.analytics_updated_at}`);
    log(`   Has territory_geojson: ${wsoData.territory_geojson ? 'Yes' : 'No'}`);
    
    if (wsoData.territory_geojson) {
        log(`   Geometry type: ${wsoData.territory_geojson.geometry?.type}`);
    }
    
    // 2. Get ALL recent meets
    log(`\nStep 2: Fetching all recent meets (since ${cutoffDateString})...`);
    const { data: allMeets, error: meetsError } = await supabase
        .from('meets')
        .select('meet_id, Meet, Date, latitude, longitude, address, wso_geography')
        .gte('Date', cutoffDateString)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);
    
    if (meetsError) {
        log(`❌ Error: ${meetsError.message}`);
        return;
    }
    
    log(`✅ Found ${allMeets.length} recent meets with coordinates`);
    
    // 3. Filter meets within Alabama boundary
    log(`\nStep 3: Applying geometric filtering to find meets in Alabama...`);
    const alabamaMeets = allMeets.filter(meet => {
        if (!meet.latitude || !meet.longitude) return false;
        return pointInGeoJSON([meet.longitude, meet.latitude], wsoData.territory_geojson);
    });
    
    log(`✅ Found ${alabamaMeets.length} meets within Alabama boundary`);
    
    if (alabamaMeets.length > 0) {
        log(`\n   Sample Alabama meets:`);
        alabamaMeets.slice(0, 5).forEach(meet => {
            log(`   - ${meet.Meet} (${meet.Date})`);
            log(`     Coords: ${meet.latitude}, ${meet.longitude}`);
            log(`     WSO Geography: ${meet.wso_geography}`);
        });
    } else {
        log(`\n   ⚠️  No meets found in Alabama boundary!`);
        log(`   This explains why active_lifters_count is 0`);
        
        // Check if there are meets with wso_geography = 'Alabama'
        const meetsWithAlabamaTag = allMeets.filter(m => m.wso_geography === 'Alabama');
        log(`\n   Checking meets tagged as wso_geography='Alabama': ${meetsWithAlabamaTag.length}`);
        
        if (meetsWithAlabamaTag.length > 0) {
            log(`   ⚠️  Found ${meetsWithAlabamaTag.length} meets tagged as Alabama but not in boundary!`);
            log(`\n   Sample tagged meets NOT in boundary:`);
            meetsWithAlabamaTag.slice(0, 5).forEach(meet => {
                const inBoundary = pointInGeoJSON([meet.longitude, meet.latitude], wsoData.territory_geojson);
                log(`   - ${meet.Meet} (${meet.Date})`);
                log(`     Coords: ${meet.latitude}, ${meet.longitude}`);
                log(`     In boundary: ${inBoundary}`);
            });
        }
    }
    
    // 4. If we found meets, count unique lifters
    if (alabamaMeets.length > 0) {
        log(`\nStep 4: Counting unique lifters from ${alabamaMeets.length} meets...`);
        
        const meetIds = alabamaMeets.map(m => m.meet_id);
        const batchSize = 200;
        const uniqueLifters = new Set();
        let totalParticipations = 0;
        
        for (let i = 0; i < meetIds.length; i += batchSize) {
            const batchMeetIds = meetIds.slice(i, i + batchSize);
            
            const { data: results, error: resultsError } = await supabase
                .from('meet_results')
                .select('lifter_id, result_id')
                .in('meet_id', batchMeetIds);
            
            if (resultsError) {
                log(`❌ Error querying results: ${resultsError.message}`);
                continue;
            }
            
            if (results) {
                totalParticipations += results.length;
                results.forEach(result => {
                    if (result.lifter_id) {
                        uniqueLifters.add(result.lifter_id);
                    }
                });
            }
        }
        
        log(`✅ Found ${uniqueLifters.size} unique lifters`);
        log(`   Total participations: ${totalParticipations}`);
        
        if (uniqueLifters.size !== wsoData.active_lifters_count) {
            log(`\n   ⚠️  MISMATCH!`);
            log(`   Calculated: ${uniqueLifters.size} lifters`);
            log(`   Database shows: ${wsoData.active_lifters_count} lifters`);
            log(`\n   This suggests the database needs to be updated.`);
            log(`   Run: node scripts/analytics/wso-weekly-calculator.js`);
        }
    } else {
        log(`\nStep 4: Skipped (no meets found in boundary)`);
    }
    
    // 5. Additional diagnostics
    log(`\n=== DIAGNOSTIC SUMMARY ===`);
    log(`\nPossible causes for 0 active_lifters_count:`);
    log(`1. ❓ No meets in past 12 months with valid coordinates in Alabama`);
    log(`2. ❓ GeoJSON boundary doesn't match actual Alabama meet locations`);
    log(`3. ❓ Meets are tagged with wso_geography='Alabama' but coordinates are outside boundary`);
    log(`4. ❓ Database analytics haven't been updated since GeoJSON was fixed`);
    
    log(`\nCutoff date: ${cutoffDateString}`);
    log(`Total recent meets (all WSOs): ${allMeets.length}`);
    log(`Meets in Alabama boundary: ${alabamaMeets.length}`);
    
    if (alabamaMeets.length === 0) {
        log(`\n⚠️  ROOT CAUSE: Zero meets found in Alabama's geographic boundary.`);
        log(`   Either:`);
        log(`   a) No competitions held in Alabama in past 12 months with coordinates`);
        log(`   b) Alabama GeoJSON boundary is incorrect`);
        log(`   c) Meet coordinates are incorrect`);
        
        // Check total meets in database for Alabama (any time period)
        log(`\nChecking ALL meets ever in Alabama boundary (no date filter)...`);
        const { data: allTimeMeets } = await supabase
            .from('meets')
            .select('meet_id, Meet, Date, latitude, longitude')
            .not('latitude', 'is', null)
            .not('longitude', 'is', null);
        
        if (allTimeMeets) {
            const allTimeAlabama = allTimeMeets.filter(meet => 
                pointInGeoJSON([meet.longitude, meet.latitude], wsoData.territory_geojson)
            );
            
            log(`   Total meets in Alabama boundary (all time): ${allTimeAlabama.length}`);
            
            if (allTimeAlabama.length > 0) {
                log(`\n   Most recent meets in Alabama boundary:`);
                const sorted = allTimeAlabama.sort((a, b) => new Date(b.Date) - new Date(a.Date));
                sorted.slice(0, 5).forEach(meet => {
                    log(`   - ${meet.Meet} (${meet.Date})`);
                });
            }
        }
    }
}

async function main() {
    try {
        await debugAlabama();
    } catch (error) {
        log(`💥 Fatal error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
