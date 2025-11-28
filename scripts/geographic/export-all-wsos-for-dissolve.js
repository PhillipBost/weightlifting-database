/**
 * Export All WSOs for Dissolve Processing
 * 
 * Identifies and exports all WSO territories that have MultiPolygon geometries
 * requiring dissolve processing to eliminate internal borders.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function identifyWSosNeedingDissolve() {
    console.log('🔍 Identifying WSOs needing dissolve processing...\n');

    const { data: allWSOs, error } = await supabase
        .from('usaw_wso_information')
        .select('*')
        .not('territory_geojson', 'is', null);

    if (error) {
        console.error('❌ Error fetching WSO data:', error);
        return [];
    }

    const wsosNeedingDissolve = [];

    for (const wso of allWSOs) {
        const geometry = wso.territory_geojson?.geometry;

        if (!geometry) continue;

        let needsDissolve = false;
        let polygonCount = 0;
        let reason = '';

        if (geometry.type === 'MultiPolygon') {
            polygonCount = geometry.coordinates.length;

            if (polygonCount > 1) {
                needsDissolve = true;
                reason = `MultiPolygon with ${polygonCount} parts - internal borders visible`;
            } else {
                reason = `MultiPolygon with 1 part - could optimize to Polygon`;
            }
        } else if (geometry.type === 'Polygon') {
            reason = 'Already unified Polygon - no action needed';
        } else {
            reason = `Unexpected geometry type: ${geometry.type}`;
        }

        const wsoInfo = {
            name: wso.name,
            geographic_type: wso.geographic_type,
            states: wso.states,
            counties: wso.counties,
            geometry_type: geometry.type,
            polygon_count: polygonCount,
            needs_dissolve: needsDissolve,
            reason: reason,
            priority: needsDissolve ? 'HIGH' : 'LOW',
            data: wso
        };

        if (needsDissolve) {
            wsosNeedingDissolve.push(wsoInfo);
        }

        console.log(`${needsDissolve ? '🔴' : '✅'} ${wso.name}: ${reason}`);
    }

    console.log(`\n📊 Summary: ${wsosNeedingDissolve.length} WSOs need dissolve processing`);

    return wsosNeedingDissolve;
}

async function exportWSO(wsoInfo, outputDir) {
    const wso = wsoInfo.data;
    const safeName = wso.name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    const filename = `${safeName}-for-dissolve.geojson`;
    const filepath = path.join(outputDir, filename);

    // Prepare export data
    const exportData = {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                geometry: wso.territory_geojson.geometry,
                properties: {
                    wso_name: wso.name,
                    geographic_type: wso.geographic_type,
                    counties: wso.counties,
                    states: wso.states,
                    export_date: new Date().toISOString(),
                    export_purpose: 'dissolve_processing',
                    processing_note: `${wsoInfo.geometry_type} with ${wsoInfo.polygon_count} parts to be dissolved`,
                    original_polygon_count: wsoInfo.polygon_count,
                    target_polygon_count: 1,
                    dissolve_method: 'qgis_external',
                    priority: wsoInfo.priority,
                    reason: wsoInfo.reason
                }
            }
        ],
        metadata: {
            export_source: 'weightlifting-database',
            table: 'wso_information',
            wso_name: wso.name,
            export_timestamp: new Date().toISOString(),
            purpose: 'External dissolve processing to eliminate internal borders',
            processing_priority: wsoInfo.priority,
            estimated_borders_to_eliminate: wsoInfo.polygon_count - 1
        }
    };

    await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));

    console.log(`   📄 Exported: ${filename}`);
    console.log(`   📊 ${wsoInfo.polygon_count} polygons → target: 1 polygon`);

    return {
        wso_name: wso.name,
        filename: filename,
        filepath: filepath,
        polygon_count: wsoInfo.polygon_count,
        size_kb: Math.round(JSON.stringify(exportData).length / 1024)
    };
}

async function exportAllWSOs() {
    console.log('=== Export All WSOs for Dissolve Processing ===\n');

    // Identify WSOs needing dissolve
    const wsosNeedingDissolve = await identifyWSosNeedingDissolve();

    if (wsosNeedingDissolve.length === 0) {
        console.log('✅ No WSOs need dissolve processing!');
        return;
    }

    // Create exports directory
    const exportsDir = './exports/batch-dissolve';
    try {
        await fs.mkdir(exportsDir, { recursive: true });
        console.log(`\n📁 Created export directory: ${exportsDir}`);
    } catch (error) {
        console.error('❌ Failed to create export directory:', error);
        return;
    }

    console.log(`\n🚀 Exporting ${wsosNeedingDissolve.length} WSOs...\n`);

    const exportResults = [];

    for (const wsoInfo of wsosNeedingDissolve) {
        console.log(`--- Exporting ${wsoInfo.name} ---`);

        try {
            const result = await exportWSO(wsoInfo, exportsDir);
            exportResults.push(result);

        } catch (error) {
            console.error(`❌ Failed to export ${wsoInfo.name}:`, error);
        }

        console.log('');
    }

    // Create processing manifest
    const manifest = {
        export_date: new Date().toISOString(),
        total_wsos: exportResults.length,
        export_directory: exportsDir,
        processing_instructions: 'Use QGIS dissolve tool on each file',
        wsos: exportResults.map(r => ({
            wso_name: r.wso_name,
            filename: r.filename,
            original_polygons: r.polygon_count,
            target_polygons: 1,
            borders_to_eliminate: r.polygon_count - 1,
            size_kb: r.size_kb
        })),
        next_steps: [
            '1. Process each GeoJSON file in QGIS with dissolve tool',
            '2. Export dissolved results with "-dissolved" suffix',
            '3. Run import-dissolved-polygon.js for each WSO',
            '4. Verify results with verify-dissolve-success.js'
        ]
    };

    const manifestPath = path.join(exportsDir, 'dissolve-processing-manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // Summary report
    console.log('=== Export Summary ===');
    console.log(`✅ Exported ${exportResults.length} WSOs for dissolve processing`);
    console.log(`📁 Location: ${exportsDir}`);

    console.log('\n📊 WSOs by Priority:');
    const highPriority = wsosNeedingDissolve.filter(w => w.priority === 'HIGH');
    console.log(`   🔴 High Priority: ${highPriority.length} WSOs (multiple polygons)`);

    console.log('\n📋 Exported WSOs:');
    exportResults.forEach(r => {
        console.log(`   ${r.wso_name}: ${r.polygon_count} → 1 polygon (${r.size_kb} KB)`);
    });

    const totalBorders = exportResults.reduce((sum, r) => sum + (r.polygon_count - 1), 0);
    console.log(`\n🎯 Total Borders to Eliminate: ${totalBorders}`);

    console.log(`\n📄 Processing manifest: ${manifestPath}`);

    console.log('\n🎯 Next Steps:');
    console.log('   1. Open each GeoJSON file in QGIS');
    console.log('   2. Use Processing Toolbox → Dissolve on each file');
    console.log('   3. Export dissolved results');
    console.log('   4. Run import scripts for each WSO');
    console.log('   5. Use verify-dissolve-success.js to confirm results');

    return exportResults;
}

async function exportSpecificWSOs(wsoNames) {
    console.log(`=== Export Specific WSOs: ${wsoNames.join(', ')} ===\n`);

    const { data: specificWSOs, error } = await supabase
        .from('usaw_wso_information')
        .select('*')
        .in('name', wsoNames)
        .not('territory_geojson', 'is', null);

    if (error) {
        console.error('❌ Error fetching specific WSO data:', error);
        return;
    }

    const exportsDir = './exports/specific-dissolve';
    await fs.mkdir(exportsDir, { recursive: true });

    const exportResults = [];

    for (const wso of specificWSOs) {
        const geometry = wso.territory_geojson?.geometry;
        if (!geometry) continue;

        const polygonCount = geometry.type === 'MultiPolygon' ? geometry.coordinates.length : 1;
        const needsDissolve = geometry.type === 'MultiPolygon' && polygonCount > 1;

        if (needsDissolve) {
            const wsoInfo = {
                data: wso,
                polygon_count: polygonCount,
                geometry_type: geometry.type,
                priority: 'HIGH',
                reason: `Requested WSO with ${polygonCount} polygons`
            };

            const result = await exportWSO(wsoInfo, exportsDir);
            exportResults.push(result);
        } else {
            console.log(`⚠️ ${wso.name}: No dissolve needed (${geometry.type})`);
        }
    }

    console.log(`\n✅ Exported ${exportResults.length} specific WSOs`);
    return exportResults;
}

// Main execution
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--california-south')) {
        await exportSpecificWSOs(['California South']);
    } else if (args.includes('--multi-state')) {
        // Export only multi-state WSOs
        const { data: multiStateWSOs, error } = await supabase
            .from('usaw_wso_information')
            .select('name')
            .eq('geographic_type', 'multi_state');

        if (!error && multiStateWSOs.length > 0) {
            const names = multiStateWSOs.map(w => w.name);
            await exportSpecificWSOs(names);
        }
    } else if (args.length > 0) {
        // Export specific WSO names provided as arguments
        await exportSpecificWSOs(args);
    } else {
        // Export all WSOs needing dissolve
        await exportAllWSOs();
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { exportAllWSOs, exportSpecificWSOs, identifyWSosNeedingDissolve };