const puppeteer = require('puppeteer');

async function inspectMeet() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        const url = 'https://usaweightlifting.sport80.com/public/rankings/results/7011';
        console.log(`Navigating to: ${url}`);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Wait a bit for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 5000));

        const pageData = await page.evaluate(() => {
            const results = {};
            
            // Find the H2 and its parent/context
            const h2 = document.querySelector('h2');
            if (h2) {
                results.h2 = {
                    text: h2.innerText.trim(),
                    className: h2.className,
                    parentClass: h2.parentElement ? h2.parentElement.className : 'none',
                    grandParentClass: (h2.parentElement && h2.parentElement.parentElement) ? h2.parentElement.parentElement.className : 'none'
                };
            }

            // Look for the date specifically, excluding table cells
            const nonTableDates = Array.from(document.querySelectorAll('div, span, p, li'))
                .filter(el => {
                    const isInsideTable = el.closest('table') !== null;
                    return !isInsideTable && el.children.length === 0 && el.innerText && el.innerText.includes('2025');
                })
                .map(el => ({
                    tag: el.tagName,
                    className: el.className,
                    text: el.innerText.trim(),
                    parentTag: el.parentElement ? el.parentElement.tagName : '',
                    parentClass: el.parentElement ? el.parentElement.className : ''
                }));
            results.nonTableDates = nonTableDates;

            // Look for any labels like "Date" or "Event Date"
            const dateLabels = Array.from(document.querySelectorAll('*'))
                .filter(el => el.innerText && /date/i.test(el.innerText) && el.innerText.length < 50)
                .map(el => ({
                    tag: el.tagName,
                    className: el.className,
                    text: el.innerText.trim(),
                    nextSiblingText: el.nextElementSibling ? el.nextElementSibling.innerText.trim() : 'none'
                }))
                .slice(0, 10);
            results.dateLabels = dateLabels;

            return results;
        });

        console.log('Inspection Results:');
        console.log('H2 Info:', JSON.stringify(pageData.h2, null, 2));
        console.log('Non-Table Dates:', JSON.stringify(pageData.nonTableDates, null, 2));
        console.log('Date Labels:', JSON.stringify(pageData.dateLabels, null, 2));
        console.log('S80 Elements:', JSON.stringify(pageData.s80Elements, null, 2));

    } catch (error) {
        console.error('Error during inspection:', error);
    } finally {
        await browser.close();
    }
}

inspectMeet();
