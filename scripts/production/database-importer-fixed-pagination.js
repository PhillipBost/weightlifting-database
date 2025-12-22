/**
 * Fixed pagination logic for internal_id extraction
 * 
 * This fixes the bug where row classes are lost and athlete names are duplicated
 * after pagination by properly waiting for Vue.js to complete the re-render.
 */

async function scrapeAthleteDataWithFixedPagination(page, division, ageCategory, weightClass, gender, startDate, endDate) {
    try {
        console.log(`    🔍 Scraping athletes from division: ${division}, ${ageCategory}, ${weightClass}, ${gender}`);
        
        const base64Params = Buffer.from(JSON.stringify({
            division,
            ageCategory,
            weightClass,
            gender,
            startDate: formatDate(startDate),
            endDate: formatDate(endDate)
        })).toString('base64');

        const url = `https://www.sport80.com/api/member/search?base64=${base64Params}`;
        console.log(`    📄 Navigating to: ${url}`);

        await page.goto(url, { waitUntil: 'networkidle0' });
        await new Promise(resolve => setTimeout(resolve, 2000));

        let allAthletes = [];
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages && currentPage <= 10) { // Safety limit
            console.log(`    📊 Processing page ${currentPage}...`);
            
            // CRITICAL: Store the first athlete name to detect when page actually changes
            const pageIdentifier = await page.evaluate(() => {
                const firstRow = document.querySelector('.v-data-table__wrapper tbody tr');
                if (firstRow) {
                    const firstCell = firstRow.querySelector('td');
                    return firstCell ? firstCell.textContent.trim() : null;
                }
                return null;
            });
            
            console.log(`      🏷️  Page ${currentPage} identifier: "${pageIdentifier}"`);

            // Extract athlete data from current page
            const pageAthletes = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                
                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const cellTexts = cells.map(cell => cell.textContent.trim());

                    // Extract athlete name (usually first column)
                    const athleteName = cellTexts[0] || '';
                    
                    // Extract other data based on column positions
                    const rawAge = cellTexts.find(text => /\d{1,3}/.test(text)) || '';
                    const numericAge = rawAge.match(/\d{1,3}/)?.[0] || '';

                    return {
                        athleteName,
                        age: numericAge,
                        _rowIndex: rows.indexOf(row),
                        _hasClickableRow: row.classList.contains('row-clickable'),
                        _rowClasses: row.className
                    };
                });
            });

            // Extract internal_ids from clickable rows
            const athletesNeedingInternalIds = pageAthletes.filter(a => a._hasClickableRow && !a.internalId);
            const totalClickableRows = pageAthletes.filter(a => a._hasClickableRow).length;
            
            console.log(`      📊 Page ${currentPage}: ${pageAthletes.length} athletes, ${totalClickableRows} clickable rows, ${athletesNeedingInternalIds.length} need internal_id extraction`);
            
            // Debug: Show row classes for first few athletes
            if (pageAthletes.length > 0) {
                console.log(`      🔍 Debug - First 3 athletes' row classes:`);
                pageAthletes.slice(0, 3).forEach((athlete, i) => {
                    console.log(`        ${i+1}. ${athlete.athleteName}: "${athlete._rowClasses}" (clickable: ${athlete._hasClickableRow})`);
                });
            }
            
            if (athletesNeedingInternalIds.length > 0) {
                console.log(`      🔗 Extracting internal_ids from ${athletesNeedingInternalIds.length} clickable rows...`);
                
                for (const athlete of athletesNeedingInternalIds) {
                    try {
                        const internalId = await page.evaluate((rowIndex, athleteName) => {
                            return new Promise((resolve) => {
                                setTimeout(() => {
                                    const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                                    const targetRow = rows[rowIndex];
                                    
                                    if (targetRow && targetRow.classList.contains('row-clickable')) {
                                        targetRow.click();
                                        
                                        setTimeout(() => {
                                            const currentUrl = window.location.href;
                                            const match = currentUrl.match(/\/member\/(\d+)/);
                                            const id = match ? parseInt(match[1]) : null;
                                            
                                            // Navigate back
                                            window.history.back();
                                            resolve(id);
                                        }, 1000);
                                    } else {
                                        resolve(null);
                                    }
                                }, 500);
                            });
                        }, athlete._rowIndex, athlete.athleteName);

                        if (internalId) {
                            athlete.internalId = internalId;
                            console.log(`        ✅ ${athlete.athleteName}: internal_id ${internalId}`);
                        } else {
                            console.log(`        ❌ ${athlete.athleteName}: could not extract internal_id`);
                        }

                        await new Promise(resolve => setTimeout(resolve, 100));

                    } catch (error) {
                        console.log(`        ❌ ${athlete.athleteName}: error extracting internal_id - ${error.message}`);
                    }
                }
            } else {
                console.log(`      ℹ️  Page ${currentPage}: No clickable rows need internal_id extraction`);
            }

            // Clean up temporary properties
            pageAthletes.forEach(athlete => {
                delete athlete._rowIndex;
                delete athlete._hasClickableRow;
                delete athlete._rowClasses;
            });

            allAthletes = allAthletes.concat(pageAthletes);
            console.log(`      Page ${currentPage}: Extracted ${pageAthletes.length} athlete(s)`);

            // FIXED PAGINATION LOGIC - Check for next page
            const nextPageExists = await page.evaluate(() => {
                const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                return nextBtn && !nextBtn.disabled;
            });

            if (nextPageExists) {
                console.log(`      ⏳ Moving to page ${currentPage + 1}, waiting for Vue.js re-render...`);
                
                // Click the next page button
                await page.evaluate(() => {
                    const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                    if (nextBtn && !nextBtn.disabled) {
                        nextBtn.click();
                    }
                });
                
                // CRITICAL FIX: Wait for the page content to actually change
                console.log(`      🔄 Waiting for page content to change from "${pageIdentifier}"...`);
                
                try {
                    // Wait for the page number indicator to change
                    await page.waitForFunction(
                        (expectedPage) => {
                            const activePageElement = document.querySelector('.v-pagination__item--active');
                            return activePageElement && parseInt(activePageElement.textContent) === expectedPage;
                        },
                        { timeout: 10000 },
                        currentPage + 1
                    );
                    
                    // Wait for table to be present
                    await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 10000 });
                    
                    // CRITICAL: Wait for the actual content to change
                    await page.waitForFunction(
                        (oldIdentifier) => {
                            const firstRow = document.querySelector('.v-data-table__wrapper tbody tr');
                            if (firstRow) {
                                const firstCell = firstRow.querySelector('td');
                                const newIdentifier = firstCell ? firstCell.textContent.trim() : null;
                                return newIdentifier && newIdentifier !== oldIdentifier;
                            }
                            return false;
                        },
                        { timeout: 15000 },
                        pageIdentifier
                    );
                    
                    // Additional stabilization time for Vue.js
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Verify the page actually changed
                    const newPageIdentifier = await page.evaluate(() => {
                        const firstRow = document.querySelector('.v-data-table__wrapper tbody tr');
                        if (firstRow) {
                            const firstCell = firstRow.querySelector('td');
                            return firstCell ? firstCell.textContent.trim() : null;
                        }
                        return null;
                    });
                    
                    console.log(`      ✅ Page changed successfully: "${pageIdentifier}" → "${newPageIdentifier}"`);
                    currentPage++;
                    
                } catch (error) {
                    console.log(`      ❌ Pagination failed: ${error.message}`);
                    hasMorePages = false;
                }
                
            } else {
                hasMorePages = false;
                console.log(`      🏁 No more pages available`);
            }
        }

        console.log(`    ✅ Scraped ${allAthletes.length} total athletes from division`);
        return allAthletes;

    } catch (error) {
        console.log(`    ❌ Error scraping division: ${error.message}`);
        return [];
    }
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

module.exports = {
    scrapeAthleteDataWithFixedPagination
};