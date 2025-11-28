const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Complete list of all 58 California counties
const ALL_CA_COUNTIES = [
    // Current North Central (18 counties)
    "Alameda", "Contra Costa", "Marin", "Napa", "San Francisco",
    "San Mateo", "Santa Clara", "Solano", "Sonoma", "Monterey",
    "San Benito", "Santa Cruz", "Merced", "Stanislaus", "San Joaquin",
    "Calaveras", "Tuolumne", "Mariposa",

    // Current South (12 counties)
    "Imperial", "Riverside", "San Bernardino", "Orange", "Los Angeles",
    "Ventura", "Santa Barbara", "Kern", "Tulare", "Fresno", "Kings", "Inyo",

    // MISSING counties that should be assigned
    "Alpine", "Amador", "Butte", "Colusa", "Del Norte", "El Dorado",
    "Glenn", "Humboldt", "Lake", "Lassen", "Mendocino", "Modoc",
    "Mono", "Nevada", "Placer", "Plumas", "Sacramento", "San Luis Obispo",
    "Shasta", "Sierra", "Siskiyou", "Sutter", "Tehama", "Trinity",
    "Yolo", "Yuba"
];

// Based on the descriptions:
// North Central: "All counties north of San Luis Obispo County, Kern County and San Bernardino County"
// South: "All counties south of Monterey, Kings, Tulare and Inyo Counties"

const CORRECTED_NORTH_CENTRAL = [
    // Bay Area
    "Alameda", "Contra Costa", "Marin", "Napa", "San Francisco",
    "San Mateo", "Santa Clara", "Solano", "Sonoma",

    // Central Coast
    "Monterey", "San Benito", "Santa Cruz",

    // Central Valley (northern part)
    "Merced", "Stanislaus", "San Joaquin", "Calaveras", "Tuolumne", "Mariposa",

    // Sacramento Valley and surrounding
    "Sacramento", "Yolo", "Sutter", "Yuba", "Placer", "El Dorado",
    "Amador", "Alpine", "Nevada", "Sierra", "Plumas",

    // Northern California
    "Butte", "Colusa", "Glenn", "Tehama", "Shasta", "Lassen", "Modoc",
    "Siskiyou", "Del Norte", "Humboldt", "Trinity", "Mendocino", "Lake"
];

const CORRECTED_SOUTH = [
    // Southern California metro
    "Los Angeles", "Orange", "Riverside", "San Bernardino", "Imperial",
    "Ventura", "Santa Barbara",

    // Central Valley (southern part)
    "Kern", "Tulare", "Fresno", "Kings",

    // Eastern Sierra
    "Inyo", "Mono",

    // Central Coast (southern part)
    "San Luis Obispo"
];

async function analyzeCountyCoverage() {
    console.log('=== California County Coverage Analysis ===\n');

    // Get current WSO data
    const { data: californiaWSOs, error } = await supabase
        .from('usaw_wso_information')
        .select('*')
        .in('name', ['California North Central', 'California South']);

    if (error) {
        console.error('Error fetching California WSOs:', error);
        return;
    }

    const currentNorthCentral = californiaWSOs.find(w => w.name === 'California North Central')?.counties || [];
    const currentSouth = californiaWSOs.find(w => w.name === 'California South')?.counties || [];

    console.log('CURRENT COVERAGE:');
    console.log(`North Central: ${currentNorthCentral.length} counties`);
    console.log(`South: ${currentSouth.length} counties`);
    console.log(`Total Current: ${currentNorthCentral.length + currentSouth.length} counties`);
    console.log(`California Total: ${ALL_CA_COUNTIES.length} counties`);
    console.log(`Missing: ${ALL_CA_COUNTIES.length - (currentNorthCentral.length + currentSouth.length)} counties\n`);

    // Find missing counties
    const currentAll = [...currentNorthCentral, ...currentSouth];
    const missing = ALL_CA_COUNTIES.filter(county => !currentAll.includes(county));

    console.log('MISSING COUNTIES:');
    missing.forEach(county => console.log(`  - ${county}`));

    console.log('\n\nCORRECTED ASSIGNMENTS:');
    console.log(`\nNorth Central (${CORRECTED_NORTH_CENTRAL.length} counties):`);
    console.log(`  ${CORRECTED_NORTH_CENTRAL.join(', ')}`);

    console.log(`\nSouth (${CORRECTED_SOUTH.length} counties):`);
    console.log(`  ${CORRECTED_SOUTH.join(', ')}`);

    console.log(`\nTotal Corrected: ${CORRECTED_NORTH_CENTRAL.length + CORRECTED_SOUTH.length} counties`);

    // Check for any still missing
    const correctedAll = [...CORRECTED_NORTH_CENTRAL, ...CORRECTED_SOUTH];
    const stillMissing = ALL_CA_COUNTIES.filter(county => !correctedAll.includes(county));

    if (stillMissing.length > 0) {
        console.log(`\nSTILL MISSING AFTER CORRECTION:`);
        stillMissing.forEach(county => console.log(`  - ${county}`));
    } else {
        console.log(`\n✓ CORRECTED ASSIGNMENTS COVER ALL 58 CALIFORNIA COUNTIES`);
    }

    return { missing, correctedNorthCentral: CORRECTED_NORTH_CENTRAL, correctedSouth: CORRECTED_SOUTH };
}

async function main() {
    try {
        await analyzeCountyCoverage();
    } catch (error) {
        console.error('Analysis error:', error);
    }
}

if (require.main === module) {
    main();
}

module.exports = { analyzeCountyCoverage, CORRECTED_NORTH_CENTRAL, CORRECTED_SOUTH };