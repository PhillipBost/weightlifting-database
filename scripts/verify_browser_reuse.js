
const fs = require('fs');
const path = require('path');
const { processMeetCsvFile } = require('./production/database-importer-custom');

// Mock data content
const csvContent = `Meet|Date|Age Category|Weight Class|Lifter|Body Weight (Kg)|Snatch Lift 1|Snatch Lift 2|Snatch Lift 3|Best Snatch|C&J Lift 1|C&J Lift 2|C&J Lift 3|Best C&J|Total|Club|Membership Number|Internal_ID
Test Meet 2025|2025-01-01|Open Men|81|Test Lifter One|80.5|100|105|-110|105|130|135|-140|135|240|Test Club|9999991|
Test Meet 2025|2025-01-01|Open Men|81|Test Lifter Two|80.8|100|105|-110|105|130|135|-140|135|240|Test Club|9999992|
`;

const tempCsvPath = path.join(__dirname, 'temp_verify_browser.csv');

async function runVerification() {
    try {
        console.log('📝 Creating temporary CSV file...');
        fs.writeFileSync(tempCsvPath, csvContent);

        console.log('🚀 Starting processMeetCsvFile...');
        // Mock meet ID and name
        await processMeetCsvFile(tempCsvPath, 99999, 'Test Meet Verification');

        console.log('✅ Verification execution finished.');
    } catch (error) {
        console.error('❌ Verification failed:', error);
    } finally {
        if (fs.existsSync(tempCsvPath)) {
            fs.unlinkSync(tempCsvPath);
            console.log('🧹 Cleaned up temporary CSV.');
        }
        process.exit(0);
    }
}

runVerification();
