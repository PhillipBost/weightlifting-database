#!/usr/bin/env node
/**
 * OWLCMS Meets Coordinates & Country Codes Backfill
 * 
 * Backfills:
 *   1. Host coordinates (latitude, longitude) for existing owlcms_meets:
 *      - Meet ID 4 (Guayaquil, Ecuador): lat -2.1894, lon -79.8891
 *      - Meet ID 1 (Chambly, Québec, CAN): lat 45.4483, lon -73.2937
 *      - Meet ID 2 (Saint-Hyacinthe, Québec, CAN): lat 45.6275, lon -72.9406
 *      - Meet ID 3 (Saint-Georges, Québec, CAN): lat 46.1230, lon -70.6720
 *   2. Participant athlete canonical IOC country codes in public.owlcms_lifters
 *      and public.owlcms_meet_results.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Target coordinates for existing meets
const MEET_COORDINATES = [
    {
        meet_id: 4,
        meet_name: 'CAMPEONATOS PANAMERICANOS SUB 15, SUB 17 Y CAMPEONATOS SUDAMERICANOS...',
        latitude: -2.1894,
        longitude: -79.8891,
        city: 'Guayaquil',
        country: 'Ecuador',
        host_country_code: 'ECU'
    },
    {
        meet_id: 1,
        meet_name: 'Championnats canadiens junior',
        latitude: 45.4483467,
        longitude: -73.2936944,
        city: 'Chambly, Québec',
        country: 'Canada',
        host_country_code: 'CAN'
    },
    {
        meet_id: 2,
        meet_name: 'Québec Open d\'été',
        latitude: 45.6274840,
        longitude: -72.9406360,
        city: 'Saint-Hyacinthe',
        country: 'Canada',
        host_country_code: 'CAN'
    },
    {
        meet_id: 3,
        meet_name: 'Mini Louis-Cyr & Louis-Cyr',
        latitude: 46.1229870,
        longitude: -70.6719590,
        city: 'Saint-Georges',
        country: 'Canada',
        host_country_code: 'CAN'
    }
];

// Canonical IOC 3-letter country codes in Meet 4
const MEET_4_IOC_CODES = [
    'ARG', 'ARU', 'BOL', 'BRA', 'CAN', 'CHI', 'COL',
    'CRC', 'ECU', 'HON', 'PAN', 'PER', 'URU', 'USA', 'VEN'
];

async function runBackfill() {
    console.log('============================================================');
    console.log('OWLCMS MEETS & RESULTS COORDINATES/COUNTRY BACKFILL');
    console.log('============================================================\n');

    // 1. Backfill Coordinates on public.owlcms_meets
    console.log('--- 1. Backfilling Coordinates on public.owlcms_meets ---');
    for (const m of MEET_COORDINATES) {
        const updatePayload = {
            latitude: m.latitude,
            longitude: m.longitude,
            updated_at: new Date().toISOString()
        };
        if (m.host_country_code) {
            updatePayload.host_country_code = m.host_country_code;
        }

        const { error: meetErr } = await supabase
            .from('owlcms_meets')
            .update(updatePayload)
            .eq('meet_id', m.meet_id);

        if (meetErr) {
            console.error(`❌ Failed to update coordinates for Meet ID ${m.meet_id}:`, meetErr.message);
        } else {
            console.log(`✓ Meet ID ${m.meet_id} ("${m.meet_name.slice(0, 40)}..."): [${m.latitude}, ${m.longitude}]`);
        }
    }

    // 2. Backfill Country Codes for Meet ID 4
    console.log('\n--- 2. Backfilling Country Codes for Meet ID 4 Participants ---');

    // Query lifters in Meet 4
    const { data: meet4Results, error: m4Err } = await supabase
        .from('owlcms_meet_results')
        .select('result_id, lifter_id')
        .eq('meet_id', 4);

    if (m4Err) {
        throw new Error(`Failed to query Meet ID 4 results: ${m4Err.message}`);
    }

    console.log(`Found ${meet4Results.length} platform appearance(s) in Meet ID 4.`);
    const lifterIdsMeet4 = [...new Set(meet4Results.map(r => r.lifter_id))];

    // Fetch lifters
    const { data: lifters, error: lifterErr } = await supabase
        .from('owlcms_lifters')
        .select('lifter_id, athlete_name, club_name, country_code')
        .in('lifter_id', lifterIdsMeet4);

    if (lifterErr) {
        throw new Error(`Failed to query Meet ID 4 lifters: ${lifterErr.message}`);
    }

    let liftersUpdated = 0;
    const lifterCountryMap = new Map();

    for (const lifter of lifters) {
        let code = lifter.country_code;
        // In meet 4, the country delegation code was stored in club_name
        if (!code && lifter.club_name && MEET_4_IOC_CODES.includes(lifter.club_name.trim().toUpperCase())) {
            code = lifter.club_name.trim().toUpperCase();
        }

        if (code) {
            lifterCountryMap.set(lifter.lifter_id, code);
            if (lifter.country_code !== code) {
                const { error: lUpErr } = await supabase
                    .from('owlcms_lifters')
                    .update({ country_code: code })
                    .eq('lifter_id', lifter.lifter_id);

                if (!lUpErr) liftersUpdated++;
            }
        }
    }
    console.log(`✓ Updated country_code on ${liftersUpdated} lifter records in public.owlcms_lifters.`);

    // Update owlcms_meet_results for Meet ID 4
    let resultsUpdated = 0;
    for (const res of meet4Results) {
        const code = lifterCountryMap.get(res.lifter_id);
        if (code) {
            const { error: rUpErr } = await supabase
                .from('owlcms_meet_results')
                .update({ country_code: code })
                .eq('result_id', res.result_id);

            if (!rUpErr) resultsUpdated++;
        }
    }
    console.log(`✓ Updated country_code on ${resultsUpdated} result records in public.owlcms_meet_results.`);

    // 3. Backfill Country Codes for Canadian Domestic Meets (Meets 1, 2, 3)
    console.log('\n--- 3. Backfilling Country Codes for Canadian Domestic Meets (1, 2, 3) ---');
    for (const meetId of [1, 2, 3]) {
        const { data: canResults } = await supabase
            .from('owlcms_meet_results')
            .select('result_id, lifter_id')
            .eq('meet_id', meetId);

        if (canResults && canResults.length > 0) {
            const canLifterIds = [...new Set(canResults.map(r => r.lifter_id))];
            await supabase
                .from('owlcms_lifters')
                .update({ country_code: 'CAN' })
                .in('lifter_id', canLifterIds)
                .is('country_code', null);

            await supabase
                .from('owlcms_meet_results')
                .update({ country_code: 'CAN' })
                .eq('meet_id', meetId)
                .is('country_code', null);

            console.log(`✓ Assigned "CAN" to ${canResults.length} records in Meet ID ${meetId}.`);
        }
    }

    // 4. Verification & Validation Summary
    console.log('\n============================================================');
    console.log('VERIFICATION & AUDIT');
    console.log('============================================================\n');

    const { data: meetsAudit } = await supabase
        .from('owlcms_meets')
        .select('meet_id, meet_name, city, country, host_country_code, latitude, longitude')
        .order('meet_id');

    console.log('--- Meets Status ---');
    console.table(meetsAudit.map(m => ({
        ID: m.meet_id,
        Name: m.meet_name.slice(0, 35) + '...',
        City: m.city,
        Country: m.host_country_code || m.country,
        Latitude: m.latitude,
        Longitude: m.longitude
    })));

    const { data: m4Breakdown } = await supabase
        .from('owlcms_meet_results')
        .select('country_code')
        .eq('meet_id', 4);

    const counts = {};
    for (const r of m4Breakdown) {
        counts[r.country_code || 'MISSING'] = (counts[r.country_code || 'MISSING'] || 0) + 1;
    }

    console.log('\n--- Meet ID 4 Country Code Distribution in owlcms_meet_results ---');
    console.table(Object.entries(counts).map(([code, count]) => ({
        'IOC Country Code': code,
        'Athlete Appearances': count
    })));

    const missingM4 = counts['MISSING'] || 0;
    if (missingM4 === 0) {
        console.log('\n✅ SUCCESS: 100% of Meet ID 4 participant results possess valid IOC country codes!');
    } else {
        console.warn(`\n⚠️ WARNING: ${missingM4} result(s) in Meet ID 4 are still missing country codes.`);
    }
}

runBackfill()
    .then(() => {
        console.log('\nBackfill completed successfully.');
        process.exit(0);
    })
    .catch(err => {
        console.error('Fatal backfill error:', err);
        process.exit(1);
    });
