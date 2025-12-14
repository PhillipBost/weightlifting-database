const puppeteer = require('puppeteer');

const DIVISIONS_TO_FIND = [
    "Women's 11 Under Age Group 30kg",
    "Women's 11 Under Age Group 33kg",
    "Men's 11 Under Age Group 32kg",
    "Men's 11 Under Age Group 36kg",
    "Women's 13 Under Age Group 30kg",
    "Women's 13 Under Age Group 33kg",
    "Men's 13 Under Age Group 32kg",
    "Men's 13 Under Age Group 36kg"
];

async function discoverDivisionCodes() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const foundCodes = {};

    for (const division of DIVISIONS_TO_FIND) {
        try {
            console.log(`\n🔍 Discovering code for: ${division}`);
            
            // Navigate to rankings page
            await page.goto('https://usaweightlifting.sport80.com/public/rankings/all', {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            // Click on the weight class field
            await page.click('#weight_class');
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');

            // Type the division name
            await page.type('#weight_class', division, { delay: 2 });
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Get all options from the dropdown
            const weightClassCode = await page.evaluate(() => {
                // Look for the selected option or first matching option
                const options = document.querySelectorAll('[role="option"]');
                if (options.length > 0) {
                    const firstOption = options[0];
                    console.log('First option HTML:', firstOption.outerHTML);
                    
                    // Try to extract the code from data attributes or text
                    const dataValue = firstOption.getAttribute('data-value');
                    if (dataValue) return dataValue;
                }
                return null;
            });

            if (weightClassCode) {
                foundCodes[division] = weightClassCode;
                console.log(`✅ Found code: ${weightClassCode}`);
            } else {
                console.log(`⚠️ Could not find code for ${division}`);
                foundCodes[division] = 'UNKNOWN';
            }

            // Press Escape to close dropdown
            await page.keyboard.press('Escape');
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`❌ Error discovering ${division}:`, error.message);
            foundCodes[division] = 'ERROR';
        }
    }

    await browser.close();

    console.log('\n\n📊 Summary of discovered codes:');
    console.log(JSON.stringify(foundCodes, null, 2));

    return foundCodes;
}

discoverDivisionCodes();
