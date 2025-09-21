/**
 * CLUB SCRAPER
 * 
 * Scrapes barbell club information from Sport80 club directory
 * Extracts club name, address, phone number, and contact email
 * 
 * Usage:
 *   node club-scraper.js
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
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'club_data.json');
const LOG_FILE = path.join(LOGS_DIR, 'club-scraper.log');

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

// Build Sport80 club directory URL
function buildClubDirectoryURL() {
    return 'https://usaweightlifting.sport80.com/public/widget/7';
}

// Initialize browser
async function initBrowser() {
    log('Initializing browser for club data scraping...');
    
    browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--memory-pressure-off',
            '--max-old-space-size=4096'
        ]
    });

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    
    log('Browser initialized successfully');
}

// Extract club data from a specific expansion panel with retry logic
async function extractClubDataFromExpansion(panelIndex, retryCount = 0) {
    const maxRetries = 2;
    const panelNumber = panelIndex + 1;
    
    try {
        log(`Processing club panel ${panelNumber}... (attempt ${retryCount + 1}/${maxRetries + 1})`);

        // Add timeout wrapper for individual panel processing
        const result = await Promise.race([
            processPanel(panelIndex),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Panel ${panelNumber} processing timeout after 30 seconds`)), 30000)
            )
        ]);

        return result;
        
    } catch (error) {
        log(`❌ Error processing panel ${panelNumber} (attempt ${retryCount + 1}): ${error.message}`);
        
        if (retryCount < maxRetries) {
            log(`🔄 Retrying panel ${panelNumber} in 2 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return extractClubDataFromExpansion(panelIndex, retryCount + 1);
        } else {
            log(`⚠️ Panel ${panelNumber} failed after ${maxRetries + 1} attempts, skipping`);
            return null;
        }
    }
}

// Core panel processing logic separated for better error handling
async function processPanel(panelIndex) {
    const panelNumber = panelIndex + 1;

    // Get the specific panel and its header together to avoid misalignment
    const targetElements = await page.evaluate((index) => {
        const panels = document.querySelectorAll('.v-expansion-panel');
        if (index >= panels.length) return null;

        const targetPanel = panels[index];
        const targetHeader = targetPanel.querySelector('.v-expansion-panel-header');

        return {
            panelExists: !!targetPanel,
            headerExists: !!targetHeader,
            isCurrentlyActive: targetPanel.classList.contains('v-expansion-panel--active')
        };
    }, panelIndex);

    if (!targetElements || !targetElements.panelExists || !targetElements.headerExists) {
        throw new Error(`Panel ${panelNumber} or its header not found`);
    }

    log(`   Debug: Panel ${panelNumber} currently active: ${targetElements.isCurrentlyActive}`);

    // First, close any currently active panels with timeout
    await Promise.race([
        page.evaluate(() => {
            const activePanels = document.querySelectorAll('.v-expansion-panel--active');
            activePanels.forEach(panel => {
                const header = panel.querySelector('.v-expansion-panel-header');
                if (header) header.click();
            });
        }),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Close panels timeout')), 5000)
        )
    ]);

    // Reduced wait time for panels to close
    await new Promise(resolve => setTimeout(resolve, 500));

    // Now click the target panel header to expand it
    const clicked = await page.evaluate((index) => {
        const panels = document.querySelectorAll('.v-expansion-panel');
        if (index >= panels.length) return false;

        const targetPanel = panels[index];
        const targetHeader = targetPanel.querySelector('.v-expansion-panel-header');

        if (targetHeader) {
            targetHeader.click();
            return true;
        }
        return false;
    }, panelIndex);

    if (!clicked) {
        throw new Error(`Could not click header for panel ${panelNumber}`);
    }

    // Wait for the panel to expand with smarter retry logic
    let isExpanded = false;
    let attempts = 0;
    const maxAttempts = 8; // Reduced from 10

    while (!isExpanded && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 300)); // Reduced from 500ms
        isExpanded = await page.evaluate((index) => {
            const panels = document.querySelectorAll('.v-expansion-panel');
            if (index >= panels.length) return false;
            return panels[index].classList.contains('v-expansion-panel--active');
        }, panelIndex);
        attempts++;
    }

    if (!isExpanded) {
        throw new Error(`Panel ${panelNumber} did not expand after ${maxAttempts} attempts`);
    }
    
    log(`   ✅ Panel ${panelNumber} expanded successfully`);
    
    // Extract club data from the expanded panel
    const clubData = await page.evaluate((index) => {
        const panels = document.querySelectorAll('.v-expansion-panel');
        if (index >= panels.length) return { debug: 'Panel not found' };

        const targetPanel = panels[index];
        const isActive = targetPanel.classList.contains('v-expansion-panel--active');

        if (!isActive) {
            return { debug: 'Panel not active' };
        }
        
        const club = {
            club_name: null,
            address: null,
            phone: null,
            email: null,
            full_text: targetPanel.textContent?.trim() || null
        };
        
        // Extract club name from the header
        const header = targetPanel.querySelector('.v-expansion-panel-header');
        if (header) {
            const nameSelectors = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '.title', 'strong', '.v-card-title'];
            for (const selector of nameSelectors) {
                const nameElement = header.querySelector(selector);
                if (nameElement && nameElement.textContent?.trim()) {
                    club.club_name = nameElement.textContent.trim();
                    break;
                }
            }
            
            // Fallback: use first meaningful line of header text
            if (!club.club_name && header.textContent) {
                const lines = header.textContent.split('\n').map(l => l.trim()).filter(l => l && l.length > 3);
                if (lines.length > 0) {
                    club.club_name = lines[0];
                }
            }
        }
        
        // Extract details from the expanded content
        const content = targetPanel.querySelector('.v-expansion-panel-content');
        if (content) {
            const allText = content.textContent || '';

            // Email pattern matching - improved for the format we're seeing (emails may be concatenated with zip codes)
            // Extract emails by first finding the full pattern, then cleaning it
            const fullEmailPattern = /\d{5}-[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\w*/g;
            let emailMatches = allText.match(fullEmailPattern);

            // If no zip-prefixed emails found, try standard email pattern
            if (!emailMatches) {
                const standardEmailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\w*/g;
                emailMatches = allText.match(standardEmailPattern);
            }

            // Clean up the email matches by removing trailing text after .com/.org etc
            if (emailMatches) {
                emailMatches = emailMatches.map(email => {
                    // Remove everything after the top-level domain
                    const cleanEmail = email.replace(/(\.[a-zA-Z]{2,}).*$/, '$1');
                    return cleanEmail;
                });
            }


            if (emailMatches && emailMatches.length > 0) {
                // Get the first valid email
                for (const email of emailMatches) {
                    // Clean the email first - remove zip prefix and trailing text
                    let cleanEmail = email.replace(/^\d{5}-/, ''); // Remove zip prefix
                    // Remove everything after common TLDs
                    cleanEmail = cleanEmail.replace(/(\.(com|org|net|edu|gov)).*$/i, '$1');

                    if (cleanEmail.length < 50 && cleanEmail.includes('@')) {
                        club.email = cleanEmail.trim();
                        break;
                    }
                }
            }

            // Phone pattern matching - looking for various formats
            const phonePattern = /\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4}|\d{3}\.\d{3}\.\d{4}|\d{3}\s+\d{3}\s+\d{4}/g;
            const phoneMatches = allText.match(phonePattern);
            if (phoneMatches && phoneMatches.length > 0) {
                club.phone = phoneMatches[0].trim();
            }

            // Address pattern - improved for the format we're seeing
            // Looking for addresses in format: "1789 McGuckian St, Annapolis, Maryland, United States of America, 21401"
            const addressPattern = /\d+[^,]+(?:St|Ave|Rd|Dr|Blvd|Way|Street|Avenue|Road|Drive|Boulevard)[^,]*,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*\d{5}/i;
            const addressMatch = allText.match(addressPattern);
            if (addressMatch) {
                club.address = addressMatch[0].trim();
            } else {
                // Fallback: try simpler patterns
                const lines = allText.split('\n').map(l => l.trim()).filter(l => l && l.length < 200);
                for (const line of lines) {
                    // Look for typical address format with numbers and street names
                    if (line.match(/^\d+/) && line.match(/\b(St|Ave|Rd|Dr|Blvd|Way|Street|Avenue|Road|Drive|Boulevard)\b/i) && line.match(/\d{5}/)) {
                        club.address = line;
                        break;
                    }
                }
            }
            
            // Also check for linked email/phone
            const emailLinks = content.querySelectorAll('a[href^="mailto:"]');
            if (emailLinks.length > 0 && !club.email) {
                club.email = emailLinks[0].getAttribute('href').replace('mailto:', '');
            }
            
            const phoneLinks = content.querySelectorAll('a[href^="tel:"]');
            if (phoneLinks.length > 0 && !club.phone) {
                club.phone = phoneLinks[0].getAttribute('href').replace('tel:', '');
            }
        }
        
        return club;
    }, panelIndex);


    if (clubData && clubData.club_name) {
        log(`   ✅ ${clubData.club_name}`);
        if (clubData.address) log(`      📍 ${clubData.address}`);
        if (clubData.phone) log(`      📞 ${clubData.phone}`);
        if (clubData.email) log(`      📧 ${clubData.email}`);

        // Debug: show if expansion content was found
        if (!clubData.address && !clubData.phone && !clubData.email) {
            log(`      ⚠️ No contact details found - panel may not be expanding properly`);
        }
    } else {
        log(`   ⚠️ No valid data extracted from panel ${panelNumber}`);
    }

    // Close the panel after extracting data with timeout
    if (isExpanded) {
        try {
            await Promise.race([
                page.evaluate((index) => {
                    const panels = document.querySelectorAll('.v-expansion-panel');
                    if (index < panels.length) {
                        const targetPanel = panels[index];
                        const targetHeader = targetPanel.querySelector('.v-expansion-panel-header');
                        if (targetHeader && targetPanel.classList.contains('v-expansion-panel--active')) {
                            targetHeader.click();
                        }
                    }
                }, panelIndex),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Close panel timeout')), 3000)
                )
            ]);

            // Reduced wait for panel to close
            await new Promise(resolve => setTimeout(resolve, 200));
            log(`   🔹 Panel ${panelNumber} minimized`);
        } catch (error) {
            log(`   ⚠️ Could not close panel ${panelNumber}: ${error.message}`);
        }
    }

    return clubData;
}

