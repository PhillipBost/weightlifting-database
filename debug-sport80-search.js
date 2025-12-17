// Debug script to find the correct Sport80 search field selector
require('dotenv').config();
const puppeteer = require('puppeteer');

async function debugSearchField() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Go to a sample rankings page
    const url = 'https://usaweightlifting.sport80.com/public/rankings/all?filters=eyJkYXRlX3JhbmdlX3N0YXJ0IjoiMjAwOS0wNC0xMiIsImRhdGVfcmFuZ2VfZW5kIjoiMjAyNS0wOC0yMCIsIndlaWdodF9jbGFzcyI6Nzc2fQ%3D%3D';
    
    console.log('Opening page...');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    
    console.log('Waiting for table to load...');
    await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const initialCount = await page.evaluate(() => {
        return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
    });
    console.log(`Initial row count: ${initialCount}`);
    
    console.log('\nTrying .v-text-field input selector...');
    
    try {
        await page.waitForSelector('.v-text-field input', { timeout: 5000 });
        console.log('✓ Found .v-text-field input');
        
        // Check input properties before typing
        const inputInfo = await page.evaluate(() => {
            const input = document.querySelector('.v-text-field input');
            return {
                value: input.value,
                type: input.type,
                placeholder: input.placeholder,
                id: input.id,
                className: input.className
            };
        });
        console.log('Input field before typing:', inputInfo);
        
        // Clear and type
        console.log('\nClearing input...');
        await page.evaluate(() => {
            const input = document.querySelector('.v-text-field input');
            input.value = '';
            input.focus();
        });
        
        console.log('Typing "Jace Doty"...');
        await page.type('.v-text-field input', 'Jace Doty');
        
        // Check input after typing
        const afterTyping = await page.evaluate(() => {
            const input = document.querySelector('.v-text-field input');
            return input.value;
        });
        console.log(`Input value after typing: "${afterTyping}"`);
        
        // Monitor row count changes
        console.log('\nMonitoring row count changes (checking every 500ms for 15 seconds)...');
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const count = await page.evaluate(() => {
                return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
            });
            console.log(`  [${(i * 0.5).toFixed(1)}s] Row count: ${count}`);
            
            if (count === 1) {
                console.log(`\n✅ SUCCESS! Filtered down to 1 row after ${(i * 0.5).toFixed(1)} seconds`);
                break;
            }
        }
        
        const finalCount = await page.evaluate(() => {
            return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
        });
        
        console.log(`\nFinal row count: ${finalCount}`);
        
        if (finalCount === 1) {
            console.log('\n✅ Filter worked correctly!');
            
            // Show the filtered athlete
            const athleteInfo = await page.evaluate(() => {
                const row = document.querySelector('.v-data-table__wrapper tbody tr');
                const cells = Array.from(row.querySelectorAll('td'));
                return cells.map(c => c.textContent.trim());
            });
            console.log('Athlete data:', athleteInfo);
        } else {
            console.log('\n❌ Filter did NOT work - still showing multiple rows');
            console.log('\nDumping search input events...');
            
            // Try triggering input event manually
            await page.evaluate(() => {
                const input = document.querySelector('.v-text-field input');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            });
            
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const afterEvent = await page.evaluate(() => {
                return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
            });
            console.log(`After manually triggering events: ${afterEvent} rows`);
        }
        
    } catch (err) {
        console.log(`❌ Error: ${err.message}`);
    }
    
    console.log('\n\nBrowser will stay open for manual inspection...');
    console.log('Press Ctrl+C when done.');
    await new Promise(() => {}); // Keep browser open
}

debugSearchField().catch(console.error);
