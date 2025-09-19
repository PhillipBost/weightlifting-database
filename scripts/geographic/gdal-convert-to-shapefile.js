/**
 * GDAL Conversion: GeoJSON to Shapefile for QGIS Dissolve Processing
 * 
 * Converts the exported GeoJSON to Shapefile format, which works better
 * with QGIS dissolve operations for complex MultiPolygon geometries.
 */

const { execSync, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

async function checkGDALInstallation() {
    console.log('🔍 Checking GDAL installation...');
    
    try {
        const result = execSync('ogr2ogr --version', { encoding: 'utf8' });
        console.log(`✅ GDAL found: ${result.trim()}`);
        return true;
    } catch (error) {
        console.log('❌ GDAL not found in PATH');
        console.log('\n📦 GDAL Installation Instructions:');
        console.log('   Windows: Download from https://gisinternals.com/');
        console.log('   macOS:   brew install gdal');
        console.log('   Linux:   sudo apt-get install gdal-bin');
        console.log('\n⚠️ Alternative: Use QGIS built-in GDAL tools');
        return false;
    }
}

async function convertGeoJSONToShapefile() {
    console.log('=== Converting GeoJSON to Shapefile for QGIS Dissolve ===\n');
    
    // Check if GDAL is available
    const hasGDAL = await checkGDALInstallation();
    
    // Define file paths
    const inputFile = './exports/ca-north-central-for-dissolve.geojson';
    const outputDir = './exports/shapefiles';
    const outputFile = path.join(outputDir, 'ca-north-central');
    
    // Check if input file exists
    try {
        await fs.access(inputFile);
        console.log(`✅ Input file found: ${inputFile}`);
    } catch (error) {
        console.error('❌ Input GeoJSON file not found');
        console.log('💡 Run: node export-ca-north-central-geojson.js first');
        return;
    }
    
    // Create output directory
    try {
        await fs.mkdir(outputDir, { recursive: true });
        console.log(`📁 Output directory: ${outputDir}`);
    } catch (error) {
        console.error('❌ Failed to create output directory:', error);
        return;
    }
    
    if (hasGDAL) {
        try {
            console.log('\n🔄 Converting with GDAL...');
            
            // Build GDAL command
            const gdalCommand = [
                'ogr2ogr',
                '-f "ESRI Shapefile"',           // Output format
                '-overwrite',                     // Overwrite existing files
                '-t_srs EPSG:4326',              // Target spatial reference system
                `"${outputFile}.shp"`,           // Output shapefile
                `"${inputFile}"`                 // Input GeoJSON
            ].join(' ');
            
            console.log(`📝 Command: ${gdalCommand}`);
            
            const result = execSync(gdalCommand, { 
                encoding: 'utf8',
                stdio: 'pipe'
            });
            
            console.log('✅ GDAL conversion completed successfully!');
            
            // List created files
            const files = await fs.readdir(outputDir);
            const shapefileFiles = files.filter(f => f.startsWith('ca-north-central'));
            
            console.log('\n📄 Shapefile components created:');
            shapefileFiles.forEach(file => {
                console.log(`   ${file}`);
            });
            
            console.log('\n🎯 Next Steps:');
            console.log('   1. Open QGIS Desktop');
            console.log(`   2. Add Vector Layer: ${outputFile}.shp`);
            console.log('   3. Use Vector → Geoprocessing Tools → Dissolve');
            console.log('   4. Dissolve all features (leave dissolve field empty or use same value)');
            console.log('   5. Save result as GeoJSON for import back to database');
            
        } catch (error) {
            console.error('❌ GDAL conversion failed:', error.message);
            console.log('\n💡 Alternative: Use QGIS to import GeoJSON directly');
            await createQGISInstructions();
        }
        
    } else {
        console.log('\n⚠️ GDAL not available - providing QGIS import instructions');
        await createQGISInstructions();
    }
}

async function createQGISInstructions() {
    console.log('\n=== QGIS Direct Import Instructions ===');
    
    const instructionsFile = './exports/qgis-dissolve-instructions.md';
    
    const instructions = `# QGIS Dissolve Instructions for California North Central

## Method 1: Direct GeoJSON Import (Recommended if GDAL unavailable)

### Step 1: Import GeoJSON to QGIS
1. Open QGIS Desktop
2. Layer → Add Layer → Add Vector Layer
3. Source: \`./exports/ca-north-central-for-dissolve.geojson\`
4. Click "Add" - the MultiPolygon should load showing all county boundaries

### Step 2: Dissolve Operation
1. Vector → Geoprocessing Tools → Dissolve
2. **Input layer**: ca-north-central-for-dissolve
3. **Dissolve field**: Leave empty (dissolves all features into one)
4. **Output**: Save as \`./exports/ca-north-central-dissolved.geojson\`
5. Click "Run"

### Step 3: Verify Results
1. Check that output is single polygon feature (not MultiPolygon)
2. Verify no internal county boundaries are visible
3. Confirm exterior boundary matches original territory

## Method 2: Convert to Shapefile First (If GDAL available)

### In QGIS:
1. Import the GeoJSON as above
2. Right-click layer → Export → Save Features As
3. Format: ESRI Shapefile
4. Filename: \`./exports/shapefiles/ca-north-central.shp\`
5. Then follow dissolve steps above

## Expected Results

**Before Dissolve:**
- Geometry Type: MultiPolygon
- Feature Count: 1 feature with multiple polygon parts
- Visible: Internal county boundaries

**After Dissolve:**
- Geometry Type: Polygon (single)
- Feature Count: 1 unified feature
- Visible: Only exterior WSO boundary

## Next Steps After Dissolve

1. Export dissolved result as GeoJSON
2. Run: \`node import-dissolved-polygon.js\`
3. Verify border elimination with: \`node verify-dissolve-success.js\`

## Troubleshooting

**If dissolve fails:**
- Try Vector → Geometry Tools → Fix Geometries first
- Use Processing Toolbox → "Dissolve" algorithm instead
- Simplify geometry before dissolving

**If export fails:**
- Ensure output directory exists
- Check file permissions
- Try different export format (GeoPackage instead of GeoJSON)
`;

    await fs.writeFile(instructionsFile, instructions);
    console.log(`📄 Instructions saved: ${instructionsFile}`);
}

// Main execution
if (require.main === module) {
    convertGeoJSONToShapefile().catch(console.error);
}

module.exports = { convertGeoJSONToShapefile, createQGISInstructions };