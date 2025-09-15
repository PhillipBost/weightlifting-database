/**
 * Verify Border Elimination Success
 * 
 * Check if we actually eliminated county borders by examining the geometry structure.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function verifyBorderElimination() {
    console.log('=== Verifying County Border Elimination ===\n');
    
    const { data: californiaWSOs, error } = await supabase
        .from('wso_information')
        .select('name, territory_geojson')
        .in('name', ['California North Central', 'California South']);
    
    if (error) {
        console.error('Error fetching WSOs:', error);
        return;
    }
    
    for (const wso of californiaWSOs) {
        console.log(`--- ${wso.name} Border Analysis ---`);
        
        const geojson = wso.territory_geojson;
        const geometry = geojson.geometry;
        const props = geojson.properties || {};
        
        console.log(`Geometry Type: ${geometry.type}`);
        
        if (geometry.type === 'Polygon') {
            // Single polygon = no internal borders!
            console.log('✅ SUCCESS: Single unified polygon (NO internal county borders)');
            console.log(`🎯 Border Elimination: COMPLETE`);
            
            if (props.borders_eliminated) {
                console.log(`📊 Borders Eliminated: ${props.borders_eliminated}`);
                console.log(`📈 Before: ${props.polygon_count_before} separate polygons`);
                console.log(`📈 After: ${props.polygon_count_after} unified polygon(s)`);
            }
            
        } else if (geometry.type === 'MultiPolygon') {
            const polygonCount = geometry.coordinates.length;
            console.log(`⚠️ PARTIAL: MultiPolygon with ${polygonCount} polygons`);
            console.log(`🎯 Border Elimination: ${polygonCount === 1 ? 'COMPLETE' : 'INCOMPLETE'}`);
            console.log(`📊 Remaining internal borders: ${polygonCount - 1}`);
        }
        
        // Check processing metadata
        if (props.merge_method) {
            console.log(`🔧 Processing Method: ${props.merge_method}`);
            console.log(`📅 Last Processed: ${props.processing_date}`);
            
            if (props.merge_method === 'smart_turf_union' && geometry.type === 'Polygon') {
                console.log('🎉 CONFIRMED: Turf.js union successfully eliminated all county borders!');
            }
        }
        
        // Frontend implications
        console.log('\n📱 Frontend Map Implications:');
        if (geometry.type === 'Polygon') {
            console.log('  ✅ WSO will render as single seamless region');
            console.log('  ✅ No visible county boundaries within WSO');
            console.log('  ✅ Clean, professional appearance');
            console.log('  ✅ Faster rendering (fewer polygons)');
        } else {
            console.log(`  ❌ WSO will show ${geometry.coordinates.length - 1} internal county borders`);
            console.log('  ❌ "Sloppy" appearance with visible gaps');
        }
        
        console.log('');
    }
    
    console.log('=== CONCLUSION ===');
    
    // Final assessment
    const allPolygons = californiaWSOs.every(wso => 
        wso.territory_geojson.geometry.type === 'Polygon'
    );
    
    if (allPolygons) {
        console.log('🎉 SUCCESS: County border elimination ACHIEVED!');
        console.log('✅ Both California WSOs now have unified boundaries');
        console.log('✅ Frontend maps will show seamless WSO regions');
        console.log('✅ Original problem SOLVED');
        
        console.log('\n📋 Technical Summary:');
        console.log('- MultiPolygon → Polygon conversion: COMPLETE');
        console.log('- Internal county borders: ELIMINATED');
        console.log('- Visual gaps in maps: RESOLVED');
        console.log('- Turf.js union operation: SUCCESSFUL');
        
    } else {
        console.log('❌ INCOMPLETE: Some WSOs still have multiple polygons');
        console.log('⚠️ County borders may still be visible in frontend');
    }
}

if (require.main === module) {
    verifyBorderElimination().catch(console.error);
}