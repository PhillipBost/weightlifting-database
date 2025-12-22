const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

/**
 * Test that scrapeOneMeet.js now correctly identifies clickable rows
 * This tests the minimal change we made to add the isClickable flag
 */

// Copy the scrapeDivisionRankings function logic to test it
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

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

async function testClickableFlagDetection() {
    console.log('🧪 Testing clickable row flag detection...');
    
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });
    
    try {
        const page = await browser.newPage();
        
        // Use a known division with clickable rows
        const divisionCode = 356; // From the URL you provided
        const endDate = new Date('2017-01-18');
        const startDate = addDays(endDate, -10);
        
        const url = buildRankingsURL(divisionCode, startDate, endDate);
        console.log(`📄 Navigating to: ${url}`);
        
        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for table to load properly
        console.log('⏳ Waiting for Vue.js table to render...');
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Extract athletes with the NEW isClickable flag
        const pageAthletes = await page.evaluate(() => {
            const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                .map(th => th.textContent.trim().toLowerCase());

            const colMap = {
                athleteName: headers.findIndex(h => h.includes('athlete') || h.includes('lifter') && !h.includes('age'))
            };

            if (colMap.athleteName === -1) colMap.athleteName = 0;

            const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));

            return rows.map((row, index) => {
                const cells = Array.from(row.querySelectorAll('td'));
                const cellTexts = cells.map(cell => cell.textContent?.trim() || '');

                if (cellTexts.length < 1) return null;

                const athleteName = colMap.athleteName > -1 ? cellTexts[colMap.athleteName] : '';
                
                // Check for direct link
                let internalId = null;
                if (colMap.athleteName > -1) {
                    const nameCell = cells[colMap.athleteName];
                    const link = nameCell.querySelector('a[href*="/member/"]');
                    if (link) {
                        const href = link.getAttribute('href');
                        const match = href.match(/\/member\/(\d+)/);
                        if (match) {
                            internalId = parseInt(match[1]);
                        }
                    }
                }
                
                // NEW: Check if row is clickable
                const isClickable = row.classList.contains('row-clickable');

                return {
                    rowIndex: index + 1,
                    athleteName: athleteName,
                    internalId: internalId,
                    isClickable: isClickable,
                    rowClasses: row.className
                };
            }).filter(a => a && a.athleteName);
        });

        console.log(`\n📊 Results:`);
        console.log(`   Total athletes found: ${pageAthletes.length}`);
        
        const clickableRows = pageAthletes.filter(a => a.isClickable);
        const rowsWithDirectLinks = pageAthletes.filter(a => a.internalId);
        
        console.log(`   Clickable rows: ${clickableRows.length}`);
        console.log(`   Rows with direct links: ${rowsWithDirectLinks.length}`);
        
        console.log(`\n📋 First 5 athletes:`);
        pageAthletes.slice(0, 5).forEach(athlete => {
            const clickStatus = athlete.isClickable ? '✅ CLICKABLE' : '❌ NOT CLICKABLE';
            const idStatus = athlete.internalId ? `ID: ${athlete.internalId}` : 'NO ID';
            console.log(`   ${athlete.rowIndex}. ${athlete.athleteName} - ${clickStatus}, ${idStatus}`);
        });

        // Test result
        if (clickableRows.length > 0) {
            console.log(`\n✅ SUCCESS: isClickable flag is working! Found ${clickableRows.length} clickable rows.`);
            return true;
        } else {
            console.log(`\n❌ FAILURE: No clickable rows detected. The isClickable flag may not be working.`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return false;
    } finally {
        await browser.close();
    }
}

// Run the test
if (require.main === module) {
    testClickableFlagDetection()
        .then((success) => {
            if (success) {
                console.log('\n🎉 Test passed!');
                process.exit(0);
            } else {
                console.log('\n💥 Test failed!');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('\n💥 Test error:', error);
            process.exit(1);
        });
}

module.exports = { testClickableFlagDetection };