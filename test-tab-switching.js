const puppeteer = require('puppeteer');
const config = require('./scripts/production/iwf-config');

async function testTabSwitching() {
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

        // Initial tab info
        console.log('\n=== INITIAL STATE ===');
        let currentTab = await page.evaluate(() => {
            const active = document.querySelector('div.single__event__filter.current');
            return {
                text: active?.textContent.trim(),
                dataTarget: active?.getAttribute('data-target'),
                cardCount: document.querySelectorAll('div.card:not(.card__legend)').length
            };
        });
        console.log('Current tab:', currentTab);

        // Try clicking men's snatchjerk
        console.log('\n=== CLICKING MEN\'S SNATCH, CLEAN & JERK ===');
        const menSelector = 'div.single__event__filter[data-target="men_snatchjerk"]';
        
        try {
            await page.waitForSelector(menSelector, { timeout: 3000 });
            console.log('✓ Selector found');
            
            await page.click(menSelector);
            console.log('✓ Clicked');
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            currentTab = await page.evaluate(() => {
                const active = document.querySelector('div.single__event__filter.current');
                return {
                    text: active?.textContent.trim(),
                    dataTarget: active?.getAttribute('data-target'),
                    cardCount: document.querySelectorAll('div.card:not(.card__legend)').length
                };
            });
            
            console.log('After click:', currentTab);
            
            // Check structure of first card
            const firstCard = await page.evaluate(() => {
                const card = document.querySelector('div.card:not(.card__legend)');
                if (!card) return 'NO CARDS';
                
                return {
                    text: card.textContent.substring(0, 100),
                    hasNameLink: !!card.querySelector('a[href*="athlete"]'),
                    children: card.children.length
                };
            });
            
            console.log('First card:', firstCard);
            
        } catch (e) {
            console.error('Error clicking men tab:', e.message);
        }

        // Try clicking women's snatchjerk
        console.log('\n=== CLICKING WOMEN\'S SNATCH, CLEAN & JERK ===');
        const womenSelector = 'div.single__event__filter[data-target="women_snatchjerk"]';
        
        try {
            await page.waitForSelector(womenSelector, { timeout: 3000 });
            console.log('✓ Selector found');
            
            await page.click(womenSelector);
            console.log('✓ Clicked');
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            currentTab = await page.evaluate(() => {
                const active = document.querySelector('div.single__event__filter.current');
                return {
                    text: active?.textContent.trim(),
                    dataTarget: active?.getAttribute('data-target'),
                    cardCount: document.querySelectorAll('div.card:not(.card__legend)').length
                };
            });
            
            console.log('After click:', currentTab);
            
        } catch (e) {
            console.error('Error clicking women tab:', e.message);
        }

        await browser.close();
    } catch (error) {
        console.error('Error:', error.message);
        if (browser) await browser.close();
    }
}

testTabSwitching();
