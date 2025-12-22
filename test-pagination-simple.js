const puppeteer = require('puppeteer');

/**
 * Simple test to verify pagination bug and fix
 * Tests the specific issue where internal_id extraction fails after page 1
 */

async function testPaginationBug() {
    console.log('🔍 Testing pagination bug in internal_id extraction...');
    
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });
    
    try {
        const page = await browser.newPage();
        
        // Use the base64 URL you mentioned that has Eli Smith on page 3
        const testUrl = 'https://www.sport80.com/api/member/search?base64=eyJkaXZpc2lvbiI6IkNBLVNvdXRoIiwiYWdlQ2F0ZWdvcnkiOiJTZW5pb3IiLCJ3ZWlnaHRDbGFzcyI6IjEwOSIsImdlbmRlciI6Ik1hbGUiLCJzdGFydERhdGUiOiIyMDI0LTEwLTAxIiwiZW5kRGF0ZSI6IjIwMjQtMTItMzEifQ%3D%3D';
        
        console.log('📄 Navigating to test URL...');
        await page.goto(testUrl, { waitUntil: 'networkidle0' });
        
        // Wait for page to load - be more flexible with selectors
        console.log('⏳ Waiting for page to load...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        let currentPage = 1;
        
        while (currentPage <= 3) {
            console.log(`\n📊 Testing Page ${currentPage}:`);
            
            // Test current page data extraction using the same logic as the importer
            const pageResults = await page.evaluate(() => {
                // Try to find table rows using multiple selectors
                let rows = [];
                
                // Try different table selectors
                const tableSelectors = [
                    '.v-data-table__wrapper tbody tr',
                    'tbody tr',
                    'table tr',
                    '.table tbody tr'
                ];
                
                for (const selector of tableSelectors) {
                    rows = Array.from(document.querySelectorAll(selector));
                    if (rows.length > 0) break;
                }
                
                if (rows.length === 0) {
                    return { error: 'No table rows found', selectors: tableSelectors };
                }
                
                // Extract data from first 3 rows
                const athletes = rows.slice(0, 3).map((row, index) => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const athleteName = cells.length > 0 ? cells[0].textContent.trim() : 'NO_NAME';
                    
                    return {
                        index: index + 1,
                        name: athleteName,
                        classes: row.className,
                        isClickable: row.classList.contains('row-clickable'),
                        cellCount: cells.length
                    };
                });
                
                return {
                    totalRows: rows.length,
                    clickableRows: rows.filter(row => row.classList.contains('row-clickable')).length,
                    athletes: athletes,
                    pageNumber: document.querySelector('.v-pagination__item--active')?.textContent || 'unknown'
                };
            });
            
            if (pageResults.error) {
                console.log(`   ❌ Error: ${pageResults.error}`);
                console.log(`   Tried selectors: ${pageResults.selectors.join(', ')}`);
                break;
            }
            
            console.log(`   📊 Page ${pageResults.pageNumber}: ${pageResults.totalRows} total rows, ${pageResults.clickableRows} clickable`);
            console.log(`   👥 First 3 athletes:`);
            
            pageResults.athletes.forEach(athlete => {
                const status = athlete.classes === '' ? '❌ NO CLASSES' : '✅';
                console.log(`     ${status} ${athlete.index}. "${athlete.name}" (classes: "${athlete.classes}", clickable: ${athlete.isClickable})`);
            });
            
            // Check if this is the bug - empty classes on pages 2+
            if (currentPage > 1) {
                const hasEmptyClasses = pageResults.athletes.some(a => a.classes === '');
                const hasDuplicateNames = new Set(pageResults.athletes.map(a => a.name)).size < pageResults.athletes.length;
                
                if (hasEmptyClasses) {
                    console.log(`   🐛 BUG CONFIRMED: Empty row classes detected on page ${currentPage}`);
                }
                if (hasDuplicateNames) {
                    console.log(`   🐛 BUG CONFIRMED: Duplicate athlete names detected on page ${currentPage}`);
                }
            }
            
            // Try to go to next page
            if (currentPage < 3) {
                console.log(`   ⏳ Attempting to navigate to page ${currentPage + 1}...`);
                
                const navigationSuccess = await page.evaluate(() => {
                    const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                        return true;
                    }
                    return false;
                });
                
                if (navigationSuccess) {
                    console.log('   ✅ Navigation clicked, waiting for page change...');
                    
                    // Wait for page to change - use a more robust approach
                    await new Promise(resolve => setTimeout(resolve, 4000));
                    
                    // Verify page actually changed
                    const newPageNumber = await page.evaluate(() => {
                        return document.querySelector('.v-pagination__item--active')?.textContent || 'unknown';
                    });
                    
                    console.log(`   📄 New page number: ${newPageNumber}`);
                    currentPage++;
                } else {
                    console.log('   🏁 No next page button found');
                    break;
                }
            } else {
                break;
            }
        }
        
        console.log('\n✅ Pagination test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// Run the test
if (require.main === module) {
    testPaginationBug()
        .then(() => {
            console.log('\n🎉 Test completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testPaginationBug };