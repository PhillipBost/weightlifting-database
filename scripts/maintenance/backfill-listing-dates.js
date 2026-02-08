const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// --- Date Parsing Logic ---

function parseDateString(dateStr) {
    if (!dateStr) return null;
    // Remove ordinals (st, nd, rd, th)
    const cleanStr = dateStr.replace(/(\d+)(st|nd|rd|th)/g, '$1');
    const date = new Date(cleanStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
}

function parseDatesFromEventDate(eventDate) {
    if (!eventDate) return { start: null, end: null };

    // Clean up the string first
    // Remove time and timezone info (e.g., "7:00 AM (MST)") to avoid confusion
    // We want to keep the date parts.
    // Heuristic: Remove time patterns like "7:00 AM", "5:00 PM", "(MST)", etc.
    // But be careful not to remove the year or date parts.
    // Actually, splitting by " - " first is safer.

    const parts = eventDate.split(' - ');

    // Helper to clean a single date part string
    const cleanPart = (str) => {
        return str
            .replace(/\d{1,2}:\d{2}\s+(AM|PM)/gi, '') // Remove time
            .replace(/\([A-Z]+\)/g, '')               // Remove timezone
            .trim();
    };

    if (parts.length === 2) {
        // Range: "Start - End"
        const startRaw = cleanPart(parts[0]);
        const endRaw = cleanPart(parts[1]);

        let start = parseDateString(startRaw);
        let end = parseDateString(endRaw);

        // Handle case like "Dec 31" (missing year in first part?)
        // The current data seems to include year in most cases like "Month DD, YYYY" or "Month DD YYYY"
        // But if we have "May 20th 2023 - May 21st 2023", both have years.

        // Return whatever we managed to parse
        return { start, end };
    }

    if (parts.length === 1) {
        // Single date or complex string not separated by " - "
        const raw = cleanPart(parts[0]);
        const date = parseDateString(raw);
        if (date) {
            // For single date, start = end
            return { start: date, end: date };
        }
    }

    return { start: null, end: null };
}

async function backfillDates() {
    console.log('🚀 Starting backfill of start_date and end_date...');

    // 1. Fetch all listings where start_date is NULL
    // Fetching in batches to avoid memory issues
    const pageSize = 1000;
    let page = 0;
    let processed = 0;
    let updated = 0;
    let errors = 0;

    while (true) {
        const { data, error } = await supabase
            .from('usaw_meet_listings')
            .select('listing_id, event_date')
            .is('start_date', null)
            .not('event_date', 'is', null)
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error('❌ Error fetching listings:', error);
            break;
        }

        if (data.length === 0) {
            break; // No more records to process
        }

        console.log(`Processing batch ${page + 1} (${data.length} records)...`);

        const updates = [];

        for (const row of data) {
            const { start, end } = parseDatesFromEventDate(row.event_date);

            if (start) {
                updates.push({
                    listing_id: row.listing_id,
                    start_date: start,
                    end_date: end || start // Fallback to start if end is null (shouldn't happen with our logic but safe)
                });
            } else {
                // console.warn(`⚠️ Could not parse date: "${row.event_date}"`);
                errors++;
            }
        }

        // Perform bulk updates? 
        // Supabase upsert requires unique constraint. 
        // We can use upsert on (listing_id) if it's a primary key.
        // listing_id is PK.

        if (updates.length > 0) {
            const { error: updateError } = await supabase
                .from('usaw_meet_listings')
                .upsert(updates, { onConflict: 'listing_id' });

            if (updateError) {
                console.error('❌ Error updating batch:', updateError);
            } else {
                updated += updates.length;
            }
        }

        processed += data.length;

        // If we fetched fewer than pageSize, we are done
        if (data.length < pageSize) break;

        // Important: Since we are filtering by `is('start_date', null)`, 
        // the processed rows will no longer match the filter in the next query.
        // So we should NOT increment `page` if we want to process the "next" remaining nulls.
        // However, standard pagination increment is safer to avoid infinite loops if updates fail.
        // BUT, if updates succeed, the next page 0 will be new data.
        // So let's keep page 0.

        // wait a bit to be nice to the DB
        await new Promise(r => setTimeout(r, 100));
    }

    console.log('\n✅ Backfill complete!');
    console.log(`Processed: ${processed}`);
    console.log(`Updated: ${updated}`);
    console.log(`Failed to parse: ${errors}`);
}

backfillDates();
