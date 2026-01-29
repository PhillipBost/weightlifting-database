const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function run() {
    // Try to find the file
    const possiblePaths = [
        'GAMX files v2.0/GAMX_calculator_allages.xlsx',
        '../GAMX files v2.0/GAMX_calculator_allages.xlsx',
        '../../GAMX files v2.0/GAMX_calculator_allages.xlsx'
    ];

    let filePath = null;
    for (const p of possiblePaths) {
        const abs = path.resolve(p);
        if (fs.existsSync(abs)) {
            filePath = abs;
            break;
        }
    }

    if (!filePath) {
        console.error('Could not find GAMX_calculator_allages.xlsx in standard locations.');
        return;
    }

    console.log(`Reading file: ${filePath}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheet = workbook.getWorksheet('GAMX');
    if (!sheet) {
        console.error('Sheet GAMX not found');
        return;
    }

    // Based on Excel inspection, Row 2 is typically the calculation row matching cell B2 input
    const row = sheet.getRow(2);

    let logOutput = '';
    const log = (msg) => { console.log(msg); logOutput += msg + '\n'; };

    log('--- Cell Values & Formulas ---');
    // Check Columns G(7) to L(12)
    for (let i = 7; i <= 12; i++) {
        const cell = row.getCell(i);
        const address = cell.address;
        log(`Cell ${address}:`);
        if (cell.formula) {
            log(`  Formula: ${cell.formula}`);
        }
        if (cell.result) { // Cached result
            log(`  Result: ${JSON.stringify(cell.result)}`);
        }
        if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
            log(`  Formula Obj: ${cell.value.formula}`);
        }
    }
    fs.writeFileSync('formula_output.txt', logOutput);
}

run();
