/**
 * Test extraction of Eli Smith from page 3
 * This is the REAL test - can we extract internal_id for an athlete on page 3?
 */

const puppeteer = require('puppeteer');

async function testEliSmithPage3() {
    console.log('🧪 Testing Eli Smith extraction from page 3\n');

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

        // Navigate to page 3
        console.log('\n📄 Navigating to page 3...');
        
        // Click next button twice to get to page 3
        for (let i = 1; i <= 2; i++) {
            console.log(`   Clicking next (page ${i} → ${i + 1})...`);
            
            const nextButtonExists = await page.evaluate(() => {
                const nextBtn = document.querySelector('.v-data-footer__icons-after button:not([disabled])');
                if (nextBtn) {
                    nextBtn.click();
                    return true;
                }
                return false;
            });

            if (!nextButtonExists) {
                console.log(`   ❌ Next button not found or disabled`);
                return;
            }

            // Wait for page to load
            await new Promise(resolve => setTimeout(resolve, 4000));
            await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 10000 });
        }

        console.log('   ✅ Reached page 3');

        // Find Eli Smith on page 3
        console.log('\n🔍 Looking for Eli Smith on page 3...');
        
        const eliSmithData = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
            
            for (let index = 0; index < rows.length; index++) {
                const row = rows[index];
                const cells = Array.from(row.querySelectorAll('td'));
                const athleteName = cells[3]?.textContent?.trim() || '';
                
                if (athleteName.toLowerCase().includes('eli smith') || 
                    'eli smith'.includes(athleteName.toLowerCase())) {
                    
                    return {
                        found: true,
                        rowIndex: index,
                        athleteName: athleteName,
                        isClickable: row.classList.contains('row-clickable'),
                        rowClasses: row.className
                    };
                }
            }
            
            return { found: false };
        });

        if (!eliSmithData.found) {
            console.log('❌ Eli Smith not found on page 3');
            return;
        }

        console.log(`✅ Found: ${eliSmithData.athleteName}`);
        console.log(`   Row index: ${eliSmithData.rowIndex}`);
        console.log(`   Clickable: ${eliSmithData.isClickable}`);
        console.log(`   Row classes: "${eliSmithData.rowClasses}"`);

        if (!eliSmithData.isClickable) {
            console.log('\n❌ Row is not clickable - cannot extract internal_id');
            return;
        }

        // Extract internal_id by clicking
        console.log(`\n🖱️ Clicking Eli Smith's row to extract internal_id...`);
        
        try {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
                page.evaluate((rowIndex) => {
                    const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                    if (rows[rowIndex]) {
                        rows[rowIndex].click();
                    }
                }, eliSmithData.rowIndex)
            ]);
            
            const currentUrl = page.url();
            console.log(`📍 Navigated to: ${currentUrl}`);
            
            const match = currentUrl.match(/\/member\/(\d+)/);
            if (match) {
                const internalId = parseInt(match[1]);
                console.log(`\n✅ SUCCESS: Extracted internal_id ${internalId} for Eli Smith`);
                
                console.log('\n' + '='.repeat(60));
                console.log('🎉 TEST PASSED!');
                console.log('='.repeat(60));
                console.log(`Athlete: ${eliSmithData.athleteName}`);
                console.log(`Page: 3`);
                console.log(`Internal ID: ${internalId}`);
                console.log('='.repeat(60));
                
            } else {
                console.log(`\n❌ FAILED: No internal_id found in URL: ${currentUrl}`);
            }
            
        } catch (error) {
            console.log(`\n❌ FAILED: ${error.message}`);
        }

    } catch (error) {
        console.error('💥 Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await browser.close();
    }
}

testEliSmithPage3();
