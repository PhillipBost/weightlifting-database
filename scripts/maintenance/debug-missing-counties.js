const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// All 58 California counties for verification
const ALL_CA_COUNTIES = [
    "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa",
    "Del Norte", "El Dorado", "Fresno", "Glenn", "Humboldt", "Imperial", "Inyo",
    "Kern", "Kings", "Lake", "Lassen", "Los Angeles", "Madera", "Marin",
    "Mariposa", "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa",
    "Nevada", "Orange", "Placer", "Plumas", "Riverside", "Sacramento", "San Benito",
    "San Bernardino", "San Diego", "San Francisco", "San Joaquin", "San Luis Obispo",
    "San Mateo", "Santa Barbara", "Santa Clara", "Santa Cruz", "Shasta", "Sierra",
    "Siskiyou", "Solano", "Sonoma", "Stanislaus", "Sutter", "Tehama", "Trinity",
    "Tulare", "Tuolumne", "Ventura", "Yolo", "Yuba"
];

async function debugMissingCounties() {
    console.log('=== Debugging Missing California Counties ===\n');

    // Get current WSO data
    const { data: californiaWSOs, error } = await supabase
        .from('wso_information')
        .select('*')
        .in('name', ['California North Central', 'California South']);

    if (error) {
        console.error('Error fetching California WSOs:', error);
        return;
    }

    const currentNorthCentral = californiaWSOs.find(w => w.name === 'California North Central')?.counties || [];
    const currentSouth = californiaWSOs.find(w => w.name === 'California South')?.counties || [];
    const currentAll = [...currentNorthCentral, ...currentSouth];

    console.log('CURRENT ASSIGNMENTS:');
    console.log(`North Central: ${currentNorthCentral.length} counties`);
    console.log(`South: ${currentSouth.length} counties`);
    console.log(`Total: ${currentAll.length} counties`);

    // Check for missing counties
    const missing = ALL_CA_COUNTIES.filter(county => !currentAll.includes(county));
    const extra = currentAll.filter(county => !ALL_CA_COUNTIES.includes(county));

    console.log(`\nMISSING FROM ASSIGNMENTS:`);
    if (missing.length > 0) {
        missing.forEach(county => console.log(`  ❌ ${county}`));
    } else {
        console.log(`  ✅ None - all 58 counties assigned`);
    }

    console.log(`\nEXTRA/INVALID COUNTIES:`);
    if (extra.length > 0) {
        extra.forEach(county => console.log(`  ⚠️  ${county}`));
    } else {
        console.log(`  ✅ None - all assigned counties are valid`);
    }

    // Test fetching a few potentially problematic counties
    console.log(`\n=== Testing County Boundary Fetching ===`);

    const testCounties = ["Madera", "San Diego"]; // These are commonly missing

    for (const county of testCounties) {
        console.log(`\nTesting ${county} County...`);

        try {
            const query = `${county} County, California, USA`;
            const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&q=${encodeURIComponent(query)}&limit=1`;

            const response = await fetch(nominatimUrl, {
                headers: {
                    'User-Agent': 'Weightlifting-Database/1.0'
                }
            });

            if (!response.ok) {
                console.log(`  ❌ HTTP Error: ${response.status}`);
                continue;
            }

            const data = await response.json();

            if (data.length > 0 && data[0].geojson) {
                console.log(`  ✅ Found boundary for ${county} County`);
                console.log(`     Type: ${data[0].geojson.type}`);
                console.log(`     Display Name: ${data[0].display_name}`);
            } else {
                console.log(`  ❌ No boundary data found for ${county} County`);
                if (data.length > 0) {
                    console.log(`     Found: ${data[0].display_name}`);
                    console.log(`     But no geojson data`);
                }
            }
        } catch (error) {
            console.error(`  ❌ Error fetching ${county} County:`, error.message);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Check if these missing counties should be added
    const shouldBeIncluded = ["Madera", "San Diego"];
    console.log(`\n=== Counties That Should Be Added ===`);
    shouldBeIncluded.forEach(county => {
        if (!currentAll.includes(county)) {
            console.log(`❌ ${county} - Missing from assignments!`);
        } else {
            console.log(`✅ ${county} - Already assigned`);
        }
    });

    return { missing, extra, totalAssigned: currentAll.length };
}

async function main() {
    try {
        await debugMissingCounties();
    } catch (error) {
        console.error('Debug error:', error);
    }
}

if (require.main === module) {
    main();
}

module.exports = { debugMissingCounties };