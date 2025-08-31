/**
 * RESCRAPE MEET SCRIPT
 * 
 * Usage: node rescrape-meet.js <meetId>
 * Example: node rescrape-meet.js 6948
 */

const { scrapeOneMeet } = require('./scrapeOneMeet.js');

async function rescrapeMeet() {
    const meetId = process.argv[2];
    
    if (!meetId) {
        console.log('❌ Error: Please provide a meet ID');
        console.log('Usage: node rescrape-meet.js <meetId>');
        console.log('Example: node rescrape-meet.js 6948');
        process.exit(1);
    }
    
    const outputFile = `./meet_${meetId}_rescrape.csv`;
    
    console.log(`🔍 Scraping meet ${meetId}...`);
    console.log(`📄 Output file: ${outputFile}`);
    
    try {
        await scrapeOneMeet(parseInt(meetId), outputFile);
        console.log('✅ Scraping complete!');
        console.log(`📊 Results saved to: ${outputFile}`);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

rescrapeMeet();