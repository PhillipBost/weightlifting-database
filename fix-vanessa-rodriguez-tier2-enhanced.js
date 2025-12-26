/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

/**
 * ENHANCED Tier 2 verification with bodyweight/total extraction and comparison
 * This fixes the critical bug where Vanessa Rodriguez was assigned to wrong athlete
 */
async function enhancedVerifyLifterParticipationInMeet(lifterInternalId, targetMeetId, expectedBodyweight = null, expectedTotal = null) {
    // Get target meet information for enhanced matching
    const { data: targetMeet, error: meetError } = await supabase
        .from('usaw_meets')
        .select('meet_id, meet_internal_id, Meet, Date')
        .eq('meet_id', targetMeetId)
        .single();
    
    if (meetError) {
        console.log(`    ❌ Error getting meet info: ${meetError.message}`);
        return { verified: false, reason: 'meet_info_error' };
    }

    const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${lifterInternalId}`;
    console.log(`    🌐 Visiting: ${memberUrl}`);
    console.log(`    🎯 Looking for: "${targetMeet.Meet}" on ${targetMeet.Date}`);
    
    if (expectedBodyweight || expectedTotal) {
        console.log(`    📊 Expected: BW=${expectedBodyweight}kg, Total=${expectedTotal}kg`);
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--disable-extensions'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1500, height: 1000 });

        // Navigate to the member page
        await page.goto(memberUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for table to load
        await page.waitForSelector('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Search through all pages of meet history
        let foundMeet = null;
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages && !foundMeet) {
            console.log(`    📄 Checking page ${currentPage} of meet history...`);

            // Extract meet information from current page with ENHANCED data extraction
            const pageData = await page.evaluate(() => {
                const meetRows = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr'));

                // Get headers to understand column structure
                const headers = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table thead th'))
                    .map(th => th.textContent.trim());

                console.log('Headers:', headers);

                const meetInfo = meetRows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length < 2) return null;

                    const meetName = cells[0]?.textContent?.trim();
                    const meetDate = cells[1]?.textContent?.trim();
                    
                    // ENHANCED: Extract bodyweight and total from the row
                    // Based on the user's console output, the structure is:
                    // ['Meet', 'Date', 'Age Category', 'Lifter', 'Body Weight (Kg)', 'Snatch Lift 1', 'Snatch Lift 2', 'Snatch Lift 3', 'C&J Lift 1', 'C&J Lift 2', 'C&J Lift 3', 'Best Snatch', 'Best C&J', 'Total']
                    
                    let bodyweight = null;
                    let bestSnatch = null;
                    let bestCJ = null;
                    let total = null;
                    
                    // Find bodyweight column (usually index 4: 'Body Weight (Kg)')
                    if (cells[4]) {
                        const bwText = cells[4].textContent?.trim();
                        if (bwText && !isNaN(parseFloat(bwText))) {
                            bodyweight = parseFloat(bwText);
                        }
                    }
                    
                    // Find best snatch column (usually index 11: 'Best Snatch')
                    if (cells[11]) {
                        const snatchText = cells[11].textContent?.trim();
                        if (snatchText && !isNaN(parseFloat(snatchText))) {
                            bestSnatch = parseFloat(snatchText);
                        }
                    }
                    
                    // Find best C&J column (usually index 12: 'Best C&J')
                    if (cells[12]) {
                        const cjText = cells[12].textContent?.trim();
                        if (cjText && !isNaN(parseFloat(cjText))) {
                            bestCJ = parseFloat(cjText);
                        }
                    }
                    
                    // Find total column (usually index 13: 'Total')
                    if (cells[13]) {
                        const totalText = cells[13].textContent?.trim();
                        if (totalText && !isNaN(parseFloat(totalText))) {
                            total = parseFloat(totalText);
                        }
                    }

                    return {
                        name: meetName,
                        date: meetDate,
                        bodyweight: bodyweight,
                        bestSnatch: bestSnatch,
                        bestCJ: bestCJ,
                        total: total,
                        rawCells: cells.map(c => c.textContent?.trim()) // For debugging
                    };
                }).filter(Boolean);

                return meetInfo;
            });

            // Match by meet name and date (with ±5 day tolerance)
            foundMeet = pageData.find(meet => {
                const nameMatch = meet.name === targetMeet.Meet;
                
                // Date matching with ±5 day tolerance
                let dateMatch = false;
                if (meet.date && targetMeet.Date) {
                    try {
                        const sport80Date = new Date(meet.date);
                        const targetDate = new Date(targetMeet.Date);
                        const daysDifference = Math.abs((sport80Date - targetDate) / (1000 * 60 * 60 * 24));
                        dateMatch = daysDifference <= 5;
                        
                        if (nameMatch) {
                            console.log(`    📅 Date comparison: Sport80="${meet.date}" vs Target="${targetMeet.Date}" (${daysDifference.toFixed(1)} days difference)`);
                        }
                    } catch (error) {
                        // Fallback to exact string match if date parsing fails
                        dateMatch = meet.date === targetMeet.Date;
                    }
                }
                
                return nameMatch && dateMatch;
            });

            if (foundMeet) {
                console.log(`    ✅ FOUND MEET: "${foundMeet.name}" on ${foundMeet.date} found on page ${currentPage}`);
                console.log(`    📊 Sport80 Data: BW=${foundMeet.bodyweight}kg, Total=${foundMeet.total}kg`);
                
                // ENHANCED: Compare bodyweight and total if provided
                let bodyweightMatch = true;
                let totalMatch = true;
                
                if (expectedBodyweight && foundMeet.bodyweight) {
                    const bwDiff = Math.abs(expectedBodyweight - foundMeet.bodyweight);
                    bodyweightMatch = bwDiff <= 2.0; // Allow 2kg tolerance for bodyweight
                    console.log(`    ⚖️  Bodyweight: Expected=${expectedBodyweight}kg, Found=${foundMeet.bodyweight}kg, Diff=${bwDiff.toFixed(1)}kg, Match=${bodyweightMatch}`);
                }
                
                if (expectedTotal && foundMeet.total) {
                    const totalDiff = Math.abs(expectedTotal - foundMeet.total);
                    totalMatch = totalDiff <= 5; // Allow 5kg tolerance for total
                    console.log(`    🏋️  Total: Expected=${expectedTotal}kg, Found=${foundMeet.total}kg, Diff=${totalDiff.toFixed(1)}kg, Match=${totalMatch}`);
                }
                
                if (bodyweightMatch && totalMatch) {
                    console.log(`    ✅ VERIFIED: Meet found with matching performance data`);
                    return {
                        verified: true,
                        meetData: foundMeet,
                        reason: 'meet_and_performance_match'
                    };
                } else {
                    console.log(`    ❌ PERFORMANCE MISMATCH: Meet found but performance data doesn't match`);
                    console.log(`    📋 Raw cells for debugging:`, foundMeet.rawCells);
                    return {
                        verified: false,
                        meetData: foundMeet,
                        reason: 'performance_mismatch',
                        bodyweightMatch: bodyweightMatch,
                        totalMatch: totalMatch
                    };
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
                // Wait for next page to load
                await new Promise(resolve => setTimeout(resolve, 3000));
                await page.waitForSelector('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr', { timeout: 10000 });
                currentPage++;
            }
        }

        console.log(`    ❌ NOT FOUND: "${targetMeet.Meet}" on ${targetMeet.Date} not found in ${currentPage} page(s) of history`);
        return {
            verified: false,
            reason: 'meet_not_found'
        };

    } catch (error) {
        console.log(`    ❌ Error accessing member page: ${error.message}`);
        return {
            verified: false,
            reason: 'technical_error',
            error: error.message
        };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Test the enhanced Tier 2 verification with Vanessa Rodriguez case
 */
async function testVanessaRodriguezCase() {
    console.log('🧪 Testing Enhanced Tier 2 Verification with Vanessa Rodriguez Case\n');
    
    // Test data from the user's console output
    const testCases = [
        {
            name: 'Vanessa Rodriguez (Correct - internal_id 59745)',
            internal_id: 59745,
            expected_bodyweight: 75.4,
            expected_total: 130,
            meet_id: 7142
        },
        {
            name: 'Vanessa Rodriguez (Wrong - internal_id 28381)', 
            internal_id: 28381,
            expected_bodyweight: 75.4,
            expected_total: 130,
            meet_id: 7142
        }
    ];
    
    for (const testCase of testCases) {
        console.log(`\n=== Testing: ${testCase.name} ===`);
        
        const result = await enhancedVerifyLifterParticipationInMeet(
            testCase.internal_id,
            testCase.meet_id,
            testCase.expected_bodyweight,
            testCase.expected_total
        );
        
        console.log(`📊 Result:`, result);
        
        if (result.verified) {
            console.log(`✅ CORRECT: This athlete should be used for the result`);
        } else {
            console.log(`❌ INCORRECT: This athlete should NOT be used (${result.reason})`);
        }
    }
}

/**
 * Delete the incorrect Vanessa Rodriguez result from meet 7142
 */
async function deleteIncorrectVanessaResult() {
    console.log('\n🗑️  Deleting incorrect Vanessa Rodriguez result from meet 7142...\n');
    
    // First, let's see what results exist for Vanessa Rodriguez in meet 7142
    const { data: existingResults, error: queryError } = await supabase
        .from('usaw_meet_results')
        .select('result_id, lifter_id, lifter_name, body_weight_kg, total, meet_id')
        .eq('meet_id', 7142)
        .ilike('lifter_name', '%vanessa rodriguez%');
    
    if (queryError) {
        console.error('❌ Error querying existing results:', queryError.message);
        return;
    }
    
    console.log(`📊 Found ${existingResults.length} Vanessa Rodriguez results in meet 7142:`);
    existingResults.forEach((result, index) => {
        console.log(`  ${index + 1}. Result ID: ${result.result_id}, Lifter ID: ${result.lifter_id}, BW: ${result.body_weight_kg}kg, Total: ${result.total}kg`);
    });
    
    // Find the incorrect result (should be the one with wrong bodyweight/total for lifter_id 4199)
    const incorrectResult = existingResults.find(r => 
        r.lifter_id === 4199 && 
        (parseFloat(r.body_weight_kg) === 75.4 || parseFloat(r.total) === 130)
    );
    
    if (incorrectResult) {
        console.log(`\n🎯 Found incorrect result to delete: Result ID ${incorrectResult.result_id} (Lifter ID: ${incorrectResult.lifter_id})`);
        
        // Delete the incorrect result
        const { error: deleteError } = await supabase
            .from('usaw_meet_results')
            .delete()
            .eq('result_id', incorrectResult.result_id);
        
        if (deleteError) {
            console.error('❌ Error deleting incorrect result:', deleteError.message);
        } else {
            console.log('✅ Successfully deleted incorrect Vanessa Rodriguez result');
        }
    } else {
        console.log('⚠️  Could not identify the incorrect result to delete');
    }
}

// Main execution
async function main() {
    try {
        // Step 1: Test the enhanced verification
        await testVanessaRodriguezCase();
        
        // Step 2: Delete the incorrect result
        await deleteIncorrectVanessaResult();
        
        console.log('\n✅ Enhanced Tier 2 verification test completed');
        
    } catch (error) {
        console.error('❌ Error in main execution:', error.message);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    enhancedVerifyLifterParticipationInMeet,
    testVanessaRodriguezCase,
    deleteIncorrectVanessaResult
};