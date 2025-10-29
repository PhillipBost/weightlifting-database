#!/usr/bin/env node
/**
 * Extract and display the exact HTML structure of results divs
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('./iwf-config');

async function inspect(eventId, year) {
    let browser = null;
    let page = null;

    try {
        const OUTPUT_DIR = './output/final-inspection';
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        browser = await puppeteer.launch({
            headless: config.BROWSER.headless,
            args: config.BROWSER.args
        });

        page = await browser.newPage();
        await page.setUserAgent(config.BROWSER.userAgent);
        await page.setViewport(config.BROWSER.viewport);

        const eventUrl = config.buildEventDetailURL(eventId, year);
        console.log(`Loading event ${eventId}...`);

        await page.goto(eventUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 8000));

        const resultsHTML = await page.evaluate(() => {
            const container = document.querySelector('div.results__container');
            const results = document.querySelector('div.results');
            
            return {
                container: container ? container.outerHTML.substring(0, 5000) : 'NOT FOUND',
                resultsDiv: results ? results.outerHTML.substring(0, 5000) : 'NOT FOUND',
                containerHTML: container ? container.innerHTML.substring(0, 5000) : null,
                resultsInnerHTML: results ? results.innerHTML.substring(0, 5000) : null
            };
        });

        // Save HTML
        const htmlPath = path.join(OUTPUT_DIR, `event_${eventId}_results_html.json`);
        fs.writeFileSync(htmlPath, JSON.stringify(resultsHTML, null, 2));

        console.log('\n' + '='.repeat(80));
        console.log('RESULTS CONTAINER HTML');
        console.log('='.repeat(80) + '\n');
        console.log(resultsHTML.container);

        console.log('\n' + '='.repeat(80));
        console.log('RESULTS DIV HTML');
        console.log('='.repeat(80) + '\n');
        console.log(resultsHTML.resultsDiv);

        console.log('\n✓ Full HTML saved to: ' + htmlPath);

        await browser.close();

    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (browser) await browser.close();
        process.exit(1);
    }
}

const args = process.argv.slice(2);
const eventId = args[args.indexOf('--event-id') + 1] || '661';
const year = parseInt(args[args.indexOf('--year') + 1]) || 2025;

inspect(eventId, year);
