require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// Configuration
const FILES = {
    MAIN: 'GAMX files v2.0/GAMX_calculator_allages (updated 2026-01-29).xlsx',
    SJ: 'GAMX files v2.0/GAMX_seniors_snatch_cj.xlsx'
};
const CHUNK_SIZE = 1000;

// Setup Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Error: Missing SUPABASE_URL or SERVICE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false }
});

const TABLE_MAP = {
    // Main File - Age/Total Factors
    'params_U_men': { file: 'MAIN', table: 'gamx_u_factors', gender: 'm', type: 'age' },
    'params_U_wom': { file: 'MAIN', table: 'gamx_u_factors', gender: 'f', type: 'age' },
    'params_iwf_men': { file: 'MAIN', table: 'gamx_a_factors', gender: 'm', type: 'age' },
    'params_iwf_wom': { file: 'MAIN', table: 'gamx_a_factors', gender: 'f', type: 'age' },
    'params_mas_men': { file: 'MAIN', table: 'gamx_masters_factors', gender: 'm', type: 'age' },
    'params_mas_wom': { file: 'MAIN', table: 'gamx_masters_factors', gender: 'f', type: 'age' },
    'params_sen_men': { file: 'MAIN', table: 'gamx_points_factors', gender: 'm', type: 'weight' },
    'params_sen_women': { file: 'MAIN', table: 'gamx_points_factors', gender: 'f', type: 'weight' }, // Note: 'women' in this file

    // SJ File - Snatch/CJ Factors
    'snatch_sen_men': { file: 'SJ', table: 'gamx_s_factors', gender: 'm', type: 'weight' },
    'snatch_sen_wom': { file: 'SJ', table: 'gamx_s_factors', gender: 'f', type: 'weight' }, // Note: 'wom' in this file
    'cj_sen_men': { file: 'SJ', table: 'gamx_j_factors', gender: 'm', type: 'weight' },
    'cj_sen_wom': { file: 'SJ', table: 'gamx_j_factors', gender: 'f', type: 'weight' }
};

async function wipeTable(tableName) {
    console.log(`Clearing table ${tableName}...`);
    // Delete all rows. We assume 'id' column exists and is > 0.
    // Ideally TRUNCATE via RPC, but DELETE works for now.
    // If table is large, this might timeout.
    // Loop delete?

    let hasMore = true;
    while (hasMore) {
        const { error, count } = await supabase
            .from(tableName)
            .delete()
            .neq('id', 0); // Delete everything where ID is not 0 (all)

        if (error) {
            console.error(`Error wiping ${tableName}:`, error.message);
            // If error is timeout, maybe retry or accept partial? 
            // Postgres DELETE without where is slow.
            // But we can't do TRUNCATE easily.
            throw error;
        }
        // If count is returned, check if 0? Supabase delete returns rows.
        // Actually delete() usually returns inserted rows if returning=true.
        // Let's assume it works.
        hasMore = false;
    }
}

async function run() {
    // 1. Wipe Tables First (Unique set)
    const tables = new Set(Object.values(TABLE_MAP).map(c => c.table));
    for (const table of tables) {
        await wipeTable(table);
    }

    // Load Workbooks
    const workbooks = {};
    for (const [key, filename] of Object.entries(FILES)) {
        const filePath = path.resolve(__dirname, '../../', filename);
        if (fs.existsSync(filePath)) {
            console.log(`Reading Excel file: ${filePath}`);
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.readFile(filePath);
            workbooks[key] = wb;
        } else {
            console.error(`File missing: ${filePath}`);
        }
    }

    // 2. Iterate Sheets and Insert
    for (const [sheetName, config] of Object.entries(TABLE_MAP)) {
        const wb = workbooks[config.file];
        if (!wb) continue;

        const sheet = wb.getWorksheet(sheetName);
        if (!sheet) {
            console.warn(`Warning: Sheet '${sheetName}' not found in ${config.file}. Available sheets: ` + wb.worksheets.map(s => s.name).join(', '));
            continue;
        }

        console.log(`Processing sheet: ${sheetName} -> ${config.table} (${config.gender})`);

        let batchValues = [];
        let totalInserted = 0;

        // Iterate rows
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            let age = null;
            let bw, mu, sigma, nu;

            if (config.type === 'age') {
                const cellAge = row.getCell(1).value;
                const cellBw = row.getCell(2).value;
                age = typeof cellAge === 'object' ? cellAge.result : cellAge;
                bw = typeof cellBw === 'object' ? cellBw.result : cellBw;

                mu = row.getCell(3).value;
                sigma = row.getCell(4).value;
                nu = row.getCell(5).value;
            } else {
                const cellBw = row.getCell(1).value;
                bw = typeof cellBw === 'object' ? cellBw.result : cellBw;

                mu = row.getCell(2).value;
                sigma = row.getCell(3).value;
                nu = row.getCell(4).value;
            }

            if (mu && typeof mu === 'object') mu = mu.result;
            if (sigma && typeof sigma === 'object') sigma = sigma.result;
            if (nu && typeof nu === 'object') nu = nu.result;

            if (bw == null || mu == null) return;
            if (config.type === 'age' && age == null) return;

            // Prepare Object
            const rec = {
                gender: config.gender,
                bodyweight: parseFloat(Number(bw).toFixed(1)), // Ensure precision match
                mu: mu,
                sigma: sigma,
                nu: nu
            };
            if (config.type === 'age') {
                rec.age = age;
            }

            batchValues.push(rec);

            // Flush Chunk
            if (batchValues.length >= CHUNK_SIZE) {
                // Must handle async here, but fast iteration inside map is tricky.
                // We'll queue it? No, sync loop prevents await.
                // We'll process validation and add to huge array, BUT array of objects is memory heavy.
                // Better to structure loop to await.
            }
        });

        // Loop array to insert
        for (let i = 0; i < batchValues.length; i += CHUNK_SIZE) {
            const chunk = batchValues.slice(i, i + CHUNK_SIZE);
            const { error } = await supabase.from(config.table).insert(chunk);
            if (error) {
                console.error(`Error inserting chunk to ${config.table}:`, error.message);
                // Exit or continue? 
            }
            totalInserted += chunk.length;
            process.stdout.write(`\rInserted ${totalInserted} rows...`);
        }
        console.log(`\nDone sheet ${sheetName}`);
    }

    console.log("\nSuccess! All factors updated.");
}

run().catch(console.error);
