const puppeteer = require('puppeteer');
const config = require('./scripts/production/iwf-config');

async function testPageLoad() {
    let browser = null;
    
    try {
        browser = await puppeteer.launch({
            headless: config.BROWSER.headless,
            args: config.BROWSER.args
        });

        const page = await browser.newPage();
        await page.setUserAgent(config.BROWSER.userAgent);
        await page.setViewport(config.BROWSER.viewport);

        const eventUrl = 'https://iwf.sport/results/results-by-events/?event_id=661';
        console.log('Navigating to:', eventUrl);

        await page.goto(eventUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check what tabs exist
        const tabs = await page.evaluate(() => {
            const elements = document.querySelectorAll('div.single__event__filter');
            const result = [];
            elements.forEach((el, idx) => {
                result.push({
                    index: idx,
                    classList: el.className,
                    hasCurrentClass: el.classList.contains('current'),
                    dataTarget: el.getAttribute('data-target'),
                    id: el.id,
                    text: el.textContent.substring(0, 50)
                });
            });
            return result;
        });

        console.log('Found tabs:', JSON.stringify(tabs, null, 2));

        // Check for athlete cards
        const cardCount = await page.evaluate(() => {
            return document.querySelectorAll('div.card:not(.card__legend)').length;
        });

        console.log('Athlete cards found:', cardCount);

        // Take a screenshot
        await page.screenshot({ path: 'test-page-debug.png' });
        console.log('Screenshot saved to test-page-debug.png');

        await browser.close();
    } catch (error) {
        console.error('Error:', error.message);
        if (browser) await browser.close();
    }
}

testPageLoad();
