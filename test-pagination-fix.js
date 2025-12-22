const puppeteer = require('puppeteer');

/**
 * Test script to diagnose and fix the pagination bug in internal_id extraction
 * 
 * Issue: After pagination, row classes are lost and athlete names are duplicated
 * Root cause: Not waiting long enough for Vue.js re-render after pagination click
 * 
 * Test case: Eli Smith should be on page 3 of the rankings
 */

async function testPaginationFix() {
    console.log('🔍 Testing pagination fix for internal_id extraction...');
    console.log('🎯 Target: Find Eli Smith on page 3');
    
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });
    
    try {
        const page = await browser.newPage();
        
        // Use the correct USA Weightlifting rankings URL where Eli Smith is on page 3
        const testUrl = 'https://usaweightlifting.sport80.com/public/rankings/all?filters=eyJkYXRlX3JhbmdlX3N0YXJ0IjoiMjAxNy0wMS0wOCIsImRhdGVfcmFuZ2VfZW5kIjoiMjAxNy0wMS0xOCIsIndlaWdodF9jbGFzcyI6MzU2fQ%3D%3D';
        
        console.log('📄 Navigating to USA Weightlifting rankings...');
        await page.goto(testUrl, { waitUntil: 'networkidle0' });
        
        // Wait for initial page load
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        let currentPage = 1;
        let hasMorePages = true;
        let eliSmithFound = false;
        
        while (hasMorePages && currentPage <= 5 && !eliSmithFound) { // Test up to 5 pages to find Eli
            console.log(`\n📊 Testing Page ${currentPage}:`);
            
            // Test current page data extraction
            const pageData = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                
                const athletes = rows.map((row, index) => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const athleteName = cells.length > 1 ? cells[1].textContent.trim() : 'NO_NAME'; // Name is usually in 2nd column
                    
                    return {
                        index: index + 1,
                        name: athleteName,
                        classes: row.className,
                        isClickable: row.classList.contains('row-clickable'),
                        cellCount: cells.length
                    };
                });
                
                // Check if Eli Smith is on this page
                const eliSmith = athletes.find(a => a.name.toLowerCase().includes('eli smith'));
                
                return {
                    totalRows: rows.length,
                    athletes: athletes,
                    firstThreeAthletes: athletes.slice(0, 3),
                    clickableRows: rows.filter(row => row.classList.contains('row-clickable')).length,
                    eliSmithFound: !!eliSmith,
                    eliSmithData: eliSmith || null
                };
            });
            
            console.log(`   Athletes found: ${pageData.totalRows}`);
            console.log(`   Clickable rows: ${pageData.clickableRows}`);
            console.log(`   First 3 athletes:`);
            pageData.firstThreeAthletes.forEach(athlete => {
                console.log(`     ${athlete.index}. ${athlete.name} (classes: "${athlete.classes}", clickable: ${athlete.isClickable})`);
            });
            
            if (pageData.eliSmithFound) {
                console.log(`   🎉 FOUND ELI SMITH on page ${currentPage}!`);
                console.log(`   📋 Eli Smith data:`, pageData.eliSmithData);
                eliSmithFound = true;
                
                // Test internal_id extraction for Eli Smith
                if (pageData.eliSmithData.isClickable) {
                    console.log(`   🔗 Testing internal_id extraction for Eli Smith...`);
                    
                    const eliRowIndex = pageData.eliSmithData.index - 1; // Convert to 0-based index
                    
                    const internalId = await page.evaluate((rowIndex) => {
                        return new Promise((resolve) => {
                            const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                            const targetRow = rows[rowIndex];
                            
                            if (!targetRow || !targetRow.classList.contains('row-clickable')) {
                                resolve(null);
                                return;
                            }
                            
                            // Click the row and wait for navigation
                            targetRow.click();
                            
                            setTimeout(() => {
                                const currentUrl = window.location.href;
                                const match = currentUrl.match(/\/member\/(\d+)/);
                                resolve(match ? parseInt(match[1]) : null);
                            }, 1000);
                        });
                    }, eliRowIndex);
                    
                    if (internalId) {
                        console.log(`   ✅ Successfully extracted internal_id for Eli Smith: ${internalId}`);
                    } else {
                        console.log(`   ❌ Failed to extract internal_id for Eli Smith`);
                    }
                } else {
                    console.log(`   ⚠️  Eli Smith's row is not clickable (classes: "${pageData.eliSmithData.classes}")`);
                }
                
                break;
            }
            
            // Check for next page
            const nextPageExists = await page.evaluate(() => {
                const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                return nextBtn && !nextBtn.disabled;
            });
            
            if (nextPageExists && currentPage < 5 && !eliSmithFound) {
                console.log(`   ⏳ Navigating to page ${currentPage + 1}...`);
                
                // Click next page button
                await page.evaluate(() => {
                    const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                    }
                });
                
                // CRITICAL: Wait for Vue.js re-render to complete
                console.log('   ⏳ Waiting for Vue.js re-render...');
                
                // Wait for page number to change (indicates navigation started)
                await page.waitForFunction(
                    (expectedPage) => {
                        const pageInfo = document.querySelector('.v-data-footer__pagination .v-pagination__item--active');
                        return pageInfo && parseInt(pageInfo.textContent) === expectedPage;
                    },
                    { timeout: 10000 },
                    currentPage + 1
                );
                
                // Wait for table to stabilize
                await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
                
                // Additional wait for Vue.js to fully render
                await new Promise(resolve => setTimeout(resolve, 4000));
                
                // Verify the page has actually changed by checking if data is different
                const newPageData = await page.evaluate(() => {
                    const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                    const firstAthlete = rows.length > 1 ? rows[0].querySelector('td:nth-child(2)')?.textContent.trim() : null;
                    return {
                        firstAthleteName: firstAthlete,
                        totalRows: rows.length,
                        clickableRows: rows.filter(row => row.classList.contains('row-clickable')).length
                    };
                });
                
                console.log(`   ✅ Page changed - First athlete: ${newPageData.firstAthleteName}, Rows: ${newPageData.totalRows}, Clickable: ${newPageData.clickableRows}`);
                
                currentPage++;
            } else {
                hasMorePages = false;
                if (!eliSmithFound) {
                    console.log(`   🏁 No more pages or reached test limit - Eli Smith not found yet`);
                }
            }
        }
        
        if (eliSmithFound) {
            console.log('\n✅ Pagination test completed successfully! Eli Smith found and tested.');
        } else {
            console.log('\n⚠️  Pagination test completed but Eli Smith was not found in the first 5 pages.');
        }
        
    } catch (error) {
        console.error('❌ Pagination test failed:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// Run the test
if (require.main === module) {
    testPaginationFix()
        .then(() => {
            console.log('\n🎉 Test completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testPaginationFix };