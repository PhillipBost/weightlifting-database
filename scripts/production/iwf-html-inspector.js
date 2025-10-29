#!/usr/bin/env node
/**
 * IWF HTML INSPECTOR - Debug Script
 * Captures HTML structure from IWF event pages for selector debugging
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('./iwf-config');

const OUTPUT_DIR = './output/html-inspection';

function parseArguments() {
    const args = process.argv.slice(2);
    const options = { eventId: null, year: null, date: null };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--event-id': options.eventId = args[i + 1]; i++; break;
            case '--year': options.year = parseInt(args[i + 1]); i++; break;
            case '--date': options.date = args[i + 1]; i++; break;
            case '--help': printHelp(); process.exit(0);
        }
    }

    if (!options.eventId || !options.year) {
        console.error('Error: --event-id and --year are required');
        process.exit(1);
    }

    return options;
}

function printHelp() {
    console.log(`Usage: node iwf-html-inspector.js --event-id 661 --year 2025`);
}

async function inspectEventHTML(eventId, year, eventDate) {
    let browser = null;
    let page = null;

    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        console.log('\n' + '='.repeat(80));
        console.log('IWF HTML INSPECTOR');
        console.log('='.repeat(80));
        console.log(`Event ID: ${eventId}, Year: ${year}`);
        console.log('='.repeat(80));

        browser = await puppeteer.launch({
            headless: config.BROWSER.headless,
            args: config.BROWSER.args
        });

        page = await browser.newPage();
        await page.setUserAgent(config.BROWSER.userAgent);
        await page.setViewport(config.BROWSER.viewport);

        const eventUrl = config.buildEventDetailURL(eventId, year, eventDate);
        console.log(`\nNavigating to: ${eventUrl}`);

        await page.goto(eventUrl, {
            waitUntil: 'networkidle0',
            timeout: config.TIMING.REQUEST_TIMEOUT_MS
        });

        console.log('✓ Page loaded');
        await new Promise(resolve => setTimeout(resolve, config.TIMING.PAGE_LOAD_DELAY_MS));

        // Analyze page structure
        console.log('\n' + '-'.repeat(80));
        console.log('PAGE STRUCTURE ANALYSIS');
        console.log('-'.repeat(80));

        const analysis = await page.evaluate(() => {
            return {
                title: document.title,
                h1Count: document.querySelectorAll('h1').length,
                h2Count: document.querySelectorAll('h2').length,
                buttonCount: document.querySelectorAll('button').length,
                divCount: document.querySelectorAll('div').length,
                tableCount: document.querySelectorAll('table').length,
                buttons: Array.from(document.querySelectorAll('button')).map(b => ({
                    text: b.textContent.substring(0, 50),
                    id: b.id,
                    class: b.className
                })),
                allText: document.body.innerText.substring(0, 500)
            };
        });

        console.log(`Page Title: ${analysis.title}`);
        console.log(`Elements: ${analysis.h1Count} h1s, ${analysis.h2Count} h2s, ${analysis.buttonCount} buttons, ${analysis.tableCount} tables`);
        
        console.log('\nButtons on page:');
        analysis.buttons.forEach((btn, idx) => {
            console.log(`  ${idx}: "${btn.text}" (id: ${btn.id || 'none'}, class: ${btn.class || 'none'})`);
        });

        console.log('\nFirst 500 chars of page text:');
        console.log(analysis.allText);

        // Save full HTML
        const html = await page.content();
        const htmlPath = path.join(OUTPUT_DIR, `event_${eventId}_raw.html`);
        fs.writeFileSync(htmlPath, html);
        console.log(`\n✓ HTML saved: ${htmlPath}`);

        // Save screenshot
        const screenshotPath = path.join(OUTPUT_DIR, `event_${eventId}.png`);
        await page.screenshot({ path: screenshotPath });
        console.log(`✓ Screenshot saved: ${screenshotPath}`);

        // Save analysis
        const analysisPath = path.join(OUTPUT_DIR, `event_${eventId}_analysis.json`);
        fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
        console.log(`✓ Analysis saved: ${analysisPath}`);

        await browser.close();
        console.log('\n✓ Complete\n');

    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (browser) await browser.close();
        process.exit(1);
    }
}

async function main() {
    const options = parseArguments();
    await inspectEventHTML(options.eventId, options.year, options.date);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { inspectEventHTML };
