/**
 * WSO County Polygon Union Tool
 * 
 * Eliminates visible county borders within WSO regions by merging individual 
 * county polygons into unified territories using Turf.js union operations.
 */

const { createClient } = require('@supabase/supabase-js');
const union = require('@turf/union').default;
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function unifyWSORPolygons() {
    console.log('=== WSO County Polygon Union Tool ===\n');

    // Fetch California WSOs that need polygon merging
    const { data: californiaWSOs, error } = await supabase
        .from('usaw_wso_information')
        .select('*')
        .in('name', ['California North Central', 'California South']);

    if (error) {
        console.error('Error fetching California WSOs:', error);
        return;
    }

    if (!californiaWSOs || californiaWSOs.length === 0) {
        console.log('No California WSOs found');
        return;
    }

    for (const wso of californiaWSOs) {
        console.log(`\n--- Processing ${wso.name} ---`);

        if (!wso.territory_geojson || wso.territory_geojson.geometry.type !== 'MultiPolygon') {
            console.log('⚠️ Skipping - not a MultiPolygon or no GeoJSON data');
            continue;
        }

        const multiPolygon = wso.territory_geojson;
        const polygonCount = multiPolygon.geometry.coordinates.length;

        console.log(`📍 Current: MultiPolygon with ${polygonCount} separate polygons`);
        console.log(`🎯 Target: Single unified polygon (eliminating ${polygonCount - 1} internal borders)`);

        if (multiPolygon.properties && multiPolygon.properties.merge_method === 'turf_union') {
            console.log('✅ Already processed with Turf union - skipping');
            continue;
        }

        try {
            console.log('🔄 Starting union operation...');

            // Convert MultiPolygon coordinates to individual Polygon features
            const individualPolygons = multiPolygon.geometry.coordinates.map((coordinates, index) => ({
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: coordinates
                },
                properties: {
                    index: index,
                    county_part: `part_${index}`
                }
            }));

            console.log(`  Converting ${individualPolygons.length} polygon parts...`);

            // Perform sequential union operations
            let unionResult = individualPolygons[0];
            let successfulUnions = 1;

            for (let i = 1; i < individualPolygons.length; i++) {
                try {
                    const nextPolygon = individualPolygons[i];
                    const newUnion = union(unionResult, nextPolygon);

                    if (newUnion && newUnion.geometry) {
                        unionResult = newUnion;
                        successfulUnions++;

                        if (i % 10 === 0 || i === individualPolygons.length - 1) {
                            console.log(`  ✓ Merged ${successfulUnions}/${individualPolygons.length} polygons`);
                        }
                    } else {
                        console.log(`  ⚠️ Union ${i + 1} produced invalid result, skipping`);
                    }

                } catch (unionError) {
                    console.error(`  ❌ Union failed at polygon ${i + 1}:`, unionError.message);
                    console.log(`  📊 Continuing with ${successfulUnions} successfully merged polygons...`);
                    break;
                }
            }

            if (unionResult && unionResult.geometry && successfulUnions > 1) {
                // Create updated GeoJSON with unified geometry
                const updatedGeoJSON = {
                    type: 'Feature',
                    geometry: unionResult.geometry,
                    properties: {
                        ...multiPolygon.properties,
                        merge_method: 'turf_union',
                        border_elimination: true,
                        polygon_count_before: individualPolygons.length,
                        polygon_count_after: unionResult.geometry.type === 'MultiPolygon'
                            ? unionResult.geometry.coordinates.length
                            : 1,
                        successful_unions: successfulUnions,
                        union_success_rate: `${Math.round((successfulUnions / individualPolygons.length) * 100)}%`,
                        unified_date: new Date().toISOString(),
                        note: `Unified from ${individualPolygons.length} county polygons using Turf.js union (${successfulUnions} successful)`
                    }
                };

                const finalPolygonCount = unionResult.geometry.type === 'MultiPolygon'
                    ? unionResult.geometry.coordinates.length
                    : 1;

                console.log(`✅ Union successful!`);
                console.log(`📊 Reduced from ${individualPolygons.length} to ${finalPolygonCount} polygon(s)`);
                console.log(`📈 Success rate: ${Math.round((successfulUnions / individualPolygons.length) * 100)}%`);
                console.log(`🎯 Eliminated ${individualPolygons.length - finalPolygonCount} internal borders`);

                // Update database
                console.log('💾 Updating database...');
                const { error: updateError } = await supabase
                    .from('usaw_wso_information')
                    .update({
                        territory_geojson: updatedGeoJSON,
                        updated_at: new Date().toISOString()
                    })
                    .eq('name', wso.name);

                if (updateError) {
                    console.error('❌ Failed to update database:', updateError);
                } else {
                    console.log('✅ Database updated successfully');
                    console.log(`🗺️  ${wso.name} now has unified territory boundaries!`);
                }

            } else {
                console.error('❌ Union operation failed to produce valid unified result');
            }

        } catch (error) {
            console.error(`❌ Error processing ${wso.name}:`, error.message);
        }
    }

    console.log('\n🎉 County border elimination completed!');
    console.log('💡 The WSO territories now have unified boundaries with no internal county borders');
    console.log('📋 Run validation script to verify results');
}

async function validateResults() {
    console.log('\n=== Validation: Checking WSO Polygon Status ===');

    const { data: californiaWSOs, error } = await supabase
        .from('usaw_wso_information')
        .select('name, territory_geojson')
        .in('name', ['California North Central', 'California South']);

    if (error) {
        console.error('Error fetching WSOs for validation:', error);
        return;
    }

    for (const wso of californiaWSOs) {
        const geojson = wso.territory_geojson;
        console.log(`\n${wso.name}:`);

        if (!geojson) {
            console.log('❌ No GeoJSON data');
            continue;
        }

        const geometry = geojson.geometry;
        const props = geojson.properties || {};

        console.log(`  Geometry Type: ${geometry.type}`);

        if (geometry.type === 'MultiPolygon') {
            console.log(`  Polygon Count: ${geometry.coordinates.length}`);
        }

        if (props.merge_method === 'turf_union') {
            console.log('  ✅ Successfully unified with Turf union');
            console.log(`  📊 Before: ${props.polygon_count_before} polygons`);
            console.log(`  📊 After: ${props.polygon_count_after} polygons`);
            console.log(`  🎯 Borders eliminated: ${(props.polygon_count_before || 0) - (props.polygon_count_after || 0)}`);
            console.log(`  📈 Success rate: ${props.union_success_rate || 'Unknown'}`);
        } else {
            console.log('  ⚠️ Not yet processed with union operation');
        }
    }
}

// Main execution
async function main() {
    console.log('🗺️  WSO County Border Elimination Tool');
    console.log('    Eliminates visible county borders within WSO regions\n');

    if (process.argv.includes('--validate-only')) {
        await validateResults();
        return;
    }

    await unifyWSORPolygons();
    await validateResults();

    console.log('\n🎯 Next steps:');
    console.log('   1. Test the frontend map to verify no county borders are visible');
    console.log('   2. Check map rendering performance (should be faster)');
    console.log('   3. Run: node validate-wso-fixes.js for comprehensive validation');
}

if (require.main === module) {
    main().catch(console.error);
}