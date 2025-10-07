/**
 * Validate WSO Territory GeoJSON Data
 * 
 * Checks all WSOs in the database to ensure they have valid territory_geojson data.
 * Reports any WSOs with missing or invalid geometry that would cause analytics to return 0.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

async function validateAllWSOs() {
    log('=== Validate WSO Territory GeoJSON Data ===\n');
    
    // Fetch all WSOs
    const { data: wsos, error } = await supabase
        .from('wso_information')
        .select('name, territory_geojson, states, counties')
        .order('name');
    
    if (error) {
        log(`❌ Failed to fetch WSOs: ${error.message}`);
        process.exit(1);
    }
    
    log(`📊 Total WSOs in database: ${wsos.length}\n`);
    
    const results = {
        total: wsos.length,
        valid: [],
        missing: [],
        invalid: []
    };
    
    for (const wso of wsos) {
        const validation = validateWSO(wso);
        
        if (validation.status === 'valid') {
            results.valid.push(validation);
        } else if (validation.status === 'missing') {
            results.missing.push(validation);
        } else {
            results.invalid.push(validation);
        }
    }
    
    // Report results
    log('='.repeat(70));
    log('=== VALIDATION RESULTS ===');
    log('='.repeat(70));
    
    log(`\n✅ Valid territory_geojson: ${results.valid.length}`);
    log(`❌ Missing territory_geojson (NULL): ${results.missing.length}`);
    log(`⚠️  Invalid territory_geojson: ${results.invalid.length}`);
    
    if (results.valid.length > 0) {
        log('\n✅ WSOs with valid territory_geojson:');
        results.valid.forEach(v => {
            log(`   ${v.name}: ${v.geometryType} (${v.polygonCount} polygon(s))`);
        });
    }
    
    if (results.missing.length > 0) {
        log('\n❌ WSOs with MISSING territory_geojson (will return 0 for all metrics):');
        results.missing.forEach(v => {
            log(`   ${v.name}`);
        });
        log('\n   ⚠️  CRITICAL: These WSOs will return 0 for:');
        log('      - barbell_clubs_count');
        log('      - recent_meets_count');
        log('      - active_lifters_count');
        log('      - total_participations');
        log('\n   🔧 FIX: Run node scripts/geographic/import-wso-territories.js');
    }
    
    if (results.invalid.length > 0) {
        log('\n⚠️  WSOs with INVALID territory_geojson:');
        results.invalid.forEach(v => {
            log(`   ${v.name}: ${v.error}`);
        });
    }
    
    // Summary
    log('\n' + '='.repeat(70));
    log('=== SUMMARY ===');
    log('='.repeat(70));
    
    const healthPercentage = Math.round((results.valid.length / results.total) * 100);
    
    log(`\n📊 Database Health: ${healthPercentage}% (${results.valid.length}/${results.total})`);
    
    if (results.missing.length === 0 && results.invalid.length === 0) {
        log('✅ All WSOs have valid territory_geojson data');
        log('✅ Analytics calculations will work correctly for all regions');
        process.exit(0);
    } else {
        log(`❌ ${results.missing.length + results.invalid.length} WSO(s) have issues`);
        log('⚠️  Analytics calculations will return incorrect (0) values for affected WSOs');
        log('\n🔧 Recommended Actions:');
        
        if (results.missing.length > 0) {
            log('   1. Import missing territory data:');
            log('      node scripts/geographic/import-wso-territories.js');
        }
        
        if (results.invalid.length > 0) {
            log('   2. Fix invalid territory data for:');
            results.invalid.forEach(v => log(`      - ${v.name}`));
        }
        
        log('   3. Re-run this validation script to confirm fixes');
        log('   4. Re-run analytics calculation:');
        log('      node scripts/analytics/wso-weekly-calculator.js');
        
        process.exit(1);
    }
}

function validateWSO(wso) {
    const result = {
        name: wso.name,
        states: wso.states,
        counties: wso.counties
    };
    
    // Check if territory_geojson exists
    if (!wso.territory_geojson) {
        return {
            ...result,
            status: 'missing',
            error: 'territory_geojson is NULL'
        };
    }
    
    // Validate structure
    try {
        const geojson = wso.territory_geojson;
        
        // Check for Feature type
        if (geojson.type !== 'Feature') {
            return {
                ...result,
                status: 'invalid',
                error: `Expected type 'Feature', got '${geojson.type}'`
            };
        }
        
        // Check for geometry
        if (!geojson.geometry) {
            return {
                ...result,
                status: 'invalid',
                error: 'Missing geometry object'
            };
        }
        
        // Check geometry type
        const geometryType = geojson.geometry.type;
        if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') {
            return {
                ...result,
                status: 'invalid',
                error: `Invalid geometry type: ${geometryType} (expected Polygon or MultiPolygon)`
            };
        }
        
        // Check coordinates
        if (!geojson.geometry.coordinates || geojson.geometry.coordinates.length === 0) {
            return {
                ...result,
                status: 'invalid',
                error: 'Missing or empty coordinates array'
            };
        }
        
        // Count polygons
        const polygonCount = geometryType === 'MultiPolygon' 
            ? geojson.geometry.coordinates.length 
            : 1;
        
        return {
            ...result,
            status: 'valid',
            geometryType,
            polygonCount
        };
        
    } catch (error) {
        return {
            ...result,
            status: 'invalid',
            error: `Validation error: ${error.message}`
        };
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help')) {
        console.log('Validate WSO Territory GeoJSON Data');
        console.log('====================================\n');
        console.log('Checks all WSOs for valid territory_geojson data.\n');
        console.log('Usage:');
        console.log('  node scripts/geographic/validate-wso-territories.js\n');
        console.log('Exit codes:');
        console.log('  0 - All WSOs have valid territory_geojson');
        console.log('  1 - One or more WSOs have missing or invalid territory_geojson\n');
        return;
    }
    
    try {
        await validateAllWSOs();
    } catch (error) {
        log(`💥 Fatal error: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { validateAllWSOs, validateWSO };
