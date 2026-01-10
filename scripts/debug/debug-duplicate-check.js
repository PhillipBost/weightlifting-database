require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { scrapeOneMeet } = require('../production/scrapeOneMeet');

async function run() {
    const meetId = 1805;
    const tempFile = path.join(__dirname, `temp_${meetId}.csv`);

    console.log(`Scraping meet ${meetId} to ${tempFile}...`);
    try {
        await scrapeOneMeet(meetId, tempFile);
        console.log(`Scrape complete.`);

        if (!fs.existsSync(tempFile)) {
            console.error('File was not created.');
            return;
        }

        const content = fs.readFileSync(tempFile, 'utf8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);

        if (lines.length < 2) {
            console.log('No data found.');
            return;
        }

        const headers = lines[0];
        console.log(`Headers: ${headers}`);

        const rows = lines.slice(1);
        console.log(`Found ${rows.length} rows.`);

        // Find duplicates
        const map = new Map();
        const duplicates = [];

        rows.forEach((row, index) => {
            // we use the whole row string as key for exact duplicate detection
            const key = row.trim();
            if (map.has(key)) {
                duplicates.push({
                    originalIndex: map.get(key),
                    duplicateIndex: index,
                    content: row
                });
            } else {
                map.set(key, index);
            }
        });

        if (duplicates.length > 0) {
            console.log(`Found ${duplicates.length} duplicate rows:`);
            duplicates.forEach(d => {
                console.log(`Row ${d.duplicateIndex + 2} is duplicate of Row ${d.originalIndex + 2}`);
                console.log(`Content: ${d.content}`);
            });
        } else {
            console.log('No exact duplicates found.');
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

run();
