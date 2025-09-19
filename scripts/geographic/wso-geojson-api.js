#!/usr/bin/env node

/**
 * WSO GeoJSON API
 *
 * Provides API endpoints for exporting WSO territorial data as GeoJSON.
 * Backend service for frontend mapping applications.
 *
 * Usage:
 *   node wso-geojson-api.js --export-all           # Export all WSO territories
 *   node wso-geojson-api.js --export-wso "Texas"   # Export specific WSO
 *   node wso-geojson-api.js --export-meets         # Export meets with WSO data
 *   node wso-geojson-api.js --start-server         # Start HTTP API server
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const http = require('http');
const url = require('url');
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const OUTPUT_DIR = './geojson_exports';

async function ensureOutputDir() {
    try {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

/**
 * Export all WSO territories as a single GeoJSON FeatureCollection
 */
async function exportAllWSOs() {
    console.log('📦 Exporting All WSO Territories');
    console.log('================================');

    const { data: wsos, error } = await supabase
        .from('wso_information')
        .select('*')
        .not('territory_geojson', 'is', null);

    if (error) {
        throw new Error(`Failed to fetch WSOs: ${error.message}`);
    }

    const features = wsos.map(wso => ({
        type: "Feature",
        properties: {
            wso_name: wso.name,
            official_url: wso.official_url,
            geographic_type: wso.geographic_type,
            states: wso.states,
            counties: wso.counties,
            population_estimate: wso.population_estimate,
            geographic_center: wso.geographic_center_lat && wso.geographic_center_lng ?
                [wso.geographic_center_lng, wso.geographic_center_lat] : null,
            notes: wso.notes,
            active_status: wso.active_status
        },
        geometry: wso.territory_geojson.geometry || wso.territory_geojson
    }));

    const featureCollection = {
        type: "FeatureCollection",
        metadata: {
            title: "USA Weightlifting State Organizations Territories",
            description: "Geographic boundaries for all WSO territories",
            count: features.length,
            generated_at: new Date().toISOString(),
            coordinate_system: "WGS84 (EPSG:4326)"
        },
        features: features
    };

    await ensureOutputDir();
    const outputFile = path.join(OUTPUT_DIR, 'all_wso_territories.geojson');
    await fs.writeFile(outputFile, JSON.stringify(featureCollection, null, 2));

    console.log(`✅ Exported ${features.length} WSO territories`);
    console.log(`📁 Saved to: ${outputFile}`);

    return featureCollection;
}

/**
 * Export specific WSO territory
 */
async function exportSpecificWSO(wsoName) {
    console.log(`📦 Exporting WSO: ${wsoName}`);
    console.log('='.repeat(20 + wsoName.length));

    const { data: wso, error } = await supabase
        .from('wso_information')
        .select('*')
        .eq('name', wsoName)
        .not('territory_geojson', 'is', null)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            throw new Error(`WSO not found or has no GeoJSON data: ${wsoName}`);
        }
        throw new Error(`Failed to fetch WSO: ${error.message}`);
    }

    const feature = {
        type: "Feature",
        properties: {
            wso_name: wso.name,
            official_url: wso.official_url,
            geographic_type: wso.geographic_type,
            states: wso.states,
            counties: wso.counties,
            population_estimate: wso.population_estimate,
            geographic_center: wso.geographic_center_lat && wso.geographic_center_lng ?
                [wso.geographic_center_lng, wso.geographic_center_lat] : null,
            notes: wso.notes,
            active_status: wso.active_status
        },
        geometry: wso.territory_geojson.geometry || wso.territory_geojson
    };

    await ensureOutputDir();
    const filename = wsoName.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.geojson';
    const outputFile = path.join(OUTPUT_DIR, filename);
    await fs.writeFile(outputFile, JSON.stringify(feature, null, 2));

    console.log(`✅ Exported WSO territory`);
    console.log(`📁 Saved to: ${outputFile}`);

    return feature;
}

/**
 * Export meets with WSO territorial associations
 */
