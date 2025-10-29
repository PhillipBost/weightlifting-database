const puppeteer = require('puppeteer');
const config = require('./scripts/production/iwf-config');

async function testWomenData() {
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
        console.log('Loading and analyzing women\'s tab data...\n');

        await page.goto(eventUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Click men's tab and get first 3 names
        await page.click('div.single__event__filter[data-target="men_snatchjerk"]');
        await new Promise(resolve => setTimeout(resolve, 1500));

        const menNames = await page.evaluate(() => {
            const cards = document.querySelectorAll('div.card:not(.card__legend)');
            const names = [];
            for (let i = 0; i < Math.min(5, cards.length); i++) {
                const nameLink = cards[i].querySelector('a.col-md-5.title, a[href*="athlete"]');
                if (nameLink) {
                    names.push(nameLink.textContent.trim());
                }
            }
            return names;
        });

        console.log('MEN\'S ATHLETES (first 5):');
        menNames.forEach((n, i) => console.log(`  ${i+1}. ${n}`));

        // Click women's tab and get first 3 names
        await page.click('div.single__event__filter[data-target="women_snatchjerk"]');
        await new Promise(resolve => setTimeout(resolve, 1500));

        const womenNames = await page.evaluate(() => {
            const cards = document.querySelectorAll('div.card:not(.card__legend)');
            const names = [];
            for (let i = 0; i < Math.min(5, cards.length); i++) {
                const nameLink = cards[i].querySelector('a.col-md-5.title, a[href*="athlete"]');
                if (nameLink) {
                    names.push(nameLink.textContent.trim());
                }
            }
            return names;
        });

        console.log('\nWOMEN\'S ATHLETES (first 5):');
        womenNames.forEach((n, i) => console.log(`  ${i+1}. ${n}`));

        console.log('\nAre they identical?', JSON.stringify(menNames) === JSON.stringify(womenNames));

        await browser.close();
    } catch (error) {
        console.error('Error:', error.message);
        if (browser) await browser.close();
    }
}

testWomenData();
