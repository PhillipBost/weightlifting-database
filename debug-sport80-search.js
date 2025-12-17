// Debug script to analyze Sport80 search field timing and state changes
require('dotenv').config();
const puppeteer = require('puppeteer');

async function debugSearchField() {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    // Go to a sample rankings page
    const url = 'https://usaweightlifting.sport80.com/public/rankings/all?filters=eyJkYXRlX3JhbmdlX3N0YXJ0IjoiMTk5OC0wNC0xMCIsImRhdGVfcmFuZ2VfZW5kIjoiMjAyNS0wNy0xNiIsIndlaWdodF9jbGFzcyI6NzA0fQ%3D%3D';
    const athleteName = 'Jailene Silveri';
    
    console.log('Opening page...');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    
    console.log('Waiting for table to load...');
    await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const initialCount = await page.evaluate(() => {
        return document.querySelectorAll('.v-data-table__wrapper tbody tr').length;
    });
    console.log(`Initial row count: ${initialCount}`);
    
    console.log(`\nTyping "${athleteName}" and monitoring state changes...\n`);
    
    // Clear and focus
    await page.waitForSelector('.v-text-field input', { timeout: 5000 });
    await page.evaluate(() => {
        const input = document.querySelector('.v-text-field input');
        input.value = '';
        input.focus();
    });
    
    const startTime = Date.now();
    
    // Start typing
    await page.type('.v-text-field input', athleteName);
    const typingEndTime = Date.now();
    console.log(`[${((typingEndTime - startTime) / 1000).toFixed(2)}s] Finished typing`);
    
    // Monitor all state changes
    let previousCount = initialCount;
    let firstChangeTime = null;
    let lastChangeTime = null;
    let stableStartTime = null;
    let finalCount = null;
    
    console.log('\nMonitoring row count and DOM state (checking every 200ms for 30 seconds)...\n');
    
    for (let i = 0; i < 150; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        
        const currentState = await page.evaluate(() => {
            const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
            const input = document.querySelector('.v-text-field input');
            
            // Check for loading indicators
            const loadingIndicator = document.querySelector('.v-progress-linear, .v-overlay--active, .v-skeleton-loader');
            const isLoading = !!loadingIndicator;
            
            // Check table wrapper for any busy/loading classes
            const tableWrapper = document.querySelector('.v-data-table__wrapper');
            const wrapperClasses = tableWrapper ? tableWrapper.className : '';
            
            return {
                rowCount: rows.length,
                inputValue: input ? input.value : '',
                isLoading: isLoading,
                wrapperClasses: wrapperClasses
            };
        });
        
        const currentCount = currentState.rowCount;
        
        // Detect changes
        if (currentCount !== previousCount) {
            if (firstChangeTime === null) {
                firstChangeTime = Date.now();
                console.log(`[${elapsed}s] 🔄 FIRST CHANGE: ${previousCount} → ${currentCount} rows (${((firstChangeTime - typingEndTime) / 1000).toFixed(2)}s after typing)`);
            } else {
                console.log(`[${elapsed}s] 🔄 CHANGE: ${previousCount} → ${currentCount} rows`);
            }
            lastChangeTime = Date.now();
            stableStartTime = null;
        } else {
            // Count is stable
            if (stableStartTime === null && lastChangeTime !== null) {
                stableStartTime = Date.now();
            }
            
            // If stable for 2 seconds after changes started, consider it done
            if (stableStartTime && (Date.now() - stableStartTime) >= 2000 && finalCount === null) {
                finalCount = currentCount;
                const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
                const filterTime = lastChangeTime ? ((lastChangeTime - firstChangeTime) / 1000).toFixed(2) : 'N/A';
                
                console.log(`\n[${elapsed}s] ✅ STABLE: ${finalCount} rows (stable for 2s)`);
                console.log(`\n📊 TIMING SUMMARY:`);
                console.log(`   Typing completed: ${((typingEndTime - startTime) / 1000).toFixed(2)}s`);
                console.log(`   First change detected: ${firstChangeTime ? ((firstChangeTime - startTime) / 1000).toFixed(2) : 'Never'}s`);
                console.log(`   Last change detected: ${lastChangeTime ? ((lastChangeTime - startTime) / 1000).toFixed(2) : 'Never'}s`);
                console.log(`   Filtering duration: ${filterTime}s`);
                console.log(`   Total time: ${totalTime}s`);
                console.log(`   Initial rows: ${initialCount}`);
                console.log(`   Final rows: ${finalCount}`);
                
                if (finalCount === 1) {
                    const athleteData = await page.evaluate(() => {
                        const row = document.querySelector('.v-data-table__wrapper tbody tr');
                        if (row) {
                            const cells = Array.from(row.querySelectorAll('td'));
                            return cells.map(c => c.textContent.trim());
                        }
                        return null;
                    });
                    console.log(`\n✅ SUCCESS! Found athlete:`, athleteData);
                } else if (finalCount < initialCount) {
                    console.log(`\n✅ Filtering worked (reduced from ${initialCount} to ${finalCount})`);
                } else {
                    console.log(`\n⚠️  No filtering occurred (still ${finalCount} rows)`);
                }
                
                console.log('\n\nClosing browser in 5 seconds...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                break;
            }
        }
        
        previousCount = currentCount;
    }
    
    if (finalCount === null) {
        console.log('\n\n⚠️  No stable state reached after 30 seconds');
    }
    
    await browser.close();
}

debugSearchField().catch(console.error);
