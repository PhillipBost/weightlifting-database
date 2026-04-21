const puppeteer = require('puppeteer');

async function testVerification(internalId, version) {
    const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${internalId}`;
    console.log(`\n--- Testing Version: ${version} ---`);
    console.log(`🌐 URL: ${memberUrl}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    const startTime = Date.now();

    try {
        if (version === 'Current (Broken)') {
            // Version A: Current logic in database-importer.js
            await page.goto(memberUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            // Immediate evaluation after DOMContentLoaded
        } else {
            // Version B: Proposed logic
            await page.goto(memberUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            console.log('⏳ Waiting for selector .v-data-table__wrapper table tbody tr...');
            try {
                await page.waitForSelector('.v-data-table__wrapper table tbody tr', { timeout: 10000 });
                console.log('✅ Selector found. Waiting 2s for Vue hydration...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (e) {
                console.log('⚠️ Selector timeout - table might be empty or slow');
            }
        }

        const data = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper table tbody tr'));
            return rows.map(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                return {
                    name: cells[0]?.textContent?.trim(),
                    date: cells[1]?.textContent?.trim()
                };
            }).filter(r => r.name);
        });

        const duration = Date.now() - startTime;
        console.log(`⏱️  Scrape completed in ${duration}ms`);
        console.log(`📊 Found ${data.length} meet results.`);
        
        if (data.length > 0) {
            console.log(`🏆 Sample result: ${data[0].name} (${data[0].date})`);
        } else {
            console.log(`❌ NO RESULTS FOUND. Verification would FAIL and create a duplicate.`);
        }

    } catch (error) {
        console.error(`💥 Error: ${error.message}`);
    } finally {
        await browser.close();
    }
}

async function runComparison() {
    const targetInternalId = 30751; // Jake Powers
    
    console.log('🚀 Starting Isolated Verification Test');
    console.log('Target Athlete ID: ' + targetInternalId);

    // Test the "Broken" version first
    await testVerification(targetInternalId, 'Current (Broken)');
    
    // Then test the "Fixed" version
    await testVerification(targetInternalId, 'Proposed (Fixed)');
}

runComparison().catch(console.error);
