#!/usr/bin/env node
/**
 * INSPECT TAB JAVASCRIPT
 * Find out what triggers data load when tabs are clicked
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const config = require('./scripts/production/iwf-config');

async function inspectTabJavaScript() {
    const eventId = '661';
    const year = 2025;
    const eventDate = '2025-10-02';

    let browser = null;

    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            headless: false,
            args: config.BROWSER.args
        });

        const page = await browser.newPage();
        await page.setUserAgent(config.BROWSER.userAgent);
        await page.setViewport(config.BROWSER.viewport);

        // Enable request interception to monitor network
        await page.setRequestInterception(true);
        const requests = [];

        page.on('request', request => {
            requests.push({
                type: 'request',
                method: request.method(),
                url: request.url(),
                timestamp: Date.now()
            });
            request.continue();
        });

        page.on('response', async response => {
            requests.push({
                type: 'response',
                status: response.status(),
                url: response.url(),
                timestamp: Date.now()
            });
        });

        const eventUrl = config.buildEventDetailURL(eventId, year, eventDate);
        console.log(`\nNavigating to: ${eventUrl}\n`);

        await page.goto(eventUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        console.log('✓ Page loaded, waiting for content...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check if tabs exist
        const tabsExist = await page.evaluate(() => {
            const tabs = document.querySelectorAll('div.single__event__filter');
            return tabs.length;
        });

        console.log(`Found ${tabsExist} tab elements`);

        // Inspect tab elements and their event handlers
        console.log('='.repeat(80));
        console.log('INSPECTING TAB ELEMENTS AND EVENT HANDLERS');
        console.log('='.repeat(80));

        const tabInfo = await page.evaluate(() => {
            const results = {
                tabs: [],
                eventListeners: [],
                jqueryEvents: [],
                clickHandlers: []
            };

            // Find all tab elements
            const tabs = document.querySelectorAll('div.single__event__filter');

            tabs.forEach((tab, idx) => {
                const tabData = {
                    index: idx,
                    dataTarget: tab.getAttribute('data-target'),
                    id: tab.id,
                    text: tab.textContent.trim(),
                    hasCurrent: tab.classList.contains('current'),
                    onclick: tab.onclick ? tab.onclick.toString() : null,
                    hasClickListener: false
                };

                // Try to get event listeners (Chrome only)
                if (typeof getEventListeners !== 'undefined') {
                    const listeners = getEventListeners(tab);
                    if (listeners.click && listeners.click.length > 0) {
                        tabData.hasClickListener = true;
                        tabData.clickListeners = listeners.click.map(l => ({
                            useCapture: l.useCapture,
                            passive: l.passive,
                            once: l.once,
                            listenerString: l.listener.toString().substring(0, 200)
                        }));
                    }
                }

                // Check for jQuery events
                if (window.jQuery) {
                    const $tab = window.jQuery(tab);
                    const events = window.jQuery._data(tab, 'events');
                    if (events && events.click) {
                        tabData.jqueryClickHandlers = events.click.length;
                    }
                }

                results.tabs.push(tabData);
            });

            // Look for global functions that might handle tab clicks
            const globalFunctions = [];
            for (const key in window) {
                if (typeof window[key] === 'function' &&
                    (key.toLowerCase().includes('tab') ||
                     key.toLowerCase().includes('filter') ||
                     key.toLowerCase().includes('result'))) {
                    globalFunctions.push({
                        name: key,
                        signature: window[key].toString().substring(0, 150)
                    });
                }
            }
            results.globalFunctions = globalFunctions;

            return results;
        });

        console.log('\nTabs Found:');
        tabInfo.tabs.forEach(tab => {
            console.log(`\n[${tab.index}] ${tab.text}`);
            console.log(`    data-target: ${tab.dataTarget}`);
            console.log(`    id: ${tab.id}`);
            console.log(`    has 'current': ${tab.hasCurrent}`);
            console.log(`    onclick attr: ${tab.onclick ? 'YES' : 'NO'}`);
            console.log(`    has click listener: ${tab.hasClickListener}`);
            if (tab.clickListeners) {
                console.log(`    Click listeners: ${tab.clickListeners.length}`);
                tab.clickListeners.forEach((l, i) => {
                    console.log(`      [${i}] ${l.listenerString}...`);
                });
            }
            if (tab.jqueryClickHandlers) {
                console.log(`    jQuery handlers: ${tab.jqueryClickHandlers}`);
            }
        });

        console.log('\n\nGlobal Functions (tab/filter/result related):');
        tabInfo.globalFunctions.forEach(fn => {
            console.log(`\n${fn.name}:`);
            console.log(`  ${fn.signature}...`);
        });

        // Now click men's tab and monitor network activity
        console.log('\n\n' + '='.repeat(80));
        console.log('CLICKING MEN\'S SNATCH/CJ TAB AND MONITORING NETWORK');
        console.log('='.repeat(80));

        const requestsBefore = requests.length;

        await page.click('div.single__event__filter[data-target="men_snatchjerk"]');
        console.log('✓ Clicked men_snatchjerk tab');

        await new Promise(resolve => setTimeout(resolve, 3000));

        const newRequests = requests.slice(requestsBefore);

        console.log(`\nNetwork activity after click (${newRequests.length} requests):`);
        newRequests.forEach(req => {
            if (req.type === 'request') {
                console.log(`  → ${req.method} ${req.url}`);
            } else {
                console.log(`  ← ${req.status} ${req.url}`);
            }
        });

        // Check if content actually changed
        const contentChanged = await page.evaluate(() => {
            const cards = document.querySelectorAll('div.card:not(.card__legend)');
            return {
                cardCount: cards.length,
                firstCardText: cards[0] ? cards[0].textContent.trim().substring(0, 100) : 'none'
            };
        });

        console.log(`\nContent after click:`);
        console.log(`  Cards found: ${contentChanged.cardCount}`);
        console.log(`  First card: ${contentChanged.firstCardText}...`);

        console.log('\n\nPress Ctrl+C to exit...');
        await new Promise(() => {});

    } catch (error) {
        console.error('Error:', error.message);
        if (browser) await browser.close();
        process.exit(1);
    }
}

inspectTabJavaScript();
