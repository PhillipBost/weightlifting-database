/**
 * Import All Fixed GeoJSON Files
 * 
 * Batch imports all *-fixed.geojson files from QGIS dissolve processing
 * and updates the database with border elimination results.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// WSO name mapping for file-to-database matching
const wsoNameMapping = {
    'california-south': 'California South',
    'tennessee-kentucky': 'Tennessee-Kentucky',
    'texas-oklahoma': 'Texas-Oklahoma',
    'mountain-north': 'Mountain North',
    'minnesota-dakotas': 'Minnesota-Dakotas',
    'pacific-northwest': 'Pacific Northwest',
    'carolina': 'Carolina',
    'new-england': 'New England',
    'missouri-valley': 'Missouri Valley',
    'iowa-nebraska': 'Iowa-Nebraska',
    'mountain-south': 'Mountain South',
    'pennsylvania-west-virginia': 'Pennsylvania-West Virginia',
    'southern': 'Southern'
};

async function findFixedFiles() {
    console.log('🔍 Finding all *-fixed.geojson files...\n');
    
    const exportsDir = './exports';
    const files = await fs.readdir(exportsDir);
    const fixedFiles = files.filter(f => f.endsWith('-fixed.geojson'));
    
    console.log(`✅ Found ${fixedFiles.length} fixed files:`);
    fixedFiles.forEach(f => console.log(`   ${f}`));
    
    return fixedFiles.map(filename => {
        const baseName = filename.replace('-fixed.geojson', '');
        const wsoName = wsoNameMapping[baseName] || baseName;
        
        return {
            filename,
            filepath: path.join(exportsDir, filename),
            baseName,
            wsoName
        };
    });
}

async function analyzeFile(fileInfo) {
    try {
        const content = await fs.readFile(fileInfo.filepath, 'utf8');
        const geoData = JSON.parse(content);
        
        let feature;
        if (geoData.type === 'FeatureCollection') {
            if (!geoData.features || geoData.features.length === 0) {
                return { error: 'Empty FeatureCollection' };
            }
            feature = geoData.features[0];
        } else if (geoData.type === 'Feature') {
            feature = geoData;
        } else {
            return { error: `Unsupported type: ${geoData.type}` };
        }
        
        const geometry = feature.geometry;
        const polygonCount = geometry.type === 'MultiPolygon' ? geometry.coordinates.length : 1;
        
        return {
            feature,
            geometry,
            geometryType: geometry.type,
            polygonCount,
            success: true
        };
        
    } catch (error) {
        return { error: error.message };
    }
}

async function importSingleWSO(fileInfo) {
    console.log(`\n--- Processing ${fileInfo.filename} ---`);
    console.log(`🎯 Target WSO: ${fileInfo.wsoName}`);
    
    // Analyze the file
    const analysis = await analyzeFile(fileInfo);
    if (analysis.error) {
        console.error(`❌ File analysis failed: ${analysis.error}`);
        return { success: false, error: analysis.error };
    }
    
    console.log(`📊 Dissolved geometry: ${analysis.geometryType}`);
    console.log(`📊 Polygon count: ${analysis.polygonCount}`);
    
    // Find matching WSO in database
    const { data: matchingWSOs, error: searchError } = await supabase
        .from('wso_information')
        .select('*')
        .eq('name', fileInfo.wsoName);
    
    if (searchError) {
        console.error(`❌ Database search failed: ${searchError.message}`);
        return { success: false, error: searchError.message };
    }
    
    if (!matchingWSOs || matchingWSOs.length === 0) {
        console.error(`❌ No WSO found with name: ${fileInfo.wsoName}`);
        return { success: false, error: `WSO not found: ${fileInfo.wsoName}` };
    }
    
    const targetWSO = matchingWSOs[0];
    console.log(`✅ Found WSO: ${targetWSO.name}`);
    
    // Get current state for comparison
    const currentGeometry = targetWSO.territory_geojson.geometry;
    const polygonsBefore = currentGeometry.type === 'MultiPolygon' 
        ? currentGeometry.coordinates.length 
        : 1;
    const polygonsAfter = analysis.polygonCount;
    const bordersEliminated = polygonsBefore - polygonsAfter;
    
    console.log(`📊 Before: ${currentGeometry.type} with ${polygonsBefore} polygons`);
    console.log(`📊 After: ${analysis.geometryType} with ${polygonsAfter} polygons`);
    console.log(`🎯 Borders eliminated: ${bordersEliminated}`);
    
    // Create updated GeoJSON with metadata
    const updatedGeoJSON = {
        type: 'Feature',
        geometry: analysis.geometry,
        properties: {
            ...targetWSO.territory_geojson.properties,
            dissolve_method: 'qgis_external',
            border_elimination: true,
            polygon_count_before: polygonsBefore,
            polygon_count_after: polygonsAfter,
            borders_eliminated: bordersEliminated,
            dissolve_date: new Date().toISOString(),
            processing_tool: 'QGIS Desktop',
            geometry_type_before: currentGeometry.type,
            geometry_type_after: analysis.geometryType,
            dissolve_success: analysis.geometryType === 'Polygon' || polygonsAfter < polygonsBefore,
            note: analysis.geometryType === 'Polygon' 
                ? `Successfully dissolved all ${bordersEliminated} borders into unified polygon`
                : `Reduced from ${polygonsBefore} to ${polygonsAfter} polygons, eliminated ${bordersEliminated} borders`,
            wso_name: targetWSO.name,
            counties: targetWSO.counties,
            states: targetWSO.states,
            source_file: fileInfo.filename
        }
    };
    
    // Update database
    console.log('💾 Updating database...');
    
    const { error: updateError } = await supabase
        .from('wso_information')
        .update({
            territory_geojson: updatedGeoJSON,
            updated_at: new Date().toISOString()
        })
        .eq('name', targetWSO.name);
    
    if (updateError) {
        console.error(`❌ Database update failed: ${updateError.message}`);
        return { success: false, error: updateError.message };
    }
    
    console.log('✅ Database updated successfully!');
    
    return {
        success: true,
        wso_name: targetWSO.name,
        filename: fileInfo.filename,
        geometry_type: analysis.geometryType,
        polygon_count: polygonsAfter,
        borders_eliminated: bordersEliminated,
        dissolve_success: updatedGeoJSON.properties.dissolve_success
    };
}

async function importAllFixedFiles() {
    console.log('=== Batch Import All Fixed GeoJSON Files ===\n');
    
    const fixedFiles = await findFixedFiles();
    
    if (fixedFiles.length === 0) {
        console.log('❌ No *-fixed.geojson files found in exports directory');
        return;
    }
    
    console.log(`\n🚀 Processing ${fixedFiles.length} files...\n`);
    
    const results = [];
    
    for (const fileInfo of fixedFiles) {
        const result = await importSingleWSO(fileInfo);
        results.push({
            ...result,
            wso_name: result.wso_name || fileInfo.wsoName,
            filename: fileInfo.filename
        });
    }
    
    // Generate summary report
    console.log('\n' + '='.repeat(60));
    console.log('=== BATCH IMPORT SUMMARY ===');
    console.log('='.repeat(60));
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successfully imported: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);
    console.log(`📊 Total processed: ${results.length}`);
    
    if (successful.length > 0) {
        console.log('\n🎉 Successfully Processed WSOs:');
        successful.forEach(r => {
            const status = r.geometry_type === 'Polygon' ? '🏆 PERFECT' : '✅ IMPROVED';
            console.log(`   ${status} ${r.wso_name}: ${r.polygon_count} polygon(s) (eliminated ${r.borders_eliminated} borders)`);
        });
        
        const totalBordersEliminated = successful.reduce((sum, r) => sum + (r.borders_eliminated || 0), 0);
        const perfectCount = successful.filter(r => r.geometry_type === 'Polygon').length;
        const improvedCount = successful.filter(r => r.geometry_type === 'MultiPolygon' && r.borders_eliminated > 0).length;
        
        console.log('\n📊 Overall Statistics:');
        console.log(`   🏆 Perfect dissolves (Polygon): ${perfectCount}`);
        console.log(`   ✅ Improved dissolves (reduced MultiPolygon): ${improvedCount}`);
        console.log(`   🎯 Total borders eliminated: ${totalBordersEliminated}`);
        console.log(`   📈 Success rate: ${Math.round((successful.length / results.length) * 100)}%`);
    }
    
    if (failed.length > 0) {
        console.log('\n❌ Failed Imports:');
        failed.forEach(r => {
            console.log(`   ${r.filename}: ${r.error}`);
        });
    }
    
    console.log('\n🎯 Next Steps:');
    console.log('   1. Run comprehensive verification: node verify-all-dissolve-success.js');
    console.log('   2. Test frontend map rendering');
    console.log('   3. Verify no visible internal borders in WSO territories');
    console.log('   4. Document successful border elimination workflow');
    
    return results;
}

if (require.main === module) {
    importAllFixedFiles().catch(console.error);
}

module.exports = { importAllFixedFiles, importSingleWSO };