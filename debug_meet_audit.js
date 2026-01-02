const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });
    const url = 'https://usaweightlifting.sport80.com/public/rankings/results/2388';
    console.log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle0' });

    // Screenshot
    await page.screenshot({ path: 'meet_page_debug.png' });
    console.log('Saved screenshot to meet_page_debug.png');

    // Dump typical selectors
    const tables = await page.evaluate(() => document.querySelectorAll('table').length);
    const rows = await page.evaluate(() => document.querySelectorAll('tr').length);
    const vCards = await page.evaluate(() => document.querySelectorAll('.v-card').length);
    const dataTables = await page.evaluate(() => document.querySelectorAll('.v-data-table').length);

    const headers = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('thead th')).map(th => th.innerText);
    });
    console.log("Headers:");
    console.log(JSON.stringify(headers, null, 2));

    const rowTexts = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.v-data-table tr'));
        return rows.slice(0, 10).map(r => r.innerText);
    });
    console.log("First 10 Rows:");
    console.log(JSON.stringify(rowTexts, null, 2));

    await browser.close();
})();
