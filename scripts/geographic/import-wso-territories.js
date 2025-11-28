/**
 * Import WSO Territory GeoJSON Files
 * 
 * Imports all WSO territory GeoJSON files from geojson_data/wso_territories/
 * into the wso_information.territory_geojson column in Supabase.
 * 
 * This fixes the issue where WSOs with NULL territory_geojson return 0 for all analytics metrics.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Mapping from filename (without .geojson) to WSO database name
const wsoNameMapping = {
    'alabama': 'Alabama',
    'alaska': 'Alaska',
    'arizona': 'Arizona',
    'arkansas': 'Arkansas',
    'california_north_central': 'California North Central',
    'california_south': 'California South',
    'carolina': 'Carolina',
    'colorado': 'Colorado',
    'connecticut': 'Connecticut',
    'delaware': 'Delaware',
    'dmv': 'DMV',
    'florida': 'Florida',
    'georgia': 'Georgia',
    'hawaii_and_international': 'Hawaii and International',
    'illinois': 'Illinois',
    'indiana': 'Indiana',
    'iowa_nebraska': 'Iowa-Nebraska',
    'michigan': 'Michigan',
    'minnesota_dakotas': 'Minnesota-Dakotas',
    'missouri_valley': 'Missouri Valley',
    'mountain_north': 'Mountain North',
    'mountain_south': 'Mountain South',
    'new_england': 'New England',
    'new_jersey': 'New Jersey',
    'new_york': 'New York',
    'ohio': 'Ohio',
    'pacific_northwest': 'Pacific Northwest',
    'pennsylvania_west_virginia': 'Pennsylvania-West Virginia',
    'southern': 'Southern',
    'tennessee_kentucky': 'Tennessee-Kentucky',
    'texas_oklahoma': 'Texas-Oklahoma',
    'wisconsin': 'Wisconsin'
};

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

async function findTerritoryFiles() {
    log('🔍 Finding all WSO territory GeoJSON files...');

    const territoriesDir = './geojson_data/wso_territories';
    const files = await fs.readdir(territoriesDir);

    // Filter for individual territory files (exclude all_wso_territories.geojson)
    const territoryFiles = files.filter(f =>
        f.endsWith('.geojson') &&
        f !== 'all_wso_territories.geojson'
    );

    log(`✅ Found ${territoryFiles.length} territory files`);

    return territoryFiles.map(filename => {
        const baseName = filename.replace('.geojson', '');
        const wsoName = wsoNameMapping[baseName];

        return {
            filename,
            filepath: path.join(territoriesDir, filename),
            baseName,
            wsoName: wsoName || baseName
        };
    });
}

async function loadGeoJSON(filepath) {
    try {
        const content = await fs.readFile(filepath, 'utf8');
        const geoData = JSON.parse(content);

        // Validate it's a Feature or FeatureCollection
        if (geoData.type === 'Feature') {
            return { success: true, feature: geoData };
        } else if (geoData.type === 'FeatureCollection' && geoData.features && geoData.features.length > 0) {
            return { success: true, feature: geoData.features[0] };
        } else {
            return { success: false, error: `Invalid GeoJSON structure: ${geoData.type}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function checkWSOExists(wsoName) {
    const { data, error } = await supabase
        .from('usaw_wso_information')
        .select('name, territory_geojson')
        .eq('name', wsoName)
        .single();

    if (error) {
        return { exists: false, error: error.message };
    }

    return {
        exists: true,
        wso: data,
        hasGeometry: data.territory_geojson !== null && data.territory_geojson !== undefined
    };
}

async function importSingleWSO(fileInfo, options = {}) {
    const { dryRun = false, force = false } = options;

    log(`\n--- ${fileInfo.filename} ---`);
    log(`🎯 Target WSO: ${fileInfo.wsoName}`);

    // Check if WSO exists in database
    const wsoCheck = await checkWSOExists(fileInfo.wsoName);

    if (!wsoCheck.exists) {
        log(`❌ WSO not found in database: ${fileInfo.wsoName}`);
        return {
            success: false,
            wsoName: fileInfo.wsoName,
            filename: fileInfo.filename,
            error: 'WSO not found in database'
        };
    }

    log(`✅ Found WSO in database: ${fileInfo.wsoName}`);

    // Check if territory_geojson already exists
    if (wsoCheck.hasGeometry && !force) {
        log(`ℹ️  territory_geojson already exists (use --force to overwrite)`);
        return {
            success: true,
            wsoName: fileInfo.wsoName,
            filename: fileInfo.filename,
            skipped: true,
            reason: 'Geometry already exists'
        };
    }

    if (wsoCheck.hasGeometry && force) {
        log(`⚠️  Overwriting existing territory_geojson (--force mode)`);
    } else {
        log(`📍 territory_geojson is NULL - importing...`);
    }

    // Load GeoJSON file
    const geoResult = await loadGeoJSON(fileInfo.filepath);

    if (!geoResult.success) {
        log(`❌ Failed to load GeoJSON: ${geoResult.error}`);
        return {
            success: false,
            wsoName: fileInfo.wsoName,
            filename: fileInfo.filename,
            error: `Failed to load GeoJSON: ${geoResult.error}`
        };
    }

    const feature = geoResult.feature;
    const geometryType = feature.geometry.type;
    const polygonCount = geometryType === 'MultiPolygon'
        ? feature.geometry.coordinates.length
        : 1;

    log(`📊 Geometry type: ${geometryType}`);
    log(`📊 Polygon count: ${polygonCount}`);

    if (dryRun) {
        log(`🔍 DRY RUN - Would import ${geometryType} with ${polygonCount} polygon(s)`);
        return {
            success: true,
            wsoName: fileInfo.wsoName,
            filename: fileInfo.filename,
            dryRun: true,
            geometryType,
            polygonCount
        };
    }

    // Update database
    log(`💾 Updating database...`);

    const { error: updateError } = await supabase
        .from('usaw_wso_information')
        .update({
            territory_geojson: feature,
            updated_at: new Date().toISOString()
        })
        .eq('name', fileInfo.wsoName);

    if (updateError) {
        log(`❌ Database update failed: ${updateError.message}`);
        return {
            success: false,
            wsoName: fileInfo.wsoName,
            filename: fileInfo.filename,
            error: `Database update failed: ${updateError.message}`
        };
    }

    log(`✅ Successfully imported territory_geojson`);

    return {
        success: true,
        wsoName: fileInfo.wsoName,
        filename: fileInfo.filename,
        geometryType,
        polygonCount,
        imported: true
    };
}

async function importAllTerritories(options = {}) {
    log('=== Import WSO Territory GeoJSON Files ===\n');

    const { dryRun = false, force = false } = options;

    if (dryRun) {
        log('🔍 DRY RUN MODE - No database changes will be made\n');
    }

    if (force) {
        log('⚠️  FORCE MODE - Will overwrite existing territory_geojson data\n');
    }

    const territoryFiles = await findTerritoryFiles();

    if (territoryFiles.length === 0) {
        log('❌ No territory GeoJSON files found');
        return;
    }

    log(`\n🚀 Processing ${territoryFiles.length} files...\n`);

    const results = [];

    for (const fileInfo of territoryFiles) {
        const result = await importSingleWSO(fileInfo, options);
        results.push(result);
    }

    // Generate summary report
    log('\n' + '='.repeat(70));
    log('=== IMPORT SUMMARY ===');
    log('='.repeat(70));

    const successful = results.filter(r => r.success && !r.skipped && !r.dryRun);
    const skipped = results.filter(r => r.skipped);
    const failed = results.filter(r => !r.success);
    const dryRunResults = results.filter(r => r.dryRun);

    log(`✅ Successfully imported: ${successful.length}`);
    log(`⏭️  Skipped (already exists): ${skipped.length}`);
    log(`❌ Failed: ${failed.length}`);
    if (dryRun) {
        log(`🔍 Dry run results: ${dryRunResults.length}`);
    }
    log(`📊 Total processed: ${results.length}`);

    if (successful.length > 0) {
        log('\n✅ Successfully Imported:');
        successful.forEach(r => {
            log(`   ${r.wsoName}: ${r.geometryType} (${r.polygonCount} polygon(s))`);
        });
    }

    if (skipped.length > 0) {
        log('\n⏭️  Skipped (already have territory_geojson):');
        skipped.forEach(r => {
            log(`   ${r.wsoName}`);
        });
        log(`   Use --force to overwrite existing data`);
    }

    if (failed.length > 0) {
        log('\n❌ Failed:');
        failed.forEach(r => {
            log(`   ${r.wsoName}: ${r.error}`);
        });
    }

    if (dryRun) {
        log('\n🔍 Dry Run Complete - No changes made to database');
        log('   Run without --dry-run to actually import the data');
    }

    if (!dryRun && successful.length > 0) {
        log('\n🎯 Next Steps:');
        log('   1. Verify imports: node scripts/geographic/validate-wso-territories.js');
        log('   2. Re-run analytics: node scripts/analytics/wso-weekly-calculator.js');
        log('   3. Check Alabama active_lifters_count is now non-zero');
    }

    return results;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');

    if (args.includes('--help')) {
        console.log('Import WSO Territory GeoJSON Files');
        console.log('===================================\n');
        console.log('Usage:');
        console.log('  node scripts/geographic/import-wso-territories.js [options]\n');
        console.log('Options:');
        console.log('  --dry-run    Show what would be imported without making changes');
        console.log('  --force      Overwrite existing territory_geojson data');
        console.log('  --help       Show this help message\n');
        console.log('Examples:');
        console.log('  node scripts/geographic/import-wso-territories.js --dry-run');
        console.log('  node scripts/geographic/import-wso-territories.js');
        console.log('  node scripts/geographic/import-wso-territories.js --force');
        return;
    }

    try {
        await importAllTerritories({ dryRun, force });
    } catch (error) {
        log(`💥 Fatal error: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { importAllTerritories, importSingleWSO };
