/**
 * Test targeted internal_id extraction
 * 
 * This test validates that we can extract internal_id for a SPECIFIC athlete
 * by clicking only their row, without trying to click all rows.
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

// Extract internal_id for a specific athlete by clicking their row
async function extractInternalIdByClicking(page, athleteName, rowIndex) {
    try {
        console.log(`    🖱️ Clicking row for: ${athleteName}...`);
        
        // Click the row and wait for navigation
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
            page.evaluate((rowIndex) => {
                const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                if (rows[rowIndex]) {
                    rows[rowIndex].click();
                }
            }, rowIndex)
        ]);
        
        // Extract internal_id from destination URL
        const currentUrl = page.url();
        const match = currentUrl.match(/\/member\/(\d+)/);
        
        if (match) {
            const internalId = parseInt(match[1]);
            console.log(`    ✅ Extracted internal_id ${internalId} for ${athleteName}`);
            
            // Navigate back to rankings page
            await page.goBack({ waitUntil: 'networkidle0', timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return internalId;
        } else {
            console.log(`    ❌ No internal_id found in URL: ${currentUrl}`);
            await page.goBack({ waitUntil: 'networkidle0', timeout: 10000 });
            return null;
        }
        
    } catch (error) {
        console.log(`    ❌ Failed to extract internal_id for ${athleteName}: ${error.message}`);
        // Try to recover by going back
        try {
            await page.goBack({ waitUntil: 'networkidle0', timeout: 5000 });
        } catch (e) {
            console.log(`    ⚠️ Cannot navigate back after error`);
        }
        return null;
    }
}

async function testTargetedExtraction() {
    console.log('🧪 Testing targeted internal_id extraction\n');

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

        // Extract all athletes
        const athletes = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
            
            return rows.slice(0, 10).map((row, index) => {
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

        console.log(`\n📋 Found ${athletes.length} athletes on page`);
        console.log('First 5 athletes:');
        athletes.slice(0, 5).forEach((a, i) => {
            console.log(`  ${i + 1}. ${a.athleteName} (clickable: ${a.isClickable})`);
        });

        // Test extracting internal_id for specific athletes
        const targetAthletes = ['Alexander Escamilla', 'Kenny Wilkins', 'Jerome Smith'];
        
        console.log(`\n🎯 Testing targeted extraction for ${targetAthletes.length} specific athletes:\n`);

        for (const targetName of targetAthletes) {
            // Find the target athlete
            const targetAthlete = athletes.find(a => 
                a.athleteName.toLowerCase().includes(targetName.toLowerCase()) ||
                targetName.toLowerCase().includes(a.athleteName.toLowerCase())
            );

            if (!targetAthlete) {
                console.log(`⚠️ ${targetName}: Not found on page`);
                continue;
            }

            if (!targetAthlete.isClickable) {
                console.log(`⚠️ ${targetName}: Not clickable`);
                continue;
            }

            // Extract internal_id by clicking
            const extractedId = await extractInternalIdByClicking(page, targetAthlete.athleteName, targetAthlete.rowIndex);
            targetAthlete.internalId = extractedId;

            // Small delay between extractions
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log('\n' + '='.repeat(60));
        console.log('📊 FINAL RESULTS:');
        console.log('='.repeat(60));
        
        const successCount = targetAthletes.filter(name => {
            const athlete = athletes.find(a => 
                a.athleteName.toLowerCase().includes(name.toLowerCase()) ||
                name.toLowerCase().includes(a.athleteName.toLowerCase())
            );
            return athlete && athlete.internalId;
        }).length;

        targetAthletes.forEach(name => {
            const athlete = athletes.find(a => 
                a.athleteName.toLowerCase().includes(name.toLowerCase()) ||
                name.toLowerCase().includes(a.athleteName.toLowerCase())
            );
            
            if (athlete) {
                const status = athlete.internalId ? '✅' : '❌';
                console.log(`${status} ${athlete.athleteName}: ${athlete.internalId || 'NO ID'}`);
            } else {
                console.log(`❌ ${name}: NOT FOUND`);
            }
        });

        console.log('='.repeat(60));
        console.log(`Success: ${successCount}/${targetAthletes.length}`);
        console.log('='.repeat(60));

        if (successCount === targetAthletes.length) {
            console.log('\n🎉 ALL TESTS PASSED! Targeted extraction works correctly.');
        } else if (successCount > 0) {
            console.log('\n⚠️ PARTIAL SUCCESS: Some extractions worked.');
        } else {
            console.log('\n❌ ALL TESTS FAILED: Targeted extraction not working.');
        }

    } catch (error) {
        console.error('💥 Test failed:', error.message);
        console.error(error.stack);
    } finally {
        await browser.close();
    }
}

testTargetedExtraction();
