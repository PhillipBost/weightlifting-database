const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        console.log('Navigating to IWF Sanctions page...');
        await page.goto('https://iwf.sport/anti-doping/sanctions/', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        console.log('Page loaded. Extracting HTML...');
        const content = await page.content();

        const outputPath = path.resolve(__dirname, '../../temp/sanctions_dump.html');
        if (!fs.existsSync(path.dirname(outputPath))) {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        }

        fs.writeFileSync(outputPath, content);
        console.log(`HTML saved to ${outputPath}`);

        // Also try to grab table info directly
        const tables = await page.evaluate(() => {
            const result = [];
            const tableNodes = document.querySelectorAll('table');
            tableNodes.forEach((t, i) => {
                const headers = Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim());
                const firstRow = t.querySelector('tbody tr');
                const firstRowData = firstRow ? Array.from(firstRow.querySelectorAll('td')).map(td => td.innerText.trim()) : [];
                result.push({
                    index: i,
                    headers,
                    firstRowData,
                    className: t.className,
                    parentClass: t.parentElement.className
                });
            });

            // Also look for the accordion headers to see how data is grouped
            // It might not be tables, but div structures
            const accordions = Array.from(document.querySelectorAll('.elementor-tab-title')).map(el => el.innerText.trim());

            return { tables, accordions };
        });

        console.log('Structure Analysis:', JSON.stringify(tables, null, 2));

        await browser.close();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
})();
