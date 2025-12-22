/**
 * Test the updated scrapeOneMeet.js with targeted internal_id extraction
 * 
 * This test validates that the base64 lookup fallback correctly extracts
 * internal_ids for specific athletes by clicking only their rows.
 */

const fs = require('fs');
const path = require('path');
const { scrapeOneMeet } = require('./scripts/production/scrapeOneMeet.js');

async function testUpdatedScrapeOneMeet() {
    console.log('🧪 Testing updated scrapeOneMeet with targeted internal_id extraction\n');

    // Test with a small meet
    const testMeetId = 2357; // A known meet ID
    const testFile = path.join(__dirname, 'test-meet-output.csv');

    // Clean up any existing test file
    if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
        console.log('🧹 Cleaned up existing test file');
    }

    try {
        console.log(`🌐 Scraping meet ${testMeetId}...`);
        console.log('⏳ This may take a few minutes...\n');

        await scrapeOneMeet(testMeetId, testFile);

        console.log('\n✅ Scraping completed!');

        // Analyze the output
        if (!fs.existsSync(testFile)) {
            console.log('❌ Test file was not created');
            return;
        }

        const csvContent = fs.readFileSync(testFile, 'utf8');
        const lines = csvContent.split('\n').filter(line => line.trim());

        if (lines.length < 2) {
            console.log('❌ CSV file is empty or has no data');
            return;
        }

        const headers = lines[0].split('|');
        const internalIdIndex = headers.findIndex(h => h.trim() === 'Internal_ID');

        if (internalIdIndex === -1) {
            console.log('❌ Internal_ID column not found in CSV');
            return;
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 ANALYSIS:');
        console.log('='.repeat(60));
        console.log(`Total athletes: ${lines.length - 1}`);

        // Count athletes with internal_ids
        let athletesWithIds = 0;
        let athletesWithoutIds = 0;
        const sampleAthletes = [];

        for (let i = 1; i < lines.length; i++) {
            const cells = lines[i].split('|');
            const internalId = cells[internalIdIndex]?.trim();
            const athleteName = cells[3]?.trim(); // Assuming name is in column 3

            if (internalId && internalId !== 'null' && internalId !== '') {
                athletesWithIds++;
                if (sampleAthletes.length < 5) {
                    sampleAthletes.push({ name: athleteName, id: internalId });
                }
            } else {
                athletesWithoutIds++;
            }
        }

        console.log(`Athletes with internal_ids: ${athletesWithIds}`);
        console.log(`Athletes without internal_ids: ${athletesWithoutIds}`);
        console.log(`Coverage: ${Math.round(athletesWithIds / (lines.length - 1) * 100)}%`);

        if (sampleAthletes.length > 0) {
            console.log('\n📋 Sample athletes with internal_ids:');
            sampleAthletes.forEach((a, i) => {
                console.log(`  ${i + 1}. ${a.name}: ${a.id}`);
            });
        }

        console.log('='.repeat(60));

        if (athletesWithIds > 0) {
            console.log('\n✅ SUCCESS: Internal_id extraction is working!');
        } else {
            console.log('\n⚠️ WARNING: No internal_ids were extracted');
        }

    } catch (error) {
        console.error('💥 Test failed:', error.message);
        console.error(error.stack);
    } finally {
        // Clean up test file
        if (fs.existsSync(testFile)) {
            console.log('\n🧹 Cleaning up test file...');
            fs.unlinkSync(testFile);
        }
    }
}

testUpdatedScrapeOneMeet();
