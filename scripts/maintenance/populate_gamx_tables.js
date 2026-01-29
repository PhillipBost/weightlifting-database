const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');
const ExcelJS = require('exceljs');
const fs = require('fs');

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY; // Use Service Key for writes

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SERVICE_KEY must be set in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// File Paths
const FILE_CALCULATOR = 'GAMX files v2.0/GAMX_calculator_allages.xlsx';
const FILE_SNATCH_CJ = 'GAMX files v2.0/GAMX_seniors_snatch_cj.xlsx';

// Mappings: Sheet Name -> Table Name
// We also need to know if the sheet implies a specific gender (some do, some have it in columns? NO, inspection showed gender-specific sheets usually)
// Inspection showed:
// params_U_men -> gamx_u_factors (gender='m')
// params_U_wom -> gamx_u_factors (gender='f')
// ... and so on.

// Definition of work items
const WORK_ITEMS = [
    // --- GAMX-U (Age 7-20) ---
    { file: FILE_CALCULATOR, sheet: 'params_U_men', table: 'gamx_u_factors', gender: 'm', hasAge: true },
    { file: FILE_CALCULATOR, sheet: 'params_U_wom', table: 'gamx_u_factors', gender: 'f', hasAge: true },

    // --- GAMX-A (Age 13-30) ---
    { file: FILE_CALCULATOR, sheet: 'params_iwf_men', table: 'gamx_a_factors', gender: 'm', hasAge: true },
    { file: FILE_CALCULATOR, sheet: 'params_iwf_wom', table: 'gamx_a_factors', gender: 'f', hasAge: true },

    // --- GAMX-Masters (Age 30-95) ---
    { file: FILE_CALCULATOR, sheet: 'params_mas_men', table: 'gamx_masters_factors', gender: 'm', hasAge: true },
    // Note: Inspection showed 'params_mas_wom' but let's double check if it's 'women' or 'wom' in the filename/sheet.
    // The inspection output said: "Sheet: params_mas_wom"
    { file: FILE_CALCULATOR, sheet: 'params_mas_wom', table: 'gamx_masters_factors', gender: 'f', hasAge: true },

    // --- GAMX Points (Total) ---
    { file: FILE_CALCULATOR, sheet: 'params_sen_men', table: 'gamx_points_factors', gender: 'm', hasAge: false },
    // Inspection said: "Sheet: params_sen_women" (Note 'women' vs 'wom')
    { file: FILE_CALCULATOR, sheet: 'params_sen_women', table: 'gamx_points_factors', gender: 'f', hasAge: false },

    // --- GAMX-S (Snatch) ---
    { file: FILE_SNATCH_CJ, sheet: 'snatch_sen_men', table: 'gamx_s_factors', gender: 'm', hasAge: false },
    { file: FILE_SNATCH_CJ, sheet: 'snatch_sen_wom', table: 'gamx_s_factors', gender: 'f', hasAge: false },

    // --- GAMX-J (Clean & Jerk) ---
    { file: FILE_SNATCH_CJ, sheet: 'cj_sen_men', table: 'gamx_j_factors', gender: 'm', hasAge: false },
    { file: FILE_SNATCH_CJ, sheet: 'cj_sen_wom', table: 'gamx_j_factors', gender: 'f', hasAge: false },
];

async function processSheet(workbook, item) {
    const sheet = workbook.getWorksheet(item.sheet);
    if (!sheet) {
        console.error(`  [WARN] Sheet '${item.sheet}' not found in workbook! Skipping.`);
        return;
    }

    console.log(`  Processing sheet '${item.sheet}' -> Table '${item.table}' (Gender: ${item.gender})...`);

    const rowsToInsert = [];
    const BATCH_SIZE = 1000;

    // Headers are usually row 1. Data starts row 2.
    // Inspection showed headers: [null, "age", "bmass", "mu", "sigma", "nu"] for age-based
    // And [null, "bmass", "mu", "sigma", "nu"] for weight-based.
    // NOTE: ExcelJS row.values is 1-based index usually, with index 0 often being null or empty depending on parser.
    // The inspection output showed: "Row 2: [null,7,25,39.5...]" implies index 1=age, 2=bmass...

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header

        const values = row.values;
        // values[1] is typically column A, values[2] is B, etc.

        // Check if empty row
        if (!values[1] && !values[2]) return;

        let record = {
            gender: item.gender,
            mu: null,
            sigma: null,
            nu: null,
            bodyweight: null
        };

        if (item.hasAge) {
            // Expect: Age (A), Bmass (B), Mu (C), Sigma (D), Nu (E)
            // values array: [empty, Age, Bmass, Mu, Sigma, Nu]
            record.age = values[1];
            record.bodyweight = values[2];
            record.mu = values[3];
            record.sigma = values[4];
            record.nu = values[5];
        } else {
            // Expect: Bmass (A), Mu (B), Sigma (C), Nu (D)
            // values array: [empty, Bmass, Mu, Sigma, Nu]
            record.bodyweight = values[1];
            record.mu = values[2];
            record.sigma = values[3];
            record.nu = values[4];
        }

        // Validate required fields
        if (record.bodyweight != null && record.mu != null) {
            rowsToInsert.push(record);
        }
    });

    console.log(`    Found ${rowsToInsert.length} rows. Uploading in batches...`);

    for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
        const batch = rowsToInsert.slice(i, i + BATCH_SIZE);

        // Upsert or Insert. Since table is new, insert is fine.
        // However, if run multiple times, upsert is safer?
        // We don't have a unique constraint on ID alone (it's auto gen).
        // The implementation plan created indexes on (gender, age, bodyweight).
        // BUT we did NOT create a unique constraint in the SQL migration, only plain indexes.
        // So simply inserting will duplicate data if run twice. 
        // For this task, we assume tables are empty (newly created).
        // We will just do inserts.

        const { error } = await supabase
            .from(item.table)
            .insert(batch);

        if (error) {
            fs.appendFileSync('population_error.log', `[ERROR] Table: ${item.table} Batch index ${i}: ${error.message} - Details: ${JSON.stringify(error)}\n`);
            console.error(`    [ERROR] Batch insert failed at index ${i}. See log for details.`);
            // Abort or continue? Let's continue but log.
        } else {
            // console.log(`    Inserted batch ${i} - ${i + batch.length}`);
        }

        if (i % 10000 === 0 && i > 0) process.stdout.write('.');
    }
    console.log('\n    Done.');
}

async function run() {
    console.log('Starting GAMX Population...');

    // Group items by file to avoid re-reading the big excel files multiple times
    const distinctFiles = [...new Set(WORK_ITEMS.map(i => i.file))];

    for (const filePath of distinctFiles) {
        console.log(`\nReading File: ${filePath}`);
        const absolutePath = path.resolve(__dirname, '../../', filePath);

        if (!fs.existsSync(absolutePath)) {
            console.error(`File not found: ${absolutePath}`);
            continue;
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(absolutePath);

        const itemsForFile = WORK_ITEMS.filter(i => i.file === filePath);
        for (const item of itemsForFile) {
            await processSheet(workbook, item);
        }
    }

    console.log('\nPopulation Complete!');
}

run().catch(err => console.error(err));
