const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const FILE = 'GAMX files v2.0/GAMX_calculator_allages (updated 2026-01-29).xlsx';

async function run() {
    const filePath = path.resolve(__dirname, '../../', FILE);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return;
    }

    console.log(`Reading: ${FILE}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    console.log("Sheets found:");
    workbook.worksheets.forEach(sheet => {
        console.log(` - ${sheet.name} (Rows: ${sheet.rowCount})`);
    });
}

run().catch(console.error);
