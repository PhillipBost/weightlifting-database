const puppeteer = require('puppeteer');

/**
 * Test script to verify exact division names in Sport80 dropdown
 * Checks if youth divisions match our CSV format
 */

async function testDivisionNames() {
    console.log('🔍 Testing Sport80 division name formats...\n');
    
    const browser = await puppeteer.launch({
        headless: false, // Show browser to see what's happening
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1000 });
    
    try {
        console.log('📂 Navigating to rankings page...');
        await page.goto('https://usaweightlifting.sport80.com/public/rankings/all', {
            waitUntil: 'networkidle0'
        });
        
        console.log('✅ Page loaded\n');
        
        // Click the weight class dropdown to see all options
        console.log('📋 Clicking weight class dropdown...');
        await page.click('#weight_class');
        await page.waitForTimeout(1000);
        
        // Extract all available division options
        const divisionOptions = await page.evaluate(() => {
            const options = [];
            
            // Try different selectors for dropdown options
            const selectors = [
                '.v-list-item__title',
                '.v-select__selection',
                '.menuable__content__active .v-list-item',
                '[role="option"]'
            ];
            
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    elements.forEach(el => {
                        const text = el.textContent.trim();
                        if (text && text.length > 0 && !options.includes(text)) {
                            options.push(text);
                        }
                    });
                    break; // Found options with this selector
                }
            }
            
            return options;
        });
        
        console.log(`\n📊 Found ${divisionOptions.length} total division options in dropdown\n`);
        
        // Filter for youth divisions (11 Under, 13 Under, 14-15, 16-17)
        const youthDivisions = divisionOptions.filter(d => 
            d.includes('11 Under') || 
            d.includes('13 Under') || 
            d.includes('14-15') || 
            d.includes('16-17')
        );
        
        console.log(`\n🏃 Youth Divisions (${youthDivisions.length}):`);
        console.log('='.repeat(80));
        
        // Group by age category
        const categories = {
            "11 Under": [],
            "13 Under": [],
            "14-15": [],
            "16-17": []
        };
        
        youthDivisions.forEach(div => {
            if (div.includes('11 Under')) categories["11 Under"].push(div);
            else if (div.includes('13 Under')) categories["13 Under"].push(div);
            else if (div.includes('14-15')) categories["14-15"].push(div);
            else if (div.includes('16-17')) categories["16-17"].push(div);
        });
        
        for (const [category, divisions] of Object.entries(categories)) {
            if (divisions.length > 0) {
                console.log(`\n${category} Age Group (${divisions.length} divisions):`);
                divisions.sort().forEach(div => console.log(`  - "${div}"`));
            }
        }
        
        // Compare with our CSV format
        console.log('\n\n🔍 CSV Format vs Sport80 Format Comparison:');
        console.log('='.repeat(80));
        
        const csvFormats = [
            "Women's 11 Under Age Group 30kg",
            "Women's 11 Under Age Group 36kg",
            "Men's 11 Under Age Group 32kg",
            "Women's 13 Under Age Group 30kg",
            "Men's 14-15 Age Group 48kg",
            "Women's 16-17 Age Group 44kg"
        ];
        
        csvFormats.forEach(csvFormat => {
            const found = youthDivisions.find(d => d === csvFormat);
            if (found) {
                console.log(`✅ EXACT MATCH: "${csvFormat}"`);
            } else {
                console.log(`❌ NO MATCH: "${csvFormat}"`);
                // Try to find similar
                const similar = youthDivisions.filter(d => {
                    const csvParts = csvFormat.toLowerCase().split(' ');
                    return csvParts.every(part => d.toLowerCase().includes(part));
                });
                if (similar.length > 0) {
                    console.log(`   Possible matches:`);
                    similar.forEach(s => console.log(`     - "${s}"`));
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
    
    console.log('\n\n⏸️  Browser will remain open for 30 seconds for manual inspection...');
    await page.waitForTimeout(30000);
    
    await browser.close();
    console.log('\n✅ Test complete!');
}

testDivisionNames().catch(console.error);
