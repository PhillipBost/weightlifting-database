const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const startCode = 780;
    const endCode = 835;
    const results = {};

    console.log(`Harvesting division names for codes ${startCode}-${endCode}...`);

    const browser = await puppeteer.launch({
        headless: true, // headless: "new"
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Loop through codes
    for (let code = startCode; code <= endCode; code++) {
        try {
            // Construct Base64 Filter
            // We use a date range far in the past/future to avoid heavy results payload, 
            // we just want the division name which is displayed in the UI filters.
            // Using the user's sample date range:
            const filterObj = {
                date_range_start: "2020-09-14",
                date_range_end: "2020-09-27",
                weight_class: code
            };
            const b64 = Buffer.from(JSON.stringify(filterObj)).toString('base64');
            const url = `https://usaweightlifting.sport80.com/public/rankings/all?filters=${encodeURIComponent(b64)}`;

            console.log(`Checking Code ${code}...`);
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

            // Scrape the "Weight Class" filter chip or dropdown value
            // Selector might vary. Usually in the filter bar or table header.
            // Let's try to find the text in the "Filters" section.
            // Sport80 usually lists active filters as chips.

            const divisionName = await page.evaluate(() => {
                // Try finding the chip that corresponds to weight class
                // It's often a .v-chip or similar in the filter area
                const chips = Array.from(document.querySelectorAll('.v-chip__content'));
                // Look for one that likely contains the division name. 
                // Since we don't know the name, we might just grab all text and guess, 
                // OR look for the specific filter dropdown.

                // Better approach: The title or h1/h2 usually reflects the category in some views, 
                // but in "Rankings", it's a filter.

                // Let's try to grab the text from the specific filter display if possible.
                // Assuming the filter for "Weight Category" is set.
                // We can also try to infer from the Results table if empty? No.

                // Strategy: Look for the text inside the "Weight Category" select or chip.
                // Inspecting common Sport80 DOM (blindly):
                // Often there's a summary like "Ranking for [Division]"

                // Fallback: If we can't find it easily, return "UNKNOWN".
                // But typically filter chips are present.
                // Let's grab all chip text.
                return chips.map(c => c.textContent.trim()).join(' | ');
            });

            // The chips usually show "Weight Class: <Name>"
            if (divisionName) {
                // Extract the value after "Weight Class: " or similar if possible.
                // Since we get all chips, we might get "Date Range: ..." and "Weight Class: ..."
                // Let's clean it up in node.
                console.log(`  Found raw text: "${divisionName}"`);
                results[code] = divisionName;
            } else {
                console.log(`  No division name found for ${code}`);
                results[code] = "UNKNOWN";
            }

            // Random delay to be nice
            await new Promise(r => setTimeout(r, 1000));

        } catch (e) {
            console.error(`  Error processing ${code}: ${e.message}`);
            results[code] = "ERROR";
        }
    }

    await browser.close();

    // Save Results
    fs.writeFileSync('harvested_divisions.json', JSON.stringify(results, null, 2));
    console.log('Saved results to harvested_divisions.json');
})();
