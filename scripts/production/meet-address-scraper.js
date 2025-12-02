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
const LOGS_DIR = './logs';
const LOG_FILE = path.join(LOGS_DIR, 'meet-address-scraper.log');

// Browser instance
let browser = null;
let page = null;

// Ensure directories exist
function ensureDirectories() {
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

// Extract GPS coordinates from Google Maps iframe
async function extractGoogleMapsCoordinates(page) {
    try {
        log('🗺️ Attempting to extract Google Maps coordinates...');

        // Wait for iframe to load within the active panel (20s timeout with polling)
        const iframeLoaded = await page.waitForFunction(
            () => {
                const activePanel = document.querySelector('.v-expansion-panel--active');
                if (!activePanel) return false;

                const iframe = activePanel.querySelector('iframe[src*="google.com/maps"]');
                return iframe !== null;
            },
            { timeout: 20000, polling: 1000 }
        ).catch(() => false);

        if (!iframeLoaded) {
            log('   ℹ️ No Google Maps iframe found in active panel');
            return null;
        }

        // Get the iframe's src URL from the ACTIVE PANEL (prevents coordinate leakage!)
        const iframeSrc = await page.evaluate(() => {
            const activePanel = document.querySelector('.v-expansion-panel--active');
            if (!activePanel) return null;
            const iframe = activePanel.querySelector('iframe[src*="google.com/maps"]');
            return iframe ? iframe.src : null;
        });

        if (!iframeSrc) {
            log('   ℹ️ Could not get iframe src from active panel');
            return null;
        }

        // Find the frame that matches THIS SPECIFIC iframe's src (not just any Google Maps frame)
        const frames = page.frames();
        const googleMapsFrame = frames.find(frame => frame.url() === iframeSrc);

        if (!googleMapsFrame) {
            log('   ℹ️ Google Maps frame not found (no frame matches the active panel\'s iframe src)');
            return null;
        }

        log('   🔍 Found Google Maps frame, waiting for "View larger map" link...');

        // Wait for link to load within the frame context (5s timeout)
        let linkElement = null;
        try {
            linkElement = await googleMapsFrame.waitForSelector(
                'a[aria-label="View larger map"]',
                { timeout: 5000 }
            );
        } catch (error) {
            log('   ℹ️ No "View larger map" link found in iframe (timed out after 5s)');
            return null;
        }

        if (!linkElement) {
            log('   ℹ️ No "View larger map" link found in iframe');
            return null;
        }

        log('   🔗 Found Google Maps link, extracting href...');

        // Get the href from the link (simpler and more reliable than opening new tab)
        const mapsUrl = await linkElement.evaluate(el => el.href);

        if (!mapsUrl) {
            log('   ⚠️ Link found but href is empty');
            return null;
        }

        log(`   🌐 Google Maps URL: ${mapsUrl.substring(0, 100)}...`);

        // Parse coordinates from URL
        const coordinates = parseCoordinatesFromUrl(mapsUrl);

        if (coordinates) {
            log(`   📍 Extracted: ${coordinates.latitude}, ${coordinates.longitude}`);
            return {
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
                source_url: mapsUrl,
                strategy: 'sport80_google_maps_link'
            };
        } else {
            log('   ⚠️ Could not parse coordinates from URL');
            return null;
        }

    } catch (error) {
        log(`   ❌ Error extracting coordinates: ${error.message}`);
        return null;
    }
}

// Parse latitude/longitude from Google Maps URL
function parseCoordinatesFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const params = urlObj.searchParams;

        // Try different parameter patterns (priority order)
        const patterns = [
            params.get('ll'),      // ll=40.460986,-75.876225
            params.get('q'),       // q=40.460986,-75.876225
            params.get('center')   // center=40.460986,-75.876225
        ];

        for (const pattern of patterns) {
            if (!pattern) continue;

            // Extract lat,lng from pattern
            const match = pattern.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
            if (match) {
                const lat = parseFloat(match[1]);
                const lng = parseFloat(match[2]);

                // Basic validation (just check if they're numbers)
                if (!isNaN(lat) && !isNaN(lng)) {
                    return {
                        latitude: lat,
                        longitude: lng
                    };
                }
            }
        }

        return null;
    } catch (error) {
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

// Get meets from database that need addresses or coordinate updates
async function getMeetsNeedingAddresses() {
    try {
        log('📊 Querying database for meets needing updates...');

        let allMeets = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('usaw_meets')
                .select('meet_id, Meet, "Date", address, geocode_precision_score')
                .or('address.is.null,geocode_precision_score.is.null,geocode_precision_score.lte.5')
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) {
                throw new Error(`Failed to fetch meets: ${error.message}`);
            }

            if (data && data.length > 0) {
                allMeets = allMeets.concat(data);
                hasMore = data.length === pageSize;
                page++;
                log(`📄 Fetched page ${page}, total so far: ${allMeets.length}`);
            } else {
                hasMore = false;
            }
        }

        // Show breakdown of what needs updating
        const needsAddress = allMeets.filter(m => !m.address).length;
        const needsCoordinates = allMeets.filter(m => m.address && (!m.geocode_precision_score || m.geocode_precision_score <= 5)).length;

        log(`📋 Found ${allMeets.length} meets needing updates:`);
        log(`   - ${needsAddress} need addresses`);
        log(`   - ${needsCoordinates} need coordinate improvements`);

        return allMeets;

    } catch (error) {
        log(`❌ Database query failed: ${error.message}`);
        throw error;
    }
}

