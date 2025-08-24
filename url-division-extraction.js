const puppeteer = require('puppeteer');
const fs = require('fs');
const Papa = require('papaparse');

class AutocompleteDivisionScraper {
    constructor() {
        this.baseUrl = 'https://usaweightlifting.sport80.com/public/rankings/all';
        this.divisionCodes = {};
        this.failedDivisions = [];
        this.browser = null;
        this.page = null;
    }

    loadDivisions() {
        // Try both possible file names
        const possibleFiles = ['./all-divisions.csv', './alldivisions.csv'];
        let divisionsFile = null;
        
        for (const file of possibleFiles) {
            if (fs.existsSync(file)) {
                divisionsFile = file;
                break;
            }
        }
        
        if (!divisionsFile) {
            throw new Error('Division file not found! Looking for: all-divisions.csv or alldivisions.csv');
        }
        
        console.log(`📁 Using file: ${divisionsFile}`);
        
        const csvContent = fs.readFileSync(divisionsFile, 'utf8');
        const parsed = Papa.parse(csvContent, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true
        });
        
        console.log(`Loaded ${parsed.data.length} divisions from CSV`);
        return parsed.data;
    }

    async init() {
        this.browser = await puppeteer.launch({
            headless: false, // Keep visible for debugging
            defaultViewport: { width: 1400, height: 900 },
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        // Start with base URL
        await this.page.goto(this.baseUrl);
        await this.page.waitForFunction(() => document.readyState === 'complete');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('✅ Browser initialized and page loaded');
    }

    async openFilterPanel() {
        try {
            // Check if the weight class input is already visible (panel already open)
            const inputAlreadyVisible = await this.page.$('#weight_class');
            
            if (inputAlreadyVisible) {
                const isVisible = await this.page.evaluate(() => {
                    const input = document.querySelector('#weight_class');
                    return input && input.offsetParent !== null;
                });
                
                if (isVisible) {
                    console.log('✅ Filter panel already open');
                    return true;
                }
            }
            
            // Panel not open, so click the filter button
            const filterButtonSelector = 'i.mdi-filter-variant';
            await this.page.waitForSelector(filterButtonSelector, { timeout: 10000 });
            await this.page.click(filterButtonSelector);
            
            console.log('✅ Filter button clicked');
            
            // Wait for the panel to open and the input field to appear
            await this.page.waitForSelector('#weight_class', { timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('✅ Filter panel opened, weight class input found');
            return true;
            
        } catch (error) {
            console.error('❌ Failed to open filter panel:', error.message);
            return false;
        }
    }

    async selectDivision(divisionName) {
        try {
            console.log(`🎯 Selecting division: ${divisionName}`);
            
            // Focus and clear the input field more reliably
            await this.page.focus('#weight_class');
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Clear existing content
            await this.page.evaluate(() => {
                const input = document.querySelector('#weight_class');
                if (input) {
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Type the division name character by character to trigger autocomplete
            for (const char of divisionName) {
                await this.page.keyboard.type(char);
                await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between characters
            }
            
            // Wait longer for autocomplete suggestions to appear
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Take screenshot to see what's happening
            await this.page.screenshot({ path: `debug_autocomplete_${Date.now()}.png` });
            
            // Look for suggestions and log what we find
            const suggestions = await this.page.evaluate((targetDivision) => {
                // More comprehensive selector list for Vuetify autocomplete
                const selectors = [
                    '.v-autocomplete__content .v-list-item',
                    '.v-menu__content .v-list-item',
                    '.menuable__content__active .v-list-item',
                    '[role="listbox"] [role="option"]',
                    '.v-select__content [role="option"]',
                    '.v-list .v-list-item',
                    '.v-autocomplete .v-list-item',
                    '[class*="autocomplete"] [class*="item"]',
                    '[class*="menu"] [class*="item"]'
                ];
                
                let allSuggestions = [];
                
                for (let selector of selectors) {
                    const found = document.querySelectorAll(selector);
                    for (let suggestion of found) {
                        const text = suggestion.textContent?.trim();
                        if (text && text.length > 0) {
                            allSuggestions.push({
                                text: text,
                                selector: selector,
                                isVisible: suggestion.offsetParent !== null
                            });
                        }
                    }
                }
                
                return allSuggestions;
            }, divisionName);
            
            console.log(`   Found ${suggestions.length} suggestions:`, suggestions.slice(0, 5));
            
            // Try to find and click exact match
            const exactMatch = suggestions.find(s => s.text === divisionName && s.isVisible);
            
            if (exactMatch) {
                console.log(`   Found exact match: ${exactMatch.text}`);
                
                // Click the exact match
                const clicked = await this.page.evaluate((targetText) => {
                    const selectors = [
                        '.v-autocomplete__content .v-list-item',
                        '.v-menu__content .v-list-item',
                        '.menuable__content__active .v-list-item',
                        '.v-list .v-list-item'
                    ];
                    
                    for (let selector of selectors) {
                        const items = document.querySelectorAll(selector);
                        for (let item of items) {
                            if (item.textContent?.trim() === targetText && item.offsetParent !== null) {
                                item.click();
                                return true;
                            }
                        }
                    }
                    return false;
                }, divisionName);
                
                if (clicked) {
                    console.log(`   ✅ Clicked suggestion`);
                } else {
                    console.log(`   ⚠️ Could not click suggestion, trying Enter`);
                    await this.page.keyboard.press('ArrowDown');
                    await new Promise(resolve => setTimeout(resolve, 200));
                    await this.page.keyboard.press('Enter');
                }
            } else {
                console.log(`   ⚠️ No exact match found, trying Enter`);
                await this.page.keyboard.press('Enter');
            }
            
            // Wait a moment for the selection to register
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Click the Apply button
            console.log(`   🔘 Clicking Apply button...`);
            const applyClicked = await this.page.evaluate(() => {
                // Look for Apply button with different possible selectors
                const selectors = [
                    'span:contains("Apply")',
                    'button:contains("Apply")',
                    '[class*="apply"]',
                    'span.text-padding'
                ];
                
                // Since :contains() doesn't work in evaluate, we'll search manually
                const buttons = document.querySelectorAll('button, span, div[role="button"]');
                for (let button of buttons) {
                    const text = button.textContent?.trim().toLowerCase();
                    if (text === 'apply' || text.includes('apply')) {
                        button.click();
                        return true;
                    }
                }
                return false;
            });
            
            if (applyClicked) {
                console.log(`   ✅ Apply button clicked`);
            } else {
                console.log(`   ⚠️ Apply button not found, trying Enter as fallback`);
                await this.page.keyboard.press('Enter');
            }
            
            // Wait for URL to update after Apply
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const currentUrl = this.page.url();
            console.log(`   Current URL: ${currentUrl}`);
            
            if (currentUrl.includes('filters=')) {
                // Extract the weight class code
                const encodedFilters = currentUrl.split('filters=')[1].split('&')[0];
                
                // First decode URL encoding (handles %3D%3D -> ==)
                const urlDecodedFilters = decodeURIComponent(encodedFilters);
                
                // Then decode base64
                const decodedFilters = JSON.parse(atob(urlDecodedFilters));
                const weightClassCode = decodedFilters.weight_class;
                
                if (weightClassCode !== undefined) {
                    console.log(`   ✅ Success! Code: ${weightClassCode}`);
                    return weightClassCode;
                }
            }
            
            throw new Error('No weight class code found in URL after selection');
            
        } catch (error) {
            console.log(`   ❌ Failed: ${error.message}`);
            
            // Take screenshot on error for debugging
            await this.page.screenshot({ path: `error_${Date.now()}.png` });
            
            return null;
        }
    }

    async extractDivisionCode(divisionName, index, total) {
        try {
            console.log(`\n[${index + 1}/${total}] Processing: ${divisionName}`);
            
            // Open filter panel if not already open
            const panelOpen = await this.openFilterPanel();
            if (!panelOpen) {
                throw new Error('Could not open filter panel');
            }
            
            // Select the division
            const weightClassCode = await this.selectDivision(divisionName);
            
            if (weightClassCode !== null) {
                this.divisionCodes[divisionName] = weightClassCode;
                
                // Close filter panel for next iteration
                await this.page.keyboard.press('Escape');
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                return weightClassCode;
            }
            
            throw new Error('Could not extract weight class code');
            
        } catch (error) {
            console.log(`   ❌ Failed: ${divisionName} - ${error.message}`);
            this.failedDivisions.push({ 
                division: divisionName, 
                reason: error.message,
                index: index 
            });
            return null;
        }
    }

    async scrapAllDivisions() {
        const divisions = this.loadDivisions();
        const total = divisions.length;
        
        console.log(`🚀 Starting to scrape ${total} divisions...\n`);
        
        for (let i = 0; i < total; i++) {
            const division = divisions[i];
            await this.extractDivisionCode(division.Division, i, total);
            
            // Rate limiting between requests
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Save progress every 25 divisions
            if ((i + 1) % 25 === 0) {
                this.saveProgress();
                console.log(`\n💾 Progress saved at ${i + 1}/${total} divisions\n`);
            }
        }
        
        this.saveProgress();
        this.generateReport();
    }

    saveProgress() {
        // Save successful mappings
        fs.writeFileSync(
            'division_codes.json', 
            JSON.stringify(this.divisionCodes, null, 2)
        );
        
        // Save failed divisions
        fs.writeFileSync(
            'failed_divisions.json', 
            JSON.stringify(this.failedDivisions, null, 2)
        );
        
        console.log(`📁 Saved ${Object.keys(this.divisionCodes).length} successful codes`);
        console.log(`📁 Saved ${this.failedDivisions.length} failed attempts`);
    }

    generateReport() {
        const successCount = Object.keys(this.divisionCodes).length;
        const failureCount = this.failedDivisions.length;
        const total = successCount + failureCount;
        
        const report = {
            summary: {
                total_divisions_processed: total,
                successful_extractions: successCount,
                failed_extractions: failureCount,
                success_rate: total > 0 ? `${((successCount / total) * 100).toFixed(1)}%` : '0%'
            },
            successful_codes: this.divisionCodes,
            failed_divisions: this.failedDivisions
        };
        
        fs.writeFileSync('division_scraping_report.json', JSON.stringify(report, null, 2));
        
        console.log('\n📊 SCRAPING COMPLETE');
        console.log(`✅ Successful: ${successCount}/${total} (${report.summary.success_rate})`);
        console.log(`❌ Failed: ${failureCount}/${total}`);
        console.log('\n📁 Files generated:');
        console.log('- division_codes.json (successful mappings)');
        console.log('- failed_divisions.json (failures for manual review)');
        console.log('- division_scraping_report.json (complete report)');
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }
}

// URL Builder function for later use
function buildDisambiguationURL(athleteName, divisionName, competitionDate) {
    const divisionCodes = JSON.parse(fs.readFileSync('division_codes.json', 'utf8'));
    const weightClassCode = divisionCodes[divisionName];
    
    if (weightClassCode === undefined) {
        throw new Error(`No code found for division: ${divisionName}`);
    }
    
    const filters = {
        date_range_start: competitionDate,
        date_range_end: competitionDate,
        weight_class: weightClassCode
    };
    
    const encodedFilters = btoa(JSON.stringify(filters));
    return `https://usaweightlifting.sport80.com/public/rankings/all?filters=${encodedFilters}`;
}

// Main execution
async function main() {
    const scraper = new AutocompleteDivisionScraper();
    
    try {
        await scraper.init();
        await scraper.scrapAllDivisions();
    } catch (error) {
        console.error('Scraping failed:', error);
    } finally {
        await scraper.close();
    }
}

// Export for use in other modules
module.exports = { AutocompleteDivisionScraper, buildDisambiguationURL };

// Run if called directly
if (require.main === module) {
    main();
}