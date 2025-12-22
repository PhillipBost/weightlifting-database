const puppeteer = require('puppeteer');

/**
 * Diagnose the actual structure of clickable rows to understand
 * how to properly extract internal_ids
 */

async function diagnoseClickableRows() {
    console.log('🔍 Diagnosing clickable row structure...');
    
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });
    
    try {
        const page = await browser.newPage();
        
        const testUrl = 'https://usaweightlifting.sport80.com/public/rankings/all?filters=eyJkYXRlX3JhbmdlX3N0YXJ0IjoiMjAxNy0wMS0wOCIsImRhdGVfcmFuZ2VfZW5kIjoiMjAxNy0wMS0xOCIsIndlaWdodF9jbGFzcyI6MzU2fQ%3D%3D';
        
        console.log('📄 Navigating to rankings page...');
        await page.goto(testUrl, { waitUntil: 'networkidle0' });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('\n🔍 Analyzing first 3 rows on page 1:');
        
        const rowAnalysis = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('tbody tr'));
            
            return rows.slice(0, 3).map((row, index) => {
                const cells = Array.from(row.querySelectorAll('td'));
                const athleteName = cells[0]?.textContent.trim() || 'NO_NAME';
                
                // Check row attributes
                const rowAttrs = {};
                for (let attr of row.attributes) {
                    rowAttrs[attr.name] = attr.value;
                }
                
                // Check for Vue.js data
                const hasVueData = !!row.__vue__;
                let vueRouterTo = null;
                if (row.__vue__ && row.__vue__.$attrs) {
                    vueRouterTo = row.__vue__.$attrs.to;
                }
                
                // Check onclick handlers
                const hasOnClick = !!row.onclick;
                const onClickStr = row.onclick ? row.onclick.toString() : null;
                
                // Check for router-link or links in cells
                const links = Array.from(row.querySelectorAll('a'));
                const linkInfo = links.map(link => ({
                    href: link.href,
                    text: link.textContent.trim()
                }));
                
                return {
                    rowNumber: index + 1,
                    athleteName,
                    isClickable: row.classList.contains('row-clickable'),
                    rowClasses: row.className,
                    rowAttrs,
                    hasVueData,
                    vueRouterTo,
                    hasOnClick,
                    onClickStr,
                    links: linkInfo
                };
            });
        });
        
        rowAnalysis.forEach(row => {
            console.log(`\n📊 Row ${row.rowNumber}: ${row.athleteName}`);
            console.log(`   Clickable: ${row.isClickable}`);
            console.log(`   Classes: "${row.rowClasses}"`);
            console.log(`   Attributes:`, JSON.stringify(row.rowAttrs, null, 2));
            console.log(`   Has Vue data: ${row.hasVueData}`);
            console.log(`   Vue router 'to': ${row.vueRouterTo}`);
            console.log(`   Has onClick: ${row.hasOnClick}`);
            if (row.onClickStr) {
                console.log(`   onClick: ${row.onClickStr.substring(0, 100)}...`);
            }
            console.log(`   Links found: ${row.links.length}`);
            row.links.forEach((link, i) => {
                console.log(`     Link ${i + 1}: ${link.href} (${link.text})`);
            });
        });
        
        console.log('\n✅ Diagnosis complete');
        return rowAnalysis;
        
    } catch (error) {
        console.error('❌ Diagnosis failed:', error.message);
        throw error;
    } finally {
        await browser.close();
    }
}

// Run the diagnosis
if (require.main === module) {
    diagnoseClickableRows()
        .then(() => {
            console.log('\n🎉 Diagnosis completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Diagnosis failed:', error);
            process.exit(1);
        });
}

module.exports = { diagnoseClickableRows };