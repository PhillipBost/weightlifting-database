#!/usr/bin/env node
/**
 * OWLCMS Meet Geocode & Country Sweep Worker
 * 
 * Identifies any owlcms meet records missing latitude/longitude coordinates
 * and retries geocoding via OpenStreetMap (OSM) Nominatim API.
 * Also synchronizes missing country codes on results from lifters.
 * 
 * Safe to run anytime, idempotent.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { geocodeOwlcmsMeet } = require('./owlcms-geocoder');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sweep() {
    console.log('[SWEEP] Checking for owlcms meets with missing coordinates...');

    const { data: meets, error } = await supabase
        .from('owlcms_meets')
        .select('meet_id, meet_name, city, country, venue, host_country_code, raw_payload')
        .or('latitude.is.null,longitude.is.null')
        .order('meet_id', { ascending: true });

    if (error) {
        console.error('[SWEEP] Error querying un-geocoded meets:', error.message);
        return;
    }

    if (!meets || meets.length === 0) {
        console.log('[SWEEP] All owlcms meets currently possess valid coordinates.');
    } else {
        console.log(`[SWEEP] Found ${meets.length} meet(s) requiring geocoding.`);

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
                    const { error: updateErr } = await supabase
                        .from('owlcms_meets')
                        .update({
                            latitude: geo.latitude,
                            longitude: geo.longitude,
                            updated_at: new Date().toISOString()
                        })
                        .eq('meet_id', meet.meet_id);

                    if (updateErr) {
                        console.error(`[SWEEP] Failed to update meet ${meet.meet_id}: ${updateErr.message}`);
                    } else {
                        console.log(`[SWEEP] ✓ Updated meet ${meet.meet_id}: ${geo.latitude}, ${geo.longitude}`);
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
    const { data: missingResults, error: resErr } = await supabase
        .from('owlcms_meet_results')
        .select('result_id, lifter_id')
        .is('country_code', null)
        .limit(500);

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
