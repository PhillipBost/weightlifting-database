#!/usr/bin/env node
/**
 * IWF DIVS INSPECTOR
 * Analyzes div-based content structure
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('./iwf-config');

const OUTPUT_DIR = './output/divs-inspection';

async function inspect(eventId, year) {
    let browser = null;
    let page = null;

    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        console.log('\n' + '='.repeat(80));
        console.log('IWF DIVS INSPECTOR');
        console.log('='.repeat(80));

        browser = await puppeteer.launch({
            headless: config.BROWSER.headless,
            args: config.BROWSER.args
        });

        page = await browser.newPage();
        await page.setUserAgent(config.BROWSER.userAgent);
        await page.setViewport(config.BROWSER.viewport);

        const eventUrl = config.buildEventDetailURL(eventId, year);
        console.log(`Loading: ${eventUrl}`);

        await page.goto(eventUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('✓ Loaded');

        // Wait for content
        await new Promise(resolve => setTimeout(resolve, 8000));

        // Analyze divs
        const divAnalysis = await page.evaluate(() => {
            const analysis = {
                resultsDivs: [],
                eventDivs: [],
                allDivClasses: [],
                mainContent: null
            };

            // Find all divs with "results" in class
            document.querySelectorAll('div[class*="results"]').forEach((div, idx) => {
                if (idx < 10) {
                    analysis.resultsDivs.push({
                        index: idx,
                        class: div.className,
                        childCount: div.children.length,
                        textLength: div.textContent.length,
                        innerHTML: div.innerHTML.substring(0, 200),
                        computedStyle: window.getComputedStyle(div).display
                    });
                }
            });

            // Find all divs with "event" in class
            document.querySelectorAll('div[class*="event"]').forEach((div, idx) => {
                if (idx < 10) {
                    analysis.eventDivs.push({
                        index: idx,
                        class: div.className,
                        childCount: div.children.length,
                        textLength: div.textContent.length
                    });
                }
            });

            // All unique div classes
            const allDivs = document.querySelectorAll('div[class]');
            const classSet = new Set();
            allDivs.forEach(div => {
                if (div.className) {
                    div.className.split(' ').forEach(cls => {
                        if (cls && cls.length > 0) {
                            classSet.add(cls);
                        }
                    });
                }
            });

            // Find main content area
            const mainContent = document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('.container');
            if (mainContent) {
                analysis.mainContent = {
                    class: mainContent.className,
                    tag: mainContent.tagName,
                    childCount: mainContent.children.length,
                    html: mainContent.innerHTML.substring(0, 500)
                };
            }

            // Get body structure
            analysis.bodyChildElements = [];
            Array.from(document.body.children).forEach((child, idx) => {
                if (idx < 15) {
                    analysis.bodyChildElements.push({
                        tag: child.tagName,
                        class: child.className,
                        id: child.id
                    });
                }
            });

            return analysis;
        });

        console.log('\n' + '-'.repeat(80));
        console.log('DIV ANALYSIS');
        console.log('-'.repeat(80));

        console.log(`\nResults divs found: ${divAnalysis.resultsDivs.length}`);
        divAnalysis.resultsDivs.forEach(div => {
            console.log(`\n  Div ${div.index}:`);
            console.log(`    Class: ${div.class}`);
            console.log(`    Display: ${div.computedStyle}`);
            console.log(`    Children: ${div.childCount}, Text length: ${div.textLength}`);
            if (div.innerHTML) {
                console.log(`    HTML: ${div.innerHTML.substring(0, 100)}...`);
            }
        });

        console.log(`\n\nEvent divs found: ${divAnalysis.eventDivs.length}`);
        divAnalysis.eventDivs.forEach(div => {
            console.log(`\n  Div ${div.index}:`);
            console.log(`    Class: ${div.class}`);
            console.log(`    Children: ${div.childCount}`);
        });

        console.log(`\n\nMain content element:`);
        if (divAnalysis.mainContent) {
            console.log(`  Tag: ${divAnalysis.mainContent.tag}`);
            console.log(`  Class: ${divAnalysis.mainContent.class}`);
            console.log(`  Children: ${divAnalysis.mainContent.childCount}`);
        } else {
            console.log('  Not found');
        }

        console.log(`\n\nBody structure:`);
        divAnalysis.bodyChildElements.forEach(elem => {
            console.log(`  <${elem.tag}> ${elem.class || '(no class)'}`);
        });

        // Save analysis
        const reportPath = path.join(OUTPUT_DIR, `event_${eventId}_divs.json`);
        fs.writeFileSync(reportPath, JSON.stringify(divAnalysis, null, 2));
        console.log(`\n✓ Report saved`);

        // Save HTML for manual inspection
        const html = await page.content();
        const htmlPath = path.join(OUTPUT_DIR, `event_${eventId}_full.html`);
        fs.writeFileSync(htmlPath, html);

        await browser.close();
        console.log('\n✓ Complete\n');

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
