const puppeteer = require('puppeteer');

/**
 * Test to confirm the Tier 1 internal_id extraction limitation
 * 
 * Confirms that USA Weightlifting rankings only allow internal_id extraction
 * from row 1 of page 1, not from subsequent rows or pages.
 */

async function testTier1ExtractionLimitation() {
    console.log('🔍 Testing Tier 1 internal_id extraction limitations...');
    
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });
    
    try {
        const page = await browser.newPage();
        
        // Use the specific URL you mentioned
        const testUrl = 'https://usaweightlifting.sport80.com/public/rankings/all?filters=eyJkYXRlX3JhbmdlX3N0YXJ0IjoiMjAxNy0wMS0wOCIsImRhdGVfcmFuZ2VfZW5kIjoiMjAxNy0wMS0xOCIsIndlaWdodF9jbGFzcyI6MzU2fQ%3D%3D';
        
        console.log('📄 Navigating to USA Weightlifting rankings...');
        await page.goto(testUrl, { waitUntil: 'networkidle0' });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Test Page 1 - Check first 3 rows for internal_id extraction capability
        console.log('\n📊 Testing Page 1 - Internal_ID Extraction:');
        
        const page1Results = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('tbody tr'));
            
            return rows.slice(0, 3).map((row, index) => {
                const cells = Array.from(row.querySelectorAll('td'));
                const athleteName = cells.length > 0 ? cells[0].textContent.trim() : 'NO_NAME';
                
                // Check for direct links (traditional method)
                const nameCell = cells[0];
                const directLink = nameCell ? nameCell.querySelector('a[href*="/member/"]') : null;
                let directInternalId = null;
                if (directLink) {
                    const match = directLink.href.match(/\/member\/(\d+)/);
                    directInternalId = match ? parseInt(match[1]) : null;
                }
                
                return {
                    rowNumber: index + 1,
                    athleteName: athleteName,
                    isClickable: row.classList.contains('row-clickable'),
                    hasDirectLink: !!directLink,
                    directInternalId: directInternalId,
                    rowClasses: row.className
                };
            });
        });
        
        page1Results.forEach(result => {
            const status = result.hasDirectLink ? '✅ HAS LINK' : '❌ NO LINK';
            console.log(`   Row ${result.rowNumber}: ${status} - ${result.athleteName} (ID: ${result.directInternalId || 'none'})`);
        });
        
        // Navigate to Page 3 to test Eli Smith's row
        console.log('\n⏳ Navigating to Page 3...');
        
        // Click to page 3
        await page.evaluate(() => {
            const pageButtons = Array.from(document.querySelectorAll('.v-pagination__item'));
            const page3Button = pageButtons.find(btn => btn.textContent.trim() === '3');
            if (page3Button) page3Button.click();
        });
        
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        // Test Page 3 - Look for Eli Smith and check extraction capability
        console.log('\n📊 Testing Page 3 - Internal_ID Extraction:');
        
        const page3Results = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('tbody tr'));
            
            return rows.slice(0, 5).map((row, index) => {
                const cells = Array.from(row.querySelectorAll('td'));
                const athleteName = cells.length > 0 ? cells[0].textContent.trim() : 'NO_NAME';
                
                // Check for direct links
                const nameCell = cells[0];
                const directLink = nameCell ? nameCell.querySelector('a[href*="/member/"]') : null;
                let directInternalId = null;
                if (directLink) {
                    const match = directLink.href.match(/\/member\/(\d+)/);
                    directInternalId = match ? parseInt(match[1]) : null;
                }
                
                return {
                    rowNumber: index + 1,
                    athleteName: athleteName,
                    isClickable: row.classList.contains('row-clickable'),
                    hasDirectLink: !!directLink,
                    directInternalId: directInternalId,
                    isEliSmith: athleteName.toLowerCase().includes('eli smith')
                };
            });
        });
        
        page3Results.forEach(result => {
            const status = result.hasDirectLink ? '✅ HAS LINK' : '❌ NO LINK';
            const eliFlag = result.isEliSmith ? ' 🎯 ELI SMITH' : '';
            console.log(`   Row ${result.rowNumber}: ${status} - ${result.athleteName} (ID: ${result.directInternalId || 'none'})${eliFlag}`);
        });
        
        // Summary
        const page1WithLinks = page1Results.filter(r => r.hasDirectLink).length;
        const page3WithLinks = page3Results.filter(r => r.hasDirectLink).length;
        
        console.log('\n📈 SUMMARY:');
        console.log(`   Page 1: ${page1WithLinks}/3 rows have extractable internal_ids`);
        console.log(`   Page 3: ${page3WithLinks}/5 rows have extractable internal_ids`);
        
        if (page1WithLinks === 1 && page3WithLinks === 0) {
            console.log('\n✅ CONFIRMED: Tier 1 extraction limited to row 1 of page 1 only');
        } else {
            console.log('\n❓ UNEXPECTED: Different pattern than expected');
        }
        
        return {
            page1WithLinks,
            page3WithLinks,
            page1Results,
            page3Results
        };
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// Run the test
if (require.main === module) {
    testTier1ExtractionLimitation()
        .then((results) => {
            console.log('\n🎉 Test completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testTier1ExtractionLimitation };