#!/usr/bin/env node

/**
 * WSO GeoJSON Processor
 *
 * Downloads and processes geographic boundary data for WSO territories.
 * Populates the territory_geojson field in the wso_information table.
 *
 * Usage:
 *   node wso-geojson-processor.js --download-states    # Download state boundaries
 *   node wso-geojson-processor.js --process-counties   # Process CA county boundaries
 *   node wso-geojson-processor.js --create-territories # Create multi-state territories
 *   node wso-geojson-processor.js --update-database    # Update WSO database
 *   node wso-geojson-processor.js --all                # Run all steps
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const https = require('https');
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Data sources for geographic boundaries
const DATA_SOURCES = {
    // US states from a reliable source
    states_us: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',

    // Alternative: Natural Earth data (includes more detail but needs filtering)
    states_ne: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lakes.geojson',

    // US only states (reliable source)
    states_simple: 'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/us_states.geojson',

    // County boundaries
    counties: 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json'
};

// Directory structure for storing GeoJSON files
const GEOJSON_DIR = './geojson_data';
const STATE_DIR = path.join(GEOJSON_DIR, 'states');
const COUNTY_DIR = path.join(GEOJSON_DIR, 'counties');
const WSO_DIR = path.join(GEOJSON_DIR, 'wso_territories');

// California county definitions from WSO_DATA
// North Central: All counties NORTH of San Luis Obispo, Kern, and San Bernardino
// South: All counties SOUTH of Monterey, Kings, Tulare, and Inyo
const CA_COUNTIES = {
    north_central: [
        // Bay Area (9 counties)
        "Alameda", "Contra Costa", "Marin", "Napa", "San Francisco",
        "San Mateo", "Santa Clara", "Solano", "Sonoma",
        // Central Coast (3 counties)
        "Monterey", "San Benito", "Santa Cruz",
        // Central Valley North (13 counties)
        "Sacramento", "Yolo", "Sutter", "Yuba", "Placer", "El Dorado",
        "Merced", "Stanislaus", "San Joaquin", "Calaveras", "Tuolumne", "Mariposa", "Madera",
        // Central Valley - Boundary Counties (4 counties - north of SLO/Kern/SB)
        "Fresno", "Kings", "Tulare", "Inyo",
        // Northern Mountains (13 counties)
        "Del Norte", "Siskiyou", "Modoc", "Lassen", "Shasta", "Trinity",
        "Tehama", "Plumas", "Glenn", "Butte", "Colusa", "Sierra", "Nevada",
        // North Coast (3 counties)
        "Humboldt", "Mendocino", "Lake",
        // Sierra Nevada (3 counties)
        "Amador", "Alpine", "Mono"
    ],
    south: [
        // Southern Coast (4 counties)
        "San Luis Obispo", "Santa Barbara", "Ventura", "San Diego",
        // LA Metro (2 counties)
        "Los Angeles", "Orange",
        // Inland Empire & Desert (3 counties)
        "San Bernardino", "Riverside", "Imperial",
        // Southern Central Valley (1 county)
        "Kern"
    ]
};

async function downloadFile(url, filepath) {
    console.log(`📥 Downloading: ${url}`);

    const file = await fs.open(filepath, 'w');

    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }

            response.pipe(file.createWriteStream());
            response.on('end', () => {
                console.log(`✅ Downloaded: ${path.basename(filepath)}`);
                resolve();
            });
        }).on('error', reject);
    });
}

async function ensureDirectories() {
    const dirs = [GEOJSON_DIR, STATE_DIR, COUNTY_DIR, WSO_DIR];
    for (const dir of dirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
}

async function downloadStateBoundaries() {
    console.log('🗺️  Downloading US State Boundaries');
    console.log('===================================');

    await ensureDirectories();

    try {
        // Try the simple US states source first
        const stateFile = path.join(STATE_DIR, 'us_states.geojson');

        try {
            console.log('Trying US-only states source...');
            await downloadFile(DATA_SOURCES.states_us, stateFile);
        } catch (error) {
            console.log('First source failed, trying alternative...');
            await downloadFile(DATA_SOURCES.states_simple, stateFile);
        }

        // Load and validate data
        const data = JSON.parse(await fs.readFile(stateFile, 'utf8'));

        let usStates;
        if (data.features && data.features.length > 0) {
            // Check if this is already US-only data or needs filtering
            const firstFeature = data.features[0];
            if (firstFeature.properties.admin === 'United States of America' ||
                firstFeature.properties.country === 'USA' ||
                firstFeature.properties.NAME || // Common US state property
                firstFeature.properties.name) {

                if (firstFeature.properties.admin === 'United States of America') {
                    // Filter Natural Earth data
                    usStates = {
                        type: "FeatureCollection",
                        features: data.features.filter(feature =>
                            feature.properties.admin === 'United States of America' &&
                            (feature.properties.type_en === 'State' || feature.properties.type_en === 'District')
                        )
                    };
                } else {
                    // Assume this is already US-only data
                    usStates = data;
                }
            } else {
                throw new Error('Unknown state data format');
            }
        } else {
            throw new Error('Invalid GeoJSON format');
        }

        // Save filtered US states
        const usStateFile = path.join(STATE_DIR, 'us_states_filtered.geojson');
        await fs.writeFile(usStateFile, JSON.stringify(usStates, null, 2));
        console.log(`✅ Processed ${usStates.features.length} US states/territories`);

        // Log some state names for verification
        const stateNames = usStates.features.slice(0, 5).map(f =>
            f.properties.name || f.properties.NAME || f.properties.name_en || 'Unknown'
        );
        console.log(`📍 Sample states: ${stateNames.join(', ')}`);

        return usStates;
    } catch (error) {
        console.error('❌ Error downloading state boundaries:', error.message);
        throw error;
    }
}

async function processCountyBoundaries() {
    console.log('🏘️  Processing County Boundaries');
    console.log('================================');

    try {
        const countyFile = path.join(COUNTY_DIR, 'us_counties.geojson');
        await downloadFile(DATA_SOURCES.counties, countyFile);

        const data = JSON.parse(await fs.readFile(countyFile, 'utf8'));

        // This is a simplified example - real implementation would need
        // to match county names to FIPS codes and filter by state
        console.log(`📊 Found ${data.features.length} counties`);
        console.log('⚠️  County processing needs refinement for CA regions');

        return data;
    } catch (error) {
        console.error('❌ Error processing counties:', error.message);
        throw error;
    }
}

async function createWSOTerritories() {
    console.log('🌍 Creating WSO Territories');
    console.log('===========================');

    // Get WSO definitions from database
    const { data: wsos, error } = await supabase
        .from('wso_information')
        .select('name, geographic_type, states, counties');

    if (error) {
        throw new Error(`Failed to fetch WSOs: ${error.message}`);
    }

    // Load state boundaries
    const stateFile = path.join(STATE_DIR, 'us_states_filtered.geojson');
    let stateData;
    try {
        stateData = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    } catch (error) {
        console.log('⚠️  State boundaries not found. Run --download-states first.');
        return;
    }

    const wsoTerritories = {};

    for (const wso of wsos) {
        console.log(`\\n📍 Processing: ${wso.name}`);

        if (wso.geographic_type === 'state' && wso.states?.length === 1) {
            // Single state WSO
            const stateName = wso.states[0];
            const stateFeature = stateData.features.find(f => {
                const props = f.properties;
                return props.name === stateName ||
                       props.name_en === stateName ||
                       props.NAME === stateName ||
                       props.STUSPS === stateName ||  // State abbreviation
                       props.NAME_1 === stateName;
            });

            if (stateFeature) {
                wsoTerritories[wso.name] = {
                    type: "Feature",
                    properties: {
                        wso_name: wso.name,
                        geographic_type: wso.geographic_type,
                        states: wso.states
                    },
                    geometry: stateFeature.geometry
                };
                console.log(`   ✅ Single state: ${stateName}`);
            } else {
                console.log(`   ❌ State not found: ${stateName}`);
                // Debug: show available state names
                const availableNames = stateData.features.slice(0, 3).map(f => {
                    const props = f.properties;
                    return props.name || props.NAME || props.name_en || props.NAME_1 || 'Unknown';
                });
                console.log(`   🔍 Sample available states: ${availableNames.join(', ')}`);
            }

        } else if (wso.geographic_type === 'multi_state' || wso.geographic_type === 'multi_jurisdictional') {
            // Multi-state WSO - combine multiple state geometries
            const stateFeatures = [];

            for (const stateName of wso.states || []) {
                const stateFeature = stateData.features.find(f => {
                    const props = f.properties;
                    return props.name === stateName ||
                           props.name_en === stateName ||
                           props.NAME === stateName ||
                           props.STUSPS === stateName ||
                           props.NAME_1 === stateName ||
                           (stateName === 'District of Columbia' && (
                               props.name === 'Washington D.C.' ||
                               props.NAME === 'Washington D.C.' ||
                               props.name === 'District of Columbia' ||
                               props.NAME === 'District of Columbia'
                           ));
                });

                if (stateFeature) {
                    stateFeatures.push(stateFeature);
                    console.log(`   ✅ Added: ${stateName}`);
                } else {
                    console.log(`   ❌ Not found: ${stateName}`);
                }
            }

            if (stateFeatures.length > 0) {
                // Create MultiPolygon from multiple states
                const coordinates = stateFeatures.map(f => {
                    if (f.geometry.type === 'Polygon') {
                        return [f.geometry.coordinates];
                    } else if (f.geometry.type === 'MultiPolygon') {
                        return f.geometry.coordinates;
                    }
                }).flat();

                wsoTerritories[wso.name] = {
                    type: "Feature",
                    properties: {
                        wso_name: wso.name,
                        geographic_type: wso.geographic_type,
                        states: wso.states
                    },
                    geometry: {
                        type: "MultiPolygon",
                        coordinates: coordinates
                    }
                };
                console.log(`   ✅ Multi-state territory created (${stateFeatures.length} states)`);
            }

        } else if (wso.geographic_type === 'regional') {
            // Regional WSOs (like California subdivisions)
            if (wso.name === 'California North Central' || wso.name === 'California South') {
                // For California regions, create a simplified boundary based on the state
                const californiaFeature = stateData.features.find(f => {
                    const props = f.properties;
                    return props.name === 'California' ||
                           props.name_en === 'California' ||
                           props.NAME === 'California' ||
                           props.NAME_1 === 'California';
                });

                if (californiaFeature) {
                    // Use California state boundary as placeholder
                    // In production, this would be replaced with actual county boundary processing
                    wsoTerritories[wso.name] = {
                        type: "Feature",
                        properties: {
                            wso_name: wso.name,
                            geographic_type: wso.geographic_type,
                            states: wso.states,
                            counties: wso.counties,
                            note: "Placeholder using state boundary - needs county-level refinement"
                        },
                        geometry: californiaFeature.geometry
                    };
                    console.log(`   ✅ Regional boundary created (using CA state boundary as placeholder)`);
                } else {
                    console.log(`   ❌ California state not found for regional WSO`);
                }
            } else {
                console.log(`   ⚠️  Unknown regional WSO: ${wso.name}`);
            }

        } else if (wso.geographic_type === 'special') {
            // Special WSOs like Hawaii and International
            if (wso.name === 'Hawaii and International' && wso.states?.includes('Hawaii')) {
                const hawaiiFeature = stateData.features.find(f => {
                    const props = f.properties;
                    return props.name === 'Hawaii' ||
                           props.name_en === 'Hawaii' ||
                           props.NAME === 'Hawaii' ||
                           props.NAME_1 === 'Hawaii';
                });

                if (hawaiiFeature) {
                    wsoTerritories[wso.name] = {
                        type: "Feature",
                        properties: {
                            wso_name: wso.name,
                            geographic_type: wso.geographic_type,
                            states: wso.states,
                            note: "Hawaii state boundary - international coverage not mapped"
                        },
                        geometry: hawaiiFeature.geometry
                    };
                    console.log(`   ✅ Special territory: Hawaii boundary created`);
                } else {
                    console.log(`   ❌ Hawaii state not found`);
                }
            } else {
                console.log(`   ⚠️  Unknown special WSO: ${wso.name}`);
            }

        } else {
            console.log(`   ⚠️  Unknown geographic type: ${wso.geographic_type}`);
        }
    }

    // Save individual WSO territories
    for (const [wsoName, territory] of Object.entries(wsoTerritories)) {
        const filename = wsoName.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.geojson';
        const filepath = path.join(WSO_DIR, filename);
        await fs.writeFile(filepath, JSON.stringify(territory, null, 2));
    }

    // Save complete WSO collection
    const wsoCollection = {
        type: "FeatureCollection",
        features: Object.values(wsoTerritories)
    };

    const collectionFile = path.join(WSO_DIR, 'all_wso_territories.geojson');
    await fs.writeFile(collectionFile, JSON.stringify(wsoCollection, null, 2));

    console.log(`\\n📊 Summary:`);
    console.log(`   Created territories: ${Object.keys(wsoTerritories).length}`);
    console.log(`   Saved to: ${WSO_DIR}`);

    return wsoTerritories;
}

async function updateDatabase() {
    console.log('💾 Updating Database with GeoJSON');
    console.log('==================================');

    const wsoDir = WSO_DIR;
    let files;

    try {
        files = await fs.readdir(wsoDir);
    } catch (error) {
        console.log('⚠️  WSO territories not found. Run --create-territories first.');
        return;
    }

    const geoJsonFiles = files.filter(f => f.endsWith('.geojson') && f !== 'all_wso_territories.geojson');

    for (const file of geoJsonFiles) {
        const filepath = path.join(wsoDir, file);
        const geoJsonData = JSON.parse(await fs.readFile(filepath, 'utf8'));
        const wsoName = geoJsonData.properties.wso_name;

        console.log(`\\n📍 Updating: ${wsoName}`);

        const { error } = await supabase
            .from('wso_information')
            .update({ territory_geojson: geoJsonData })
            .eq('name', wsoName);

        if (error) {
            console.log(`   ❌ Error: ${error.message}`);
        } else {
            console.log(`   ✅ Updated successfully`);
        }
    }

    console.log(`\\n📊 Database update complete!`);
}

async function main() {
    const args = process.argv.slice(2);

    try {
        if (args.includes('--download-states') || args.includes('--all')) {
            await downloadStateBoundaries();
        }

        if (args.includes('--process-counties') || args.includes('--all')) {
            await processCountyBoundaries();
        }

        if (args.includes('--create-territories') || args.includes('--all')) {
            await createWSOTerritories();
        }

        if (args.includes('--update-database') || args.includes('--all')) {
            await updateDatabase();
        }

        if (!args.length || args.includes('--help')) {
            console.log('WSO GeoJSON Processor');
            console.log('====================');
            console.log('');
            console.log('Options:');
            console.log('  --download-states    Download US state boundaries');
            console.log('  --process-counties   Process county boundaries');
            console.log('  --create-territories Create WSO territorial boundaries');
            console.log('  --update-database    Update database with GeoJSON');
            console.log('  --all               Run all steps');
            console.log('');
            console.log('Example: node wso-geojson-processor.js --all');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    downloadStateBoundaries,
    processCountyBoundaries,
    createWSOTerritories,
    updateDatabase
};