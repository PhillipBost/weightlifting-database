/**
 * MEET ENTRY SCRAPER
 * 
 * Scrapes meet entries from Sport80 events pages
 * Captures entry data: member ID, names, state, birth year, age, club, gender, 
 * division, weight class, and entry total declarations
 * 
 * Usage:
 *   node meet-entry-scraper.js
 *   node meet-entry-scraper.js --year 2024
 *   node meet-entry-scraper.js --from-date 2024-01-01 --to-date 2024-12-31
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Configuration
const OUTPUT_DIR = './output';
const LOGS_DIR = './logs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'meet_entries.json');
const LOG_FILE = path.join(LOGS_DIR, 'meet-entry-scraper.log');

// Browser instance
let browser = null;
let page = null;

// Ensure directories exist
function ensureDirectories() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

// Logging utility
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    console.log(message);
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        fromDate: null,
        toDate: null
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--year':
                const year = args[i + 1];
                options.fromDate = `${year}-01-01`;
                options.toDate = `${year}-12-31`;
                i++;
                break;
            case '--from-date':
                options.fromDate = args[i + 1];
                i++;
                break;
            case '--to-date':
                options.toDate = args[i + 1];
                i++;
                break;
        }
    }
    
    // Default to current year if no dates provided
    if (!options.fromDate || !options.toDate) {
        const currentYear = new Date().getFullYear();
        options.fromDate = `${currentYear}-01-01`;
        options.toDate = `${currentYear}-12-31`;
    }
    
    return options;
}

// Build Sport80 events URL with base64 encoded filters
function buildEventsURL(fromDate, toDate) {
    // Expand date range by +/- 7 days to catch week-long meets
    const expandedFromDate = new Date(fromDate);
    expandedFromDate.setDate(expandedFromDate.getDate() - 7);
    
    const expandedToDate = new Date(toDate);
    expandedToDate.setDate(expandedToDate.getDate() + 7);
    
    const finalFromDate = expandedFromDate.toISOString().split('T')[0];
    const finalToDate = expandedToDate.toISOString().split('T')[0];
    
    const filters = {
        from_date: finalFromDate,
        to_date: finalToDate,
        event_type: 11  // Filter to meets only
    };
    
    const encodedFilters = btoa(JSON.stringify(filters));
    const url = `https://usaweightlifting.sport80.com/public/events?filters=${encodedFilters}`;
    
    log(`📅 Date range expanded: ${fromDate} to ${toDate} → ${finalFromDate} to ${finalToDate}`);
    return url;
}

// Initialize browser
async function initBrowser() {
    log('Initializing browser for meet entry scraping...');
    
    browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    
    log('Browser initialized successfully');
}

// Scrape meet basic info from a single page
async function scrapeMeetBasicInfo() {
    log('Scraping meet basic info from current page...');
    
    const meetData = await page.evaluate(() => {
        const results = [];
        
        // Look for meet rows based on the actual DOM structure
        const meetRows = document.querySelectorAll('.row.no-gutters.align-center');
        
        for (const row of meetRows) {
            try {
                // Find the meet name in <strong> tag
                const meetNameElement = row.querySelector('strong');
                
                // Find the date/location span with calendar icon
                const dateLocationElement = row.querySelector('span.d-block.mt-2.grey--text');
                
                // Find the expand button
                const expandButton = row.querySelector('button.s80-btn');
                
                if (meetNameElement) {
                    const meetInfo = {
                        meet_name: meetNameElement.textContent?.trim() || null,
                        date_location: dateLocationElement?.textContent?.trim() || null,
                        has_expand_button: !!expandButton,
                        full_text: row.textContent?.trim() || null
                    };
                    
                    // Parse date and location from the combined text if available
                    if (meetInfo.date_location) {
                        // Try to extract location (usually after the last dash)
                        const parts = meetInfo.date_location.split(' - ');
                        if (parts.length >= 2) {
                            meetInfo.location = parts[parts.length - 1].trim();
                            meetInfo.date_range = parts.slice(0, -1).join(' - ').trim();
                        }
                    }
                    
                    results.push(meetInfo);
                }
            } catch (error) {
                console.log('Error processing meet row:', error.message);
            }
        }
        
        return results;
    });
    
    log(`Found ${meetData.length} meets on current page`);
    return meetData;
}

// Find and click Entry List button for a specific meet
async function findAndClickEntryButton(meetIndex) {
    try {
        log(`Looking for Entry List button for meet ${meetIndex + 1}...`);
        
        // Get all meet rows (divs with class 'row no-gutters align-center')
        const meetRows = await page.$$('.row.no-gutters.align-center');
        
        if (meetIndex >= meetRows.length) {
            log(`Meet index ${meetIndex} out of range (found ${meetRows.length} meets)`);
            return null;
        }
        
        const targetRow = meetRows[meetIndex];
        
        // Look for Entry List button in this specific row
        const entryButtonInfo = await page.evaluate((row) => {
            // Find the meet name in this row
            const meetNameElement = row.querySelector('strong');
            const meetName = meetNameElement?.textContent?.trim() || 'Unknown';
            
            // Find all buttons in this row
            const buttons = row.querySelectorAll('button.s80-btn');
            
            for (const button of buttons) {
                const buttonText = button.textContent?.trim();
                if (buttonText && buttonText.includes('Entry List')) {
                    return {
                        found: true,
                        meet_name: meetName,
                        button_text: buttonText,
                        aria_description: button.getAttribute('aria-description')
                    };
                }
            }
            
            return { found: false, meet_name: meetName };
        }, targetRow);
        
        if (entryButtonInfo.found) {
            log(`✅ Found Entry List button for: ${entryButtonInfo.meet_name}`);
            log(`   Button text: "${entryButtonInfo.button_text}"`);
            log(`   Aria description: "${entryButtonInfo.aria_description}"`);
            
            // Click the Entry List button (opens in new tab)
            log(`🖱️ Clicking Entry List button (expects new tab)...`);
            
            // Get initial tab count
            const initialPages = await browser.pages();
            log(`📊 Initial tabs: ${initialPages.length}`);
            
            // Wait for new tab to open with timeout
            const newPagePromise = Promise.race([
                new Promise(resolve => {
                    browser.once('targetcreated', target => {
                        log(`🎯 New target created: ${target.type()}`);
                        resolve(target);
                    });
                }),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('No new tab created within 10 seconds')), 10000);
                })
            ]);
            
            // Click the Entry List button directly
            const button = await targetRow.$('button.s80-btn');
            if (button) {
                log(`🖱️ Clicking button...`);
                await button.click();
                log(`✅ Button clicked`);
            } else {
                throw new Error('Could not find button element to click');
            }
            
            log(`🖱️ Entry List button clicked, waiting for new tab...`);
            
            // Wait for new tab to be created
            const newTarget = await newPagePromise;
            const newPage = await newTarget.page();
            
            if (!newPage) {
                throw new Error('Failed to get new page from new tab');
            }
            
            // Wait for the new tab content to load
            await newPage.waitForSelector('body', { timeout: 30000 });
            
            const entryUrl = newPage.url();
            log(`🌐 Entry List URL (new tab): ${entryUrl}`);
            
            const finalUrl = entryUrl;
            return {
                found: true,
                meet_name: entryButtonInfo.meet_name,
                entry_url: finalUrl,
                button_text: entryButtonInfo.button_text,
                newPage: newPage  // Return the new page for scraping
            };
            
        } else {
            log(`❌ No Entry List button found for: ${entryButtonInfo.meet_name}`);
            return { 
                found: false, 
                meet_name: entryButtonInfo.meet_name 
            };
        }
        
    } catch (error) {
        log(`Error finding Entry List button for meet ${meetIndex + 1}: ${error.message}`);
        return null;
    }
}

// Scrape entry data from a specific page (new tab)
async function scrapeEntryDataFromPage(targetPage) {
    try {
        log(`Scraping entry data from page: ${targetPage.url()}`);
        
        // Give the page time to fully load all entries
        log(`⏳ Waiting for entry data to load...`);
        await new Promise(resolve => setTimeout(resolve, 8000)); // Increased to 8 seconds
        
        // Try to wait for table or entry content to be present
        try {
            await targetPage.waitForSelector('table, .entry-row, .athlete-entry, tr', { timeout: 10000 });
            log(`✅ Entry content detected`);
        } catch (e) {
            log(`⚠️ No specific entry content detected, proceeding anyway`);
        }
        
        // Scrape entry data with pagination
        let allEntries = [];
        let currentPage = 1;
        let hasNextPage = true;
        
        while (hasNextPage && currentPage <= 10) { // Limit to 10 pages for safety
            log(`📄 Scraping entries from page ${currentPage}...`);
            
            // Scrape current page entries
            const pageEntries = await targetPage.evaluate(() => {
                const entries = [];
                
                // Look for table rows containing entry data
                const rows = document.querySelectorAll('tr, .entry-row, .athlete-entry');
                
                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    
                    // Expect a certain number of columns for entry data
                    if (cells.length >= 8) {
                        try {
                            const entry = {
                                member_id: cells[0]?.textContent?.trim() || null,
                                first_name: cells[1]?.textContent?.trim() || null,
                                last_name: cells[2]?.textContent?.trim() || null,
                                state: cells[3]?.textContent?.trim() || null,
                                birth_year: cells[4]?.textContent?.trim() || null,
                                weightlifting_age: cells[5]?.textContent?.trim() || null,
                                club: cells[6]?.textContent?.trim() || null,
                                gender: cells[7]?.textContent?.trim() || null,
                                division_declaration: cells[8]?.textContent?.trim() || null,
                                weight_class_declaration: cells[9]?.textContent?.trim() || null,
                                entry_total_declaration: cells[10]?.textContent?.trim() || null
                            };
                            
                            // Clean up numeric fields
                            if (entry.birth_year) {
                                const year = parseInt(entry.birth_year);
                                entry.birth_year = (year >= 1900 && year <= 2020) ? year : null;
                            }
                            
                            if (entry.weightlifting_age) {
                                const age = parseInt(entry.weightlifting_age);
                                entry.weightlifting_age = (age >= 0 && age <= 100) ? age : null;
                            }
                            
                            if (entry.member_id) {
                                const memberId = parseInt(entry.member_id);
                                entry.member_id = (memberId > 0) ? memberId : null;
                            }
                            
                            if (entry.entry_total_declaration) {
                                const total = parseInt(entry.entry_total_declaration);
                                entry.entry_total_declaration = (total > 0) ? total : null;
                            }
                            
                            // Only add if we have essential data
                            if (entry.first_name || entry.last_name || entry.member_id) {
                                entries.push(entry);
                            }
                            
                        } catch (error) {
                            console.log('Error processing entry row:', error.message);
                        }
                    }
                }
                
                return entries;
            });
            
            log(`   Found ${pageEntries.length} entries on page ${currentPage}`);
            allEntries.push(...pageEntries);
            
            // Check for next page button and navigate
            try {
                const nextButtonSelectors = [
                    '.v-pagination__next:not(.v-pagination__next--disabled)',
                    '.pagination .next:not(.disabled)',
                    'button[aria-label*="next" i]:not([disabled])',
                    '.page-navigation .next:not(.disabled)'
                ];
                
                let nextButton = null;
                for (const selector of nextButtonSelectors) {
                    try {
                        nextButton = await targetPage.$(selector);
                        if (nextButton) {
                            const isClickable = await targetPage.evaluate((btn) => {
                                return !btn.disabled && !btn.classList.contains('disabled');
                            }, nextButton);
                            
                            if (isClickable) {
                                log(`   Found next page button: ${selector}`);
                                break;
                            }
                        }
                    } catch (error) {
                        continue;
                    }
                }
                
                if (nextButton) {
                    await nextButton.click();
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await targetPage.waitForSelector('table, tr', { timeout: 10000 });
                    log(`   Navigated to page ${currentPage + 1}`);
                    currentPage++;
                } else {
                    log(`   No next page button found - finished at page ${currentPage}`);
                    hasNextPage = false;
                }
                
            } catch (error) {
                log(`   Error navigating to next page: ${error.message}`);
                hasNextPage = false;
            }
        }
        
        log(`✅ Scraped ${allEntries.length} total entries across ${currentPage} pages`);
        return allEntries;
        
    } catch (error) {
        log(`Error scraping entry data: ${error.message}`);
        return [];
    }
}

// Check if there's a next page and navigate to it
async function goToNextPage() {
    try {
        // Look for next page button
        const nextButtonSelectors = [
            '.v-pagination__next:not(.v-pagination__next--disabled)',
            '.pagination .next:not(.disabled)',
            'button[aria-label*="next" i]:not([disabled])',
            '.page-navigation .next:not(.disabled)'
        ];
        
        let nextButton = null;
        for (const selector of nextButtonSelectors) {
            try {
                nextButton = await page.$(selector);
                if (nextButton) {
                    // Check if button is actually clickable
                    const isClickable = await page.evaluate((btn) => {
                        return !btn.disabled && !btn.classList.contains('disabled');
                    }, nextButton);
                    
                    if (isClickable) {
                        log(`Found next page button with selector: ${selector}`);
                        break;
                    }
                }
            } catch (error) {
                // Continue to next selector
                continue;
            }
        }
        
        if (nextButton) {
            await nextButton.click();
            await new Promise(resolve => setTimeout(resolve, 3000));
            await page.waitForNetworkIdle();
            log('Successfully navigated to next page');
            return true;
        } else {
            log('No next page button found - reached end of results');
            return false;
        }
        
    } catch (error) {
        log(`Error navigating to next page: ${error.message}`);
        return false;
    }
}

// Main scraping function
async function scrapeMeetEntries() {
    const startTime = Date.now();
    
    try {
        const options = parseArguments();
        log(`🏋️ Starting meet entry scraping for ${options.fromDate} to ${options.toDate}`);
        log('='.repeat(60));
        
        await initBrowser();
        
        const eventsURL = buildEventsURL(options.fromDate, options.toDate);
        log(`📍 Navigating to: ${eventsURL}`);
        
        await page.goto(eventsURL, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        let allMeetData = [];
        let currentPage = 1;
        let hasNextPage = true;
        
        while (hasNextPage && currentPage <= 50) { // Limit to 50 pages for safety
            log(`\n📄 Processing page ${currentPage}...`);
            
            // Get basic meet data from current page
            const meetData = await scrapeMeetBasicInfo();
            
            // Debug: log what meets we found
            log(`\n📋 Found meets on page ${currentPage}:`);
            meetData.forEach((meet, i) => {
                log(`   ${i}: ${meet.meet_name}`);
            });
            
            // For each meet, try to find Entry List button and scrape entries
            for (let i = 0; i < meetData.length; i++) {
                const meet = meetData[i];
                log(`\n🔍 Processing meet: ${meet.meet_name}`);
                log(`📍 Current directory URL: ${page.url()}`);
                
                const entryButtonInfo = await findAndClickEntryButton(i);
                
                if (entryButtonInfo && entryButtonInfo.found && entryButtonInfo.entry_url) {
                    log(`🌐 Entry List URL: ${entryButtonInfo.entry_url}`);
                    log(`🔍 Scraping entry data from new tab...`);
                    
                    // Scrape entry data from the new tab
                    const entryData = await scrapeEntryDataFromPage(entryButtonInfo.newPage);
                    
                    meet.entries = entryData;
                    meet.entry_url = entryButtonInfo.entry_url;
                    meet.entry_count = entryData.length;
                    meet.directory_url = eventsURL;
                    
                    log(`✅ Scraped ${entryData.length} entries`);
                    
                    // Close the new tab
                    log(`🗙 Closing entry tab...`);
                    await entryButtonInfo.newPage.close();
                    
                    // Main page should still be on directory - no need to navigate back
                } else {
                    log(`❌ No Entry List button found for ${meet.meet_name}`);
                    meet.entries = [];
                    meet.entry_url = null;
                    meet.entry_count = 0;
                    meet.directory_url = eventsURL;
                }
                
                // Add URLs to meet data for visibility
                meet.lookup_url = eventsURL;
                
                allMeetData.push(meet);
                
                // Small delay between meets
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            
            log(`Page ${currentPage} complete: ${meetData.length} meets processed`);
            
            // Try to go to next page
            hasNextPage = await goToNextPage();
            currentPage++;
        }
        
        // Close browser
        if (browser) {
            await browser.close();
            log('Browser closed');
        }
        
        // Load existing data if file exists
        let existingData = { meets: [] };
        if (fs.existsSync(OUTPUT_FILE)) {
            try {
                existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
                log(`📂 Loaded existing data: ${existingData.meets?.length || 0} meets`);
            } catch (error) {
                log(`⚠️ Could not parse existing file, starting fresh: ${error.message}`);
                existingData = { meets: [] };
            }
        }

        // Merge new meets with existing ones (avoiding duplicates by meet name + date)
        const existingMeets = existingData.meets || [];
        const newMeets = allMeetData.filter(newMeet => {
            return !existingMeets.some(existing => 
                existing.meet_name === newMeet.meet_name && 
                existing.date_range === newMeet.date_range
            );
        });
        
        const mergedMeets = [...existingMeets, ...newMeets];
        log(`🔄 Merged data: ${existingMeets.length} existing + ${newMeets.length} new = ${mergedMeets.length} total meets`);

        // Save results with merged data
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                script_name: 'meet-entry-scraper',
                date_ranges: [
                    ...(existingData.metadata?.date_ranges || [existingData.metadata?.date_range].filter(Boolean) || []),
                    { from: options.fromDate, to: options.toDate }
                ],
                processing_time_ms: Date.now() - startTime,
                total_processing_time_ms: (existingData.metadata?.total_processing_time_ms || existingData.metadata?.processing_time_ms || 0) + (Date.now() - startTime),
                pages_processed: currentPage - 1,
                total_meets: mergedMeets.length,
                meets_with_entries: mergedMeets.filter(m => m.entry_count > 0).length,
                total_entries: mergedMeets.reduce((sum, meet) => sum + meet.entry_count, 0),
                new_meets_added: newMeets.length
            },
            meets: mergedMeets
        };
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
        log(`📄 Results saved to: ${OUTPUT_FILE}`);
        
        // Summary
        log('\n' + '='.repeat(60));
        log('✅ MEET ENTRY SCRAPING COMPLETE');
        log(`   Date range: ${options.fromDate} to ${options.toDate}`);
        log(`   Pages processed: ${currentPage - 1}`);
        log(`   New meets found: ${allMeetData.length}`);
        log(`   New meets with entries: ${allMeetData.filter(m => m.entry_count > 0).length}`);
        log(`   Total meets in database: ${mergedMeets.length}`);
        log(`   Total meets with entries: ${report.metadata.meets_with_entries}`);
        log(`   Total entries scraped: ${report.metadata.total_entries}`);
        log(`   Processing time: ${Date.now() - startTime}ms`);
        
        return report;
        
    } catch (error) {
        log(`\n❌ Scraping failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        
        if (browser) {
            await browser.close();
        }
        
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    ensureDirectories();
    scrapeMeetEntries();
}

module.exports = {
    scrapeMeetEntries,
    buildEventsURL
};