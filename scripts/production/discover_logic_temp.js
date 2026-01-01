
// This function will be appended to database-importer-custom.js via tool
async function discoverAllInternalIds(page, divisionCode, startDate, endDate, targetAthleteName) {
    console.log(`    🔍 Discovery Mode: Searching for ALL internal_ids for "${targetAthleteName}"...`);
    const findings = [];
    const url = buildRankingsURL(divisionCode, startDate, endDate);

    try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 4000));

        let hasMorePages = true;
        let currentPage = 1;

        while (hasMorePages) {
            // Find all matching rows on current page
            // We return their indices.
            const matches = await page.evaluate((targetName) => {
                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                const indices = [];
                rows.forEach((row, index) => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const name = cells[3]?.textContent?.trim() || '';
                    if (name.toLowerCase().includes(targetName.toLowerCase()) ||
                        targetName.toLowerCase().includes(name.toLowerCase())) {
                        indices.push({ index, name });
                    }
                });
                return indices;
            }, targetAthleteName);

            if (matches.length > 0) {
                console.log(`      Found ${matches.length} candidate(s) on page ${currentPage}`);

                // Process each match
                // Note: We process in reverse order so we don't mess up indices? No, indices are constant for the page load.
                // BUT we have to reload the page after each click.

                for (let i = 0; i < matches.length; i++) {
                    const matchIndex = matches[i].index; // This index is valid for this page state
                    const matchName = matches[i].name;

                    console.log(`      Processing candidate [${i + 1}/${matches.length}]: "${matchName}"...`);

                    // Click the row
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
                        page.evaluate((idx) => {
                            const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                            if (rows[idx]) rows[idx].click();
                        }, matchIndex)
                    ]);

                    // Extract ID
                    const currentUrl = page.url();
                    const idMatch = currentUrl.match(/\/member\/(\d+)/);
                    if (idMatch) {
                        const internalId = parseInt(idMatch[1]);
                        console.log(`      ✅ Discovered Internal ID: ${internalId}`);
                        findings.push({ internalId, name: matchName });
                    } else {
                        console.log(`      ⚠️ Failed to extract ID from URL: ${currentUrl}`);
                    }

                    // Navigate BACK to rankings and restore page
                    await page.goto(url, { waitUntil: 'networkidle0' });
                    await page.waitForSelector('.v-data-table__wrapper tbody tr');
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    // Navigate to current page if > 1
                    if (currentPage > 1) {
                        for (let p = 1; p < currentPage; p++) {
                            // click next
                            await page.evaluate(() => {
                                const btn = document.querySelector('.v-data-footer__icons-after button:not([disabled])');
                                if (btn) btn.click();
                            });
                            await new Promise(resolve => setTimeout(resolve, 2000)); // wait for transition
                        }
                        await new Promise(resolve => setTimeout(resolve, 2000)); // wait for settle
                    }
                }
            }

            // Check for next page
            hasMorePages = await page.evaluate(() => {
                const nextBtn = document.querySelector('.v-data-footer__icons-after button:not([disabled])');
                if (nextBtn && !nextBtn.disabled) {
                    nextBtn.click();
                    return true;
                }
                return false;
            });

            if (hasMorePages) {
                console.log(`      ⏭️ Checking page ${currentPage + 1}...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                currentPage++;
            }
        }

    } catch (e) {
        console.log(`    ❌ Discovery Error: ${e.message}`);
    }

    return findings;
}
