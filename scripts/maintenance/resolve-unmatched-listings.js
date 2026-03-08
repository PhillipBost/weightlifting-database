/**
 * Resolve Unmatched Meet Listings
 * 
 * This script runs through all usaw_meet_listings that have 'unmatched' status
 * and attempts to link them to verified meets in usaw_meets by Name and Date.
 * It's designed to run on a daily schedule to catch listings that get their
 * official results logged *after* the listing was originally created.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function resolveUnmatched() {
    console.log("🔍 Finding unmatched meet listings...");

    // 1. Get all unmatched listings
    // We only need ones that have a start_date, because if they don't, we can't reliably match anyway
    const { data: unmatched, error: fetchErr } = await supabase
        .from('usaw_meet_listings')
        .select('listing_id, meet_name, start_date')
        .eq('meet_match_status', 'unmatched')
        .not('start_date', 'is', null);

    if (fetchErr) {
        console.error("❌ Error fetching unmatched listings:", fetchErr.message);
        process.exit(1);
    }

    if (!unmatched || unmatched.length === 0) {
        console.log("✅ No unmatched listings found.");
        return;
    }

    console.log(`📋 Found ${unmatched.length} unmatched listings. Attempting to match against usaw_meets...`);

    let matchCount = 0;

    for (const listing of unmatched) {
        // Query the usaw_meets table exactly like the scraper does
        const { data: match, error: matchErr } = await supabase
            .from('usaw_meets')
            .select('meet_id')
            .eq('Meet', listing.meet_name)
            .eq('Date', listing.start_date)
            .limit(1)
            .maybeSingle();

        if (matchErr) {
            console.error(`  ⚠️ Warning: Query error matching "${listing.meet_name}":`, matchErr.message);
            continue;
        }

        if (match && match.meet_id) {
            console.log(`  🔗 Matched: "${listing.meet_name}" -> Meet ID ${match.meet_id}`);

            const { error: updateErr } = await supabase
                .from('usaw_meet_listings')
                .update({
                    meet_match_status: 'matched',
                    meet_id: match.meet_id
                })
                .eq('listing_id', listing.listing_id);

            if (updateErr) {
                console.error(`  ❌ Error updating listing ${listing.listing_id}:`, updateErr.message);
            } else {
                matchCount++;
            }
        }
    }

    console.log(`\n🎉 Finished matching. Successfully resolved ${matchCount} listings.`);
}

resolveUnmatched().catch(e => {
    console.error("Fatal error:", e);
    process.exit(1);
});
