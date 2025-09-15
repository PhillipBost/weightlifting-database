/**
 * Verify Dissolve Success
 * 
 * Validates that the QGIS dissolve operation successfully eliminated
 * county borders in the California North Central territory.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function analyzeGeometry(geometry, name) {
    console.log(`\n--- ${name} Geometry Analysis ---`);
    
    const type = geometry.type;
    console.log(`📊 Geometry Type: ${type}`);
    
    if (type === 'Polygon') {
        console.log('✅ EXCELLENT: Single unified polygon');
        console.log('🎯 Border Status: ALL COUNTY BORDERS ELIMINATED');
        
        const rings = geometry.coordinates.length;
        console.log(`📍 Coordinate Rings: ${rings} (${rings === 1 ? 'exterior only' : `exterior + ${rings-1} holes`})`);
        
        // Count total coordinates
        let totalCoords = 0;
        geometry.coordinates.forEach(ring => totalCoords += ring.length);
        console.log(`📊 Total Coordinates: ${totalCoords.toLocaleString()}`);
        
        return {
            success: true,
            polygonCount: 1,
            bordersEliminated: 'ALL',
            geometryType: 'Polygon'
        };
        
    } else if (type === 'MultiPolygon') {
        const polygonCount = geometry.coordinates.length;
        console.log(`⚠️ PARTIAL: MultiPolygon with ${polygonCount} parts`);
        
        if (polygonCount === 1) {
            console.log('✅ Single polygon part - essentially unified');
            console.log('💡 Could convert to Polygon for perfect result');
        } else {
            console.log(`❌ ${polygonCount} separate polygons - internal borders remain`);
            console.log(`🎯 Border Status: ${polygonCount - 1} INTERNAL BORDERS STILL VISIBLE`);
        }
        
        // Analyze polygon sizes
        geometry.coordinates.forEach((polygon, index) => {
            const coordCount = polygon.reduce((sum, ring) => sum + ring.length, 0);
            console.log(`   Polygon ${index + 1}: ${coordCount} coordinates`);
        });
        
        return {
            success: polygonCount === 1,
            polygonCount: polygonCount,
            bordersEliminated: polygonCount > 1 ? 'PARTIAL' : 'ALL',
            geometryType: 'MultiPolygon'
        };
        
    } else {
        console.log(`❓ UNEXPECTED: ${type} geometry`);
        return {
            success: false,
            polygonCount: 0,
            bordersEliminated: 'UNKNOWN',
            geometryType: type
        };
    }
}

async function analyzeFrontendImpact(analysis) {
    console.log('\n--- Frontend Map Impact Analysis ---');
    
    if (analysis.success && analysis.geometryType === 'Polygon') {
        console.log('🎉 FRONTEND READY: Perfect seamless rendering');
        console.log('✅ WSO will display as unified territory');
        console.log('✅ No visible county boundaries');
        console.log('✅ Clean, professional map appearance');
        console.log('✅ Optimal rendering performance');
        
    } else if (analysis.polygonCount === 1) {
        console.log('✅ FRONTEND READY: Single polygon rendering');
        console.log('✅ No visible internal borders');
        console.log('💡 Could optimize further by converting to Polygon type');
        
    } else {
        console.log('❌ FRONTEND ISSUES: Visible internal borders');
        console.log(`❌ ${analysis.polygonCount - 1} county borders will be visible`);
        console.log('❌ "Sloppy" map appearance persists');
        console.log('💡 Need additional dissolve processing');
    }
}

async function compareWithPrevious(currentData) {
    console.log('\n--- Processing History Analysis ---');
    
    const props = currentData.territory_geojson.properties || {};
    
    if (props.dissolve_method) {
        console.log(`🔧 Dissolve Method: ${props.dissolve_method}`);
        console.log(`📅 Processing Date: ${props.dissolve_date || 'Unknown'}`);
        console.log(`🛠️ Processing Tool: ${props.processing_tool || 'Unknown'}`);
        
        if (props.polygon_count_before && props.polygon_count_after) {
            console.log(`📊 Before: ${props.polygon_count_before} polygons`);
            console.log(`📊 After: ${props.polygon_count_after} polygons`);
            console.log(`🎯 Borders Eliminated: ${props.borders_eliminated || 0}`);
            console.log(`✅ Dissolve Success: ${props.dissolve_success ? 'YES' : 'NO'}`);
        }
        
        // Compare with original problem
        if (props.polygon_count_before > 1 && props.polygon_count_after === 1) {
            console.log('\n🏆 MISSION STATUS: ACCOMPLISHED!');
            console.log('   Original problem: Multiple county polygons with visible borders');
            console.log('   Current state: Single unified polygon with no internal borders');
            console.log('   Result: Visual border problem SOLVED');
        } else if (props.polygon_count_after < props.polygon_count_before) {
            console.log('\n📈 MISSION STATUS: PARTIAL SUCCESS');
            console.log(`   Reduced from ${props.polygon_count_before} to ${props.polygon_count_after} polygons`);
            console.log(`   Eliminated ${props.borders_eliminated} internal borders`);
            console.log('   Some visual improvements achieved');
        } else {
            console.log('\n❌ MISSION STATUS: INCOMPLETE');
            console.log('   No reduction in polygon count achieved');
            console.log('   Original border visibility problem persists');
        }
        
    } else {
        console.log('⚠️ No dissolve processing metadata found');
        console.log('💡 May not have been processed with dissolve operation yet');
    }
}

async function generateRecommendations(analysis, wsoData) {
    console.log('\n--- Recommendations ---');
    
    if (analysis.success && analysis.geometryType === 'Polygon') {
        console.log('🎉 NO FURTHER ACTION NEEDED');
        console.log('✅ County borders successfully eliminated');
        console.log('✅ Ready for production frontend deployment');
        console.log('\n🎯 Optional optimizations:');
        console.log('   - Test frontend map rendering');
        console.log('   - Measure performance improvements');
        console.log('   - Document successful workflow for other WSOs');
        
    } else if (analysis.polygonCount === 1) {
        console.log('💡 GEOMETRY TYPE OPTIMIZATION RECOMMENDED');
        console.log('   Current: MultiPolygon with 1 part');
        console.log('   Optimal: Convert to Polygon type');
        console.log('   Action: Re-export from QGIS ensuring Polygon output');
        
    } else {
        console.log('🔧 ADDITIONAL DISSOLVE PROCESSING NEEDED');
        console.log(`   Problem: ${analysis.polygonCount} separate polygons remain`);
        console.log('   Solutions:');
        console.log('   1. Re-run QGIS dissolve with geometry validation');
        console.log('   2. Try QGIS Buffer→Dissolve workflow');
        console.log('   3. Use PostGIS ST_Union if available');
        console.log('   4. Manual geometry editing in QGIS');
        
        console.log('\n🔍 Troubleshooting Steps:');
        console.log('   1. Check for topology errors in original data');
        console.log('   2. Use Vector→Geometry Tools→Fix Geometries');
        console.log('   3. Try simplification before dissolve');
        console.log('   4. Verify all polygons are truly adjacent');
    }
}

async function verifyDissolveSuccess() {
    console.log('=== California North Central Dissolve Verification ===\n');
    
    try {
        // Fetch current WSO data
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
            console.error('❌ California North Central WSO not found');
            return;
        }
        
        console.log('✅ Found California North Central WSO data');
        
        // Check if territory data exists
        if (!wsoData.territory_geojson) {
            console.error('❌ No territory GeoJSON data found');
            return;
        }
        
        // Analyze geometry
        const geometry = wsoData.territory_geojson.geometry;
        const analysis = await analyzeGeometry(geometry, 'California North Central');
        
        // Analyze frontend impact
        await analyzeFrontendImpact(analysis);
        
        // Compare with processing history
        await compareWithPrevious(wsoData);
        
        // Generate recommendations
        await generateRecommendations(analysis, wsoData);
        
        // Final verdict
        console.log('\n=== FINAL VERDICT ===');
        
        if (analysis.success && analysis.geometryType === 'Polygon') {
            console.log('🏆 SUCCESS: County border elimination COMPLETE');
            console.log('✅ California North Central ready for seamless map rendering');
            console.log('✅ Original "sloppy borders" problem SOLVED');
            
        } else if (analysis.polygonCount === 1) {
            console.log('✅ SUCCESS: Borders effectively eliminated');
            console.log('💡 Minor optimization opportunity available');
            
        } else {
            console.log('❌ INCOMPLETE: Additional processing required');
            console.log(`⚠️ ${analysis.polygonCount - 1} county borders still visible`);
        }
        
        console.log('\n📊 Summary Statistics:');
        console.log(`   Geometry Type: ${analysis.geometryType}`);
        console.log(`   Polygon Count: ${analysis.polygonCount}`);
        console.log(`   Borders Eliminated: ${analysis.bordersEliminated}`);
        console.log(`   Frontend Ready: ${analysis.success ? 'YES' : 'NO'}`);
        
        return analysis;
        
    } catch (error) {
        console.error('❌ Verification failed:', error);
    }
}

// Main execution
if (require.main === module) {
    verifyDissolveSuccess().catch(console.error);
}

module.exports = { verifyDissolveSuccess, analyzeGeometry };