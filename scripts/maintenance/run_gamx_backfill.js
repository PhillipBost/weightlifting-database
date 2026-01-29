require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Error: Missing SUPABASE_URL or SERVICE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runBackfill() {
    console.log("Starting Chunked Backfill...");
    let totalProcessed = 0;
    const batchSize = 1000;

    while (true) {
        const { data, error } = await supabase.rpc('backfill_gamx_batch', { p_batch_size: batchSize });

        if (error) {
            console.error("RPC Error:", error);
            break;
        }

        const count = data;
        totalProcessed += count;
        console.log(`Processed batch of ${count} records. Total: ${totalProcessed}`);

        if (count < batchSize) {
            console.log("Backfill complete (batch smaller than limit or zero).");
            break;
        }

        // Optional short sleep to be nice to DB
        await new Promise(r => setTimeout(r, 100));
    }
}

runBackfill();
