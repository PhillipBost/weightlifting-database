const puppeteer = require('puppeteer');
const config = require('./scripts/production/iwf-config');

async function testCardStructure() {
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
        console.log('Navigating and clicking men\'s snatchjerk tab...');

        await page.goto(eventUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        await page.click('div.single__event__filter[data-target="men_snatchjerk"]');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get HTML of first 2 cards
        const cardsHtml = await page.evaluate(() => {
            const cards = document.querySelectorAll('div.card:not(.card__legend)');
            const result = [];
            
            for (let i = 0; i < Math.min(2, cards.length); i++) {
                result.push({
                    index: i,
                    html: cards[i].outerHTML.substring(0, 500),
                    classList: cards[i].className,
                    childCount: cards[i].children.length
                });
            }
            
            return result;
        });

        console.log('\n=== CARD HTML STRUCTURE ===');
        console.log(JSON.stringify(cardsHtml, null, 2));

        // Try the existing extraction logic
        const extracted = await page.evaluate(() => {
            const athleteData = [];
            const athleteCards = document.querySelectorAll('div.card:not(.card__legend)');

            console.log(`Found ${athleteCards.length} cards`);

            for (let i = 0; i < Math.min(3, athleteCards.length); i++) {
                const card = athleteCards[i];
                
                const rankCol = card.querySelector('div.col-2:not(.not__cell__767)');
                const rankText = rankCol?.querySelector('p')?.textContent?.trim() || 'NO_RANK';

                const nameLink = card.querySelector('a[href*="athlete"], a[href*="athletes-bios"], a.col-md-5, a.title, a');
                const nameText = nameLink?.textContent?.trim() || 'NO_NAME';

                athleteData.push({
                    index: i,
                    rankText,
                    nameText: nameText.substring(0, 50),
                    hasNameLink: !!nameLink
                });
            }

            return athleteData;
        });

        console.log('\n=== EXTRACTED DATA ===');
        console.log(JSON.stringify(extracted, null, 2));

        await browser.close();
    } catch (error) {
        console.error('Error:', error.message);
        if (browser) await browser.close();
    }
}

testCardStructure();