async function exportMeetsWithWSOs() {
    console.log('🏟️  Exporting Meets with WSO Data');
    console.log('=================================');

    // Get meets with coordinates
    const { data: meets, error: meetsError } = await supabase
        .from('meets')
        .select('meet_id, meet_name, date, city, state, latitude, longitude')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .order('date', { ascending: false })
        .limit(1000); // Limit for performance

    if (meetsError) {
        throw new Error(`Failed to fetch meets: ${meetsError.message}`);
    }

    // Get WSO participation data for these meets
    const meetIds = meets.map(m => m.meet_id);
    const { data: participation, error: participationError } = await supabase
        .from('meet_results')
        .select('meet_id, wso')
        .in('meet_id', meetIds)
        .not('wso', 'is', null);

    if (participationError) {
        throw new Error(`Failed to fetch participation: ${participationError.message}`);
    }

    // Aggregate WSO participation by meet
    const meetWSOs = {};
    participation.forEach(p => {
        if (!meetWSOs[p.meet_id]) {
            meetWSOs[p.meet_id] = new Set();
        }
        meetWSOs[p.meet_id].add(p.wso);
    });

    // Create GeoJSON features for meets
    const features = meets.map(meet => ({
        type: "Feature",
        properties: {
            meet_id: meet.meet_id,
            meet_name: meet.meet_name,
            date: meet.date,
            city: meet.city,
            state: meet.state,
            participating_wsos: meetWSOs[meet.meet_id] ? Array.from(meetWSOs[meet.meet_id]) : [],
            wso_count: meetWSOs[meet.meet_id] ? meetWSOs[meet.meet_id].size : 0
        },
        geometry: {
            type: "Point",
            coordinates: [parseFloat(meet.longitude), parseFloat(meet.latitude)]
        }
    }));

    const featureCollection = {
        type: "FeatureCollection",
        metadata: {
            title: "Weightlifting Meets with WSO Participation",
            description: "Competition locations with participating WSO data",
            count: features.length,
            generated_at: new Date().toISOString(),
            coordinate_system: "WGS84 (EPSG:4326)"
        },
        features: features
    };

    await ensureOutputDir();
    const outputFile = path.join(OUTPUT_DIR, 'meets_with_wso_data.geojson');
    await fs.writeFile(outputFile, JSON.stringify(featureCollection, null, 2));

    console.log(`✅ Exported ${features.length} meets`);
    console.log(`📁 Saved to: ${outputFile}`);

    return featureCollection;
}

/**
 * HTTP API Server for real-time GeoJSON access
 */
function startAPIServer(port = 3001) {
    console.log('🚀 Starting WSO GeoJSON API Server');
    console.log('==================================');

    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
        const query = parsedUrl.query;

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        try {
            if (pathname === '/api/wso/territories') {
                // Get all WSO territories
                const data = await exportAllWSOs();
                res.writeHead(200);
                res.end(JSON.stringify(data));

            } else if (pathname === '/api/wso/territory' && query.name) {
                // Get specific WSO territory
                const data = await exportSpecificWSO(query.name);
                res.writeHead(200);
                res.end(JSON.stringify(data));

            } else if (pathname === '/api/meets') {
                // Get meets with WSO data
                const data = await exportMeetsWithWSOs();
                res.writeHead(200);
                res.end(JSON.stringify(data));

            } else if (pathname === '/api/wso/list') {
                // Get list of available WSOs
                const { data: wsos, error } = await supabase
                    .from('wso_information')
                    .select('name, geographic_type, states, population_estimate')
                    .eq('active_status', true)
                    .order('name');

                if (error) throw error;

                res.writeHead(200);
                res.end(JSON.stringify({
                    count: wsos.length,
                    wsos: wsos
                }));

            } else {
                // API documentation
                res.writeHead(200);
                res.end(JSON.stringify({
                    title: "WSO GeoJSON API",
                    description: "Backend API for weightlifting geographic data",
                    endpoints: {
                        "/api/wso/territories": "Get all WSO territories as GeoJSON FeatureCollection",
                        "/api/wso/territory?name=WSO_NAME": "Get specific WSO territory",
                        "/api/meets": "Get meets with WSO participation data",
                        "/api/wso/list": "Get list of available WSOs"
                    },
                    usage: "Designed for frontend mapping applications (Leaflet, Mapbox, etc.)"
                }));
            }

        } catch (error) {
            console.error('API Error:', error.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: error.message }));
        }
    });

    server.listen(port, () => {
        console.log(`🌐 API Server running on http://localhost:${port}`);
        console.log('');
        console.log('Available endpoints:');
        console.log(`  GET http://localhost:${port}/api/wso/territories`);
        console.log(`  GET http://localhost:${port}/api/wso/territory?name=Texas-Oklahoma`);
        console.log(`  GET http://localhost:${port}/api/meets`);
        console.log(`  GET http://localhost:${port}/api/wso/list`);
    });

    return server;
}

async function main() {
    const args = process.argv.slice(2);

    try {
        if (args.includes('--export-all')) {
            await exportAllWSOs();

        } else if (args.includes('--export-wso')) {
            const wsoIndex = args.indexOf('--export-wso');
            const wsoName = args[wsoIndex + 1];
            if (!wsoName) {
                throw new Error('Please specify WSO name: --export-wso "Texas-Oklahoma"');
            }
            await exportSpecificWSO(wsoName);

        } else if (args.includes('--export-meets')) {
            await exportMeetsWithWSOs();

        } else if (args.includes('--start-server')) {
            const port = args.includes('--port') ?
                parseInt(args[args.indexOf('--port') + 1]) : 3001;
            startAPIServer(port);

        } else {
            console.log('WSO GeoJSON API');
            console.log('===============');
            console.log('');
            console.log('Options:');
            console.log('  --export-all              Export all WSO territories');
            console.log('  --export-wso "NAME"       Export specific WSO territory');
            console.log('  --export-meets            Export meets with WSO data');
            console.log('  --start-server [--port N] Start HTTP API server');
            console.log('');
            console.log('Examples:');
            console.log('  node wso-geojson-api.js --export-all');
            console.log('  node wso-geojson-api.js --export-wso "Texas-Oklahoma"');
            console.log('  node wso-geojson-api.js --start-server --port 3001');
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
    exportAllWSOs,
    exportSpecificWSO,
    exportMeetsWithWSOs,
    startAPIServer
};