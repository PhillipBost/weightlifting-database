const puppeteer = require('puppeteer');
const fs = require('fs');

async function debugDump() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    try {
        console.log('Navigating to events page...');
        await page.goto('https://usaweightlifting.sport80.com/public/events', { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for rows
        await page.waitForSelector('.row.no-gutters.align-center', { timeout: 15000 });
        console.log('Rows found.');

        // Dump first row info
        const firstRowHTML = await page.evaluate(() => {
            const row = document.querySelector('.row.no-gutters.align-center');
            return row ? row.outerHTML : 'NO ROW FOUND';
        });
        fs.writeFileSync('debug_meet_row.html', firstRowHTML);
        console.log('Dumped debug_meet_row.html');

        // Click the first row's expansion panel
        console.log('Clicking expansion panel...');
        await page.evaluate(() => {
            const header = document.querySelector('.v-expansion-panel-header');
            if (header) header.click();
        });

        // Wait for expansion panel content to appear
        try {
            await page.waitForSelector('.v-expansion-panel-content', { timeout: 5000 });
            await new Promise(r => setTimeout(r, 2000)); // Extra wait for content

            const expandedContent = await page.evaluate(() => {
                const content = document.querySelector('.v-expansion-panel-content');
                return content ? content.innerHTML : 'NO CONTENT FOUND';
            });
            fs.writeFileSync('debug_meet_expanded.html', expandedContent);
            console.log('Dumped debug_meet_expanded.html');
        } catch (e) {
            console.log('No expansion panel content found:', e.message);
            const fullPage = await page.content();
            fs.writeFileSync('debug_full_page.html', fullPage);
            console.log('Dumped full page instead.');
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
}

debugDump();
