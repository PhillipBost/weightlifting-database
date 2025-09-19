const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Complete corrected county assignments
const COMPLETE_ASSIGNMENTS = {
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
        "Ventura", "Santa Barbara",

        // Central Valley (southern part)
        "Kern", "Tulare", "Fresno", "Kings",

        // Eastern Sierra
        "Inyo", "Mono",

        // Central Coast (southern part)
        "San Luis Obispo"
    ]
};

async function updateCompleteCountyAssignments() {
    console.log('=== Updating California WSOs with Complete County Lists ===\n');

    for (const [wsoName, counties] of Object.entries(COMPLETE_ASSIGNMENTS)) {
        console.log(`--- Updating ${wsoName} ---`);
        console.log(`Counties: ${counties.length} total`);
        console.log(`List: ${counties.join(', ')}\n`);

        const { error } = await supabase
            .from('wso_information')
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

    console.log('=== County Assignment Update Complete ===');
    console.log('Note: You will need to re-run california-wso-fixer.js to generate');
    console.log('new GeoJSON boundaries with the complete county lists.');
}

async function main() {
    try {
        await updateCompleteCountyAssignments();
    } catch (error) {
        console.error('Update error:', error);
    }
}

if (require.main === module) {
    main();
}

module.exports = { updateCompleteCountyAssignments, COMPLETE_ASSIGNMENTS };