require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Error: Missing SUPABASE_URL or SERVICE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CHUNK_SIZE = 500;

async function processTable(tableName, idColumn) {
    console.log(`\n--- Backfilling ${tableName} ---`);

    // 1. Get Min/Max ID
    const { data: minData } = await supabase.from(tableName).select(idColumn).order(idColumn, { ascending: true }).limit(1);
    const { data: maxData } = await supabase.from(tableName).select(idColumn).order(idColumn, { ascending: false }).limit(1);

    if (!minData?.[0] || !maxData?.[0]) {
        console.log(`Table ${tableName} appears empty.`);
        return;
    }

    const minId = minData[0][idColumn];
    const maxId = maxData[0][idColumn];

    console.log(`ID Range: ${minId} to ${maxId} (Total span: ${maxId - minId})`);

    // 2. Iterate
    for (let currentId = minId; currentId <= maxId; currentId += CHUNK_SIZE) {
        const nextId = currentId + CHUNK_SIZE;

        const { data, error } = await supabase.rpc('backfill_gamx_by_range', {
            p_min_id: currentId,
            p_max_id: nextId,
            p_table_name: tableName
        });

        if (error) {
            console.error(`Error processing chunk ${currentId}-${nextId}:`, error.message);
            // Don't abort, try next chunk? Or abort? 
            // Abort usually safer to notice.
            // But we'll continue to try to finish other chunks.
        } else {
            const pct = Math.round(((currentId - minId) / (maxId - minId)) * 100);
            process.stdout.write(`\r[${pct}%] Processed range ${currentId}-${nextId}: ${data} rows updated.`);
        }

        // Anti-throttle pause
        await new Promise(r => setTimeout(r, 50));
    }
    console.log(`\nDone with ${tableName}.`);
}

async function run() {
    await processTable('usaw_meet_results', 'result_id');
    await processTable('iwf_meet_results', 'db_result_id');
    console.log("\nAll Backfills Complete.");
}

run();
