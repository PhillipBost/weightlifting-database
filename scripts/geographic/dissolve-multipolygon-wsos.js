#!/usr/bin/env node

/**
 * Dissolve MultiPolygon WSO Territories
 *
 * Converts MultiPolygon geometries (multi-state WSOs) into single Polygon geometries
 * by dissolving/merging the state portions. This removes interior state borders while
 * preserving the exterior WSO boundary.
 *
 * This solves the frontend mapping issue where interior state borders are rendered
 * as visible boundaries, which is visually incorrect for WSO territories.
 *
 * Uses Turf.js for geometric operations.
 *
 * Usage:
 *   node dissolve-multipolygon-wsos.js --dry-run    # Preview changes
 *   node dissolve-multipolygon-wsos.js              # Apply changes
 *   node dissolve-multipolygon-wsos.js --force      # Force update all
 */

const { createClient } = require('@supabase/supabase-js');
const turf = require('@turf/turf');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

/**
 * Dissolve a MultiPolygon into a single Polygon
 * @param {Object} feature - GeoJSON Feature with MultiPolygon geometry
 * @returns {Object} GeoJSON Feature with dissolved Polygon geometry
 */
function dissolveMultiPolygon(feature) {
    const geometry = feature.geometry;

    if (geometry.type !== 'MultiPolygon') {
        log(`  ⚠️  Geometry is ${geometry.type}, not MultiPolygon - skipping`);
        return null;
    }

    try {
        // Create a FeatureCollection from all polygons in the MultiPolygon
        const features = geometry.coordinates.map(coords =>
            turf.polygon(coords)
        );

        // Union all features using turf.union with featureCollection
        const featureCollection = turf.featureCollection(features);

        // Dissolve by unioning features sequentially
        let dissolved = features[0];
        for (let i = 1; i < features.length; i++) {
            dissolved = turf.union(turf.featureCollection([dissolved, features[i]]));
        }

        // Return as Feature with original properties
        return {
            type: 'Feature',
            properties: feature.properties,
            geometry: dissolved.geometry
        };

    } catch (error) {
        log(`  ❌ Error dissolving geometry: ${error.message}`);
        return null;
    }
}

/**
 * Get all WSOs with MultiPolygon geometries
 */
async function getMultiPolygonWSOs() {
    log('🔍 Finding WSOs with MultiPolygon geometries...');

    const { data: wsos, error } = await supabase
        .from('usaw_wso_information')
        .select('name, territory_geojson, geographic_type')
        .not('territory_geojson', 'is', null);

    if (error) {
        throw new Error(`Failed to fetch WSOs: ${error.message}`);
    }

    // Filter for MultiPolygons
    const multiPolygonWSOs = wsos.filter(wso => {
        const geom = wso.territory_geojson.geometry || wso.territory_geojson;
        return geom.type === 'MultiPolygon';
    });

    log(`✅ Found ${multiPolygonWSOs.length} WSOs with MultiPolygon geometries`);

    return multiPolygonWSOs;
}

/**
 * Process a single WSO
 */
async function processSingleWSO(wso, options = {}) {
    const { dryRun = false } = options;

    log(`\n--- ${wso.name} ---`);

    const feature = wso.territory_geojson;
    const geometry = feature.geometry || feature;

    log(`  📊 Current geometry: ${geometry.type}`);
    log(`  📊 Polygon count: ${geometry.coordinates.length}`);

    // Dissolve the MultiPolygon
    const dissolved = dissolveMultiPolygon(feature);

    if (!dissolved) {
        return {
            success: false,
            wsoName: wso.name,
            error: 'Failed to dissolve geometry'
        };
    }

    const newGeometry = dissolved.geometry;
    log(`  ✅ Dissolved to: ${newGeometry.type}`);

    // Calculate reduction in complexity
    const originalCoordCount = JSON.stringify(geometry.coordinates).length;
    const newCoordCount = JSON.stringify(newGeometry.coordinates).length;
    const reduction = ((1 - newCoordCount / originalCoordCount) * 100).toFixed(1);

    log(`  📉 Coordinate data reduced by ~${reduction}%`);

    if (dryRun) {
        log(`  🔍 DRY RUN - Would update to ${newGeometry.type}`);
        return {
            success: true,
            wsoName: wso.name,
            dryRun: true,
            originalType: geometry.type,
            newType: newGeometry.type,
            reduction: reduction
        };
    }

    // Update database
    log(`  💾 Updating database...`);

    const { error: updateError } = await supabase
        .from('usaw_wso_information')
        .update({
            territory_geojson: dissolved,
            updated_at: new Date().toISOString()
        })
        .eq('name', wso.name);

    if (updateError) {
        log(`  ❌ Database update failed: ${updateError.message}`);
        return {
            success: false,
            wsoName: wso.name,
            error: `Database update failed: ${updateError.message}`
        };
    }

    log(`  ✅ Successfully dissolved and updated`);

    return {
        success: true,
        wsoName: wso.name,
        originalType: geometry.type,
        newType: newGeometry.type,
        reduction: reduction,
        updated: true
    };
}

