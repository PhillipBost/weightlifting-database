const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const FILE = 'GAMX files v2.0/GAMX_seniors_snatch_cj.xlsx';

async function run() {
    const filePath = path.resolve(__dirname, '../../', FILE);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets = workbook.worksheets.map(s => s.name);
    fs.writeFileSync('sheets.json', JSON.stringify(sheets, null, 2));
    console.log("Wrote sheets.json");
}

run().catch(console.error);
