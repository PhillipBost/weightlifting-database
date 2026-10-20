#!/usr/bin/env node
/**
 * OWLCMS Meet Geocode & Country Sweep Worker
 * 
 * Identifies any Open Weightlifting Competition Management System (OWLCMS) meet records
 * missing latitude/longitude coordinates and resolves them using the cascading
 * geocoder (Photon primary, OpenStreetMap Nominatim fallback).
 * Also synchronizes missing country codes on results from lifters.
 * 
 * Safe to run anytime, idempotent.
 * Supports targeted execution: node sweep-owlcms-geocodes.js --meet_id <id>
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { geocodeOwlcmsMeet } = require('./owlcms-geocoder');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Parse command line arguments for --meet_id <id>
 */
function parseArgs() {
    const args = process.argv.slice(2);
    let targetMeetId = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--meet_id' || args[i] === '--meet' || args[i] === '-m') {
            if (args[i + 1]) {
                targetMeetId = parseInt(args[i + 1], 10);
                i++;
            }
        } else if (/^\d+$/.test(args[i])) {
            targetMeetId = parseInt(args[i], 10);
        }
    }

    return { targetMeetId: isNaN(targetMeetId) ? null : targetMeetId };
}

/**
 * Main geocode sweep task
 * 
 * @param {Object} [options] - Optional execution options
 * @param {number} [options.meetId] - Specific meet_id to target
 */
async function sweep(options = {}) {
    const meetId = options.meetId || parseArgs().targetMeetId;

    if (meetId) {
        console.log(`[SWEEP] Targeted geocoding initiated for meet_id ${meetId}...`);
    } else {
        console.log('[SWEEP] Batch sweep initiated: checking for owlcms meets with missing coordinates...');
    }

    let query = supabase
        .from('owlcms_meets')
        .select('meet_id, meet_name, city, country, venue, host_country_code, raw_payload');

    if (meetId) {
        query = query.eq('meet_id', meetId);
    } else {
        query = query.or('latitude.is.null,longitude.is.null');
    }

    const { data: meets, error } = await query.order('meet_id', { ascending: true });

    if (error) {
        console.error('[SWEEP] Error querying un-geocoded meets:', error.message);
        return;
    }

    if (!meets || meets.length === 0) {
        if (meetId) {
            console.log(`[SWEEP] Meet ${meetId} not found or already verified.`);
        } else {
            console.log('[SWEEP] All owlcms meets currently possess valid coordinates.');
        }
    } else {
        console.log(`[SWEEP] Processing ${meets.length} meet(s) for geocoding...`);

        for (const meet of meets) {
            console.log(`[SWEEP] Processing meet ${meet.meet_id}: "${meet.meet_name}"...`);
            const rawComp = (meet.raw_payload && meet.raw_payload.competition) ? meet.raw_payload.competition : {};

            try {
                const geo = await geocodeOwlcmsMeet({
                    venue: meet.venue || rawComp.competitionSite,
                    city: meet.city || rawComp.competitionCity,
                    country: meet.host_country_code || meet.country,
                    rawComp
                });

                if (geo && geo.latitude != null && geo.longitude != null) {
                    const updatePayload = {
                        latitude: geo.latitude,
                        longitude: geo.longitude,
                        updated_at: new Date().toISOString()
                    };

                    if (!meet.country && geo.country_name) {
                        updatePayload.country = geo.country_name;
                    }
                    if (!meet.host_country_code && geo.ioc_country_code) {
                        updatePayload.host_country_code = geo.ioc_country_code;
                    }

                    const { error: updateErr } = await supabase
                        .from('owlcms_meets')
                        .update(updatePayload)
                        .eq('meet_id', meet.meet_id);

                    if (updateErr) {
                        console.error(`[SWEEP] Failed to update meet ${meet.meet_id}: ${updateErr.message}`);
                    } else {
                        console.log(`[SWEEP] ✓ Updated meet ${meet.meet_id}: [${geo.latitude}, ${geo.longitude}] (${geo.provider || 'geocoder'}: "${geo.display_name}")`);
                    }
                } else {
                    console.warn(`[SWEEP] ⚠️ Could not resolve coordinates for meet ${meet.meet_id}`);
                }
            } catch (err) {
                console.error(`[SWEEP] Error geocoding meet ${meet.meet_id}:`, err.message);
            }
        }
    }

    // Sync missing country_code on owlcms_meet_results from owlcms_lifters
    let resultsQuery = supabase
        .from('owlcms_meet_results')
        .select('result_id, lifter_id')
        .is('country_code', null);

    if (meetId) {
        resultsQuery = resultsQuery.eq('meet_id', meetId);
    } else {
        resultsQuery = resultsQuery.limit(500);
    }

    const { data: missingResults, error: resErr } = await resultsQuery;

    if (!resErr && missingResults && missingResults.length > 0) {
        console.log(`[SWEEP] Found ${missingResults.length} result(s) with missing country_code. Synchronizing from lifters...`);
        const lifterIds = [...new Set(missingResults.map(r => r.lifter_id))];

        const { data: lifters } = await supabase
            .from('owlcms_lifters')
            .select('lifter_id, country_code')
            .in('lifter_id', lifterIds)
            .not('country_code', 'is', null);

        if (lifters && lifters.length > 0) {
            const countryByLifter = new Map(lifters.map(l => [l.lifter_id, l.country_code]));
            let updatedCount = 0;

            for (const res of missingResults) {
                const code = countryByLifter.get(res.lifter_id);
                if (code) {
                    await supabase
                        .from('owlcms_meet_results')
                        .update({ country_code: code })
                        .eq('result_id', res.result_id);
                    updatedCount++;
                }
            }
            console.log(`[SWEEP] ✓ Synchronized country_code for ${updatedCount} meet results.`);
        }
    }

    console.log('[SWEEP] Sweep completed.');
}

if (require.main === module) {
    sweep()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('[SWEEP] Fatal error:', err);
            process.exit(1);
        });
}

module.exports = { sweep };
