const puppeteer = require('puppeteer');

async function testKaileeSport80Verification() {
    console.log('🔍 Testing Kailee Bingman Sport80 verification...');
    
    const browser = await puppeteer.launch({
        headless: false, // Show browser for debugging
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        const memberUrl = 'https://usaweightlifting.sport80.com/public/rankings/member/38184';
        
        console.log(`🌐 Visiting: ${memberUrl}`);
        await page.goto(memberUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        
        // Wait for the page to load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Extract meet history
        const meetHistory = await page.evaluate(() => {
            // Look for meet results table or meet history
            const tables = Array.from(document.querySelectorAll('table'));
            const meetData = [];
            
            tables.forEach(table => {
                const rows = Array.from(table.querySelectorAll('tr'));
                rows.forEach(row => {
                    const cells = Array.from(row.querySelectorAll('td, th'));
                    const rowText = cells.map(cell => cell.textContent.trim()).join(' | ');
                    if (rowText.includes('2357') || rowText.includes('2017')) {
                        meetData.push(rowText);
                    }
                });
            });
            
            return {
                meetData,
                pageTitle: document.title,
                hasResults: document.body.textContent.includes('2357'),
                pageText: document.body.textContent.substring(0, 1000) // First 1000 chars for debugging
            };
        });
        
        console.log('📋 Sport80 Member Page Analysis:');
        console.log('   Page Title:', meetHistory.pageTitle);
        console.log('   Contains "2357":', meetHistory.hasResults);
        console.log('   Meet data found:', meetHistory.meetData.length);
        
        if (meetHistory.meetData.length > 0) {
            console.log('   Meet history entries:');
            meetHistory.meetData.forEach(entry => {
                console.log(`     ${entry}`);
            });
        }
        
        // Check if meet 2357 is actually there
        const meet2357Found = meetHistory.pageText.includes('2357') || 
                             meetHistory.meetData.some(entry => entry.includes('2357'));
        
        console.log('\\n🔍 VERIFICATION RESULT:');
        if (meet2357Found) {
            console.log('✅ Meet 2357 IS found in Kailee\'s Sport80 history');
            console.log('❌ BUG: Tier 2 verification incorrectly reported "NOT FOUND"');
        } else {
            console.log('❌ Meet 2357 NOT found in Kailee\'s Sport80 history');
            console.log('❓ Need to investigate further - maybe meet ID mismatch?');
        }
        
        // Save page content for debugging
        const html = await page.content();
        require('fs').writeFileSync('kailee-sport80-page.html', html);
        console.log('💾 Saved page content to kailee-sport80-page.html for inspection');
        
    } catch (error) {
        console.error('💥 Verification test failed:', error.message);
    } finally {
        await browser.close();
    }
}

testKaileeSport80Verification();