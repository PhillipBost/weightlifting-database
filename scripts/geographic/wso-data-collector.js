#!/usr/bin/env node

/**
 * WSO Data Collection and Population Script
 *
 * This script:
 * 1. Extracts unique WSO values from the existing database
 * 2. Provides a framework for researching WSO information
 * 3. Populates the wso_information table with collected data
 *
 * Usage:
 *   node wso-data-collector.js --analyze     # Show current WSO values
 *   node wso-data-collector.js --populate    # Populate table with known data
 *   node wso-data-collector.js --research    # Show research template
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Known WSO information (based on database analysis - needs research for URLs and exact boundaries)
const WSO_DATA = {
    // TOP PRIORITY - Most active WSOs
    "Texas-Oklahoma": {
        geographic_type: "multi_state",
        states: ["Texas", "Oklahoma"],
        counties: [],
        geographic_center_lat: 33.0, // Midpoint between TX and OK
        geographic_center_lng: -97.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/texas-oklahoma",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 33000000, // TX ~30M + OK ~4M
        notes: "Multi-state WSO covering Texas and Oklahoma - highest participation"
    },
    "Florida": {
        geographic_type: "state",
        states: ["Florida"],
        counties: [],
        geographic_center_lat: 27.7663,
        geographic_center_lng: -81.6868,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/florida",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 22600000,
        notes: "Single state WSO - high participation"
    },
    "New York": {
        geographic_type: "state",
        states: ["New York"],
        counties: [],
        geographic_center_lat: 42.1497,
        geographic_center_lng: -74.9384,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/new-york",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 19300000,
        notes: "Single state WSO - high participation"
    },
    "New England": {
        geographic_type: "multi_state",
        states: ["Maine", "New Hampshire", "Vermont", "Massachusetts", "Rhode Island", "Connecticut"],
        counties: [],
        geographic_center_lat: 43.5, // Regional center
        geographic_center_lng: -71.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/new-england",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 15000000, // Combined New England states
        notes: "Multi-state WSO covering New England region"
    },
    "DMV": {
        geographic_type: "multi_jurisdictional",
        states: ["Delaware", "Maryland", "Virginia", "District of Columbia"],
        counties: [],
        geographic_center_lat: 38.5, // Regional center
        geographic_center_lng: -77.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/dmv",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 15700000, // DE + MD + VA + DC combined
        notes: "Multi-jurisdictional WSO covering Delaware, Maryland, Virginia, and District of Columbia (DMV region)"
    },
    "Carolina": {
        geographic_type: "multi_state",
        states: ["North Carolina", "South Carolina"],
        counties: [],
        geographic_center_lat: 34.7, // Midpoint between NC and SC
        geographic_center_lng: -80.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/carolina",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 15700000, // NC ~10.7M + SC ~5.2M
        notes: "Multi-state WSO covering the Carolinas"
    },
    "California South": {
        geographic_type: "regional",
        states: ["California"],
        counties: ["San Luis Obispo", "Santa Barbara", "Ventura", "San Diego", "Los Angeles", "Orange", "San Bernardino", "Riverside", "Imperial", "Kern"], // All counties south of Monterey, Kings, Tulare and Inyo Counties
        geographic_center_lat: 34.0, // Southern CA center
        geographic_center_lng: -118.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/california-south",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 20000000, // Southern CA population estimate
        notes: "Regional WSO covering Southern California - All counties south of Monterey, Kings, Tulare and Inyo Counties"
    },
    "Pacific Northwest": {
        geographic_type: "multi_state",
        states: ["Washington", "Oregon", "Alaska"],
        counties: [],
        geographic_center_lat: 47.0, // Regional center
        geographic_center_lng: -120.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/pacific-northwest",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 12000000, // WA + OR + AK
        notes: "Multi-state WSO covering Pacific Northwest"
    },
    "Missouri Valley": {
        geographic_type: "multi_state",
        states: ["Missouri", "Kansas"],
        counties: [],
        geographic_center_lat: 38.5, // Midpoint between MO and KS
        geographic_center_lng: -94.5,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/missouri-valley",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 9100000, // MO ~6.2M + KS ~2.9M
        notes: "Multi-state WSO covering Missouri Valley region"
    },
    "Mountain South": {
        geographic_type: "multi_state",
        states: ["Utah", "Arizona", "New Mexico", "Nevada"],
        counties: [],
        geographic_center_lat: 36.5, // Regional center of UT, AZ, NM, NV
        geographic_center_lng: -111.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/mountain-south",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 13700000, // UT ~3.4M + AZ ~7.4M + NM ~2.1M + NV ~3.2M
        notes: "Multi-state WSO covering Mountain South region"
    },
    "Georgia": {
        geographic_type: "state",
        states: ["Georgia"],
        counties: [],
        geographic_center_lat: 32.9866,
        geographic_center_lng: -83.6487,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/georgia",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 10900000,
        notes: "Single state WSO"
    },
    "California North Central": {
        geographic_type: "regional",
        states: ["California"],
        counties: ["Alameda", "Contra Costa", "Marin", "Napa", "San Francisco", "San Mateo", "Santa Clara", "Solano", "Sonoma", "Monterey", "San Benito", "Santa Cruz", "Sacramento", "Yolo", "Sutter", "Yuba", "Placer", "El Dorado", "Merced", "Stanislaus", "San Joaquin", "Calaveras", "Tuolumne", "Mariposa", "Madera", "Fresno", "Kings", "Tulare", "Inyo", "Del Norte", "Siskiyou", "Modoc", "Lassen", "Shasta", "Trinity", "Tehama", "Plumas", "Glenn", "Butte", "Colusa", "Sierra", "Nevada", "Humboldt", "Mendocino", "Lake", "Amador", "Alpine", "Mono"], // All counties north of San Luis Obispo County, Kern County, and San Bernardino County
        geographic_center_lat: 37.5, // North Central CA center
        geographic_center_lng: -121.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/california-north-central",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 10000000, // North Central CA population estimate
        notes: "Regional WSO covering North Central California - All counties north of San Luis Obispo County, Kern County, and San Bernardino County"
    },
    "Pennsylvania-West Virginia": {
        geographic_type: "multi_state",
        states: ["Pennsylvania", "West Virginia"],
        counties: [],
        geographic_center_lat: 39.5, // Midpoint
        geographic_center_lng: -78.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/pennsylvania-west-virginia",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 14600000, // PA ~13M + WV ~1.8M
        notes: "Multi-state WSO covering Pennsylvania and West Virginia"
    },
    "Mountain North": {
        geographic_type: "multi_state",
        states: ["Montana", "Idaho", "Colorado", "Wyoming"],
        counties: [],
        geographic_center_lat: 44.0, // Regional center of MT, ID, CO, WY
        geographic_center_lng: -107.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/mountain-north",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 8900000, // MT ~1.1M + ID ~1.9M + CO ~5.8M + WY ~0.6M
        notes: "Multi-state WSO covering Mountain North region"
    },
    "Ohio": {
        geographic_type: "state",
        states: ["Ohio"],
        counties: [],
        geographic_center_lat: 40.3467,
        geographic_center_lng: -82.7344,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/ohio",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 11800000,
        notes: "Single state WSO"
    },
    "Indiana": {
        geographic_type: "state",
        states: ["Indiana"],
        counties: [],
        geographic_center_lat: 39.8647,
        geographic_center_lng: -86.2604,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/indiana",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 6800000,
        notes: "Single state WSO"
    },
    "Illinois": {
        geographic_type: "state",
        states: ["Illinois"],
        counties: [],
        geographic_center_lat: 40.3363,
        geographic_center_lng: -89.0022,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/illinois",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 12600000,
        notes: "Single state WSO"
    },
    "Michigan": {
        geographic_type: "state",
        states: ["Michigan"],
        counties: [],
        geographic_center_lat: 43.3266,
        geographic_center_lng: -84.5361,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/michigan",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 10000000,
        notes: "Single state WSO"
    },
    "Tennessee-Kentucky": {
        geographic_type: "multi_state",
        states: ["Tennessee", "Kentucky"],
        counties: [],
        geographic_center_lat: 36.7, // Midpoint between TN and KY
        geographic_center_lng: -85.2,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/tennessee-kentucky",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 11400000, // TN ~7M + KY ~4.5M
        notes: "Multi-state WSO covering Tennessee and Kentucky"
    },
    "Iowa-Nebraska": {
        geographic_type: "multi_state",
        states: ["Iowa", "Nebraska"],
        counties: [],
        geographic_center_lat: 42.0, // Midpoint
        geographic_center_lng: -96.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/iowa-nebraska",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 5200000, // IA ~3.2M + NE ~2M
        notes: "Multi-state WSO covering Iowa and Nebraska"
    },
    "New Jersey": {
        geographic_type: "state",
        states: ["New Jersey"],
        counties: [],
        geographic_center_lat: 40.2206,
        geographic_center_lng: -74.7567,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/new-jersey",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 9300000,
        notes: "Single state WSO"
    },
    "Wisconsin": {
        geographic_type: "state",
        states: ["Wisconsin"],
        counties: [],
        geographic_center_lat: 44.2563,
        geographic_center_lng: -89.6385,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/wisconsin",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 5900000,
        notes: "Single state WSO"
    },
    "Minnesota-Dakotas": {
        geographic_type: "multi_state",
        states: ["Minnesota", "North Dakota", "South Dakota"],
        counties: [],
        geographic_center_lat: 46.0, // Regional center
        geographic_center_lng: -96.0,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/minnesota-dakotas",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 7200000, // MN ~5.7M + ND ~0.8M + SD ~0.9M
        notes: "Multi-state WSO covering Minnesota and the Dakotas"
    },
    "Southern": {
        geographic_type: "multi_state",
        states: ["Louisiana", "Mississippi", "Arkansas"],
        counties: [],
        geographic_center_lat: 32.5, // Regional center of LA, MS, AR
        geographic_center_lng: -91.5,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/southern",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 8900000, // LA ~4.6M + MS ~2.9M + AR ~3.0M
        notes: "Multi-state WSO covering Southern region"
    },
    "Hawaii and International": {
        geographic_type: "special",
        states: ["Hawaii"],
        counties: [],
        geographic_center_lat: 21.0943,
        geographic_center_lng: -157.4983,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/hawaii-and-international",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 1400000, // Hawaii population
        notes: "Special WSO covering Hawaii and international athletes"
    },
    "Alabama": {
        geographic_type: "state",
        states: ["Alabama"],
        counties: [],
        geographic_center_lat: 32.7794,
        geographic_center_lng: -86.8287,
        official_url: "https://www.usaweightlifting.org/club-wso/wso-information/alabama",
        contact_email: null, // TO BE RESEARCHED
        population_estimate: 5000000,
        notes: "Single state WSO - low participation"
    }
};

async function analyzeCurrentWSOs() {
    console.log('🔍 Analyzing current WSO values in database...');

    const { data, error } = await supabase
        .from('meet_results')
        .select('wso')
        .not('wso', 'is', null);

    if (error) {
        console.error('Error fetching WSO data:', error);
        return;
    }

    const wsoCount = {};
    data.forEach(result => {
        const wso = result.wso.trim();
        wsoCount[wso] = (wsoCount[wso] || 0) + 1;
    });

    const sortedWSOs = Object.entries(wsoCount)
        .sort(([,a], [,b]) => b - a);

    console.log('\\n📊 WSO Usage Statistics:');
    console.log('========================');
    sortedWSOs.forEach(([wso, count]) => {
        const known = WSO_DATA[wso] ? '✅' : '❓';
        console.log(`${known} ${wso}: ${count.toLocaleString()} records`);
    });

    console.log('\\n📝 Summary:');
    console.log(`Total unique WSOs: ${sortedWSOs.length}`);
    console.log(`Known WSOs: ${Object.keys(WSO_DATA).length}`);
    console.log(`Need research: ${sortedWSOs.length - Object.keys(WSO_DATA).length}`);

    return sortedWSOs.map(([wso]) => wso);
}

async function populateWSOs() {
    console.log('🚀 Populating wso_information table...');

    for (const [wsoName, data] of Object.entries(WSO_DATA)) {
        try {
            const { error } = await supabase
                .from('wso_information')
                .upsert({
                    name: wsoName,
                    geographic_type: data.geographic_type,
                    states: data.states,
                    counties: data.counties,
                    geographic_center_lat: data.geographic_center_lat,
                    geographic_center_lng: data.geographic_center_lng,
                    official_url: data.official_url,
                    contact_email: data.contact_email,
                    population_estimate: data.population_estimate,
                    notes: data.notes,
                    active_status: true
                }, { onConflict: 'name' });

            if (error) {
                console.error(`❌ Error upserting ${wsoName}:`, error.message);
            } else {
                console.log(`✅ ${wsoName}: Successfully added/updated`);
            }
        } catch (err) {
            console.error(`❌ Error processing ${wsoName}:`, err.message);
        }
    }
}

function showResearchTemplate() {
    console.log('🔬 WSO Research Template');
    console.log('========================\\n');

    console.log('For each unknown WSO, research and add to WSO_DATA object:');
    console.log('');
    console.log('"WSO_NAME": {');
    console.log('    geographic_type: "state|multi_state|county_subdivision",');
    console.log('    states: ["State1", "State2"],');
    console.log('    counties: ["County1", "County2"], // If applicable');
    console.log('    geographic_center_lat: 40.0000,');
    console.log('    geographic_center_lng: -80.0000,');
    console.log('    official_url: "https://example.com",');
    console.log('    contact_email: "contact@example.com",');
    console.log('    population_estimate: 5000000,');
    console.log('    notes: "Description of territory"');
    console.log('},\\n');

    console.log('Research sources:');
    console.log('• USA Weightlifting official website');
    console.log('• State weightlifting federation websites');
    console.log('• Competition results for geographic patterns');
    console.log('• Census data for population estimates');
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--analyze')) {
        await analyzeCurrentWSOs();
    } else if (args.includes('--populate')) {
        await populateWSOs();
    } else if (args.includes('--research')) {
        showResearchTemplate();
    } else {
        console.log('WSO Data Collection Script');
        console.log('=========================');
        console.log('');
        console.log('Options:');
        console.log('  --analyze    Show current WSO values and usage');
        console.log('  --populate   Populate wso_information table');
        console.log('  --research   Show research template');
        console.log('');
        console.log('Example: node wso-data-collector.js --analyze');
    }
}

if (require.main === module) {
    main().catch(console.error);
}