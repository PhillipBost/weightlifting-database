#!/usr/bin/env node
/**
 * TEST TAB STRUCTURE - Inspect HTML after clicking Snatch/C&J tab
 */

require('dotenv').config();
const fs = require('fs');
const puppeteer = require('puppeteer');
const config = require('./scripts/production/iwf-config');

async function inspectTabStructure() {
    const eventId = '661';
    const year = 2025;
    const eventDate = '2025-10-02';

    let browser = null;

    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            headless: false,  // Show browser so we can see what's happening
            args: config.BROWSER.args
        });

        const page = await browser.newPage();
        await page.setUserAgent(config.BROWSER.userAgent);
        await page.setViewport(config.BROWSER.viewport);

        const eventUrl = config.buildEventDetailURL(eventId, year, eventDate);
        console.log(`Navigating to: ${eventUrl}`);

        await page.goto(eventUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('✓ Page loaded\n');

        // Click men's Snatch/C&J tab
        console.log('Clicking Men\'s Snatch, Clean & Jerk tab...');
        const menTabSelector = 'div.single__event__filter[data-target="men_snatchjerk"]';

        await page.click(menTabSelector);
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('✓ Clicked\n');

        // Extract structure of athlete cards
        console.log('Analyzing athlete card structure...\n');
        const cardStructure = await page.evaluate(() => {
            const cards = document.querySelectorAll('div.card:not(.card__legend)');

            if (cards.length === 0) {
                return { error: 'No athlete cards found' };
            }

            // Analyze first card in detail
            const firstCard = cards[0];

            const analysis = {
                totalCards: cards.length,
                cardHTML: firstCard.outerHTML,
                cardClasses: firstCard.className,

                // Try to find all column divs
                columns: [],
                rows: [],
                strongTags: [],
                allText: firstCard.textContent.trim()
            };

            // Get all divs with col- classes
            const colDivs = firstCard.querySelectorAll('[class*="col-"]');
            colDivs.forEach((div, idx) => {
                analysis.columns.push({
                    index: idx,
                    className: div.className,
                    text: div.textContent.trim().substring(0, 50)
                });
            });

            // Get all row divs
            const rowDivs = firstCard.querySelectorAll('div.row');
            rowDivs.forEach((div, idx) => {
                analysis.rows.push({
                    index: idx,
                    className: div.className,
                    text: div.textContent.trim().substring(0, 100)
                });
            });

            // Get all strong tags
            const strongs = firstCard.querySelectorAll('strong');
            strongs.forEach((strong, idx) => {
                analysis.strongTags.push({
                    index: idx,
                    text: strong.textContent.trim(),
                    parent: strong.parentElement.className
                });
            });

            return analysis;
        });

        console.log('CARD STRUCTURE ANALYSIS:');
        console.log('='.repeat(80));
        console.log(`Total Cards: ${cardStructure.totalCards}`);
        console.log(`\nCard Classes: ${cardStructure.cardClasses}`);
        console.log(`\nColumns (div[class*="col-"]):`);
        cardStructure.columns?.forEach(col => {
            console.log(`  [${col.index}] ${col.className}: "${col.text}"`);
        });
        console.log(`\nRows (div.row):`);
        cardStructure.rows?.forEach(row => {
            console.log(`  [${row.index}] ${row.className}: "${row.text}"`);
        });
        console.log(`\nStrong Tags:`);
        cardStructure.strongTags?.forEach(tag => {
            console.log(`  [${tag.index}] "${tag.text}" (parent: ${tag.parent})`);
        });

        // Save HTML
        const outputDir = './output/tab-structure';
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(
            `${outputDir}/card-structure.json`,
            JSON.stringify(cardStructure, null, 2)
        );

        console.log(`\n✓ Full analysis saved to: ${outputDir}/card-structure.json`);
        console.log('\nPress Ctrl+C to exit and close browser...');

        // Keep browser open for manual inspection
        await new Promise(() => {});

    } catch (error) {
        console.error('Error:', error.message);
        if (browser) await browser.close();
        process.exit(1);
    }
}

inspectTabStructure();
