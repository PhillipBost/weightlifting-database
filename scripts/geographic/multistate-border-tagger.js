const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Define which states share borders with each other
const STATE_BORDERS = {
    'Minnesota': ['North Dakota', 'South Dakota', 'Iowa', 'Wisconsin'],
    'North Dakota': ['Minnesota', 'South Dakota', 'Montana'],
    'South Dakota': ['Minnesota', 'North Dakota', 'Iowa', 'Nebraska', 'Wyoming', 'Montana'],
    'Montana': ['North Dakota', 'South Dakota', 'Wyoming', 'Idaho'],
    'Idaho': ['Montana', 'Wyoming', 'Utah', 'Nevada', 'Oregon', 'Washington'],
    'Colorado': ['Wyoming', 'Nebraska', 'Kansas', 'Oklahoma', 'New Mexico', 'Utah'],
    'Wyoming': ['Montana', 'South Dakota', 'Nebraska', 'Colorado', 'Utah', 'Idaho'],
    'Washington': ['Oregon', 'Idaho'],
    'Oregon': ['Washington', 'Idaho', 'Nevada', 'California'],
    'Louisiana': ['Mississippi', 'Arkansas', 'Texas'],
    'Mississippi': ['Louisiana', 'Arkansas', 'Tennessee', 'Alabama'],
    'Arkansas': ['Louisiana', 'Mississippi', 'Tennessee', 'Missouri', 'Oklahoma', 'Texas'],
    'Tennessee': ['Kentucky', 'Virginia', 'North Carolina', 'Georgia', 'Alabama', 'Mississippi', 'Arkansas', 'Missouri'],
    'Kentucky': ['Tennessee', 'Virginia', 'West Virginia', 'Ohio', 'Indiana', 'Illinois', 'Missouri'],
    'Texas': ['Oklahoma', 'Arkansas', 'Louisiana', 'New Mexico'],
    'Oklahoma': ['Texas', 'Arkansas', 'Missouri', 'Kansas', 'Colorado', 'New Mexico'],
    'Delaware': ['Maryland', 'Pennsylvania'],
    'Maryland': ['Delaware', 'Pennsylvania', 'West Virginia', 'Virginia'],
    'Virginia': ['Maryland', 'West Virginia', 'Kentucky', 'Tennessee', 'North Carolina'],
    'District of Columbia': ['Maryland', 'Virginia'],
    'North Carolina': ['Virginia', 'Tennessee', 'Georgia', 'South Carolina'],
    'South Carolina': ['North Carolina', 'Georgia'],
    'Maine': ['New Hampshire'],
    'New Hampshire': ['Maine', 'Vermont', 'Massachusetts'],
    'Vermont': ['New Hampshire', 'Massachusetts', 'New York'],
    'Massachusetts': ['New Hampshire', 'Vermont', 'Rhode Island', 'Connecticut', 'New York'],
    'Rhode Island': ['Massachusetts', 'Connecticut'],
    'Connecticut': ['Massachusetts', 'Rhode Island', 'New York'],
    'Iowa': ['Minnesota', 'South Dakota', 'Nebraska', 'Missouri', 'Illinois', 'Wisconsin'],
    'Nebraska': ['South Dakota', 'Iowa', 'Missouri', 'Kansas', 'Colorado', 'Wyoming'],
    'Missouri': ['Iowa', 'Nebraska', 'Kansas', 'Oklahoma', 'Arkansas', 'Tennessee', 'Kentucky', 'Illinois'],
    'Kansas': ['Nebraska', 'Missouri', 'Oklahoma', 'Colorado'],
    'Utah': ['Idaho', 'Wyoming', 'Colorado', 'New Mexico', 'Arizona', 'Nevada'],
    'Arizona': ['Utah', 'New Mexico', 'Nevada', 'California'],
    'New Mexico': ['Colorado', 'Oklahoma', 'Texas', 'Arizona', 'Utah'],
    'Nevada': ['Idaho', 'Utah', 'Arizona', 'California', 'Oregon'],
    'Pennsylvania': ['Delaware', 'Maryland', 'West Virginia', 'Ohio', 'New York'],
    'West Virginia': ['Maryland', 'Virginia', 'Kentucky', 'Ohio', 'Pennsylvania']
};

