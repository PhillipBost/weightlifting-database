/**
 * Batch Import Dissolved Polygons
 * 
 * Imports multiple QGIS-processed dissolved polygons back into the database,
 * supporting California South, multi-state WSOs, and any other territories
 * that have been processed for border elimination.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function findDissolvedFiles(searchDir = './exports') {
    console.log(`🔍 Searching for dissolved GeoJSON files in ${searchDir}...`);
    
    const dissolvedFiles = [];
    
    try {
        // Check multiple possible directories
        const searchDirs = [
            path.join(searchDir, 'batch-dissolve'),
            path.join(searchDir, 'specific-dissolve'),
            searchDir
        ];
        
        for (const dir of searchDirs) {
            try {
                const files = await fs.readdir(dir);
                const geojsonFiles = files.filter(f => 
                    f.endsWith('.geojson') && 
                    (f.includes('dissolved') || f.includes('unified'))
                );
                
                for (const file of geojsonFiles) {
                    const fullPath = path.join(dir, file);
                    
                    // Try to extract WSO name from filename
                    let wsoName = extractWSONameFromFilename(file);
                    
                    dissolvedFiles.push({
                        filename: file,
                        filepath: fullPath,
                        directory: dir,
                        wso_name: wsoName
                    });
                }
            } catch (error) {
                // Directory doesn't exist, continue
            }
        }
        
    } catch (error) {
        console.error('Error searching for files:', error);
    }
    
    if (dissolvedFiles.length > 0) {
        console.log(`✅ Found ${dissolvedFiles.length} dissolved files:`);
        dissolvedFiles.forEach(f => {
            console.log(`   ${f.filename} → ${f.wso_name || 'Unknown WSO'}`);
        });
    } else {
        console.log('❌ No dissolved GeoJSON files found');
        console.log('\n💡 Expected filename patterns:');
        console.log('   - *-dissolved.geojson');
        console.log('   - *-dissolved-final.geojson');
        console.log('   - *-unified.geojson');
    }
    
    return dissolvedFiles;
}

function extractWSONameFromFilename(filename) {
    // Remove extensions and dissolve suffixes
    let name = filename
        .replace(/\.geojson$/i, '')
        .replace(/-dissolved(-final)?$/i, '')
        .replace(/-unified$/i, '')
        .replace(/-for-dissolve$/i, '');
    
    // Convert common patterns back to WSO names
    const wsoPatterns = {
        'california-north-central': 'California North Central',
        'california-south': 'California South',
        'tennessee-kentucky': 'Tennessee-Kentucky',
        'mountain-north': 'Mountain North',
        'mountain-south': 'Mountain South',
        'adirondack': 'Adirondack',
        'new-mexico-west-texas': 'New Mexico-West Texas'
    };
    
    return wsoPatterns[name] || name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

async function validateAndImportFile(fileInfo) {
    console.log(`\n--- Processing ${fileInfo.filename} ---`);
    
    try {
        // Read and validate GeoJSON
        const fileContent = await fs.readFile(fileInfo.filepath, 'utf8');
        const geoData = JSON.parse(fileContent);
        
        // Extract feature and geometry
        let feature;
        if (geoData.type === 'FeatureCollection') {
            if (!geoData.features || geoData.features.length === 0) {
                throw new Error('FeatureCollection has no features');
            }
            feature = geoData.features[0];
        } else if (geoData.type === 'Feature') {
            feature = geoData;
        } else {
            throw new Error(`Unsupported GeoJSON type: ${geoData.type}`);
        }
        
        const geometry = feature.geometry;
        const wsoNameFromFile = feature.properties?.wso_name || fileInfo.wso_name;
        
        console.log(`📊 WSO: ${wsoNameFromFile}`);
        console.log(`📊 Geometry: ${geometry.type}`);
        
        if (geometry.type === 'MultiPolygon') {
            console.log(`📊 Polygons: ${geometry.coordinates.length}`);
        }
        
        // Find matching WSO in database
        const { data: matchingWSOs, error: searchError } = await supabase
            .from('wso_information')
            .select('*')
            .ilike('name', `%${wsoNameFromFile}%`);
        
        if (searchError) {
            throw new Error(`Database search failed: ${searchError.message}`);
        }
        
        if (!matchingWSOs || matchingWSOs.length === 0) {
            throw new Error(`No matching WSO found for "${wsoNameFromFile}"`);
        }
        
        if (matchingWSOs.length > 1) {
            console.log(`⚠️ Multiple WSOs match "${wsoNameFromFile}":`);
            matchingWSOs.forEach(w => console.log(`   - ${w.name}`));
            console.log('Using first match');
        }
        
        const targetWSO = matchingWSOs[0];
        console.log(`✅ Matched to database WSO: ${targetWSO.name}`);
        
        // Get current geometry for comparison
        const currentGeometry = targetWSO.territory_geojson.geometry;
        
        console.log(`📊 Before: ${currentGeometry.type}`);
        if (currentGeometry.type === 'MultiPolygon') {
            console.log(`📊 Before polygons: ${currentGeometry.coordinates.length}`);
        }
        
        // Calculate border elimination
        const polygonsBefore = currentGeometry.type === 'MultiPolygon' 
            ? currentGeometry.coordinates.length 
            : 1;
        const polygonsAfter = geometry.type === 'MultiPolygon' 
            ? geometry.coordinates.length 
            : 1;
        const bordersEliminated = polygonsBefore - polygonsAfter;
        
        console.log(`🎯 Borders eliminated: ${bordersEliminated}`);
        
        // Prepare updated GeoJSON
        const updatedGeoJSON = {
            type: 'Feature',
            geometry: geometry,
            properties: {
                ...targetWSO.territory_geojson.properties,
                // Dissolve operation metadata
                dissolve_method: 'qgis_external',
                border_elimination: true,
                polygon_count_before: polygonsBefore,
                polygon_count_after: polygonsAfter,
                borders_eliminated: bordersEliminated,
                dissolve_date: new Date().toISOString(),
                processing_tool: 'QGIS Desktop',
                geometry_type_before: currentGeometry.type,
                geometry_type_after: geometry.type,
                dissolve_success: geometry.type === 'Polygon' || polygonsAfter < polygonsBefore,
                note: geometry.type === 'Polygon' 
                    ? 'Successfully dissolved all borders into unified polygon'
                    : `Reduced from ${polygonsBefore} to ${polygonsAfter} polygons`,
                // Preserve original properties
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
            throw new Error(`Database update failed: ${updateError.message}`);
        }
        
        console.log('✅ Database updated successfully!');
        
        return {
            wso_name: targetWSO.name,
            filename: fileInfo.filename,
            success: true,
            geometry_type: geometry.type,
            borders_eliminated: bordersEliminated,
            dissolve_success: updatedGeoJSON.properties.dissolve_success
        };
        
    } catch (error) {
        console.error(`❌ Failed to process ${fileInfo.filename}:`, error.message);
        
        return {
            wso_name: fileInfo.wso_name || 'Unknown',
            filename: fileInfo.filename,
            success: false,
            error: error.message
        };
    }
}

async function batchImportDissolvedPolygons() {
    console.log('=== Batch Import Dissolved Polygons ===\n');
    
    // Find all dissolved files
    const dissolvedFiles = await findDissolvedFiles();
    
    if (dissolvedFiles.length === 0) {
        console.log('\n💡 To create dissolved files:');
        console.log('   1. Run: node export-all-wsos-for-dissolve.js');
        console.log('   2. Process each file in QGIS with dissolve tool');
        console.log('   3. Export results with "dissolved" in filename');
        console.log('   4. Run this script again');
        return;
    }
    
    console.log(`\n🚀 Processing ${dissolvedFiles.length} dissolved files...\n`);
    
    const results = [];
    
    for (const fileInfo of dissolvedFiles) {
        const result = await validateAndImportFile(fileInfo);
        results.push(result);
    }
    
    // Summary report
    console.log('\n=== Batch Import Summary ===');
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Successfully imported: ${successful.length}`);
    console.log(`❌ Failed: ${failed.length}`);
    
    if (successful.length > 0) {
        console.log('\n🎉 Successfully processed WSOs:');
        successful.forEach(r => {
            console.log(`   ${r.wso_name}: ${r.geometry_type} (${r.borders_eliminated} borders eliminated)`);
        });
        
        const totalBordersEliminated = successful.reduce((sum, r) => sum + r.borders_eliminated, 0);
        console.log(`\n🎯 Total borders eliminated: ${totalBordersEliminated}`);
    }
    
    if (failed.length > 0) {
        console.log('\n❌ Failed imports:');
        failed.forEach(r => {
            console.log(`   ${r.filename}: ${r.error}`);
        });
    }
    
    console.log('\n🎯 Next Steps:');
    console.log('   1. Run: node verify-all-dissolve-success.js');
    console.log('   2. Test frontend map rendering');
    console.log('   3. Verify no visible internal borders in WSO territories');
    
    return results;
}

// Support for importing specific WSOs
async function importSpecificWSO(wsoName) {
    console.log(`=== Import Specific WSO: ${wsoName} ===\n`);
    
    const dissolvedFiles = await findDissolvedFiles();
    const matchingFile = dissolvedFiles.find(f => 
        f.wso_name && f.wso_name.toLowerCase().includes(wsoName.toLowerCase())
    );
    
    if (!matchingFile) {
        console.error(`❌ No dissolved file found for WSO: ${wsoName}`);
        console.log('\n💡 Available files:');
        dissolvedFiles.forEach(f => console.log(`   ${f.filename}`));
        return;
    }
    
    const result = await validateAndImportFile(matchingFile);
    
    if (result.success) {
        console.log(`\n🎉 Successfully imported ${result.wso_name}!`);
    }
    
    return result;
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length > 0) {
        // Import specific WSO
        const wsoName = args.join(' ');
        await importSpecificWSO(wsoName);
    } else {
        // Batch import all
        await batchImportDissolvedPolygons();
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { batchImportDissolvedPolygons, importSpecificWSO, findDissolvedFiles };