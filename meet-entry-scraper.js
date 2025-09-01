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
    const filters = {
        from_date: fromDate,
        to_date: toDate,
        event_type: 11  // Filter to meets only
    };
    
    const encodedFilters = btoa(JSON.stringify(filters));
    return `https://usaweightlifting.sport80.com/public/events?filters=${encodedFilters}`;
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

// Click on meets to expand and look for entry list link
async function expandMeetAndGetEntryLink(meetIndex) {
    try {
        log(`Expanding meet ${meetIndex + 1} to find entry link...`);
        
        // Find the expansion panel headers and click the correct one
        const expansionHeaders = await page.$$('.v-expansion-panel-header');
        
        if (meetIndex >= expansionHeaders.length) {
            log(`Meet index ${meetIndex} out of range (found ${expansionHeaders.length} meets)`);
            return null;
        }
        
        const targetHeader = expansionHeaders[meetIndex];
        
        // First, close any previously opened panels by checking if they're active
        const activePanels = await page.$$('.v-expansion-panel--active');
        for (const activePanel of activePanels) {
            const activeHeader = await activePanel.$('.v-expansion-panel-header');
            if (activeHeader && activeHeader !== targetHeader) {
                await activeHeader.click();
                log(`Closed previously active panel`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // Click the expansion panel header to expand the panel
        await targetHeader.click();
        log(`Clicked expansion panel header for meet ${meetIndex + 1}`);
        
        // Wait for expansion panel to open
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Look for entry list link in the currently active expanded panel
        const entryLinkInfo = await page.evaluate(() => {
            // Look for the currently active expansion panel
            const activePanel = document.querySelector('.v-expansion-panel--active');
            if (!activePanel) {
                return null;
            }
            
            // Look for "Entry List" or similar links within this panel
            const listItems = activePanel.querySelectorAll('.v-list-item');
            
            for (const item of listItems) {
                const titleElement = item.querySelector('.v-list-item__title');
                if (titleElement) {
                    const titleText = titleElement.textContent?.trim().toLowerCase();
                    
                    // Look for entry-related text
                    if (titleText && (titleText.includes('entry') || titleText.includes('entries'))) {
                        // Try to find a link
                        const linkElement = item.querySelector('a') || item;
                        const href = linkElement.getAttribute('href') || linkElement.onclick;
                        
                        return {
                            text: titleElement.textContent?.trim(),
                            href: href,
                            found: true
                        };
                    }
                }
            }
            
            return { found: false };
        });
        
        log(`Entry link search for meet ${meetIndex + 1}: ${entryLinkInfo?.found ? 'Found' : 'Not found'}`);
        if (entryLinkInfo?.found) {
            log(`   Entry link: ${entryLinkInfo.text}`);
        }
        
        return entryLinkInfo;
        
    } catch (error) {
        log(`Error expanding meet ${meetIndex + 1}: ${error.message}`);
        return null;
    }
}

// Navigate to entry page and scrape entry data
async function scrapeEntryData(entryUrl) {
    try {
        log(`Navigating to entry page: ${entryUrl}`);
        
        await page.goto(entryUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Scrape entry data from the page
        const entryData = await page.evaluate(() => {
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
        
        log(`Scraped ${entryData.length} entries from entry page`);
        return entryData;
        
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
            
            // For each meet, try to find entry link and scrape entries
            for (let i = 0; i < meetData.length; i++) {
                const meet = meetData[i];
                log(`\n🔍 Processing meet: ${meet.meet_name}`);
                
                const entryLinkInfo = await expandMeetAndGetEntryLink(i);
                
                if (entryLinkInfo && entryLinkInfo.found && entryLinkInfo.href) {
                    log(`Found entry link, navigating to scrape entries...`);
                    
                    // Navigate to entry page and scrape
                    const entryData = await scrapeEntryData(entryLinkInfo.href);
                    
                    meet.entries = entryData;
                    meet.entry_url = entryLinkInfo.href;
                    meet.entry_count = entryData.length;
                    
                    // Return to events page
                    await page.goto(eventsURL, { waitUntil: 'networkidle0', timeout: 30000 });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    log(`No entry link found for ${meet.meet_name}`);
                    meet.entries = [];
                    meet.entry_url = null;
                    meet.entry_count = 0;
                }
                
                allMeetData.push(meet);
                
                // Small delay between meets
                await new Promise(resolve => setTimeout(resolve, 1000));
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
        
        // Save results
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                script_name: 'meet-entry-scraper',
                date_range: {
                    from: options.fromDate,
                    to: options.toDate
                },
                processing_time_ms: Date.now() - startTime,
                pages_processed: currentPage - 1,
                total_meets: allMeetData.length,
                meets_with_entries: allMeetData.filter(m => m.entry_count > 0).length,
                total_entries: allMeetData.reduce((sum, meet) => sum + meet.entry_count, 0)
            },
            meets: allMeetData
        };
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
        log(`📄 Results saved to: ${OUTPUT_FILE}`);
        
        // Summary
        log('\n' + '='.repeat(60));
        log('✅ MEET ENTRY SCRAPING COMPLETE');
        log(`   Date range: ${options.fromDate} to ${options.toDate}`);
        log(`   Pages processed: ${currentPage - 1}`);
        log(`   Total meets found: ${allMeetData.length}`);
        log(`   Meets with entries: ${report.metadata.meets_with_entries}`);
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