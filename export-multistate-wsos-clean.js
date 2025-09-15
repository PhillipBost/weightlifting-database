/**
 * Export Multi-State WSOs with Clean Properties for QGIS
 * 
 * Fixes the counties field issue that causes QGIS export errors
 * by ensuring all properties are properly formatted for QGIS processing.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function exportMultiStateWSOs() {
    console.log('=== Exporting Multi-State WSOs (QGIS Clean) ===\n');
    
    // Get multi-state WSOs
    const { data: multiStateWSOs, error } = await supabase
        .from('wso_information')
        .select('*')
        .eq('geographic_type', 'multi_state')
        .not('territory_geojson', 'is', null);
    
    if (error) {
        console.error('❌ Error fetching multi-state WSOs:', error);
        return;
    }
    
    console.log(`Found ${multiStateWSOs.length} multi-state WSOs to process:\n`);
    
    // Create clean exports directory
    const exportsDir = './exports/multistate-clean';
    await fs.mkdir(exportsDir, { recursive: true });
    
    const exportResults = [];
    
    for (const wso of multiStateWSOs) {
        const geometry = wso.territory_geojson?.geometry;
        
        if (!geometry) {
            console.log(`⚠️ ${wso.name}: No geometry data`);
            continue;
        }
        
        const polygonCount = geometry.type === 'MultiPolygon' ? geometry.coordinates.length : 1;
        const needsDissolve = geometry.type === 'MultiPolygon' && polygonCount > 1;
        
        console.log(`${needsDissolve ? '🔴' : '✅'} ${wso.name}:`);
        console.log(`   Geometry: ${geometry.type}`);
        console.log(`   Polygons: ${polygonCount}`);
        console.log(`   Counties: ${wso.counties ? wso.counties.length : 'N/A'}`);
        console.log(`   States: ${wso.states ? wso.states.join(', ') : 'N/A'}`);
        
        if (needsDissolve) {
            // Create QGIS-friendly properties
            const cleanProperties = {
                wso_name: wso.name || '',
                geographic_type: wso.geographic_type || '',
                // Handle counties field properly
                counties: wso.counties && Array.isArray(wso.counties) 
                    ? wso.counties.join(';')  // Convert to semicolon-separated string
                    : '',
                // Handle states field properly  
                states: wso.states && Array.isArray(wso.states)
                    ? wso.states.join(';')    // Convert to semicolon-separated string
                    : '',
                export_date: new Date().toISOString(),
                export_purpose: 'dissolve_processing',
                original_polygon_count: polygonCount,
                target_polygon_count: 1,
                dissolve_method: 'qgis_external',
                processing_note: `Multi-state WSO with ${polygonCount} polygons to dissolve`
            };
            
            const exportData = {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        geometry: geometry,
                        properties: cleanProperties
                    }
                ]
            };
            
            // Create filename
            const safeName = wso.name.toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            
            const filename = `${safeName}-for-dissolve.geojson`;
            const filepath = path.join(exportsDir, filename);
            
            await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
            
            console.log(`   📄 Exported: ${filename}`);
            console.log(`   🎯 Borders to eliminate: ${polygonCount - 1}`);
            
            exportResults.push({
                wso_name: wso.name,
                filename: filename,
                polygon_count: polygonCount,
                borders_to_eliminate: polygonCount - 1
            });
        }
        
        console.log('');
    }
    
    console.log('=== Export Summary ===');
    console.log(`✅ Exported ${exportResults.length} multi-state WSOs`);
    console.log(`📁 Location: ${exportsDir}`);
    
    const totalBorders = exportResults.reduce((sum, r) => sum + r.borders_to_eliminate, 0);
    console.log(`🎯 Total borders to eliminate: ${totalBorders}`);
    
    console.log('\n📋 Exported WSOs:');
    exportResults.forEach(r => {
        console.log(`   ${r.wso_name}: ${r.polygon_count} → 1 polygon`);
    });
    
    console.log('\n🎯 QGIS Processing Instructions:');
    console.log('   1. These files have CLEAN properties (no complex JSON)');
    console.log('   2. counties and states are semicolon-separated strings');
    console.log('   3. Should not trigger QGIS attribute export errors');
    console.log('   4. Process each file with dissolve operation');
    console.log('   5. Export results as: {name}-dissolved.geojson');
    
    return exportResults;
}

if (require.main === module) {
    exportMultiStateWSOs().catch(console.error);
}