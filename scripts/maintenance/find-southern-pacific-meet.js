// Find meet_id for 2019 Southern Pacific LWC Championship
// Search Sport80 event list for the meet

const puppeteer = require('puppeteer');

async function findMeet() {
    console.log('🔍 Searching for 2019 Southern Pacific LWC Championship on Sport80...\n');
    
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Go to events list page
    const eventsUrl = 'https://usaweightlifting.sport80.com/public/rankings/events';
    console.log(`Navigating to: ${eventsUrl}\n`);
    
    await page.goto(eventsUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Search for "Southern Pacific LWC"
    console.log('Searching for "Southern Pacific LWC 2019"...\n');
    
    await page.waitForSelector('input[placeholder="Search"]', { timeout: 5000 });
    await page.click('input[placeholder="Search"]');
    await page.keyboard.type('Southern Pacific LWC 2019', { delay: 50 });
    
    // Wait for filter to apply
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Extract meets from the table
    const meets = await page.evaluate(() => {
        const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
        const results = [];
        
        for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
                const meetName = cells[0]?.textContent.trim();
                const date = cells[1]?.textContent.trim();
                const level = cells[2]?.textContent.trim();
                
                // Try to find the meet_id from the link
                const link = cells[0]?.querySelector('a');
                let meetId = null;
                if (link) {
                    const href = link.getAttribute('href');
                    const match = href?.match(/\/results\/(\d+)/);
                    if (match) {
                        meetId = match[1];
                    }
                }
                
                results.push({
                    meetName,
                    date,
                    level,
                    meetId
                });
            }
        }
        
        return results;
    });
    
    console.log(`Found ${meets.length} meet(s):\n`);
    meets.forEach(meet => {
        console.log(`Meet Name: ${meet.meetName}`);
        console.log(`Date: ${meet.date}`);
        console.log(`Level: ${meet.level}`);
        console.log(`Meet ID: ${meet.meetId || 'Not found'}`);
        console.log('');
    });
    
    // Find the specific November 2019 meet
    const targetMeet = meets.find(m => 
        m.meetName?.includes('Southern Pacific') && 
        m.meetName?.includes('LWC') &&
        m.date?.includes('2019') &&
        m.date?.includes('Nov')
    );
    
    if (targetMeet) {
        console.log('✅ Target meet found!');
        console.log(`   Meet ID: ${targetMeet.meetId}`);
        console.log(`   Name: ${targetMeet.meetName}`);
        console.log(`   Date: ${targetMeet.date}`);
    } else {
        console.log('❌ Target meet not found in search results');
    }
    
    console.log('\n👀 Browser will stay open for 30 seconds for you to inspect...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    await browser.close();
}

findMeet().catch(console.error);
