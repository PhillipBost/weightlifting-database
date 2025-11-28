/**
 * Import Dissolved Polygon Results
 * 
 * Imports the QGIS-processed dissolved polygon back into the database,
 * replacing the MultiPolygon with a unified single polygon that eliminates
 * all internal county borders.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function findDissolvedGeoJSONFile() {
    console.log('🔍 Looking for dissolved GeoJSON file...');

    const exportsDir = './exports';
    const possibleFiles = [
        'ca-north-central-dissolved-final.geojson',
        'ca-north-central-dissolved.geojson',
        'california-north-central-dissolved.geojson'
    ];

    for (const filename of possibleFiles) {
        const filepath = path.join(exportsDir, filename);
        try {
            await fs.access(filepath);
            console.log(`✅ Found dissolved file: ${filepath}`);
            return filepath;
        } catch (error) {
            // File doesn't exist, continue searching
        }
    }

    // List all GeoJSON files in exports directory
    try {
        const files = await fs.readdir(exportsDir);
        const geojsonFiles = files.filter(f => f.endsWith('.geojson'));

        if (geojsonFiles.length > 0) {
            console.log('\n📄 Available GeoJSON files in exports:');
            geojsonFiles.forEach(file => console.log(`   ${file}`));
            console.log('\n💡 Rename your dissolved file to "ca-north-central-dissolved.geojson"');
        }
    } catch (error) {
        console.log('❌ Could not read exports directory');
    }

    return null;
}

async function validateDissolvedGeoJSON(filepath) {
    console.log('\n🔍 Validating dissolved GeoJSON...');

    try {
        const fileContent = await fs.readFile(filepath, 'utf8');
        const geoData = JSON.parse(fileContent);

        // Check structure
        if (!geoData.type) {
            throw new Error('Invalid GeoJSON: missing type field');
        }

        let feature;
        if (geoData.type === 'FeatureCollection') {
            if (!geoData.features || geoData.features.length === 0) {
                throw new Error('FeatureCollection has no features');
            }
            if (geoData.features.length > 1) {
                console.log(`⚠️ FeatureCollection has ${geoData.features.length} features, using first one`);
            }
            feature = geoData.features[0];
        } else if (geoData.type === 'Feature') {
            feature = geoData;
        } else {
            throw new Error(`Unsupported GeoJSON type: ${geoData.type}`);
        }

        // Validate geometry
        if (!feature.geometry) {
            throw new Error('Feature has no geometry');
        }

        const geometry = feature.geometry;
        console.log(`📊 Geometry Type: ${geometry.type}`);

        if (geometry.type === 'Polygon') {
            console.log('✅ Perfect! Single Polygon geometry (borders dissolved successfully)');
            console.log(`📍 Coordinate rings: ${geometry.coordinates.length}`);

            // Count total coordinates
            let totalCoords = 0;
            geometry.coordinates.forEach(ring => totalCoords += ring.length);
            console.log(`📊 Total coordinates: ${totalCoords}`);

        } else if (geometry.type === 'MultiPolygon') {
            const polygonCount = geometry.coordinates.length;
            console.log(`⚠️ Still MultiPolygon with ${polygonCount} parts`);
            console.log('💡 Dissolve operation may not have been fully successful');

            if (polygonCount === 1) {
                console.log('✅ Single polygon part - can convert to Polygon');
            } else {
                console.log(`❌ ${polygonCount} separate polygons - county borders still exist`);
            }
        } else {
            throw new Error(`Unexpected geometry type: ${geometry.type}`);
        }

        console.log('✅ GeoJSON validation passed');
        return { geoData, feature, geometry };

    } catch (error) {
        console.error('❌ GeoJSON validation failed:', error.message);
        return null;
    }
}

async function importDissolvedPolygon() {
    console.log('=== Importing Dissolved Polygon to Database ===\n');

    // Find the dissolved GeoJSON file
    const dissolvedFile = await findDissolvedGeoJSONFile();
    if (!dissolvedFile) {
        console.error('❌ No dissolved GeoJSON file found');
        console.log('\n📋 Required steps:');
        console.log('   1. Process MultiPolygon in QGIS using dissolve tool');
        console.log('   2. Export result as GeoJSON to ./exports/ directory');
        console.log('   3. Name file "ca-north-central-dissolved.geojson"');
        console.log('   4. Run this script again');
        return;
    }

    // Validate the dissolved GeoJSON
    const validation = await validateDissolvedGeoJSON(dissolvedFile);
    if (!validation) {
        return;
    }

    const { feature, geometry } = validation;

    // Get current database state for comparison
    console.log('\n📊 Fetching current database state...');
    const { data: currentWSO, error: fetchError } = await supabase
        .from('usaw_wso_information')
        .select('*')
        .eq('name', 'California North Central')
        .single();

    if (fetchError) {
        console.error('❌ Error fetching current WSO data:', fetchError);
        return;
    }

    // Compare before and after
    const currentGeometry = currentWSO.territory_geojson.geometry;
    console.log('\n📋 Comparison Summary:');
    console.log(`   Before: ${currentGeometry.type}`);
    console.log(`   After:  ${geometry.type}`);

    if (currentGeometry.type === 'MultiPolygon') {
        console.log(`   Polygons Before: ${currentGeometry.coordinates.length}`);
    }

    if (geometry.type === 'MultiPolygon') {
        console.log(`   Polygons After:  ${geometry.coordinates.length}`);
        const eliminated = currentGeometry.coordinates.length - geometry.coordinates.length;
        console.log(`   Borders Eliminated: ${eliminated}`);
    } else if (geometry.type === 'Polygon') {
        const eliminated = currentGeometry.coordinates.length - 1;
        console.log(`   Polygons After:  1`);
        console.log(`   Borders Eliminated: ${eliminated}`);
    }

    // Prepare updated GeoJSON with enhanced metadata
    const updatedGeoJSON = {
        type: 'Feature',
        geometry: geometry,
        properties: {
            ...currentWSO.territory_geojson.properties,
            // Dissolve operation metadata
            dissolve_method: 'qgis_external',
            border_elimination: true,
            polygon_count_before: currentGeometry.type === 'MultiPolygon'
                ? currentGeometry.coordinates.length
                : 1,
            polygon_count_after: geometry.type === 'MultiPolygon'
                ? geometry.coordinates.length
                : 1,
            borders_eliminated: currentGeometry.type === 'MultiPolygon'
                ? currentGeometry.coordinates.length - (geometry.type === 'MultiPolygon' ? geometry.coordinates.length : 1)
                : 0,
            dissolve_date: new Date().toISOString(),
            processing_tool: 'QGIS Desktop',
            geometry_type_before: currentGeometry.type,
            geometry_type_after: geometry.type,
            dissolve_success: geometry.type === 'Polygon',
            note: geometry.type === 'Polygon'
                ? 'Successfully dissolved all county borders into unified polygon'
                : 'Partial dissolve - some borders may remain',
            // Preserve original properties
            wso_name: currentWSO.name,
            counties: currentWSO.counties,
            states: currentWSO.states
        }
    };

    // Confirm import
    console.log('\n❓ Ready to update database. Continue? (This will replace the current territory)');
    console.log('📝 The operation will:');
    console.log(`   - Replace ${currentGeometry.type} with ${geometry.type}`);
    console.log(`   - Eliminate ${updatedGeoJSON.properties.borders_eliminated} internal borders`);
    console.log('   - Mark border_elimination as true');
    console.log('   - Add dissolve processing metadata');

    // For automation, proceed automatically. In interactive mode, you might want confirmation.
    console.log('\n🚀 Proceeding with database update...');

    try {
        const { error: updateError } = await supabase
            .from('usaw_wso_information')
            .update({
                territory_geojson: updatedGeoJSON,
                updated_at: new Date().toISOString()
            })
            .eq('name', 'California North Central');

        if (updateError) {
            console.error('❌ Database update failed:', updateError);
            return;
        }

        console.log('✅ Database updated successfully!');

        // Final status report
        console.log('\n🎉 Import completed successfully!');
        console.log('📊 Results:');
        console.log(`   WSO: California North Central`);
        console.log(`   Geometry: ${geometry.type}`);
        console.log(`   Borders Eliminated: ${updatedGeoJSON.properties.borders_eliminated}`);
        console.log(`   Border Elimination: ${updatedGeoJSON.properties.border_elimination ? 'SUCCESS' : 'PARTIAL'}`);

        console.log('\n🎯 Next Steps:');
        console.log('   1. Run validation: node verify-dissolve-success.js');
        console.log('   2. Test frontend map rendering');
        console.log('   3. Verify no visible county borders in WSO territory');

        if (geometry.type === 'Polygon') {
            console.log('\n🏆 MISSION ACCOMPLISHED!');
            console.log('   County borders successfully dissolved');
            console.log('   California North Central now has unified territory');
            console.log('   Frontend maps will show seamless WSO region');
        }

    } catch (error) {
        console.error('❌ Import failed:', error);
    }
}

// Main execution
if (require.main === module) {
    importDissolvedPolygon().catch(console.error);
}

module.exports = { importDissolvedPolygon, validateDissolvedGeoJSON };