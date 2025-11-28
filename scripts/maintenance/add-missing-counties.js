const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Corrected complete assignments with the missing counties
const FINAL_COMPLETE_ASSIGNMENTS = {
    "California North Central": [
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
    ],

    "California South": [
        // Southern California metro
        "Los Angeles", "Orange", "Riverside", "San Bernardino", "Imperial",
        "Ventura", "Santa Barbara", "San Diego",

        // Central Valley (southern part)
        "Kern", "Tulare", "Fresno", "Kings", "Madera",

        // Eastern Sierra
        "Inyo", "Mono",

        // Central Coast (southern part)
        "San Luis Obispo"
    ]
};

async function addMissingCounties() {
    console.log('=== Adding Missing California Counties ===\n');

    for (const [wsoName, counties] of Object.entries(FINAL_COMPLETE_ASSIGNMENTS)) {
        console.log(`--- Updating ${wsoName} ---`);
        console.log(`Counties: ${counties.length} total`);

        if (wsoName === 'California South') {
            console.log(`Added: Madera, San Diego`);
        }

        console.log(`List: ${counties.join(', ')}\n`);

        const { error } = await supabase
            .from('usaw_wso_information')
            .update({
                counties: counties,
                updated_at: new Date().toISOString()
            })
            .eq('name', wsoName);

        if (error) {
            console.error(`Error updating ${wsoName}:`, error);
        } else {
            console.log(`✓ Successfully updated ${wsoName} with ${counties.length} counties\n`);
        }
    }

    console.log('=== Missing Counties Added ===');
    console.log('Total California counties now: 42 + 16 = 58 (complete coverage)');
    console.log('Need to re-run california-wso-fixer.js to generate new boundaries.');
}

async function main() {
    try {
        await addMissingCounties();
    } catch (error) {
        console.error('Update error:', error);
    }
}

if (require.main === module) {
    main();
}

module.exports = { addMissingCounties, FINAL_COMPLETE_ASSIGNMENTS };