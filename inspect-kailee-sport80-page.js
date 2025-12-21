const puppeteer = require('puppeteer');

async function inspectKaileeSport80Page() {
    console.log('🔍 Inspecting Kailee Bingman Sport80 member page...');
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1500, height: 1000 });

        const memberUrl = 'https://usaweightlifting.sport80.com/public/rankings/member/38184';
        console.log(`🌐 Visiting: ${memberUrl}`);

        await page.goto(memberUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Extract detailed page information
        const pageData = await page.evaluate(() => {
            // Get all meet rows
            const meetRows = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr'));
            
            const meetInfo = meetRows.map((row, index) => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 2) return null;

                const meetName = cells[0]?.textContent?.trim();
                const meetDate = cells[1]?.textContent?.trim();

                // Extract meet ID from the URL if available
                const link = cells[0]?.querySelector('a');
                const meetUrl = link?.getAttribute('href');
                let meetId = null;

                if (meetUrl) {
                    const match = meetUrl.match(/\/rankings\/results\/(\d+)/);
                    if (match) {
                        meetId = parseInt(match[1]);
                    }
                }

                return {
                    index: index,
                    name: meetName,
                    date: meetDate,
                    meetId: meetId,
                    url: meetUrl,
                    rawCells: cells.map(cell => cell.textContent?.trim())
                };
            }).filter(Boolean);

            return {
                meetInfo,
                totalRows: meetRows.length,
                pageTitle: document.title,
                hasTable: !!document.querySelector('.data-table'),
                bodyText: document.body.textContent.substring(0, 2000) // First 2000 chars
            };
        });

        console.log('📋 Sport80 Member Page Analysis:');
        console.log('   Page Title:', pageData.pageTitle);
        console.log('   Has Table:', pageData.hasTable);
        console.log('   Total Rows:', pageData.totalRows);
        console.log('   Parsed Meets:', pageData.meetInfo.length);

        console.log('\\n📊 Meet History (first 10):');
        pageData.meetInfo.slice(0, 10).forEach(meet => {
            console.log(`   ${meet.index}: "${meet.name}" (${meet.date}) - ID: ${meet.meetId} - URL: ${meet.url}`);
        });

        // Look specifically for meet 2357 or similar dates
        console.log('\\n🔍 Looking for meet 2357 or January 2017 meets:');
        const targetMeets = pageData.meetInfo.filter(meet => 
            meet.meetId === 2357 || 
            meet.date?.includes('2017-01') ||
            meet.name?.toLowerCase().includes('show up') ||
            meet.name?.toLowerCase().includes('lift')
        );

        if (targetMeets.length > 0) {
            console.log('   Found potential matches:');
            targetMeets.forEach(meet => {
                console.log(`     "${meet.name}" (${meet.date}) - ID: ${meet.meetId}`);
            });
        } else {
            console.log('   No matches found for meet 2357 or January 2017');
        }

        // Check if the page contains "2357" anywhere
        const contains2357 = pageData.bodyText.includes('2357');
        console.log('\\n🔍 Page contains "2357":', contains2357);

        if (contains2357) {
            console.log('❓ Meet 2357 text found but not parsed correctly');
        }

        // Save page content for manual inspection
        const html = await page.content();
        require('fs').writeFileSync('kailee-member-page.html', html);
        console.log('💾 Saved page content to kailee-member-page.html');

    } catch (error) {
        console.error('💥 Inspection failed:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

inspectKaileeSport80Page();