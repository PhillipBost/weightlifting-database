const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function validateWSOfixes() {
    console.log('=== WSO Map Input Fixes Validation ===\n');

    // 1. Validate California WSO Fixes
    console.log('1. CALIFORNIA WSO VALIDATION');
    console.log('============================');

    const { data: californiaWSOs, error: caError } = await supabase
        .from('usaw_wso_information')
        .select('*')
        .in('name', ['California North Central', 'California South']);

    if (caError) {
        console.error('Error fetching California WSOs:', caError);
        return;
    }

    for (const wso of californiaWSOs) {
        console.log(`\n--- ${wso.name} ---`);

        // Check basic data
        const expectedCountyCount = wso.name === 'California North Central' ? 18 : 12;
        const actualCountyCount = wso.counties ? wso.counties.length : 0;

        console.log(`Expected Counties: ${expectedCountyCount}`);
        console.log(`Actual Counties: ${actualCountyCount}`);
        console.log(`Counties Match: ${actualCountyCount === expectedCountyCount ? '✓' : '✗'}`);

        // Check GeoJSON quality
        if (wso.territory_geojson) {
            const geojson = wso.territory_geojson;
            console.log(`\nGeoJSON Analysis:`);
            console.log(`  Type: ${geojson.geometry?.type || 'Missing'}`);

            if (geojson.geometry?.type === 'MultiPolygon') {
                const polygonCount = geojson.geometry.coordinates?.length || 0;
                console.log(`  Polygon Count: ${polygonCount}`);
                console.log(`  Geometry Type: ✓ Correct (MultiPolygon)`);
            } else {
                console.log(`  Geometry Type: ✗ Incorrect (should be MultiPolygon)`);
            }

            // Check properties
            const props = geojson.properties || {};
            console.log(`  Merge Method: ${props.merge_method || 'Unknown'}`);
            console.log(`  Success Rate: ${props.success_rate || 'Unknown'}`);
            console.log(`  Successful Counties: ${props.successful_counties?.length || 0}/${expectedCountyCount}`);

            if (props.success_rate === '100%' && props.successful_counties?.length === expectedCountyCount) {
                console.log(`  County Coverage: ✓ Complete (${props.success_rate})`);
            } else {
                console.log(`  County Coverage: ✗ Incomplete`);
            }
        } else {
            console.log(`\nGeoJSON: ✗ Missing`);
        }

        console.log(`Last Updated: ${wso.updated_at}`);
    }

    // 2. Validate Multistate WSO Border Metadata
    console.log('\n\n2. MULTISTATE WSO BORDER VALIDATION');
    console.log('===================================');

    const { data: multiStateWSOs, error: msError } = await supabase
        .from('usaw_wso_information')
        .select('name, states, territory_geojson')
        .not('territory_geojson->properties->shared_borders', 'is', null);

    if (msError) {
        console.error('Error fetching multistate WSOs:', msError);
        return;
    }

    console.log(`\nFound ${multiStateWSOs.length} WSOs with border metadata:`);

    let totalBorders = 0;
    for (const wso of multiStateWSOs) {
        const sharedBorders = wso.territory_geojson?.properties?.shared_borders || [];
        const expectedBorders = calculateExpectedBorders(wso.states?.length || 0);

        console.log(`\n--- ${wso.name} ---`);
        console.log(`  States: ${wso.states?.join(', ') || 'Unknown'}`);
        console.log(`  Shared Borders: ${sharedBorders.length}`);
        console.log(`  Expected Max: ${expectedBorders} (if all states border each other)`);
        console.log(`  Has Metadata: ${sharedBorders.length > 0 ? '✓' : '✗'}`);

        if (sharedBorders.length > 0) {
            console.log(`  Border Details:`);
            sharedBorders.forEach(border => {
                console.log(`    - ${border.states[0]} ↔ ${border.states[1]}`);
            });
        }

        totalBorders += sharedBorders.length;
    }

    // 3. Summary Report
    console.log('\n\n3. VALIDATION SUMMARY');
    console.log('====================');

    const caFixed = californiaWSOs.every(wso =>
        wso.territory_geojson?.geometry?.type === 'MultiPolygon' &&
        wso.territory_geojson?.properties?.success_rate === '100%'
    );

    console.log(`\nCalifornia WSO Fixes:`);
    console.log(`  North Central: ${californiaWSOs.find(w => w.name === 'California North Central')?.territory_geojson?.properties?.success_rate || 'Failed'}`);
    console.log(`  South: ${californiaWSOs.find(w => w.name === 'California South')?.territory_geojson?.properties?.success_rate || 'Failed'}`);
    console.log(`  Overall Status: ${caFixed ? '✓ FIXED' : '✗ FAILED'}`);

    console.log(`\nMultistate Border Metadata:`);
    console.log(`  WSOs with Metadata: ${multiStateWSOs.length}`);
    console.log(`  Total Shared Borders: ${totalBorders}`);
    console.log(`  Overall Status: ${multiStateWSOs.length > 0 ? '✓ COMPLETE' : '✗ FAILED'}`);

    console.log(`\nFrontend Ready:`);
    console.log(`  California County Boundaries: ${caFixed ? '✓' : '✗'}`);
    console.log(`  Interior Border Fade Metadata: ${multiStateWSOs.length > 0 ? '✓' : '✗'}`);
    console.log(`  Overall Status: ${caFixed && multiStateWSOs.length > 0 ? '🎉 READY FOR FRONTEND' : '❌ NEEDS WORK'}`);

    return { caFixed, multiStateCount: multiStateWSOs.length, totalBorders };
}

function calculateExpectedBorders(stateCount) {
    // Maximum possible borders if all states border each other = n(n-1)/2
    return stateCount > 1 ? Math.floor((stateCount * (stateCount - 1)) / 2) : 0;
}

async function main() {
    try {
        await validateWSOfixes();
    } catch (error) {
        console.error('Validation error:', error);
    }
}

if (require.main === module) {
    main();
}

module.exports = { validateWSOfixes };