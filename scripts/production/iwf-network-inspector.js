#!/usr/bin/env node
/**
 * IWF NETWORK INSPECTOR
 * Captures network requests to understand API endpoints
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('./iwf-config');

const OUTPUT_DIR = './output/network-inspection';

async function inspectNetwork(eventId, year) {
    let browser = null;
    let page = null;

    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        console.log('\nCapturing network requests...\n');

        browser = await puppeteer.launch({
            headless: config.BROWSER.headless,
            args: config.BROWSER.args
        });

        page = await browser.newPage();
        const requests = [];
        const responses = [];

        // Capture all requests
        page.on('request', request => {
            requests.push({
                url: request.url(),
                method: request.method(),
                resourceType: request.resourceType()
            });
        });

        // Capture all responses
        page.on('response', response => {
            responses.push({
                url: response.url(),
                status: response.status(),
                contentType: response.headers()['content-type']
            });
        });

        const eventUrl = config.buildEventDetailURL(eventId, year);
        console.log(`Navigating to: ${eventUrl}`);

        await page.goto(eventUrl, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        console.log('✓ Page loaded');
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('\n' + '='.repeat(80));
        console.log('NETWORK REQUESTS');
        console.log('='.repeat(80));

        const apiRequests = requests.filter(r => 
            r.url.includes('api') || 
            r.url.includes('ajax') || 
            r.url.includes('graphql') ||
            r.resourceType === 'xhr'
        );

        console.log(`\nTotal requests: ${requests.length}`);
        console.log(`API/AJAX requests: ${apiRequests.length}\n`);

        apiRequests.forEach(req => {
            console.log(`${req.method} ${req.url}`);
        });

        // Save request data
        const data = {
            eventId,
            year,
            timestamp: new Date().toISOString(),
            totalRequests: requests.length,
            apiRequests: apiRequests
        };

        const reportPath = path.join(OUTPUT_DIR, `event_${eventId}_network.json`);
        fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
        console.log(`\n✓ Report saved: ${reportPath}`);

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

inspectNetwork(eventId, year);
