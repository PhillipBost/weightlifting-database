/**
 * Check Specific Meet Coordinates
 * 
 * Investigates why a specific meet (like Bham Slam) isn't being found
 * in Alabama's boundary even though it's clearly in Birmingham, AL
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

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

async function checkMeet(searchTerm) {
    log(`=== Checking Meet: "${searchTerm}" ===\n`);

    // Search for meet
    const { data: meets, error: searchError } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, Date, address, latitude, longitude, wso_geography')
        .ilike('Meet', `%${searchTerm}%`)
        .order('Date', { ascending: false });

    if (searchError) {
        log(`❌ Error: ${searchError.message}`);
        return;
    }

    if (!meets || meets.length === 0) {
        log(`❌ No meets found matching "${searchTerm}"`);
        return;
    }

    log(`✅ Found ${meets.length} meet(s) matching "${searchTerm}":\n`);

    // Get Alabama boundary
    const { data: wsoData } = await supabase
        .from('usaw_wso_information')
        .select('name, territory_geojson')
        .eq('name', 'Alabama')
        .single();

    // Check each meet
    for (const meet of meets) {
        log(`Meet: ${meet.Meet}`);
        log(`Date: ${meet.Date}`);
        log(`Address: ${meet.address || 'N/A'}`);
        log(`Coordinates: ${meet.latitude}, ${meet.longitude}`);
        log(`WSO Geography: ${meet.wso_geography || 'NULL'}`);

        if (!meet.latitude || !meet.longitude) {
            log(`❌ ISSUE: Missing coordinates!`);
            log(`   This meet will be excluded from analytics (requires coordinates)\n`);
        } else {
            // Test if in Alabama boundary
            const inBoundary = pointInGeoJSON([meet.longitude, meet.latitude], wsoData.territory_geojson);
            log(`In Alabama boundary: ${inBoundary ? '✅ YES' : '❌ NO'}`);

            if (!inBoundary) {
                log(`⚠️  ISSUE: Coordinates outside Alabama boundary!`);
                log(`   Expected: Birmingham, AL should be around 33.52°N, -86.80°W`);
                log(`   Actual: ${meet.latitude}°N, ${meet.longitude}°W`);

                // Check if coordinates might be swapped
                const swappedInBoundary = pointInGeoJSON([meet.latitude, meet.longitude], wsoData.territory_geojson);
                if (swappedInBoundary) {
                    log(`   ⚠️  COORDINATES ARE SWAPPED! (lat/lng reversed)`);
                    log(`   Correct order should be: longitude=${meet.latitude}, latitude=${meet.longitude}`);
                }
            }
        }

        log('');
    }

    // Additional check: Look for recent Alabama meets
    log(`\n=== Recent Alabama Meets (past 2 years) ===\n`);

    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const cutoffString = twoYearsAgo.toISOString().split('T')[0];

    const { data: recentMeets } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, Date, address, latitude, longitude, wso_geography')
        .gte('Date', cutoffString)
        .or('address.ilike.%Alabama%,address.ilike.%AL %,address.ilike.%, AL,%')
        .order('Date', { ascending: false });

    if (recentMeets && recentMeets.length > 0) {
        log(`Found ${recentMeets.length} recent meets with Alabama in address:\n`);

        recentMeets.slice(0, 10).forEach(meet => {
            const hasCoords = meet.latitude && meet.longitude;
            const coordsSymbol = hasCoords ? '📍' : '❌';
            log(`${coordsSymbol} ${meet.Meet} (${meet.Date})`);
            if (hasCoords) {
                log(`   Coords: ${meet.latitude}, ${meet.longitude}`);
                const inBoundary = pointInGeoJSON([meet.longitude, meet.latitude], wsoData.territory_geojson);
                log(`   In boundary: ${inBoundary ? 'YES' : 'NO'}`);
            } else {
                log(`   No coordinates`);
            }
            log('');
        });
    }
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help')) {
        console.log('Check Specific Meet Coordinates');
        console.log('================================\n');
        console.log('Usage:');
        console.log('  node scripts/analytics/check-specific-meet.js "search term"\n');
        console.log('Examples:');
        console.log('  node scripts/analytics/check-specific-meet.js "Bham Slam"');
        console.log('  node scripts/analytics/check-specific-meet.js "Alabama Open"');
        return;
    }

    const searchTerm = args[0];

    try {
        await checkMeet(searchTerm);
    } catch (error) {
        log(`💥 Fatal error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { checkMeet };