/**
 * Process all MultiPolygon WSOs
 */
async function dissolveAllMultiPolygons(options = {}) {
    log('=== Dissolve MultiPolygon WSO Territories ===\n');

    const { dryRun = false } = options;

    if (dryRun) {
        log('🔍 DRY RUN MODE - No database changes will be made\n');
    }

    const multiPolygonWSOs = await getMultiPolygonWSOs();

    if (multiPolygonWSOs.length === 0) {
        log('✅ No MultiPolygon WSOs found - all territories already dissolved');
        return [];
    }

    log(`\n🚀 Processing ${multiPolygonWSOs.length} WSOs...\n`);

    const results = [];

    for (const wso of multiPolygonWSOs) {
        const result = await processSingleWSO(wso, options);
        results.push(result);
    }

    // Generate summary report
    log('\n' + '='.repeat(70));
    log('=== DISSOLVE SUMMARY ===');
    log('='.repeat(70));

    const successful = results.filter(r => r.success && !r.dryRun);
    const failed = results.filter(r => !r.success);
    const dryRunResults = results.filter(r => r.dryRun);

    log(`✅ Successfully dissolved: ${successful.length}`);
    log(`❌ Failed: ${failed.length}`);
    if (dryRun) {
        log(`🔍 Dry run results: ${dryRunResults.length}`);
    }
    log(`📊 Total processed: ${results.length}`);

    if (successful.length > 0) {
        log('\n✅ Successfully Dissolved:');
        successful.forEach(r => {
            log(`   ${r.wsoName}: ${r.originalType} → ${r.newType} (${r.reduction}% smaller)`);
        });
    }

    if (failed.length > 0) {
        log('\n❌ Failed:');
        failed.forEach(r => {
            log(`   ${r.wsoName}: ${r.error}`);
        });
    }

    if (dryRun) {
        log('\n🔍 Dry Run Complete - No changes made to database');
        log('   Run without --dry-run to actually dissolve the geometries');
    }

    if (!dryRun && successful.length > 0) {
        log('\n🎯 Next Steps:');
        log('   1. Export updated GeoJSON: node scripts/geographic/wso-geojson-api.js --export-all');
        log('   2. Test frontend mapping to verify interior borders are gone');
        log('   3. Validate geometries: node scripts/geographic/validate-wso-territories.js');
    }

    return results;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    if (args.includes('--help')) {
        console.log('Dissolve MultiPolygon WSO Territories');
        console.log('====================================\n');
        console.log('Converts MultiPolygon geometries to single Polygon geometries by');
        console.log('dissolving/merging state portions. Removes interior state borders.\n');
        console.log('Usage:');
        console.log('  node scripts/geographic/dissolve-multipolygon-wsos.js [options]\n');
        console.log('Options:');
        console.log('  --dry-run    Show what would be changed without making updates');
        console.log('  --help       Show this help message\n');
        console.log('Examples:');
        console.log('  node scripts/geographic/dissolve-multipolygon-wsos.js --dry-run');
        console.log('  node scripts/geographic/dissolve-multipolygon-wsos.js');
        return;
    }

    try {
        await dissolveAllMultiPolygons({ dryRun });
    } catch (error) {
        log(`💥 Fatal error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { dissolveAllMultiPolygons, processSingleWSO };
