/**
 * Test base64 lookup with targeted clicking extraction
 * 
 * This simulates the base64 lookup fallback scenario where we search for
 * a specific athlete and extract their internal_id by clicking their row.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Import the functions from scrapeOneMeet
const { scrapeOneMeet } = require('./scripts/production/scrapeOneMeet.js');

async function testBase64LookupWithClicking() {
    console.log('🧪 Testing base64 lookup with targeted clicking extraction\n');

    // Create a test CSV with athletes missing internal_ids
    const testFile = path.join(__dirname, 'test-base64-lookup.csv');
    const testCsvContent = `Name|Age Category|Weight Class|Meet|Date|Level|Internal_ID
William Cohen|Youth 17|89|Test Meet|2017-01-15|Local|
Alexander Escamilla|Youth 17|89|Test Meet|2017-01-15|Local|
Kenny Wilkins|Youth 17|89|Test Meet|2017-01-15|Local|`;

    fs.writeFileSync(testFile, testCsvContent);
    console.log('📝 Created test CSV with 3 athletes missing internal_ids');

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1500, height: 1000 });

        // Load division codes
        const divisionCodesPath = path.join(__dirname, 'division_base64_codes.json');
        let divisionCode = 356; // Youth 17 89kg

        if (fs.existsSync(divisionCodesPath)) {
            const divisionData = JSON.parse(fs.readFileSync(divisionCodesPath, 'utf8'));
            console.log(`✅ Loaded division codes`);
            
            // Try to find the exact code for Youth 17 89kg
            const searchKey = 'Youth 17 89';
            for (const [divisionName, code] of Object.entries(divisionData.division_codes)) {
                if (divisionName.includes('Youth 17') && divisionName.includes('89')) {
                    divisionCode = code;
                    console.log(`✅ Found division code ${divisionCode} for ${divisionName}`);
                    break;
                }
            }
        }

        // Build rankings URL
        const startDate = new Date('2017-01-08');
        const endDate = new Date('2017-01-18');
        
        const filters = {
            date_range_start: '2017-01-08',
            date_range_end: '2017-01-18',
            weight_class: divisionCode
        };

        const jsonStr = JSON.stringify(filters);
        const base64Encoded = Buffer.from(jsonStr).toString('base64');
        const url = `https://usaweightlifting.sport80.com/public/rankings/all?filters=${encodeURIComponent(base64Encoded)}`;

        console.log(`\n🌐 Navigating to rankings page...`);
        console.log(`   URL: ${url}`);
        
        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        console.log('⏳ Waiting for Vue table to render (4 seconds)...');
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Test targeted extraction for each athlete
        const targetAthletes = ['William Cohen', 'Alexander Escamilla', 'Kenny Wilkins'];
        const results = [];

        console.log(`\n🎯 Testing targeted extraction for ${targetAthletes.length} athletes:\n`);

        for (const targetName of targetAthletes) {
            console.log(`🔍 Looking for: ${targetName}`);
            
            // Extract all athletes and find the target
            const athleteData = await page.evaluate((targetName) => {
                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                
                for (let index = 0; index < rows.length; index++) {
                    const row = rows[index];
                    const cells = Array.from(row.querySelectorAll('td'));
                    const athleteName = cells[3]?.textContent?.trim() || '';
                    
                    if (athleteName.toLowerCase().includes(targetName.toLowerCase()) ||
                        targetName.toLowerCase().includes(athleteName.toLowerCase())) {
                        
                        return {
                            rowIndex: index,
                            athleteName: athleteName,
                            isClickable: row.classList.contains('row-clickable')
                        };
                    }
                }
                
                return null;
            }, targetName);

            if (!athleteData) {
                console.log(`   ❌ Not found on page`);
                results.push({ name: targetName, id: null, status: 'NOT_FOUND' });
                continue;
            }

            if (!athleteData.isClickable) {
                console.log(`   ❌ Not clickable`);
                results.push({ name: targetName, id: null, status: 'NOT_CLICKABLE' });
                continue;
            }

            // Click and extract internal_id
            try {
                console.log(`   🖱️ Clicking row...`);
                
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
                    page.evaluate((rowIndex) => {
                        const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                        if (rows[rowIndex]) {
                            rows[rowIndex].click();
                        }
                    }, athleteData.rowIndex)
                ]);
                
                const currentUrl = page.url();
                const match = currentUrl.match(/\/member\/(\d+)/);
                
                if (match) {
                    const internalId = parseInt(match[1]);
                    console.log(`   ✅ Extracted internal_id: ${internalId}`);
                    results.push({ name: athleteData.athleteName, id: internalId, status: 'SUCCESS' });
                } else {
                    console.log(`   ❌ No internal_id in URL: ${currentUrl}`);
                    results.push({ name: targetName, id: null, status: 'NO_ID_IN_URL' });
                }
                
                // Navigate back
                await page.goBack({ waitUntil: 'networkidle0', timeout: 10000 });
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.log(`   ❌ Extraction failed: ${error.message}`);
                results.push({ name: targetName, id: null, status: 'ERROR' });
                
                // Try to recover
                try {
                    await page.goBack({ waitUntil: 'networkidle0', timeout: 5000 });
                } catch (e) {
                    console.log(`   💥 Cannot recover`);
                    break;
                }
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 FINAL RESULTS:');
        console.log('='.repeat(60));
        
        results.forEach((r, i) => {
            const status = r.status === 'SUCCESS' ? '✅' : '❌';
            console.log(`${status} ${i + 1}. ${r.name}: ${r.id || r.status}`);
        });

        const successCount = results.filter(r => r.status === 'SUCCESS').length;
        console.log('='.repeat(60));
        console.log(`Success: ${successCount}/${results.length}`);
        console.log('='.repeat(60));

        if (successCount === results.length) {
            console.log('\n🎉 ALL TESTS PASSED! Base64 lookup with clicking works correctly.');
        } else if (successCount > 0) {
            console.log('\n⚠️ PARTIAL SUCCESS: Some extractions worked.');
        } else {
            console.log('\n❌ ALL TESTS FAILED: Base64 lookup with clicking not working.');
        }

    } catch (error) {
        console.error('💥 Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await browser.close();
        
        // Clean up test file
        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
            console.log('\n🧹 Cleaned up test file');
        }
    }
}

testBase64LookupWithClicking();
