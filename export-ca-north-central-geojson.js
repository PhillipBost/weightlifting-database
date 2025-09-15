/**
 * Export California North Central GeoJSON for External Dissolve Processing
 * 
 * Extracts the MultiPolygon territory data from the database to prepare for
 * QGIS/GDAL dissolve operations that will eliminate county borders.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function exportCaliforniaNorthCentralGeoJSON() {
    console.log('=== Exporting California North Central GeoJSON for Dissolve Processing ===\n');
    
    try {
        // Fetch California North Central WSO data
        const { data: wsoData, error } = await supabase
            .from('wso_information')
            .select('*')
            .eq('name', 'California North Central')
            .single();
        
        if (error) {
            console.error('❌ Error fetching WSO data:', error);
            return;
        }
        
        if (!wsoData) {
            console.error('❌ California North Central WSO not found in database');
            return;
        }
        
        console.log('✅ Found California North Central WSO data');
        console.log(`📊 Counties: ${wsoData.counties ? wsoData.counties.length : 'Unknown'}`);
        
        // Check GeoJSON structure
        const territoryGeoJSON = wsoData.territory_geojson;
        
        if (!territoryGeoJSON) {
            console.error('❌ No territory_geojson data found');
            return;
        }
        
        console.log(`🗺️  Geometry Type: ${territoryGeoJSON.geometry.type}`);
        
        if (territoryGeoJSON.geometry.type === 'MultiPolygon') {
            const polygonCount = territoryGeoJSON.geometry.coordinates.length;
            console.log(`📍 Polygon Count: ${polygonCount} (these are the county borders to dissolve)`);
        }
        
        // Prepare export data with metadata for processing
        const exportData = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: territoryGeoJSON.geometry,
                    properties: {
                        wso_name: 'California North Central',
                        geographic_type: wsoData.geographic_type,
                        counties: wsoData.counties,
                        states: wsoData.states,
                        export_date: new Date().toISOString(),
                        export_purpose: 'dissolve_processing',
                        processing_note: 'MultiPolygon to be dissolved into single polygon',
                        original_polygon_count: territoryGeoJSON.geometry.type === 'MultiPolygon' 
                            ? territoryGeoJSON.geometry.coordinates.length 
                            : 1,
                        target_polygon_count: 1,
                        dissolve_method: 'qgis_external'
                    }
                }
            ],
            metadata: {
                export_source: 'weightlifting-database',
                table: 'wso_information',
                wso_name: 'California North Central',
                export_timestamp: new Date().toISOString(),
                purpose: 'External dissolve processing to eliminate county borders',
                next_steps: [
                    '1. Convert to Shapefile using GDAL',
                    '2. Process in QGIS with Dissolve tool',
                    '3. Export dissolved result as GeoJSON',
                    '4. Import back to database using import script'
                ]
            }
        };
        
        // Create exports directory if it doesn't exist
        const exportsDir = './exports';
        try {
            await fs.access(exportsDir);
        } catch (error) {
            console.log('📁 Creating exports directory...');
            await fs.mkdir(exportsDir, { recursive: true });
        }
        
        // Write GeoJSON file
        const filename = 'ca-north-central-for-dissolve.geojson';
        const filepath = path.join(exportsDir, filename);
        
        await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
        
        console.log(`\n✅ Export completed successfully!`);
        console.log(`📄 File: ${filepath}`);
        console.log(`📊 Size: ${(JSON.stringify(exportData).length / 1024).toFixed(2)} KB`);
        
        // Display processing summary
        console.log('\n📋 Export Summary:');
        console.log(`   WSO Name: ${wsoData.name}`);
        console.log(`   Geometry Type: ${territoryGeoJSON.geometry.type}`);
        console.log(`   Counties: ${wsoData.counties ? wsoData.counties.length : 'Unknown'}`);
        if (territoryGeoJSON.geometry.type === 'MultiPolygon') {
            console.log(`   Polygons to Dissolve: ${territoryGeoJSON.geometry.coordinates.length}`);
        }
        console.log(`   Target Result: Single unified polygon`);
        
        console.log('\n🎯 Next Steps:');
        console.log('   1. Run: node gdal-convert-to-shapefile.js');
        console.log('   2. Open Shapefile in QGIS');
        console.log('   3. Use Vector → Geoprocessing Tools → Dissolve');
        console.log('   4. Export dissolved result as GeoJSON');
        console.log('   5. Run: node import-dissolved-polygon.js');
        
        return filepath;
        
    } catch (error) {
        console.error('❌ Export failed:', error);
    }
}

// Main execution
if (require.main === module) {
    exportCaliforniaNorthCentralGeoJSON().catch(console.error);
}

module.exports = { exportCaliforniaNorthCentralGeoJSON };