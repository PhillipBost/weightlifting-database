/**
 * Fix Turf Union Issues - Targeted County Border Elimination
 * 
 * The previous union attempts failed due to geometry complexity.
 * This approach uses geometry simplification and repair before union.
 */

const { createClient } = require('@supabase/supabase-js');
const union = require('@turf/union').default;
const { polygon } = require('@turf/helpers');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Install turf modules we need for geometry repair
async function installTurfModules() {
    console.log('📦 Checking required Turf.js modules...');

    try {
        const simplify = require('@turf/simplify');
        const cleanCoords = require('@turf/clean-coords');
        const rewind = require('@turf/rewind');
        console.log('✅ All required Turf modules available');
        return { simplify, cleanCoords, rewind };
    } catch (error) {
        console.log('❌ Missing Turf modules. Installing...');
        console.log('Run: npm install @turf/simplify @turf/clean-coords @turf/rewind');
        return null;
    }
}

function repairGeometry(feature, turfModules) {
    const { simplify, cleanCoords, rewind } = turfModules;

    try {
        // Step 1: Clean coordinates (remove duplicates)
        let repaired = cleanCoords(feature);

        // Step 2: Ensure proper winding order
        repaired = rewind(repaired, { reverse: false });

        // Step 3: Simplify slightly to reduce complexity
        repaired = simplify(repaired, { tolerance: 0.0001, highQuality: true });

        return repaired;
    } catch (error) {
        console.log(`    ⚠️ Geometry repair failed: ${error.message}`);
        return feature; // Return original if repair fails
    }
}

async function performSmartUnion() {
    console.log('=== Smart Union for WSO County Border Elimination ===\n');

    const turfModules = await installTurfModules();
    if (!turfModules) {
        console.log('Cannot proceed without required Turf modules');
        return;
    }

    // Get California WSOs
    const { data: californiaWSOs, error } = await supabase
        .from('usaw_wso_information')
        .select('*')
        .in('name', ['California North Central', 'California South']);

    if (error) {
        console.error('Error fetching California WSOs:', error);
        return;
    }

    for (const wso of californiaWSOs) {
        console.log(`\n--- Processing ${wso.name} with Smart Union ---`);

        if (!wso.territory_geojson || wso.territory_geojson.geometry.type !== 'MultiPolygon') {
            console.log('⚠️ Skipping - not a MultiPolygon');
            continue;
        }

        const multiPolygon = wso.territory_geojson;
        const coordinates = multiPolygon.geometry.coordinates;

        console.log(`📊 Input: ${coordinates.length} separate polygons`);

        // Convert each polygon coordinate set to a proper Turf feature
        const polygonFeatures = coordinates.map((polyCoords, index) => {
            try {
                const feature = polygon(polyCoords, {
                    index: index,
                    county_part: `part_${index}`
                });

                // Repair geometry issues
                return repairGeometry(feature, turfModules);

            } catch (error) {
                console.log(`    ❌ Invalid polygon ${index}: ${error.message}`);
                return null;
            }
        }).filter(Boolean); // Remove null entries

        console.log(`🔧 Repaired: ${polygonFeatures.length} valid polygons`);

        if (polygonFeatures.length === 0) {
            console.log('❌ No valid polygons after repair');
            continue;
        }

        if (polygonFeatures.length === 1) {
            console.log('✅ Single polygon - no union needed');
            continue;
        }

        // Attempt progressive union with small batches
        console.log('🔄 Attempting progressive union...');

        let unionResult = polygonFeatures[0];
        let successCount = 1;

        // Process in small batches to avoid complexity issues
        for (let i = 1; i < polygonFeatures.length; i++) {
            try {
                console.log(`  Union step ${i}/${polygonFeatures.length - 1}`);

                const nextPolygon = polygonFeatures[i];
                const attempt = union(unionResult, nextPolygon);

                if (attempt && attempt.geometry) {
                    unionResult = attempt;
                    successCount++;

                    // Progress update every 5 unions
                    if (i % 5 === 0) {
                        console.log(`    ✅ ${successCount} polygons successfully merged`);
                    }
                } else {
                    console.log(`    ⚠️ Union ${i} returned null, continuing...`);
                }

            } catch (unionError) {
                console.log(`    ❌ Union ${i} failed: ${unionError.message}`);
                // Continue with what we have
                break;
            }
        }

        const finalPolygonCount = unionResult.geometry.type === 'MultiPolygon'
            ? unionResult.geometry.coordinates.length
            : 1;

        console.log(`📊 Result: ${finalPolygonCount} polygon(s) (reduced from ${coordinates.length})`);
        console.log(`🎯 Borders eliminated: ${coordinates.length - finalPolygonCount}`);
        console.log(`📈 Success rate: ${Math.round((successCount / polygonFeatures.length) * 100)}%`);

        if (finalPolygonCount < coordinates.length) {
            // We achieved some border reduction
            const updatedGeoJSON = {
                type: 'Feature',
                geometry: unionResult.geometry,
                properties: {
                    ...multiPolygon.properties,
                    merge_method: 'smart_turf_union',
                    border_elimination: true,
                    polygon_count_before: coordinates.length,
                    polygon_count_after: finalPolygonCount,
                    borders_eliminated: coordinates.length - finalPolygonCount,
                    successful_unions: successCount,
                    union_success_rate: `${Math.round((successCount / polygonFeatures.length) * 100)}%`,
                    geometry_repair_applied: true,
                    processing_date: new Date().toISOString(),
                    note: `Smart union: eliminated ${coordinates.length - finalPolygonCount} county borders`
                }
            };

            console.log('💾 Updating database with improved geometry...');

            const { error: updateError } = await supabase
                .from('usaw_wso_information')
                .update({
                    territory_geojson: updatedGeoJSON,
                    updated_at: new Date().toISOString()
                })
                .eq('name', wso.name);

            if (updateError) {
                console.error('❌ Database update failed:', updateError);
            } else {
                console.log('✅ Database updated successfully');
                console.log(`🎉 ${wso.name} now has ${coordinates.length - finalPolygonCount} fewer visible borders!`);
            }
        } else {
            console.log('❌ No border reduction achieved');
        }
    }

    console.log('\n=== Smart Union Complete ===');
    console.log('Run validation script to check results...');
}

// Run the smart union process
if (require.main === module) {
    performSmartUnion().catch(console.error);
}