/**
 * Test the clicking-based internal_id extraction logic
 * 
 * This test validates that the updated scrapeDivisionRankings function
 * can successfully extract internal_ids by clicking clickable rows.
 * 
 * Test URL: https://usaweightlifting.sport80.com/public/rankings/all?filters=eyJkYXRlX3JhbmdlX3N0YXJ0IjoiMjAxNy0wMS0wOCIsImRhdGVfcmFuZ2VfZW5kIjoiMjAxNy0wMS0xOCIsIndlaWdodF9jbGFzcyI6MzU2fQ%3D%3D
 */

const puppeteer = require('puppeteer');

// Date utility functions
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Build rankings URL
function buildRankingsURL(divisionCode, startDate, endDate) {
    const filters = {
        date_range_start: formatDate(startDate),
        date_range_end: formatDate(endDate),
        weight_class: divisionCode
    };

    const jsonStr = JSON.stringify(filters);
    const base64Encoded = Buffer.from(jsonStr).toString('base64');

    return `https://usaweightlifting.sport80.com/public/rankings/all?filters=${encodeURIComponent(base64Encoded)}`;
}

async function testClickingExtraction() {
    console.log('🧪 Testing clicking-based internal_id extraction\n');

    const browser = await puppeteer.launch({
        headless: false, // Show browser for debugging
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1500, height: 1000 });

        // Use the test URL from user
        const url = 'https://usaweightlifting.sport80.com/public/rankings/all?filters=eyJkYXRlX3JhbmdlX3N0YXJ0IjoiMjAxNy0wMS0wOCIsImRhdGVfcmFuZ2VfZW5kIjoiMjAxNy0wMS0xOCIsIndlaWdodF9jbGFzcyI6MzU2fQ%3D%3D';
        
        console.log(`🌐 Navigating to: ${url}`);
        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for Vue table to render (4+ seconds as user requested)
        console.log('⏳ Waiting for Vue table to render (4 seconds)...');
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Extract initial athlete data
        console.log('\n📊 Extracting athlete data...');
        const athletes = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
            
            return rows.slice(0, 3).map((row, index) => { // Test first 3 rows only
                const cells = Array.from(row.querySelectorAll('td'));
                const athleteName = cells[3]?.textContent?.trim() || 'Unknown';
                
                // Check for direct link
                const nameCell = cells[3];
                const link = nameCell?.querySelector('a[href*="/member/"]');
                let internalId = null;
                if (link) {
                    const href = link.getAttribute('href');
                    const match = href.match(/\/member\/(\d+)/);
                    if (match) {
                        internalId = parseInt(match[1]);
                    }
                }
                
                return {
                    rowIndex: index,
                    athleteName: athleteName,
                    internalId: internalId,
                    isClickable: row.classList.contains('row-clickable'),
                    rowClasses: row.className
                };
            });
        });

        console.log('\n📋 Initial athlete data:');
        athletes.forEach((a, i) => {
            console.log(`  ${i + 1}. ${a.athleteName}`);
            console.log(`     - Clickable: ${a.isClickable}`);
            console.log(`     - Direct link ID: ${a.internalId || 'NONE'}`);
            console.log(`     - Row classes: "${a.rowClasses}"`);
        });

        // Test clicking extraction on first athlete only
        const testAthlete = athletes[0];
        if (testAthlete.isClickable && !testAthlete.internalId) {
            console.log(`\n🖱️ Testing click extraction on: ${testAthlete.athleteName}`);
            
            try {
                // Click the row and wait for navigation
                console.log('   ⏳ Clicking row and waiting for navigation...');
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
                    page.evaluate((rowIndex) => {
                        const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                        if (rows[rowIndex]) {
                            rows[rowIndex].click();
                        }
                    }, testAthlete.rowIndex)
                ]);
                
                // Extract internal_id from destination URL
                const currentUrl = page.url();
                console.log(`   📍 Navigated to: ${currentUrl}`);
                
                const match = currentUrl.match(/\/member\/(\d+)/);
                if (match) {
                    const extractedId = parseInt(match[1]);
                    console.log(`   ✅ SUCCESS: Extracted internal_id ${extractedId}`);
                    testAthlete.internalId = extractedId;
                } else {
                    console.log(`   ❌ FAILED: No internal_id found in URL`);
                }
                
                // Navigate back
                console.log('   ⏳ Navigating back to rankings page...');
                await page.goBack({ waitUntil: 'networkidle0', timeout: 10000 });
                await new Promise(resolve => setTimeout(resolve, 2000));
                console.log('   ✅ Successfully navigated back');
                
            } catch (error) {
                console.log(`   ❌ Click extraction failed: ${error.message}`);
            }
        } else if (!testAthlete.isClickable) {
            console.log(`\n⚠️ Row is not clickable - cannot test clicking extraction`);
        } else if (testAthlete.internalId) {
            console.log(`\n✅ Row already has internal_id from direct link: ${testAthlete.internalId}`);
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 TEST RESULTS:');
        console.log('='.repeat(60));
        console.log(`Athlete: ${testAthlete.athleteName}`);
        console.log(`Clickable: ${testAthlete.isClickable}`);
        console.log(`Internal ID: ${testAthlete.internalId || 'NOT EXTRACTED'}`);
        console.log(`Status: ${testAthlete.internalId ? '✅ SUCCESS' : '❌ FAILED'}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('💥 Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await browser.close();
    }
}

testClickingExtraction();