// Check if there's a next page and navigate to it
async function goToNextPage() {
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
                nextButton = await page.$(selector);
                if (nextButton) {
                    const isClickable = await page.evaluate((btn) => {
                        return !btn.disabled && !btn.classList.contains('disabled');
                    }, nextButton);
                    
                    if (isClickable) {
                        log(`Found next page button with selector: ${selector}`);
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

// Progress checkpoint file
const PROGRESS_FILE = path.join(OUTPUT_DIR, 'club_scraping_progress.json');

// Save progress checkpoint
function saveProgress(currentPage, allClubData, totalProcessed) {
    const progress = {
        currentPage,
        totalProcessed,
        clubDataCount: allClubData.length,
        timestamp: new Date().toISOString(),
        clubData: allClubData
    };
    
    try {
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
        log(`💾 Progress saved: page ${currentPage}, ${allClubData.length} clubs`);
    } catch (error) {
        log(`⚠️ Could not save progress: ${error.message}`);
    }
}

// Load existing progress
function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        try {
            const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
            log(`📂 Found existing progress: page ${progress.currentPage}, ${progress.clubDataCount} clubs`);
            return progress;
        } catch (error) {
            log(`⚠️ Could not load progress: ${error.message}`);
        }
    }
    return null;
}

// Clean up progress file
function cleanupProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        try {
            fs.unlinkSync(PROGRESS_FILE);
            log(`🧹 Progress file cleaned up`);
        } catch (error) {
            log(`⚠️ Could not delete progress file: ${error.message}`);
        }
    }
}

