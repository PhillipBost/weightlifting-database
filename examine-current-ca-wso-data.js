const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function examineCurrentData() {
    console.log('=== Examining Current California WSO Data ===\n');

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
        console.log('No California WSOs found in database');
        return;
    }

    for (const wso of californiaWSOs) {
        console.log(`\n--- ${wso.name} ---`);
        console.log(`Geographic Type: ${wso.geographic_type}`);
        console.log(`States: ${JSON.stringify(wso.states)}`);
        console.log(`Counties Listed: ${wso.counties ? wso.counties.length : 0} counties`);
        if (wso.counties) {
            console.log(`  Counties: ${wso.counties.join(', ')}`);
        }
        
        if (wso.territory_geojson) {
            const geojson = wso.territory_geojson;
            console.log(`\nGeoJSON Status: Present`);
            console.log(`  Type: ${geojson.type}`);
            console.log(`  Geometry Type: ${geojson.geometry?.type || 'Unknown'}`);
            
            if (geojson.properties) {
                console.log(`  Properties:`);
                Object.keys(geojson.properties).forEach(key => {
                    const value = geojson.properties[key];
                    if (Array.isArray(value)) {
                        console.log(`    ${key}: [${value.length} items] ${value.slice(0, 3).join(', ')}${value.length > 3 ? '...' : ''}`);
                    } else if (typeof value === 'string' && value.length > 50) {
                        console.log(`    ${key}: "${value.substring(0, 50)}..."`);
                    } else {
                        console.log(`    ${key}: ${JSON.stringify(value)}`);
                    }
                });
            }
            
            // Check if this looks like a single county or merged counties
            if (geojson.geometry?.type === 'Polygon') {
                console.log(`  Geometry: Single Polygon (likely one county)`);
            } else if (geojson.geometry?.type === 'MultiPolygon') {
                const polygonCount = geojson.geometry.coordinates?.length || 0;
                console.log(`  Geometry: MultiPolygon with ${polygonCount} polygon sets`);
            }
            
            // Look for clues in properties about what county this actually represents
            if (geojson.properties?.county) {
                console.log(`  ⚠️  WARNING: This appears to be from ${geojson.properties.county} County only!`);
            }
            if (geojson.properties?.note && geojson.properties.note.includes('Generated from')) {
                console.log(`  Note: ${geojson.properties.note}`);
            }
            if (geojson.properties?.merged_county_count) {
                console.log(`  Claims to represent ${geojson.properties.merged_county_count} counties`);
            }
        } else {
            console.log(`\nGeoJSON Status: Missing`);
        }
        
        console.log(`Last Updated: ${wso.updated_at}`);
    }
    
    console.log('\n=== Summary ===');
    console.log('Current california-wso-fixer.js has a bug:');
    console.log('- It fetches multiple county boundaries');
    console.log('- But only uses the FIRST county geometry (allFeatures[0].geometry)');
    console.log('- Does not actually merge/union the county polygons');
    console.log('- Results in WSO boundaries showing only one county instead of the full region');
}

async function main() {
    try {
        await examineCurrentData();
    } catch (error) {
        console.error('Error:', error);
    }
}

if (require.main === module) {
    main();
}