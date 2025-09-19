/**
 * Verify All WSO Dissolve Success
 * 
 * Comprehensive verification of border elimination across all processed WSOs
 * including California territories and multi-state WSOs.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function analyzeWSO(wso) {
    const geometry = wso.territory_geojson?.geometry;
    
    if (!geometry) {
        return {
            name: wso.name,
            status: 'NO_GEOMETRY',
            geometry_type: 'None',
            polygon_count: 0,
            borders_eliminated: 0,
            processed: false
        };
    }
    
    const props = wso.territory_geojson.properties || {};
    const polygonCount = geometry.type === 'MultiPolygon' ? geometry.coordinates.length : 1;
    const hasDissolveData = props.dissolve_method !== undefined;
    
    let status;
    if (geometry.type === 'Polygon') {
        status = 'PERFECT';
    } else if (polygonCount === 1) {
        status = 'OPTIMIZABLE'; // MultiPolygon with 1 part
    } else if (hasDissolveData && props.borders_eliminated > 0) {
        status = 'IMPROVED';
    } else if (polygonCount > 1) {
        status = 'NEEDS_PROCESSING';
    } else {
        status = 'UNKNOWN';
    }
    
    return {
        name: wso.name,
        status,
        geometry_type: geometry.type,
        polygon_count: polygonCount,
        borders_eliminated: props.borders_eliminated || 0,
        polygon_count_before: props.polygon_count_before || polygonCount,
        processed: hasDissolveData,
        dissolve_method: props.dissolve_method,
        dissolve_date: props.dissolve_date,
        geographic_type: wso.geographic_type,
        states: wso.states,
        counties: wso.counties
    };
}

async function verifyAllWSOs() {
    console.log('=== Comprehensive WSO Border Elimination Verification ===\n');
    
    // Get all WSOs with territory data
    const { data: allWSOs, error } = await supabase
        .from('wso_information')
        .select('*')
        .not('territory_geojson', 'is', null);
    
    if (error) {
        console.error('❌ Error fetching WSO data:', error);
        return;
    }
    
    console.log(`📊 Analyzing ${allWSOs.length} WSOs with territory data...\n`);
    
    const analyses = [];
    
    for (const wso of allWSOs) {
        const analysis = await analyzeWSO(wso);
        analyses.push(analysis);
    }
    
    // Categorize results
    const perfect = analyses.filter(a => a.status === 'PERFECT');
    const optimizable = analyses.filter(a => a.status === 'OPTIMIZABLE');
    const improved = analyses.filter(a => a.status === 'IMPROVED');
    const needsProcessing = analyses.filter(a => a.status === 'NEEDS_PROCESSING');
    const noGeometry = analyses.filter(a => a.status === 'NO_GEOMETRY');
    
    // Display results by category
    console.log('🏆 PERFECT - Single Polygon (No Internal Borders):');
    if (perfect.length === 0) {
        console.log('   None yet achieved');
    } else {
        perfect.forEach(a => {
            console.log(`   ✅ ${a.name} (${a.geographic_type})`);
        });
    }
    
    console.log('\\n✨ OPTIMIZABLE - MultiPolygon with 1 Part (Effectively No Borders):');
    if (optimizable.length === 0) {
        console.log('   None found');
    } else {
        optimizable.forEach(a => {
            console.log(`   🔧 ${a.name} (${a.geographic_type}) - Could convert to Polygon`);
        });
    }
    
    console.log('\\n✅ IMPROVED - Borders Significantly Reduced:');
    if (improved.length === 0) {
        console.log('   None found');
    } else {
        improved.forEach(a => {
            const reduction = Math.round((a.borders_eliminated / a.polygon_count_before) * 100);
            console.log(`   📈 ${a.name}: ${a.polygon_count_before} → ${a.polygon_count} polygons (${reduction}% reduction)`);
        });
    }
    
    console.log('\\n🔴 NEEDS PROCESSING - Multiple Polygons Remaining:');
    if (needsProcessing.length === 0) {
        console.log('   🎉 All WSOs processed!');
    } else {
        needsProcessing.forEach(a => {
            console.log(`   ❌ ${a.name}: ${a.polygon_count} polygons (${a.polygon_count - 1} borders visible)`);
        });
    }
    
    // Summary statistics
    console.log('\\n' + '='.repeat(70));
    console.log('=== BORDER ELIMINATION SUMMARY ===');
    console.log('='.repeat(70));
    
    const totalProcessed = perfect.length + optimizable.length + improved.length;
    const totalBordersEliminated = analyses.reduce((sum, a) => sum + a.borders_eliminated, 0);
    const effectivelyUnified = perfect.length + optimizable.length;
    
    console.log(`📊 Total WSOs Analyzed: ${allWSOs.length}`);
    console.log(`✅ WSOs Processed: ${totalProcessed}`);
    console.log(`🏆 Effectively Unified: ${effectivelyUnified} (no visible internal borders)`);
    console.log(`📈 WSOs Improved: ${improved.length}`);
    console.log(`❌ Still Need Processing: ${needsProcessing.length}`);
    console.log(`🎯 Total Borders Eliminated: ${totalBordersEliminated}`);
    
    if (allWSOs.length > 0) {
        const processingRate = Math.round((totalProcessed / allWSOs.length) * 100);
        console.log(`📈 Processing Success Rate: ${processingRate}%`);
    }
    
    // Detailed breakdown by WSO type
    console.log('\\n📋 Results by WSO Type:');
    
    const byType = {
        'California territories': analyses.filter(a => a.name.includes('California')),
        'Multi-state WSOs': analyses.filter(a => a.geographic_type === 'multi_state'),
        'Single-state WSOs': analyses.filter(a => a.geographic_type === 'state'),
        'County subdivisions': analyses.filter(a => a.geographic_type === 'county_subdivision'),
        'Other': analyses.filter(a => !['multi_state', 'state', 'county_subdivision'].includes(a.geographic_type) && !a.name.includes('California'))
    };
    
    Object.entries(byType).forEach(([type, wsos]) => {
        if (wsos.length > 0) {
            const processed = wsos.filter(w => w.processed).length;
            const unified = wsos.filter(w => w.status === 'PERFECT' || w.status === 'OPTIMIZABLE').length;
            console.log(`   ${type}: ${unified}/${wsos.length} unified (${processed} processed)`);
        }
    });
    
    // Frontend readiness assessment
    console.log('\\n🖥️ Frontend Map Rendering Assessment:');
    
    const frontendReady = perfect.length + optimizable.length;
    const frontendImproved = improved.filter(a => a.borders_eliminated > 0).length;
    const frontendProblematic = needsProcessing.length;
    
    console.log(`✅ Ready for seamless rendering: ${frontendReady} WSOs`);
    console.log(`📈 Significantly improved: ${frontendImproved} WSOs`);
    console.log(`❌ Still showing internal borders: ${frontendProblematic} WSOs`);
    
    if (frontendProblematic === 0) {
        console.log('\\n🎉 MISSION ACCOMPLISHED!');
        console.log('   All WSOs with territory data have been processed');
        console.log('   Frontend maps should show clean, unified WSO territories');
        console.log('   No more "sloppy" internal county borders visible');
    } else {
        console.log('\\n💡 Recommendations:');
        console.log(`   Continue processing the ${frontendProblematic} remaining WSOs`);
        console.log('   Test frontend with current improvements');
        console.log('   Consider if partial improvements are sufficient');
    }
    
    // Processing history
    const processedWSOs = analyses.filter(a => a.processed);
    if (processedWSOs.length > 0) {
        console.log('\\n📅 Processing Timeline:');
        const byDate = {};
        processedWSOs.forEach(a => {
            if (a.dissolve_date) {
                const date = a.dissolve_date.split('T')[0];
                if (!byDate[date]) byDate[date] = [];
                byDate[date].push(a.name);
            }
        });
        
        Object.entries(byDate).forEach(([date, names]) => {
            console.log(`   ${date}: ${names.length} WSOs processed`);
        });
    }
    
    return {
        total: allWSOs.length,
        perfect,
        optimizable,
        improved,
        needsProcessing,
        totalBordersEliminated,
        effectivelyUnified,
        processingRate: allWSOs.length > 0 ? Math.round((totalProcessed / allWSOs.length) * 100) : 0
    };
}

if (require.main === module) {
    verifyAllWSOs().catch(console.error);
}

module.exports = { verifyAllWSOs, analyzeWSO };