// Enhanced concurrent processing with batching
async function processPanelsBatch(panelIndices, batchSize = 2) {
    const results = [];
    
    for (let i = 0; i < panelIndices.length; i += batchSize) {
        const batch = panelIndices.slice(i, i + batchSize);
        log(`   🔄 Processing batch ${Math.floor(i/batchSize) + 1}: panels ${batch.map(idx => idx + 1).join(', ')}`);
        
        try {
            // Process panels in this batch concurrently
            const batchPromises = batch.map(async (panelIndex) => {
                try {
                    return await extractClubDataFromExpansion(panelIndex);
                } catch (error) {
                    log(`   ❌ Panel ${panelIndex + 1} failed in batch: ${error.message}`);
                    return null;
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Small delay between batches to avoid overwhelming the page
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            log(`   ❌ Batch failed: ${error.message}`);
            // Process panels individually as fallback
            for (const panelIndex of batch) {
                try {
                    const result = await extractClubDataFromExpansion(panelIndex);
                    results.push(result);
                } catch (error) {
                    log(`   ❌ Individual fallback failed for panel ${panelIndex + 1}: ${error.message}`);
                    results.push(null);
                }
            }
        }
    }
    
    return results;
}

// Main scraping function with enhanced error handling and progress tracking
async function scrapeClubData() {
    const startTime = Date.now();
    let allClubData = [];
    let totalProcessed = 0;
    let performanceMetrics = {
        pagesProcessed: 0,
        panelsProcessed: 0,
        successfulExtractions: 0,
        failedExtractions: 0,
        retries: 0
    };
    
    try {
        log(`🏋️ Starting club data scraping with enhanced error handling`);
        log('='.repeat(60));
        
        // Check for existing progress
        const existingProgress = loadProgress();
        let startPage = 1;
        
        if (existingProgress && existingProgress.clubData) {
            const resumeChoice = process.env.RESUME_SCRAPING || 'false';
            if (resumeChoice === 'true') {
                allClubData = existingProgress.clubData;
                startPage = existingProgress.currentPage;
                totalProcessed = existingProgress.totalProcessed;
                log(`🔄 Resuming from page ${startPage} with ${allClubData.length} clubs already scraped`);
            } else {
                log(`🆕 Starting fresh scraping (found existing progress but not resuming)`);
                cleanupProgress();
            }
        }
        
        await initBrowser();
        
        const clubDirectoryURL = buildClubDirectoryURL();
        log(`📍 Navigating to: ${clubDirectoryURL}`);
        
        await page.goto(clubDirectoryURL, { waitUntil: 'networkidle0', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Navigate to start page if resuming
        if (startPage > 1) {
            log(`⏭️ Navigating to page ${startPage}...`);
            for (let p = 1; p < startPage; p++) {
                const navigated = await goToNextPage();
                if (!navigated) {
                    log(`❌ Could not navigate to page ${startPage}, starting from current page`);
                    break;
                }
            }
        }
        
        let currentPage = startPage;
        let hasNextPage = true;
        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 3;
        
        while (hasNextPage && currentPage <= 50 && consecutiveFailures < maxConsecutiveFailures) {
            const pageStartTime = Date.now();
            log(`\n📄 Processing page ${currentPage}...`);
            
            try {
                // Get the number of expansion panels on this page
                const expansionPanels = await page.$$('.v-expansion-panel');
                log(`Found ${expansionPanels.length} club panels on page ${currentPage}`);
                
                if (expansionPanels.length === 0) {
                    log(`⚠️ No panels found on page ${currentPage}, skipping`);
                    consecutiveFailures++;
                } else {
                    // Create array of panel indices
                    const panelIndices = Array.from({length: expansionPanels.length}, (_, i) => i);
                    
                    // Process panels in smaller batches for better performance
                    const pageResults = await processPanelsBatch(panelIndices, 2);
                    
                    // Collect successful results
                    const validResults = pageResults.filter(result => result && result.club_name);
                    allClubData.push(...validResults);
                    
                    // Update metrics
                    performanceMetrics.panelsProcessed += pageResults.length;
                    performanceMetrics.successfulExtractions += validResults.length;
                    performanceMetrics.failedExtractions += pageResults.length - validResults.length;
                    totalProcessed += pageResults.length;
                    
                    log(`Page ${currentPage} complete: ${pageResults.length} panels processed, ${validResults.length} successful extractions`);
                    
                    // Save progress after each page
                    saveProgress(currentPage, allClubData, totalProcessed);
                    consecutiveFailures = 0;
                }
                
                performanceMetrics.pagesProcessed++;
                
                // Log performance metrics
                const pageTime = Date.now() - pageStartTime;
                log(`   ⏱️ Page processing time: ${pageTime}ms`);
                log(`   📊 Current totals: ${allClubData.length} clubs, ${performanceMetrics.successfulExtractions}/${performanceMetrics.panelsProcessed} success rate`);
                
                // Try to go to next page
                hasNextPage = await goToNextPage();
                if (hasNextPage) {
                    currentPage++;
                } else {
                    log('📄 Reached end of available pages');
                }
                
            } catch (error) {
                log(`❌ Error processing page ${currentPage}: ${error.message}`);
                consecutiveFailures++;
                
                if (consecutiveFailures < maxConsecutiveFailures) {
                    log(`🔄 Retrying page ${currentPage} (failure ${consecutiveFailures}/${maxConsecutiveFailures})...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    performanceMetrics.retries++;
                } else {
                    log(`💥 Too many consecutive failures (${maxConsecutiveFailures}), stopping scraping`);
                    break;
                }
            }
        }
        
        // Close browser
        if (browser) {
            await browser.close();
            log('Browser closed');
        }
        
        // Clean up progress file on successful completion
        cleanupProgress();
        
        // Enhanced performance logging
        const totalTime = Date.now() - startTime;
        log(`\n📊 Performance Metrics:`);
        log(`   ⏱️ Total scraping time: ${totalTime}ms (${Math.round(totalTime/1000)}s)`);
        log(`   📄 Pages processed: ${performanceMetrics.pagesProcessed}`);
        log(`   🔍 Panels processed: ${performanceMetrics.panelsProcessed}`);
        log(`   ✅ Successful extractions: ${performanceMetrics.successfulExtractions}`);
        log(`   ❌ Failed extractions: ${performanceMetrics.failedExtractions}`);
        log(`   🔄 Retries: ${performanceMetrics.retries}`);
        if (performanceMetrics.panelsProcessed > 0) {
            const successRate = (performanceMetrics.successfulExtractions / performanceMetrics.panelsProcessed * 100).toFixed(1);
            log(`   📈 Success rate: ${successRate}%`);
        }
        
        // Load existing data if file exists
        let existingData = { clubs: [] };
        if (fs.existsSync(OUTPUT_FILE)) {
            try {
                existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
                log(`📂 Loaded existing data: ${existingData.clubs?.length || 0} clubs`);
            } catch (error) {
                log(`⚠️ Could not parse existing file, starting fresh: ${error.message}`);
                existingData = { clubs: [] };
            }
        }

        // Merge new clubs with existing ones (avoiding duplicates by club name)
        const existingClubs = existingData.clubs || [];
        const newClubs = allClubData.filter(newClub => {
            return !existingClubs.some(existing => 
                existing.club_name === newClub.club_name
            );
        });
        
        const mergedClubs = [...existingClubs, ...newClubs];
        log(`🔄 Merged data: ${existingClubs.length} existing + ${newClubs.length} new = ${mergedClubs.length} total clubs`);

        // Save results with enhanced metadata
        const report = {
            metadata: {
                timestamp: new Date().toISOString(),
                script_name: 'club-scraper',
                processing_time_ms: Date.now() - startTime,
                total_processing_time_ms: (existingData.metadata?.total_processing_time_ms || existingData.metadata?.processing_time_ms || 0) + (Date.now() - startTime),
                pages_processed: performanceMetrics.pagesProcessed,
                total_clubs: mergedClubs.length,
                new_clubs_added: newClubs.length,
                clubs_with_phone: mergedClubs.filter(c => c.phone).length,
                clubs_with_email: mergedClubs.filter(c => c.email).length,
                clubs_with_address: mergedClubs.filter(c => c.address).length,
                // Enhanced metrics
                panels_processed: performanceMetrics.panelsProcessed,
                successful_extractions: performanceMetrics.successfulExtractions,
                failed_extractions: performanceMetrics.failedExtractions,
                retries_performed: performanceMetrics.retries,
                success_rate_percent: performanceMetrics.panelsProcessed > 0 ? 
                    Math.round(performanceMetrics.successfulExtractions / performanceMetrics.panelsProcessed * 100) : 0,
                average_processing_time_per_panel: performanceMetrics.panelsProcessed > 0 ? 
                    Math.round((Date.now() - startTime) / performanceMetrics.panelsProcessed) : 0
            },
            clubs: mergedClubs
        };
        
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
        log(`📄 Results saved to: ${OUTPUT_FILE}`);
        
        // Summary
        log('\n' + '='.repeat(60));
        log('✅ CLUB DATA SCRAPING COMPLETE');
        log(`   Pages processed: ${currentPage - 1}`);
        log(`   New clubs found: ${allClubData.length}`);
        log(`   New clubs with phone: ${allClubData.filter(c => c.phone).length}`);
        log(`   New clubs with email: ${allClubData.filter(c => c.email).length}`);
        log(`   New clubs with address: ${allClubData.filter(c => c.address).length}`);
        log(`   Total clubs in database: ${mergedClubs.length}`);
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
    scrapeClubData();
}

module.exports = {
    scrapeClubData,
    buildClubDirectoryURL
};