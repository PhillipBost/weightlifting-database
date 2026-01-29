const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Configuration
const EXCEL_FILE = 'GAMX files v2.0/GAMX_calculator_allages.xlsx';
const OUTPUT_FILE = 'migrations/seed_gamx_factors.sql';

// Map Sheet Names to Table Names
// Note: Verification of sheet names needed. Assuming standard names based on file content observation previously.
// Based on "inspect_gamx_formula.js" output, we saw sheet 'GAMX'. 
// We need to find the "params" sheets. 
// Common naming: "params_U_men", "params_U_wom", "params_iwf_men" (A), "params_mas_men", "params_sen_men" (Total)
// Let's try to detect them.

const TABLE_MAP = {
    'params_U_men': { table: 'gamx_u_factors', gender: 'm', type: 'age' },
    'params_U_wom': { table: 'gamx_u_factors', gender: 'f', type: 'age' },
    'params_iwf_men': { table: 'gamx_a_factors', gender: 'm', type: 'age' }, // "A" usually maps to IWF/Junior/Senior gen check
    'params_iwf_wom': { table: 'gamx_a_factors', gender: 'f', type: 'age' },
    'params_mas_men': { table: 'gamx_masters_factors', gender: 'm', type: 'age' },
    'params_mas_wom': { table: 'gamx_masters_factors', gender: 'f', type: 'age' },
    'params_sen_men': { table: 'gamx_points_factors', gender: 'm', type: 'weight' },
    'params_sen_wom': { table: 'gamx_points_factors', gender: 'f', type: 'weight' },
    'snatch_sen_men': { table: 'gamx_s_factors', gender: 'm', type: 'weight' },
    'snatch_sen_wom': { table: 'gamx_s_factors', gender: 'f', type: 'weight' },
    'cj_sen_men': { table: 'gamx_j_factors', gender: 'm', type: 'weight' },
    'cj_sen_wom': { table: 'gamx_j_factors', gender: 'f', type: 'weight' }
};

// SQL Header
let sqlOutput = `-- Seed Data for GAMX Factors
-- Generated from ${EXCEL_FILE}

BEGIN;

TRUNCATE TABLE gamx_u_factors, gamx_a_factors, gamx_masters_factors, gamx_points_factors, gamx_s_factors, gamx_j_factors RESTART IDENTITY;

`;

async function run() {
    const filePath = path.resolve(__dirname, '../../', EXCEL_FILE);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    console.log(`Reading Excel file: ${filePath}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    // Iterate through mapped sheets
    for (const [sheetName, config] of Object.entries(TABLE_MAP)) {
        const sheet = workbook.getWorksheet(sheetName);
        if (!sheet) {
            console.warn(`Warning: Sheet '${sheetName}' not found in workbook.`);
            continue;
        }

        console.log(`Processing sheet: ${sheetName} -> ${config.table} (${config.gender})`);

        let rowCount = 0;
        let batchValues = [];

        // Iterate rows (skip header, start row 2 usually)
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            // Extract values
            // AGE tables: usually Col A=Age, Col B=Bodyweight, C=Mu, D=Sigma, E=Nu?
            // WEIGHT tables: Col A=Bodyweight, B=Mu, C=Sigma, D=Nu?
            // Need to verify column index.
            // Assumption:
            // Age Type: 1:Age, 2:BW, 3:Mu, 4:Sigma, 5:Nu
            // Weight Type: 1:BW, 2:Mu, 3:Sigma, 4:Nu

            let age = null;
            let bw, mu, sigma, nu;

            if (config.type === 'age') {
                const cellAge = row.getCell(1).value;
                const cellBw = row.getCell(2).value;
                // If cell value is object (formula), take result? usually simple values
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

            // Cleanup
            if (mu && typeof mu === 'object') mu = mu.result;
            if (sigma && typeof sigma === 'object') sigma = sigma.result;
            if (nu && typeof nu === 'object') nu = nu.result;

            // Validate
            if (bw == null || mu == null) return;

            // For Age tables, Age must be present
            if (config.type === 'age' && age == null) return;

            // Add to batch
            if (config.type === 'age') {
                batchValues.push(`('${config.gender}', ${age}, ${Number(bw).toFixed(1)}, ${mu}, ${sigma}, ${nu})`);
            } else {
                batchValues.push(`('${config.gender}', ${Number(bw).toFixed(1)}, ${mu}, ${sigma}, ${nu})`);
            }

            rowCount++;
        });

        if (batchValues.length > 0) {
            // Generating chunks of inserts to avoid huge query string issues
            const CHUNK_SIZE = 5000;
            for (let i = 0; i < batchValues.length; i += CHUNK_SIZE) {
                const chunk = batchValues.slice(i, i + CHUNK_SIZE);
                let insertStmt = '';
                if (config.type === 'age') {
                    insertStmt = `INSERT INTO ${config.table} (gender, age, bodyweight, mu, sigma, nu) VALUES \n`;
                } else {
                    insertStmt = `INSERT INTO ${config.table} (gender, bodyweight, mu, sigma, nu) VALUES \n`;
                }
                insertStmt += chunk.join(',\n') + ';\n';
                sqlOutput += insertStmt;
            }
            console.log(`  -> Extracted ${rowCount} rows.`);
        }
    }

    sqlOutput += '\nCOMMIT;';

    fs.writeFileSync(path.resolve(__dirname, '../../', OUTPUT_FILE), sqlOutput);
    console.log(`\nSuccess! Seed script written to ${OUTPUT_FILE}`);
}

run().catch(console.error);