// Update meet with address data and optional coordinate data
async function updateMeetAddress(meetId, meetName, addressData, coordinateData = null) {
    try {
        const updateData = {
            address: addressData.address,
            location_text: addressData.location,
            date_range: addressData.date_range
        };

        // Add coordinate data if provided
        if (coordinateData) {
            updateData.latitude = coordinateData.latitude;
            updateData.longitude = coordinateData.longitude;
            updateData.geocode_precision_score = 6;
            updateData.geocode_strategy_used = coordinateData.strategy;
            updateData.geocode_display_name = `Direct coordinates from Sport80: ${coordinateData.source_url}`;
        }

        const { error } = await supabase
            .from('usaw_meets')
            .update(updateData)
            .eq('meet_id', meetId);

        if (error) {
            throw new Error(`Update failed for meet_id ${meetId}: ${error.message}`);
        }

        log(`  ✅ Updated database: ${meetName}${coordinateData ? ' (with coordinates)' : ''}`);
        return true;

    } catch (error) {
        log(`  ❌ Database update failed for ${meetName}: ${error.message}`);
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

        // Get meets from database that need addresses
        const meetsNeedingAddresses = await getMeetsNeedingAddresses();

        if (meetsNeedingAddresses.length === 0) {
            log('✅ All meets already have addresses - nothing to scrape');
            return { total: 0, processed: 0, updated: 0 };
        }

        await initBrowser();

        const eventsURL = buildEventsURL(options.fromDate, options.toDate);
        log(`📍 Navigating to: ${eventsURL}`);

        await page.goto(eventsURL, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        let processedCount = 0;
        let updatedCount = 0;
        let currentPage = 1;
        let hasNextPage = true;

        while (hasNextPage && currentPage <= 50) { // Limit to 50 pages for safety
            log(`
📄 Processing page ${currentPage}...`);

            // Get basic meet data from current page
            const meetData = await scrapeMeetAddressesFromPage();

            // For each meet found on page, check if it matches a database meet that needs an address
            for (let i = 0; i < meetData.length; i++) {
                const scrapedMeet = meetData[i];

                // Find matching database meet using name + date
                const dbMeet = meetsNeedingAddresses.find(m => {
                    // Try exact name match first
                    if (m.Meet === scrapedMeet.meet_name) return true;

                    // Try case-insensitive name match
                    if (m.Meet?.toLowerCase() === scrapedMeet.meet_name?.toLowerCase()) return true;

                    // If we have date info, try name + date matching
                    if (scrapedMeet.date_range && m.Date) {
                        const scrapedYear = scrapedMeet.date_range.match(/202\d/)?.[0];
                        const dbYear = m.Date.match(/202\d/)?.[0];

                        if (scrapedYear && dbYear && scrapedYear === dbYear) {
                            // Same year + similar name (case insensitive, trimmed)
                            const scrapedNameClean = scrapedMeet.meet_name?.toLowerCase().trim();
                            const dbNameClean = m.Meet?.toLowerCase().trim();
                            if (scrapedNameClean === dbNameClean) return true;
                        }
                    }

                    return false;
                });

                // Debug: show matching attempts
                if (!dbMeet && i < 3) {
                    log(`  🔍 DEBUG: No match for "${scrapedMeet.meet_name}" (${scrapedMeet.date_range})`);
                    log(`  🔍 DEBUG: Checking against ${meetsNeedingAddresses.length} database meets`);
                }

                if (dbMeet) {
                    log(`
🎯 Found database match: ${scrapedMeet.meet_name} (meet_id: ${dbMeet.meet_id})`);

                    // Try to expand and get address
                    const addressInfo = await expandMeetAndGetAddress(i);

                    if (addressInfo) {
                        // Prepare address data
                        const addressData = {
                            address: addressInfo,
                            location: scrapedMeet.location,
                            date_range: scrapedMeet.date_range
                        };

                        // Try to extract Google Maps coordinates
                        let coordinateData = null;
                        try {
                            coordinateData = await extractGoogleMapsCoordinates(page);
                            if (coordinateData) {
                                log(`   📍 Extracted coordinates: ${coordinateData.latitude}, ${coordinateData.longitude}`);
                            } else {
                                log(`   ℹ️ No Google Maps coordinates available`);
                            }
                        } catch (error) {
                            log(`   ⚠️ Coordinate extraction failed: ${error.message}`);
                            // Continue with address-only update
                        }

                        // Update database with address and coordinates (if available)
                        const success = await updateMeetAddress(dbMeet.meet_id, scrapedMeet.meet_name, addressData, coordinateData);
                        if (success) {
                            updatedCount++;
                            // Remove from needs list to avoid processing again
                            const index = meetsNeedingAddresses.indexOf(dbMeet);
                            if (index > -1) {
                                meetsNeedingAddresses.splice(index, 1);
                            }
                        }
                    } else {
                        log(`  ⚠️ No address found for: ${scrapedMeet.meet_name}`);
                    }

                    processedCount++;
                } else {
                    log(`  ⏭️ Skipping (not in database or already has address): ${scrapedMeet.meet_name}`);
                }

                // Small delay between meets
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            log(`Page ${currentPage} complete: ${meetData.length} meets found, ${processedCount} processed`);

            // Check if we've processed all needed meets
            if (meetsNeedingAddresses.length === 0) {
                log('✅ All database meets have been processed - stopping early');
                break;
            }

            // Try to go to next page
            hasNextPage = await goToNextPage();
            currentPage++;
        }

        // Close browser
        if (browser) {
            await browser.close();
            log('Browser closed');
        }

        // Summary
        log('\n' + '='.repeat(60));
        log('✅ MEET ADDRESS SCRAPING COMPLETE');
        log(`   Date range: ${options.fromDate} to ${options.toDate}`);
        log(`   Pages processed: ${currentPage - 1}`);
        log(`   Meets processed: ${processedCount}`);
        log(`   Database updates: ${updatedCount}`);
        log(`   Remaining meets needing addresses: ${meetsNeedingAddresses.length}`);
        log(`   Processing time: ${Date.now() - startTime}ms`);

        return {
            total_pages: currentPage - 1,
            meets_processed: processedCount,
            database_updates: updatedCount,
            remaining_needs_addresses: meetsNeedingAddresses.length,
            processing_time_ms: Date.now() - startTime
        };

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