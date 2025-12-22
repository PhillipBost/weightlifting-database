/**
 * Fix for Tier 1 internal_id extraction "one-way street" problem
 * 
 * Problem: Clicking a row to extract internal_id makes other rows unclickable
 * Solution: Extract internal_ids without clicking, or restore state after each click
 */

async function extractInternalIdsWithoutBreaking(page, pageAthletes) {
    console.log(`🔗 Extracting internal_ids from ${pageAthletes.length} athletes without breaking clickability...`);
    
    // Method 1: Try to extract all internal_ids from Vue.js router data without clicking
    const vueExtractionResults = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
        
        return rows.map((row, index) => {
            const cells = Array.from(row.querySelectorAll('td'));
            const athleteName = cells.length > 0 ? cells[0].textContent.trim() : 'NO_NAME';
            
            // Try multiple non-clicking extraction methods
            let internalId = null;
            let method = 'none';
            
            // Method 1: Data attributes
            const dataId = row.getAttribute('data-id') || row.getAttribute('data-member-id') || row.getAttribute('data-athlete-id');
            if (dataId) {
                internalId = parseInt(dataId);
                method = 'data-attribute';
            }
            
            // Method 2: Vue.js component data
            if (!internalId && row.__vue__) {
                const vueData = row.__vue__;
                if (vueData.$data) {
                    // Try various Vue data properties
                    const possibleIds = [
                        vueData.$data.internal_id,
                        vueData.$data.athleteId,
                        vueData.$data.memberId,
                        vueData.$data.id
                    ];
                    
                    for (const id of possibleIds) {
                        if (id && typeof id === 'number') {
                            internalId = id;
                            method = 'vue-data';
                            break;
                        }
                    }
                }
                
                // Try Vue props
                if (!internalId && vueData.$props) {
                    const possibleIds = [
                        vueData.$props.internal_id,
                        vueData.$props.athleteId,
                        vueData.$props.memberId,
                        vueData.$props.id
                    ];
                    
                    for (const id of possibleIds) {
                        if (id && typeof id === 'number') {
                            internalId = id;
                            method = 'vue-props';
                            break;
                        }
                    }
                }
            }
            
            // Method 3: Check for hidden links or href attributes
            if (!internalId) {
                const links = row.querySelectorAll('a[href*="/member/"]');
                if (links.length > 0) {
                    const href = links[0].getAttribute('href');
                    const match = href.match(/\/member\/(\d+)/);
                    if (match) {
                        internalId = parseInt(match[1]);
                        method = 'hidden-link';
                    }
                }
            }
            
            // Method 4: Check onclick handlers or event listeners
            if (!internalId) {
                const onclick = row.getAttribute('onclick');
                if (onclick && onclick.includes('member')) {
                    const match = onclick.match(/(\d+)/);
                    if (match) {
                        internalId = parseInt(match[1]);
                        method = 'onclick-handler';
                    }
                }
            }
            
            return {
                index,
                athleteName,
                internalId,
                method,
                isClickable: row.classList.contains('row-clickable')
            };
        });
    });
    
    // Apply results to pageAthletes
    let successCount = 0;
    vueExtractionResults.forEach((result, index) => {
        if (result.internalId && pageAthletes[index]) {
            pageAthletes[index].internalId = result.internalId;
            console.log(`  ✅ ${result.athleteName}: internal_id ${result.internalId} (via ${result.method})`);
            successCount++;
        }
    });
    
    console.log(`  📊 Non-clicking extraction: ${successCount}/${pageAthletes.length} successful`);
    
    // Method 2: For remaining athletes, use careful clicking with state restoration
    const remainingAthletes = pageAthletes.filter(a => !a.internalId && a._hasClickableRow);
    
    if (remainingAthletes.length > 0) {
        console.log(`  🖱️  Attempting careful clicking for ${remainingAthletes.length} remaining athletes...`);
        
        for (const athlete of remainingAthletes) {
            try {
                // Store current page state before clicking
                const pageState = await page.evaluate(() => {
                    return {
                        url: window.location.href,
                        scrollPosition: window.scrollY,
                        activeElement: document.activeElement ? document.activeElement.tagName : null
                    };
                });
                
                // Attempt to click and extract internal_id
                const internalId = await page.evaluate((rowIndex, athleteName) => {
                    return new Promise((resolve) => {
                        const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                        const targetRow = rows[rowIndex];
                        
                        if (!targetRow || !targetRow.classList.contains('row-clickable')) {
                            resolve(null);
                            return;
                        }
                        
                        // Capture URL changes
                        let capturedUrl = null;
                        
                        // Override history methods to capture navigation
                        const originalPushState = history.pushState;
                        const originalReplaceState = history.replaceState;
                        
                        history.pushState = function(state, title, url) {
                            if (url && url.includes('/member/')) {
                                capturedUrl = url;
                            }
                            return originalPushState.call(this, state, title, url);
                        };
                        
                        history.replaceState = function(state, title, url) {
                            if (url && url.includes('/member/')) {
                                capturedUrl = url;
                            }
                            return originalReplaceState.call(this, state, title, url);
                        };
                        
                        // Click the row
                        targetRow.click();
                        
                        setTimeout(() => {
                            // Restore original functions
                            history.pushState = originalPushState;
                            history.replaceState = originalReplaceState;
                            
                            // Extract internal_id from captured URL
                            if (capturedUrl) {
                                const match = capturedUrl.match(/\/member\/(\d+)/);
                                if (match) {
                                    resolve(parseInt(match[1]));
                                    return;
                                }
                            }
                            
                            // Also check current URL
                            const currentUrl = window.location.href;
                            if (currentUrl.includes('/member/')) {
                                const match = currentUrl.match(/\/member\/(\d+)/);
                                if (match) {
                                    resolve(parseInt(match[1]));
                                    return;
                                }
                            }
                            
                            resolve(null);
                        }, 1000);
                    });
                }, athlete._rowIndex, athlete.athleteName);
                
                if (internalId) {
                    athlete.internalId = internalId;
                    console.log(`    ✅ ${athlete.athleteName}: internal_id ${internalId} (via clicking)`);
                    
                    // Navigate back to restore state
                    await page.goBack();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Wait for table to be ready again
                    await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 5000 });
                    
                } else {
                    console.log(`    ❌ ${athlete.athleteName}: could not extract internal_id`);
                }
                
                // Small delay between attempts
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.log(`    ❌ ${athlete.athleteName}: error during clicking - ${error.message}`);
                
                // Try to recover by going back
                try {
                    await page.goBack();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (recoveryError) {
                    console.log(`    ⚠️  Could not recover page state: ${recoveryError.message}`);
                }
            }
        }
    }
    
    const finalSuccessCount = pageAthletes.filter(a => a.internalId).length;
    console.log(`  🎯 Final result: ${finalSuccessCount}/${pageAthletes.length} athletes have internal_ids`);
    
    return pageAthletes;
}

module.exports = {
    extractInternalIdsWithoutBreaking
};