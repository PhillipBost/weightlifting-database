require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// State boundaries
const STATE_BOUNDARIES = {
    'Tennessee': { minLat: 34.983, maxLat: 36.678, minLng: -90.310, maxLng: -81.647 },
    'North Carolina': { minLat: 33.752, maxLat: 36.588, minLng: -84.322, maxLng: -75.461 },
    'South Carolina': { minLat: 32.034, maxLat: 35.216, minLng: -83.354, maxLng: -78.499 }
};

// WSO mappings
const WSO_MAPPINGS = {
    'Carolina': ['North Carolina', 'South Carolina'],
    'Tennessee-Kentucky': ['Tennessee', 'Kentucky']
};

function findStateByCoordinates(lat, lng) {
    for (const [state, bounds] of Object.entries(STATE_BOUNDARIES)) {
        if (lat >= bounds.minLat && lat <= bounds.maxLat &&
            lng >= bounds.minLng && lng <= bounds.maxLng) {
            console.log(`  Coordinates ${lat}, ${lng} fall within ${state}`);
            return state;
        }
    }
    return null;
}

function getCorrectWSO(state) {
    for (const [wso, states] of Object.entries(WSO_MAPPINGS)) {
        if (states.includes(state)) {
            return wso;
        }
    }
    return null;
}

async function debugTennesseeIssue() {
    console.log('🔍 Debugging Tennessee WSO assignment issue...');

    const { data: tennesseeMeets, error } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet, wso_geography, latitude, longitude, city, state')
        .ilike('city', '%Johnson City%')
        .limit(3);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    if (!tennesseeMeets || tennesseeMeets.length === 0) {
        console.log('No Johnson City meets found');
        return;
    }

    console.log(`\nFound ${tennesseeMeets.length} Johnson City meets:`);

    for (const meet of tennesseeMeets) {
        console.log(`\n📍 ${meet.Meet}`);
        console.log(`   Current WSO: ${meet.wso_geography}`);
        console.log(`   Location: ${meet.city}, ${meet.state}`);
        console.log(`   Coordinates: ${meet.latitude}, ${meet.longitude}`);

        const lat = parseFloat(meet.latitude);
        const lng = parseFloat(meet.longitude);

        if (!isNaN(lat) && !isNaN(lng)) {
            const actualState = findStateByCoordinates(lat, lng);
            const correctWSO = getCorrectWSO(actualState);

            console.log(`   Actual state by coordinates: ${actualState}`);
            console.log(`   Correct WSO should be: ${correctWSO}`);
            console.log(`   Status: ${meet.wso_geography === correctWSO ? '✅ CORRECT' : '❌ INCORRECT'}`);
        } else {
            console.log('   ⚠️ Invalid coordinates');
        }
    }
}

if (require.main === module) {
    debugTennesseeIssue();
}