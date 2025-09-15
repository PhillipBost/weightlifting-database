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

    // Create MultiPolygon from all individual county polygons
    // This is more reliable than turf.union which has issues with some Nominatim geometries
    console.log(`Creating MultiPolygon from ${allFeatures.length} county boundaries...`);

    const coordinates = [];
    const successfulCounties = [];
    const failedCounties = [];

    for (const feature of allFeatures) {
        try {
            if (feature.geometry.type === 'Polygon') {
                coordinates.push(feature.geometry.coordinates);
                successfulCounties.push(feature.properties.county);
                console.log(`  ✓ Added ${feature.properties.county} County (Polygon)`);
            } else if (feature.geometry.type === 'MultiPolygon') {
                feature.geometry.coordinates.forEach(polyCoords => {
                    coordinates.push(polyCoords);
                });
                successfulCounties.push(feature.properties.county);
                console.log(`  ✓ Added ${feature.properties.county} County (MultiPolygon)`);
            } else {
                failedCounties.push(feature.properties.county);
                console.log(`  ✗ Unknown geometry type for ${feature.properties.county} County: ${feature.geometry.type}`);
            }
        } catch (error) {
            failedCounties.push(feature.properties.county);
            console.error(`  ✗ Error processing ${feature.properties.county} County:`, error.message);
        }
    }

    const multiPolygonFeature = {
        type: "Feature",
        geometry: {
            type: "MultiPolygon",
            coordinates: coordinates
        },
        properties: {
            note: `MultiPolygon from ${successfulCounties.length}/${allFeatures.length} counties: ${counties.join(', ')}`,
            states: ["California"],
            counties: counties,
            wso_name: wsoName,
            geographic_type: "regional",
            merged_county_count: allFeatures.length,
            successful_counties: successfulCounties,
            failed_counties: failedCounties,
            success_rate: `${Math.round((successfulCounties.length / allFeatures.length) * 100)}%`,
            merge_method: "multipolygon_concatenation"
        }
    };

    console.log(`✓ MultiPolygon created: ${successfulCounties.length}/${allFeatures.length} counties (${Math.round((successfulCounties.length / allFeatures.length) * 100)}%)`);
    if (failedCounties.length > 0) {
        console.log(`  Failed counties: ${failedCounties.join(', ')}`);
    }

    return multiPolygonFeature;
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