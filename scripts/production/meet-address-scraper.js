/**
 * MEET ADDRESS SCRAPER
 * 
 * Scrapes meet addresses from Sport80 events page
 * 
 * Usage:
 *   node meet-address-scraper.js
 *   node meet-address-scraper.js --year 2024
 *   node meet-address-scraper.js --from-date 2024-01-01 --to-date 2024-12-31
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
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'meet_addresses.json');
const LOG_FILE = path.join(LOGS_DIR, 'meet-address-scraper.log');

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
    log('Initializing browser for meet address scraping...');
    
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

// Scrape meet addresses from a single page
async function scrapeMeetAddressesFromPage() {
    log('Scraping meet addresses from current page...');
    
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

// Click on meets to expand and get address details
async function expandMeetAndGetAddress(meetIndex) {
    try {
        log(`Expanding meet ${meetIndex + 1} to get address...`);
        
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
        
        // Extract address from the currently active expanded panel only
        const addressInfo = await page.evaluate(() => {
            // Look for the currently active expansion panel
            const activePanel = document.querySelector('.v-expansion-panel--active');
            if (!activePanel) {
                return null;
            }
            
            // Look for the address within this specific active panel
            const listItems = activePanel.querySelectorAll('.v-list-item');
            
            for (const item of listItems) {
                // Check if this list item has a map marker icon
                const mapIcon = item.querySelector('.mdi-map-marker-outline');
                if (mapIcon) {
                    // Get the title from this list item
                    const titleElement = item.querySelector('.v-list-item__title');
                    if (titleElement) {
                        return titleElement.textContent?.trim();
                    }
                }
            }
            
            return null;
        });
        
        log(`Address info for meet ${meetIndex + 1}: ${addressInfo ? 'Found' : 'Not found'}`);
        if (addressInfo) {
            log(`   Address: ${addressInfo.substring(0, 100)}...`);
        }
        
        return addressInfo;
        
    } catch (error) {
        log(`Error expanding meet ${meetIndex + 1}: ${error.message}`);
        return null;
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
async function scrapeMeetAddresses() {
    const startTime = Date.now();
    
    try {
        const options = parseArguments();
        log(`🏋️ Starting meet address scraping for ${options.fromDate} to ${options.toDate}`);
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
            const meetData = await scrapeMeetAddressesFromPage();
            
            // Debug: log what meets we found
            log(`\n📋 Found meets on page ${currentPage}:`);
            meetData.forEach((meet, i) => {
                log(`   ${i}: ${meet.meet_name}`);
            });
            
            // For each meet, try to expand and get address
            for (let i = 0; i < meetData.length; i++) {
                const meet = meetData[i];
                const addressInfo = await expandMeetAndGetAddress(i);
                
                if (addressInfo) {
                    meet.address = addressInfo;
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

        // Save results
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                script_name: 'meet-address-scraper',
                date_ranges: [
                    ...(existingData.metadata?.date_ranges || [existingData.metadata?.date_range].filter(Boolean) || []),
                    { from: options.fromDate, to: options.toDate }
                ],
                processing_time_ms: Date.now() - startTime,
                total_processing_time_ms: (existingData.metadata?.total_processing_time_ms || existingData.metadata?.processing_time_ms || 0) + (Date.now() - startTime),
                pages_processed: currentPage - 1,
                total_meets: mergedMeets.length,
                new_meets_added: newMeets.length
            },
            meets: mergedMeets
        };
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
        log(`📄 Results saved to: ${OUTPUT_FILE}`);
        
        // Summary
        log('\n' + '='.repeat(60));
        log('✅ MEET ADDRESS SCRAPING COMPLETE');
        log(`   Date range: ${options.fromDate} to ${options.toDate}`);
        log(`   Pages processed: ${currentPage - 1}`);
        log(`   New meets found: ${allMeetData.length}`);
        log(`   New meets with addresses: ${allMeetData.filter(m => m.address).length}`);
        log(`   Total meets in database: ${mergedMeets.length}`);
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
    scrapeMeetAddresses();
}

module.exports = {
    scrapeMeetAddresses,
    buildEventsURL
};