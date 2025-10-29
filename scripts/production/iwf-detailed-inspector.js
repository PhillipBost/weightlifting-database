#!/usr/bin/env node
/**
 * IWF DETAILED INSPECTOR
 * Comprehensive DOM analysis with extended wait times
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('./iwf-config');

const OUTPUT_DIR = './output/detailed-inspection';

async function inspectDetailed(eventId, year) {
    let browser = null;
    let page = null;

    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        console.log('\n' + '='.repeat(80));
        console.log('IWF DETAILED INSPECTOR');
        console.log('='.repeat(80));

        browser = await puppeteer.launch({
            headless: config.BROWSER.headless,
            args: config.BROWSER.args
        });

        page = await browser.newPage();
        await page.setUserAgent(config.BROWSER.userAgent);
        await page.setViewport(config.BROWSER.viewport);

        const eventUrl = config.buildEventDetailURL(eventId, year);
        console.log(`URL: ${eventUrl}`);

        await page.goto(eventUrl, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        console.log('✓ Page loaded, waiting for dynamic content...');

        // Wait in stages
        for (let i = 0; i < 5; i++) {
            console.log(`  Waiting... ${(i + 1) * 2}s`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            const contentReady = await page.evaluate(() => {
                const tables = document.querySelectorAll('table');
                const buttons = document.querySelectorAll('button');
                const anyText = document.body.innerText.length > 0;
                return { tables: tables.length, buttons: buttons.length, hasText: anyText };
            });

            console.log(`    Tables: ${contentReady.tables}, Buttons: ${contentReady.buttons}, Text: ${contentReady.hasText}`);
        }

        // Get comprehensive page analysis
        const pageData = await page.evaluate(() => {
            const analysis = {
                title: document.title,
                tables: [],
                buttons: [],
                forms: [],
                divs_with_class: [],
                iframes: [],
                scripts: document.querySelectorAll('script').length,
                bodyHTML: document.body.innerHTML.substring(0, 2000)
            };

            // Tables
            document.querySelectorAll('table').forEach((table, idx) => {
                const rows = table.querySelectorAll('tbody tr');
                const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
                const firstRowCells = rows.length > 0 
                    ? Array.from(rows[0].querySelectorAll('td')).map(td => td.textContent.trim().substring(0, 30))
                    : [];

                analysis.tables.push({
                    index: idx,
                    id: table.id,
                    class: table.className,
                    rowCount: rows.length,
                    headers,
                    firstRow: firstRowCells
                });
            });

            // Buttons
            document.querySelectorAll('button').forEach((btn, idx) => {
                if (idx < 20) {
                    analysis.buttons.push({
                        text: btn.textContent.trim().substring(0, 50),
                        id: btn.id,
                        class: btn.className,
                        onclick: btn.onclick ? 'yes' : 'no'
                    });
                }
            });

            // Forms
            document.querySelectorAll('form').forEach((form, idx) => {
                analysis.forms.push({
                    id: form.id,
                    method: form.method,
                    action: form.action,
                    inputs: form.querySelectorAll('input').length
                });
            });

            // Divs with specific classes
            ['results', 'table', 'athlete', 'event', 'weight', 'snatch', 'clean'].forEach(keyword => {
                const divs = document.querySelectorAll(`div[class*="${keyword}"]`);
                if (divs.length > 0) {
                    analysis.divs_with_class.push({
                        keyword,
                        count: divs.length,
                        firstClass: divs[0].className
                    });
                }
            });

            // Iframes
            document.querySelectorAll('iframe').forEach((iframe, idx) => {
                analysis.iframes.push({
                    index: idx,
                    src: iframe.src,
                    id: iframe.id
                });
            });

            return analysis;
        });

        console.log('\n' + '-'.repeat(80));
        console.log('PAGE STRUCTURE');
        console.log('-'.repeat(80));
        console.log(`Title: ${pageData.title}`);
        console.log(`Tables: ${pageData.tables.length}`);
        console.log(`Buttons: ${pageData.buttons.length}`);
        console.log(`Forms: ${pageData.forms.length}`);
        console.log(`Iframes: ${pageData.iframes.length}`);
        console.log(`Scripts: ${pageData.scripts}`);

        if (pageData.tables.length > 0) {
            console.log('\nTable Details:');
            pageData.tables.forEach(table => {
                console.log(`\n  Table ${table.index}:`);
                console.log(`    ID: ${table.id}, Class: ${table.class}`);
                console.log(`    Rows: ${table.rowCount}`);
                if (table.headers.length > 0) {
                    console.log(`    Headers: ${table.headers.join(' | ')}`);
                }
                if (table.firstRow.length > 0) {
                    console.log(`    First row: ${table.firstRow.join(' | ')}`);
                }
            });
        }

        if (pageData.buttons.length > 0) {
            console.log('\nButtons (first 10):');
            pageData.buttons.slice(0, 10).forEach(btn => {
                console.log(`  "${btn.text}" (id: ${btn.id}, class: ${btn.class})`);
            });
        }

        if (pageData.divs_with_class.length > 0) {
            console.log('\nDivs with relevant classes:');
            pageData.divs_with_class.forEach(div => {
                console.log(`  ${div.keyword}: ${div.count} (${div.firstClass})`);
            });
        }

        if (pageData.iframes.length > 0) {
            console.log('\nIframes:');
            pageData.iframes.forEach(iframe => {
                console.log(`  ${iframe.index}: ${iframe.src || iframe.id}`);
            });
        }

        // Save detailed report
        const reportPath = path.join(OUTPUT_DIR, `event_${eventId}_detailed.json`);
        fs.writeFileSync(reportPath, JSON.stringify(pageData, null, 2));
        console.log(`\n✓ Report saved: ${reportPath}`);

        // Save screenshot
        const screenshotPath = path.join(OUTPUT_DIR, `event_${eventId}.png`);
        await page.screenshot({ path: screenshotPath });
        console.log(`✓ Screenshot saved: ${screenshotPath}`);

        // Save HTML
        const html = await page.content();
        const htmlPath = path.join(OUTPUT_DIR, `event_${eventId}.html`);
        fs.writeFileSync(htmlPath, html);
        console.log(`✓ HTML saved (first 100KB)`);

        await browser.close();
        console.log('\n✓ Inspection complete\n');

    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (browser) await browser.close();
        process.exit(1);
    }
}

const args = process.argv.slice(2);
const eventId = args[args.indexOf('--event-id') + 1] || '661';
const year = parseInt(args[args.indexOf('--year') + 1]) || 2025;

inspectDetailed(eventId, year);
