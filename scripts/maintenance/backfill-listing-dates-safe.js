const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// --- Date Parsing Logic ---

function parseDateString(dateStr) {
    if (!dateStr) return null;
    const cleanStr = dateStr.replace(/(\d+)(st|nd|rd|th)/g, '$1');
    const date = new Date(cleanStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
}

function parseDatesFromEventDate(eventDate) {
    if (!eventDate) return { start: null, end: null };

    const parts = eventDate.split(' - ');
    const cleanPart = (str) => {
        return str
            .replace(/\d{1,2}:\d{2}\s+(AM|PM)/gi, '')
            .replace(/\([A-Z]+\)/g, '')
            .trim();
    };

    if (parts.length === 2) {
        const startRaw = cleanPart(parts[0]);
        const endRaw = cleanPart(parts[1]);
        const start = parseDateString(startRaw);
        const end = parseDateString(endRaw);
        return { start, end };
    }

    if (parts.length === 1) {
        const raw = cleanPart(parts[0]);
        const date = parseDateString(raw);
        if (date) {
            return { start: date, end: date };
        }
    }

    return { start: null, end: null };
}

async function backfillDates() {
    console.log('🚀 Starting backfill of start_date and end_date (SAFE MODE)...');

    const pageSize = 1000;
    let page = 0;
    let processed = 0;
    let updated = 0;
    let errors = 0;

    // Concurrency limit for updates
    const CONCURRENCY = 20;

    while (true) {
        // Fetch listings that still need updating
        const { data, error } = await supabase
            .from('usaw_meet_listings')
            .select('listing_id, event_date')
            .is('start_date', null)
            .not('event_date', 'is', null)
            .limit(pageSize);

        if (error) {
            console.error('❌ Error fetching listings:', error);
            break;
        }

        if (data.length === 0) {
            console.log('No more records to process.');
            break;
        }

        console.log(`Processing batch of ${data.length} records...`);

        // Process in chunks of CONCURRENCY
        for (let i = 0; i < data.length; i += CONCURRENCY) {
            const chunk = data.slice(i, i + CONCURRENCY);
            const promises = chunk.map(async (row) => {
                const { start, end } = parseDatesFromEventDate(row.event_date);

                if (start) {
                    const { error: updateError } = await supabase
                        .from('usaw_meet_listings')
                        .update({
                            start_date: start,
                            end_date: end || start
                        })
                        .eq('listing_id', row.listing_id);

                    if (updateError) {
                        console.error(`❌ Error updating listing ${row.listing_id}:`, updateError.message);
                        errors++;
                    } else {
                        updated++;
                    }
                } else {
                    // console.warn(`⚠️ Could not parse date: "${row.event_date}"`);
                    errors++;
                }
            });

            await Promise.all(promises);
            process.stdout.write('.'); // Progress indicator
        }
        console.log(`\nBatch complete. Total updated: ${updated}`);

        // Since we are filtering by `is('start_date', null)`, we don't need to increment page/offset.
        // The processed rows will drop out of the query in the next iteration.

        processed += data.length;
        await new Promise(r => setTimeout(r, 100));
    }

    console.log('\n✅ Backfill complete!');
    console.log(`Processed: ${processed}`);
    console.log(`Updated: ${updated}`);
    console.log(`Failed/Skipped: ${errors}`);
}

backfillDates();
