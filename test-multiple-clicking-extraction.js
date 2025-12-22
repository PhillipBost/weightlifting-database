/**
 * Test clicking extraction for multiple athletes
 * Validates that we can click multiple rows sequentially and extract all internal_ids
 */

const puppeteer = require('puppeteer');

async function testMultipleClickingExtraction() {
    console.log('🧪 Testing multiple athlete clicking extraction\n');

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1500, height: 1000 });

        const url = 'https://usaweightlifting.sport80.com/public/rankings/all?filters=eyJkYXRlX3JhbmdlX3N0YXJ0IjoiMjAxNy0wMS0wOCIsImRhdGVfcmFuZ2VfZW5kIjoiMjAxNy0wMS0xOCIsIndlaWdodF9jbGFzcyI6MzU2fQ%3D%3D';
        
        console.log(`🌐 Navigating to rankings page...`);
        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        console.log('⏳ Waiting for Vue table to render (4 seconds)...');
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Extract first 5 athletes
        const athletes = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
            
            return rows.slice(0, 5).map((row, index) => {
                const cells = Array.from(row.querySelectorAll('td'));
                const athleteName = cells[3]?.textContent?.trim() || 'Unknown';
                
                return {
                    rowIndex: index,
                    athleteName: athleteName,
                    internalId: null,
                    isClickable: row.classList.contains('row-clickable')
                };
            });
        });

        console.log(`\n📋 Testing extraction for ${athletes.length} athletes:\n`);

        // Click each athlete sequentially
        let successCount = 0;
        let failCount = 0;

        for (const athlete of athletes) {
            if (!athlete.isClickable) {
                console.log(`⚠️ ${athlete.athleteName}: Not clickable, skipping`);
                failCount++;
                continue;
            }

            try {
                console.log(`🖱️ Clicking: ${athlete.athleteName}...`);
                
                // Click and wait for navigation
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
                    page.evaluate((rowIndex) => {
                        const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                        if (rows[rowIndex]) {
                            rows[rowIndex].click();
                        }
                    }, athlete.rowIndex)
                ]);
                
                // Extract internal_id from URL
                const currentUrl = page.url();
                const match = currentUrl.match(/\/member\/(\d+)/);
                
                if (match) {
                    athlete.internalId = parseInt(match[1]);
                    console.log(`   ✅ Extracted ID: ${athlete.internalId}`);
                    successCount++;
                } else {
                    console.log(`   ❌ No ID found in URL: ${currentUrl}`);
                    failCount++;
                }
                
                // Navigate back
                await page.goBack({ waitUntil: 'networkidle0', timeout: 10000 });
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.log(`   ❌ Failed: ${error.message}`);
                failCount++;
                
                // Try to recover
                try {
                    await page.goBack({ waitUntil: 'networkidle0', timeout: 5000 });
                } catch (e) {
                    console.log(`   💥 Cannot recover, stopping test`);
                    break;
                }
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 FINAL RESULTS:');
        console.log('='.repeat(60));
        athletes.forEach((a, i) => {
            const status = a.internalId ? '✅' : '❌';
            console.log(`${status} ${i + 1}. ${a.athleteName}: ${a.internalId || 'NO ID'}`);
        });
        console.log('='.repeat(60));
        console.log(`Success: ${successCount}/${athletes.length}`);
        console.log(`Failed: ${failCount}/${athletes.length}`);
        console.log('='.repeat(60));

        if (successCount === athletes.length) {
            console.log('\n🎉 ALL TESTS PASSED! Clicking extraction works for multiple athletes.');
        } else if (successCount > 0) {
            console.log('\n⚠️ PARTIAL SUCCESS: Some extractions worked, some failed.');
        } else {
            console.log('\n❌ ALL TESTS FAILED: Clicking extraction not working.');
        }

    } catch (error) {
        console.error('💥 Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await browser.close();
    }
}

testMultipleClickingExtraction();
