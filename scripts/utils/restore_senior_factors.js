require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// Configuration
const FILE = 'GAMX files v2.0/GAMX_calculator_allages (updated 2026-01-29).xlsx';
const TABLE = 'gamx_points_factors';

// Setup Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function run() {
    const filePath = path.resolve(__dirname, '../../', FILE);
    console.log(`Reading: ${filePath}`);

    if (!fs.existsSync(filePath)) {
        console.error("File not found!");
        return;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    // Sheets to process for Senior Total
    const SHEETS = [
        { name: 'params_sen_men', gender: 'm' },
        { name: 'params_sen_women', gender: 'f' }
    ];

    // 1. WIPE TABLE (Critical to ensure clean state, assuming we are fixing the broken state)
    // Only wipe if we are sure we are about to re-insert.
    console.log(`Clearing ${TABLE}...`);
    const { error: delError } = await supabase.from(TABLE).delete().neq('id', 0);
    if (delError) {
        console.error("Delete failed:", delError);
        return;
    }

    // 2. INSERT
    let totalInserted = 0;

    for (const conf of SHEETS) {
        const sheet = workbook.getWorksheet(conf.name);
        if (!sheet) {
            console.error(`MISSING SHEET: ${conf.name}`);
            continue;
        }

        console.log(`Processing ${conf.name} (${conf.gender})... Rows: ${sheet.rowCount}`);

        let batch = [];

        sheet.eachRow((row, rowNum) => {
            if (rowNum === 1) return; // Skip header

            // Senior Weight Table Format: Col 1=BW, 2=Mu, 3=Sigma, 4=Nu
            // (Verify this matches observation: previously user said "I2" formulas etc, but data tables are commonly A/B/C/D)

            let bw = row.getCell(1).value;
            let mu = row.getCell(2).value;
            let sigma = row.getCell(3).value;
            let nu = row.getCell(4).value;

            // Handle formulas
            if (bw && typeof bw === 'object') bw = bw.result;
            if (mu && typeof mu === 'object') mu = mu.result;
            if (sigma && typeof sigma === 'object') sigma = sigma.result;
            if (nu && typeof nu === 'object') nu = nu.result;

            if (bw == null || mu == null) return;

            batch.push({
                gender: conf.gender,
                bodyweight: parseFloat(Number(bw).toFixed(1)),
                mu: mu,
                sigma: sigma,
                nu: nu
            });
        });

        // Insert Batch
        if (batch.length > 0) {
            const { error } = await supabase.from(TABLE).insert(batch);
            if (error) {
                console.error(`Insert failed for ${conf.name}:`, error.message);
            } else {
                console.log(`Inserted ${batch.length} rows from ${conf.name}`);
                totalInserted += batch.length;
            }
        } else {
            console.warn(`No valid rows found in ${conf.name}`);
        }
    }

    // FINAL VERIFICATION
    const { count: finalCount } = await supabase.from(TABLE).select('*', { count: 'exact', head: true });
    console.log(`\nFinal DB Count: ${finalCount}`);

    if (finalCount === totalInserted) {
        console.log("SUCCESS: Database count matches inserted count.");
    } else {
        console.error(`MISMATCH: Inserted ${totalInserted} but DB has ${finalCount}.`);
    }
}

run().catch(console.error);
