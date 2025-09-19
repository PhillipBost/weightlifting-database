const { createClient } = require('@supabase/supabase-js');
const union = require('@turf/union').default;
const { polygon, multiPolygon } = require('@turf/helpers');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Function to fetch county boundaries from a public API and merge them
async function generateMergedCountyBoundaries(counties, wsoName) {
    console.log(`\n=== Generating boundaries for ${wsoName} ===`);
    console.log(`Counties: ${counties.join(', ')}`);

    const allFeatures = [];

    for (const county of counties) {
        try {
            console.log(`Fetching boundary for ${county} County, California...`);

            // Use Nominatim to get county boundary
            const query = `${county} County, California, USA`;
            const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&q=${encodeURIComponent(query)}&limit=1`;

            const response = await fetch(nominatimUrl, {
                headers: {
                    'User-Agent': 'Weightlifting-Database/1.0'
                }
            });

            if (!response.ok) {
                console.log(`Failed to fetch ${county} County: ${response.status}`);
                continue;
            }

            const data = await response.json();

            if (data.length > 0 && data[0].geojson) {
                console.log(`✓ Got boundary for ${county} County`);
                allFeatures.push({
                    type: "Feature",
                    geometry: data[0].geojson,
                    properties: { county: county }
                });
            } else {
                console.log(`✗ No boundary found for ${county} County`);
            }

            // Rate limiting - wait 1 second between requests
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.error(`Error fetching ${county} County:`, error.message);
        }
    }

    if (allFeatures.length === 0) {
        console.log('No county boundaries found - using placeholder');
        return null;
    }

    console.log(`Successfully fetched ${allFeatures.length} county boundaries`);

    // Try Turf.js union for true polygon merging (eliminates county borders)
    // Fallback to MultiPolygon concatenation if union fails
    console.log(`Attempting to union ${allFeatures.length} county boundaries...`);

    let unifiedFeature = null;
    const successfulCounties = [];
    const failedCounties = [];
    let mergeMethod = "union_failed";

    // Attempt Turf.js union for seamless boundaries
    try {
        if (allFeatures.length === 1) {
            // Single county - no union needed
            unifiedFeature = allFeatures[0];
            successfulCounties.push(allFeatures[0].properties.county);
            mergeMethod = "single_county";
            console.log(`  ✓ Single county - no union needed`);
        } else {
            // Multiple counties - attempt union
            console.log(`  🔄 Attempting union of ${allFeatures.length} counties...`);
            
            unifiedFeature = allFeatures[0];
            successfulCounties.push(allFeatures[0].properties.county);
            
            for (let i = 1; i < allFeatures.length; i++) {
                try {
                    const nextFeature = allFeatures[i];
                    const unionResult = union(unifiedFeature, nextFeature);
                    
                    if (unionResult && unionResult.geometry) {
                        unifiedFeature = unionResult;
                        successfulCounties.push(nextFeature.properties.county);
                        console.log(`    ✓ Unioned ${nextFeature.properties.county} County (${i+1}/${allFeatures.length})`);
                    } else {
                        throw new Error('Union produced invalid geometry');
                    }
                } catch (unionError) {
                    console.log(`    ⚠️ Union failed for ${allFeatures[i].properties.county}: ${unionError.message}`);
                    failedCounties.push(allFeatures[i].properties.county);
                    // Continue with what we have so far
                }
            }
            
            if (successfulCounties.length > 1) {
                mergeMethod = "turf_union_partial";
                if (failedCounties.length === 0) {
                    mergeMethod = "turf_union_complete";
                    console.log(`  ✅ Complete union successful! Eliminated all county borders`);
                } else {
                    console.log(`  ✅ Partial union successful (${successfulCounties.length}/${allFeatures.length} counties)`);
                }
            } else {
                throw new Error('Union failed for all counties except first');
            }
        }
    } catch (unionError) {
        console.log(`  ❌ Turf union failed: ${unionError.message}`);
        console.log(`  🔄 Falling back to MultiPolygon concatenation...`);
        
        // Fallback: MultiPolygon concatenation (original approach)
        const coordinates = [];
        successfulCounties.length = 0; // Clear array
        failedCounties.length = 0;
        
        for (const feature of allFeatures) {
            try {
                if (feature.geometry.type === 'Polygon') {
                    coordinates.push(feature.geometry.coordinates);
                    successfulCounties.push(feature.properties.county);
                } else if (feature.geometry.type === 'MultiPolygon') {
                    feature.geometry.coordinates.forEach(polyCoords => {
                        coordinates.push(polyCoords);
                    });
                    successfulCounties.push(feature.properties.county);
                } else {
                    failedCounties.push(feature.properties.county);
                }
            } catch (error) {
                failedCounties.push(feature.properties.county);
            }
        }
        
        unifiedFeature = {
            type: "Feature",
            geometry: {
                type: "MultiPolygon",
                coordinates: coordinates
            }
        };
        mergeMethod = "multipolygon_concatenation";
    }

    // Create final feature with comprehensive properties
    const finalFeature = {
        type: "Feature",
        geometry: unifiedFeature.geometry,
        properties: {
            note: `WSO territory: ${mergeMethod === "turf_union_complete" ? "Unified boundaries (no county borders)" : "Multiple county polygons"}`,
            states: ["California"],
            counties: counties,
            wso_name: wsoName,
            geographic_type: "regional",
            merged_county_count: allFeatures.length,
            successful_counties: successfulCounties,
            failed_counties: failedCounties,
            success_rate: `${Math.round((successfulCounties.length / allFeatures.length) * 100)}%`,
            merge_method: mergeMethod,
            border_elimination: mergeMethod.includes("union"),
            polygon_count_before: allFeatures.length,
            polygon_count_after: unifiedFeature.geometry.type === "MultiPolygon" 
                ? unifiedFeature.geometry.coordinates.length 
                : 1,
            borders_eliminated: mergeMethod === "turf_union_complete" 
                ? allFeatures.length - 1 
                : 0,
            processing_date: new Date().toISOString()
        }
    };

    const finalPolygonCount = finalFeature.geometry.type === "MultiPolygon" 
        ? finalFeature.geometry.coordinates.length 
        : 1;
    
    console.log(`✓ Processing complete: ${successfulCounties.length}/${allFeatures.length} counties (${Math.round((successfulCounties.length / allFeatures.length) * 100)}%)`);
    console.log(`📊 Method: ${mergeMethod}`);
    console.log(`🗺️  Result: ${finalPolygonCount} polygon(s)`);
    
    if (mergeMethod.includes("union")) {
        const bordersEliminated = allFeatures.length - finalPolygonCount;
        console.log(`🎯 County borders eliminated: ${bordersEliminated}`);
    }
    
    if (failedCounties.length > 0) {
        console.log(`⚠️ Failed counties: ${failedCounties.join(', ')}`);
    }

    return finalFeature;
}

async function fixCaliforniaWSOs() {
    console.log('=== California WSO Boundary Fixer ===\n');

    // Get California WSOs
    const { data: californiaWSOs, error } = await supabase
        .from('wso_information')
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

    console.log(`Found ${californiaWSOs.length} California WSOs to fix`);

    for (const wso of californiaWSOs) {
        console.log(`\n--- Processing ${wso.name} ---`);

        if (!wso.counties || wso.counties.length === 0) {
            console.log('No counties listed for this WSO');
            continue;
        }

        // Generate merged boundaries
        const mergedBoundary = await generateMergedCountyBoundaries(wso.counties, wso.name);

        if (!mergedBoundary) {
            console.log('Failed to generate boundary');
            continue;
        }

        // Update the WSO with new boundary
        console.log(`Updating ${wso.name} with new boundary...`);

        const { error: updateError } = await supabase
            .from('wso_information')
            .update({
                territory_geojson: mergedBoundary,
                updated_at: new Date().toISOString()
            })
            .eq('wso_id', wso.wso_id);

        if (updateError) {
            console.error(`Error updating ${wso.name}:`, updateError);
        } else {
            console.log(`✓ Successfully updated ${wso.name}`);
        }
    }

    console.log('\n=== California WSO Fix Complete ===');
}

// Check if we can find multi-state WSOs while we're at it
async function identifyMultiStateWSOs() {
    console.log('\n=== Identifying Multi-State WSOs ===');

    const { data: allWSOs, error } = await supabase
        .from('wso_information')
        .select('wso_id, name, states, geographic_type');

    if (error) {
        console.error('Error fetching WSOs:', error);
        return;
    }

    const multiStateWSOs = allWSOs.filter(wso => wso.states && wso.states.length > 1);

    console.log(`Found ${multiStateWSOs.length} multi-state WSOs:`);
    multiStateWSOs.forEach(wso => {
        console.log(`- ${wso.name}: ${wso.states.join(', ')}`);
    });

    return multiStateWSOs;
}

async function main() {
    try {
        await fixCaliforniaWSOs();
        await identifyMultiStateWSOs();
    } catch (error) {
        console.error('Main error:', error);
    }
}

if (require.main === module) {
    main();
}

module.exports = { fixCaliforniaWSOs, identifyMultiStateWSOs, generateMergedCountyBoundaries };