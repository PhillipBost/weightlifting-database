const fs = require('fs');
const csvParser = require('csv-parser');

const CSV_FILE = '../../data/legacy/internal_ids.csv';
const JSON_FILE = '../../internal_ids.json';

async function convertCsvToJson() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CSV_FILE)) {
      console.error(`CSV file '${CSV_FILE}' does not exist!`);
      reject(new Error('CSV file not found'));
      return;
    }

    const athletes = {};
    let maxId = 0;
    let recordCount = 0;

    console.log(`Converting ${CSV_FILE} to ${JSON_FILE}...`);

    fs.createReadStream(CSV_FILE)
      .pipe(csvParser())
      .on('data', (row) => {
        // Handle both possible column names
        const id = parseInt(row['internal_id']) || parseInt(row['Athlete ID']);
        const name = row['lifter'] || row['Athlete Name'];

        if (!isNaN(id) && name && name.trim().length > 0) {
          athletes[id] = name.trim();
          if (id > maxId) {
            maxId = id;
          }
          recordCount++;
        } else {
          console.warn(`Skipping invalid row: ID=${id}, Name="${name}"`);
        }
      })
      .on('end', () => {
        // Create the JSON structure expected by the new script
        const jsonData = {
          athletes: athletes,
          failedIds: [], // Will be populated with gaps
          lastProcessedId: maxId
        };

        // Find gaps in the sequence and add them to failedIds
        const gaps = [];
        for (let i = 1; i <= maxId; i++) {
          if (!athletes[i]) {
            gaps.push(i);
          }
        }
        
        jsonData.failedIds = gaps;

        try {
          // Write the JSON file
          fs.writeFileSync(JSON_FILE, JSON.stringify(jsonData, null, 2));
          
          console.log(`✅ Conversion completed successfully!`);
          console.log(`📊 Statistics:`);
          console.log(`   - Athletes converted: ${recordCount}`);
          console.log(`   - Highest athlete ID: ${maxId}`);
          console.log(`   - JSON file created: ${JSON_FILE}`);
          console.log(`   - File size: ${(fs.statSync(JSON_FILE).size / 1024).toFixed(1)} KB`);
          
          // Show a sample of the data
          const sampleIds = Object.keys(athletes).slice(0, 5);
          console.log(`📋 Sample data:`);
          sampleIds.forEach(id => {
            console.log(`   - ID ${id}: ${athletes[id]}`);
          });
          
          // Check for any gaps in the sequence (these are now in failedIds)
          if (jsonData.failedIds.length > 0) {
            console.log(`⚠️  Found ${jsonData.failedIds.length} gaps in the sequence (added to failedIds for retry):`);
            console.log(`   First 10 gaps: ${jsonData.failedIds.slice(0, 10).join(', ')}${jsonData.failedIds.length > 10 ? '...' : ''}`);
            console.log(`   These will be automatically retried when you run the new script.`);
          } else {
            console.log(`✅ No gaps found in the sequence - perfect data!`);
          }

          resolve(jsonData);
        } catch (error) {
          console.error('Error writing JSON file:', error);
          reject(error);
        }
      })
      .on('error', (error) => {
        console.error('Error reading CSV file:', error);
        reject(error);
      });
  });
}

// Run the conversion
convertCsvToJson()
  .then(() => {
    console.log(`\n🎉 Ready to use the new JSON-based script!`);
    console.log(`The new script will automatically:`);
    console.log(`- Load your existing ${Object.keys(require('../../' + JSON_FILE).athletes).length} athletes`);
    console.log(`- Start from ID ${require('../../' + JSON_FILE).lastProcessedId + 1}`);
    console.log(`- Retry any gaps found in your data`);
  })
  .catch((error) => {
    console.error('Conversion failed:', error.message);
    process.exit(1);
  });