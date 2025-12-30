const puppeteer = require('puppeteer');

async function inspect() {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    try {
        const url = 'https://usaweightlifting.sport80.com/public/rankings/member/42858';
        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        console.log("Page loaded. Extracting text content...");

        const content = await page.evaluate(() => {
            return document.body.innerText;
        });

        console.log("---------------------------------------------------");
        console.log(content);
        console.log("---------------------------------------------------");

        // Also try to find specific structure around "Gender"
        const specific = await page.evaluate(() => {
            const nodes = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent.includes('Gender')) {
                    nodes.push({
                        text: node.textContent,
                        parentTag: node.parentElement.tagName,
                        parentClass: node.parentElement.className,
                        nextSiblingText: node.parentElement.nextElementSibling?.innerText || "N/A"
                    });
                }
            }
            return nodes;
        });

        console.log("Gender Nodes found:", JSON.stringify(specific, null, 2));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await browser.close();
    }
}

inspect();
