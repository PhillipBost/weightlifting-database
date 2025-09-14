#!/usr/bin/env node

/**
 * Meet Geographic Analysis Script
 *
 * Analyzes meets from a geographic perspective using WSO territorial data.
 * Provides insights into travel patterns, geographic diversity, and accessibility.
 *
 * Usage:
 *   node meet-geographic-analysis.js --meet-id 12345
 *   node meet-geographic-analysis.js --national-meets
 *   node meet-geographic-analysis.js --travel-analysis
 */

const { createClient } = require('@supabase/supabase-js');
const { WSOGeographicUtils } = require('./wso-geographic-utils');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const wsoUtils = new WSOGeographicUtils(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function analyzeSingleMeet(meetId) {
    console.log(`🎯 Analyzing Meet ID: ${meetId}`);
    console.log('==================================');

    // Get meet information
    const { data: meet, error: meetError } = await supabase
        .from('meets')
        .select('*')
        .eq('meet_id', meetId)
        .single();

    if (meetError) {
        console.error('Error fetching meet:', meetError.message);
        return;
    }

    // Get meet results with WSO data
    const { data: results, error: resultsError } = await supabase
        .from('meet_results')
        .select('*')
        .eq('meet_id', meetId);

    if (resultsError) {
        console.error('Error fetching results:', resultsError.message);
        return;
    }

    console.log(`📍 Meet: ${meet.meet_name}`);
    console.log(`📅 Date: ${meet.date}`);
    console.log(`🌍 Location: ${meet.city}, ${meet.state}`);
    if (meet.latitude && meet.longitude) {
        console.log(`🗺️  Coordinates: ${meet.latitude}, ${meet.longitude}`);
    }
    console.log(`👥 Total Athletes: ${results.length}`);

    // Analyze geographic diversity
    const diversity = await wsoUtils.analyzeMeetGeographicDiversity(
        results.map(r => ({ ...r, meet_lat: meet.latitude, meet_lng: meet.longitude }))
    );

    console.log('\\n📊 Geographic Analysis:');
    console.log('========================');
    console.log(`🏛️  Unique WSOs Represented: ${diversity.unique_wsos}`);
    console.log(`📈 Diversity Score: ${diversity.diversity_score}`);

    if (diversity.farthest_wso) {
        console.log(`🛣️  Farthest WSO: ${diversity.farthest_wso} (${Math.round(diversity.average_travel_distances[diversity.farthest_wso])} km)`);
    }

    console.log('\\n🗺️  WSO Participation:');
    console.log('======================');
    Object.entries(diversity.wso_participation)
        .sort(([,a], [,b]) => b - a)
        .forEach(([wso, count]) => {
            const distance = diversity.average_travel_distances[wso];
            const distanceStr = distance ? ` (${Math.round(distance)} km away)` : '';
            console.log(`   ${wso}: ${count} athletes${distanceStr}`);
        });

    // Calculate travel burden if coordinates available
    if (meet.latitude && meet.longitude) {
        const travelBurden = await wsoUtils.calculateTravelBurden(results, meet.latitude, meet.longitude);
        if (travelBurden) {
            console.log('\\n✈️  Travel Analysis:');
            console.log('====================');
            console.log(`📊 Average Travel Distance: ${travelBurden.average_travel_distance} km`);
            console.log(`📈 Travel Burden Score: ${travelBurden.travel_burden_score}`);
            console.log(`🌍 WSOs Represented: ${travelBurden.participating_wsos}`);
        }
    }
}

async function analyzeNationalMeets() {
    console.log('🇺🇸 Analyzing National Meets');
    console.log('============================');

    // Find meets that are likely national (by name patterns)
    const { data: meets, error } = await supabase
        .from('meets')
        .select('meet_id, meet_name, date, city, state, latitude, longitude')
        .or('meet_name.ilike.%national%,meet_name.ilike.%championship%,meet_name.ilike.%american open%')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .order('date', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error fetching national meets:', error.message);
        return;
    }

    console.log(`Found ${meets.length} recent national-level meets with coordinates:\\n`);

    for (const meet of meets) {
        const { data: results } = await supabase
            .from('meet_results')
            .select('wso')
            .eq('meet_id', meet.meet_id);

        if (!results || results.length === 0) continue;

        const diversity = await wsoUtils.analyzeMeetGeographicDiversity(
            results.map(r => ({ ...r, meet_lat: meet.latitude, meet_lng: meet.longitude }))
        );

        const travelBurden = await wsoUtils.calculateTravelBurden(results, meet.latitude, meet.longitude);

        console.log(`📍 ${meet.meet_name} (${meet.date})`);
        console.log(`   🌍 Location: ${meet.city}, ${meet.state}`);
        console.log(`   👥 Athletes: ${results.length}`);
        console.log(`   🏛️  WSOs: ${diversity.unique_wsos}`);
        console.log(`   📈 Diversity: ${diversity.diversity_score}`);
        if (travelBurden) {
            console.log(`   ✈️  Avg Travel: ${travelBurden.average_travel_distance} km`);
        }
        if (diversity.farthest_wso) {
            console.log(`   🛣️  Farthest: ${diversity.farthest_wso}`);
        }
        console.log('');
    }
}

async function performTravelAnalysis() {
    console.log('🚗 Travel Pattern Analysis');
    console.log('==========================');

    // Find meets with the highest travel burden
    const { data: meetsWithCoords, error } = await supabase
        .from('meets')
        .select('meet_id, meet_name, date, city, state, latitude, longitude')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .gte('date', '2020-01-01') // Recent meets only
        .order('date', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Error fetching meets:', error.message);
        return;
    }

    const travelAnalysis = [];

    console.log('Analyzing travel patterns for recent meets...\\n');

    for (const meet of meetsWithCoords) {
        const { data: results } = await supabase
            .from('meet_results')
            .select('wso')
            .eq('meet_id', meet.meet_id);

        if (!results || results.length < 10) continue; // Skip small meets

        const travelBurden = await wsoUtils.calculateTravelBurden(results, meet.latitude, meet.longitude);
        if (travelBurden && travelBurden.participating_wsos >= 3) { // Need decent geographic spread
            travelAnalysis.push({
                meet,
                ...travelBurden
            });
        }
    }

    // Sort by travel burden score
    travelAnalysis.sort((a, b) => b.average_travel_distance - a.average_travel_distance);

    console.log('🏆 Meets with Highest Travel Burden:');
    console.log('====================================');
    travelAnalysis.slice(0, 10).forEach((analysis, index) => {
        console.log(`${index + 1}. ${analysis.meet.meet_name}`);
        console.log(`   📍 ${analysis.meet.city}, ${analysis.meet.state} (${analysis.meet.date})`);
        console.log(`   ✈️  Average Travel: ${analysis.average_travel_distance} km`);
        console.log(`   🌍 WSOs: ${analysis.participating_wsos}`);
        console.log('');
    });

    console.log('🏠 Most Accessible Meets (Lowest Travel Burden):');
    console.log('================================================');
    travelAnalysis.slice(-10).reverse().forEach((analysis, index) => {
        console.log(`${index + 1}. ${analysis.meet.meet_name}`);
        console.log(`   📍 ${analysis.meet.city}, ${analysis.meet.state} (${analysis.meet.date})`);
        console.log(`   🚗 Average Travel: ${analysis.average_travel_distance} km`);
        console.log(`   🌍 WSOs: ${analysis.participating_wsos}`);
        console.log('');
    });
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--meet-id')) {
        const meetIdIndex = args.indexOf('--meet-id');
        const meetId = args[meetIdIndex + 1];
        if (meetId) {
            await analyzeSingleMeet(parseInt(meetId));
        } else {
            console.error('Please provide a meet ID: --meet-id 12345');
        }
    } else if (args.includes('--national-meets')) {
        await analyzeNationalMeets();
    } else if (args.includes('--travel-analysis')) {
        await performTravelAnalysis();
    } else {
        console.log('Meet Geographic Analysis');
        console.log('========================');
        console.log('');
        console.log('Options:');
        console.log('  --meet-id 12345     Analyze a specific meet');
        console.log('  --national-meets    Analyze national-level meets');
        console.log('  --travel-analysis   Travel pattern analysis');
        console.log('');
        console.log('Examples:');
        console.log('  node meet-geographic-analysis.js --meet-id 12345');
        console.log('  node meet-geographic-analysis.js --national-meets');
    }
}

if (require.main === module) {
    main().catch(console.error);
}