function findSharedBorders(wsoStates) {
    const sharedBorders = [];

    for (let i = 0; i < wsoStates.length; i++) {
        for (let j = i + 1; j < wsoStates.length; j++) {
            const state1 = wsoStates[i];
            const state2 = wsoStates[j];

            // Check if these states share a border
            if (STATE_BORDERS[state1] && STATE_BORDERS[state1].includes(state2)) {
                sharedBorders.push({
                    states: [state1, state2],
                    border_type: 'interstate'
                });
            }
        }
    }

    return sharedBorders;
}

async function tagMultiStateBorders() {
    console.log('=== Multi-State Border Tagging ===\n');

    // Get all multi-state WSOs
    const { data: allWSOs, error } = await supabase
        .from('usaw_wso_information')
        .select('*');

    if (error) {
        console.error('Error fetching WSOs:', error);
        return;
    }

    const multiStateWSOs = allWSOs.filter(wso => wso.states && wso.states.length > 1);

    console.log(`Found ${multiStateWSOs.length} multi-state WSOs to process:`);

    for (const wso of multiStateWSOs) {
        console.log(`\n--- Processing ${wso.name} ---`);
        console.log(`States: ${wso.states.join(', ')}`);

        // Find shared borders within this WSO
        const sharedBorders = findSharedBorders(wso.states);

        if (sharedBorders.length > 0) {
            console.log(`Found ${sharedBorders.length} shared borders:`);
            sharedBorders.forEach(border => {
                console.log(`  - ${border.states[0]} ↔ ${border.states[1]}`);
            });

            // Add border metadata to the territory_geojson
            const updatedGeojson = { ...wso.territory_geojson };

            if (!updatedGeojson.properties) {
                updatedGeojson.properties = {};
            }

            updatedGeojson.properties.shared_borders = sharedBorders;
            updatedGeojson.properties.has_internal_borders = true;
            updatedGeojson.properties.internal_border_count = sharedBorders.length;

            // Update the WSO
            const { error: updateError } = await supabase
                .from('usaw_wso_information')
                .update({
                    territory_geojson: updatedGeojson,
                    updated_at: new Date().toISOString()
                })
                .eq('wso_id', wso.wso_id);

            if (updateError) {
                console.error(`Error updating ${wso.name}:`, updateError);
            } else {
                console.log(`✓ Tagged ${sharedBorders.length} shared borders for ${wso.name}`);
            }
        } else {
            console.log('No shared borders found (states don\'t border each other)');
        }
    }

    console.log('\n=== Border Tagging Summary ===');

    // Get updated data to show results
    const { data: updatedWSOs } = await supabase
        .from('usaw_wso_information')
        .select('name, territory_geojson')
        .not('territory_geojson->properties->shared_borders', 'is', null);

    if (updatedWSOs && updatedWSOs.length > 0) {
        console.log(`\n${updatedWSOs.length} WSOs now have shared border metadata:`);
        updatedWSOs.forEach(wso => {
            const borderCount = wso.territory_geojson?.properties?.internal_border_count || 0;
            console.log(`- ${wso.name}: ${borderCount} shared borders`);
        });
    }

    console.log('\n=== Multi-State Border Tagging Complete ===');
}

// Function to verify the tagging worked
async function verifyBorderTags() {
    console.log('\n=== Verifying Border Tags ===');

    const { data: taggedWSOs, error } = await supabase
        .from('usaw_wso_information')
        .select('name, states, territory_geojson')
        .not('territory_geojson->properties->shared_borders', 'is', null);

    if (error) {
        console.error('Error fetching tagged WSOs:', error);
        return;
    }

    console.log(`Found ${taggedWSOs?.length || 0} WSOs with border tags:`);

    taggedWSOs?.forEach(wso => {
        const sharedBorders = wso.territory_geojson?.properties?.shared_borders || [];
        console.log(`\n${wso.name} (${wso.states.join(', ')}):`);
        sharedBorders.forEach(border => {
            console.log(`  ↳ ${border.states[0]} ↔ ${border.states[1]}`);
        });
    });
}

async function main() {
    try {
        await tagMultiStateBorders();
        await verifyBorderTags();
    } catch (error) {
        console.error('Main error:', error);
    }
}

if (require.main === module) {
    main();
}

module.exports = { tagMultiStateBorders, verifyBorderTags, findSharedBorders, STATE_BORDERS };