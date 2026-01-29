const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const files = [
    'GAMX files v2.0/GAMX_calculator_allages.xlsx',
    'GAMX files v2.0/GAMX_seniors_snatch_cj.xlsx'
];

async function inspectFile(filePath, stream) {
    const workbook = new ExcelJS.Workbook();
    const absolutePath = path.resolve(__dirname, '..', filePath);
    stream.write(`\n--- Inspecting: ${filePath} ---\n`);

    try {
        await workbook.xlsx.readFile(absolutePath);

        workbook.eachSheet((sheet, id) => {
            stream.write(`\nSheet: ${sheet.name}\n`);
            stream.write(`Total Rows: ${sheet.rowCount}\n`);

            // Print first 5 rows
            for (let i = 1; i <= 5; i++) {
                const row = sheet.getRow(i).values;
                // value[0] is typically empty because exceljs is 1-indexed for rows, but values array might vary
                stream.write(`Row ${i}: ${JSON.stringify(row)}\n`);
            }
        });
    } catch (err) {
        stream.write(`Error reading ${filePath}: ${err.message}\n`);
    }
}

async function run() {
    const logFile = path.resolve(__dirname, '..', 'analysis_output.txt');
    const stream = fs.createWriteStream(logFile);

    for (const file of files) {
        await inspectFile(file, stream);
    }

    stream.end();
    console.log('Analysis complete. Check analysis_output.txt');
}

run();
