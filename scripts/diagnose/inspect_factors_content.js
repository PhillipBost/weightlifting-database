require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

// Configuration
const MAIN_FILE = 'GAMX files v2.0/GAMX_calculator_allages (updated 2026-01-29).xlsx';
const SJ_FILE = 'GAMX files v2.0/GAMX_seniors_snatch_cj.xlsx';

const CHECKS = [
    { table: 'gamx_points_factors', file: MAIN_FILE, sheets: ['params_sen_men', 'params_sen_women'] },
    { table: 'gamx_s_factors', file: SJ_FILE, sheets: ['snatch_sen_men', 'snatch_sen_wom'] }, // Check if 'wom' or 'women'
    { table: 'gamx_j_factors', file: SJ_FILE, sheets: ['cj_sen_men', 'cj_sen_wom'] }
];

// Setup Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSheet(filename, sheetNames) {
    const filePath = path.resolve(__dirname, '../../', filename);
    if (!fs.existsSync(filePath)) {
        console.error(`[Excel] MISSING FILE: ${filename}`);
        return { error: 'File Missing', rows: 0 };
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    let totalRows = 0;
    for (const name of sheetNames) {
        const sheet = wb.getWorksheet(name);
        if (!sheet) {
            console.error(`[Excel] MISSING SHEET: ${name} in ${filename}`);
            // Try to list available
            console.log(`Available sheets: ${wb.worksheets.map(s => s.name).join(', ')}`);
        } else {
            // Subtract header
            const rows = Math.max(0, sheet.rowCount - 1);
            console.log(`[Excel] Sheet '${name}': ${rows} data rows`);
            totalRows += rows;
        }
    }
    return { rows: totalRows };
}

async function checkTable(tableName) {
    const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
    if (error) {
        console.error(`[DB] Error checking ${tableName}:`, error.message);
        return 0;
    }
    console.log(`[DB] Table '${tableName}': ${count} rows`);
    return count;
}

async function run() {
    console.log("--- GAMX DATA CONSISTENCY CHECK ---\n");

    for (const check of CHECKS) {
        console.log(`Checking ${check.table}...`);

        // Check DB
        const dbCount = await checkTable(check.table);

        // Check Excel
        const excelStats = await checkSheet(check.file, check.sheets);

        // Result
        const diff = excelStats.rows - dbCount;
        if (diff === 0) {
            console.log(`✅ MATCH: ${check.table} has ${dbCount} rows.`);
        } else {
            console.error(`❌ MISMATCH: ${check.table} (DB: ${dbCount}) vs Excel (${excelStats.rows}). Diff: ${Math.abs(diff)}`);
        }
        console.log("---------------------------------------------------");
    }
}

run().catch(console.error);
