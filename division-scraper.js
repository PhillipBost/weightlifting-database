const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// =================================================================
// DIVISION-BASED SCRAPER WITH INTEGRATED ATHLETE SCRAPING
// =================================================================
const OVERWRITE_EXISTING_FILES = false;

// Utility functions
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`📁 Created directory: ${dirPath}`);
    }
}

function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function loadDivisions() {
    const divisionsFile = '../all divisions.csv';
    if (!fs.existsSync(divisionsFile)) {
        throw new Error('Division file not found: ../all divisions.csv');
    }
    
    const content = fs.readFileSync(divisionsFile, 'utf8');
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    
    // Skip header if it exists
    const divisions = lines[0].includes('Age Group') && lines[0].includes('kg') ? lines.slice(1) : lines;
    
    console.log(`📋 Loaded ${divisions.length} divisions from ../all divisions.csv`);
    return divisions;
}

function splitAgeCategoryAndWeightClass(combinedString) {
    if (!combinedString) return { ageCategory: '', weightClass: '' };
    
    const weightClassPattern = /(\+?\d+\+?\s*kg)$/i;
    const match = combinedString.match(weightClassPattern);
    
    if (match) {
        const weightClass = match[1].trim();
        const ageCategory = combinedString.replace(weightClassPattern, '').trim();
        return { ageCategory, weightClass };
    }
    
    return { ageCategory: combinedString, weightClass: '' };
}

// Function to check if athlete already processed
function isAthleteAlreadyProcessed(membershipId) {
    if (!membershipId) return false;
    
    const athleteFile = path.join('../output/athletes', `athlete_${membershipId}.csv`);
    return fs.existsSync(athleteFile) && !OVERWRITE_EXISTING_FILES;
}

// Function to create individual athlete CSV file
function createAthleteCSV(membershipId, profileData, sourceDivision) {
    const athletesDir = '../output/athletes';
    ensureDirectoryExists(athletesDir);
    
    const athleteFile = path.join(athletesDir, `athlete_${membershipId}.csv`);
    const profile = profileData.profileData;
    
    // EXACT headers as specified
    const headers = [
        'membership_number',
        'athlete_name', 
        'gender',
        'club_name',
        'wso',
        'national_rank',
        'internal_id',
        'lifter_age',
        'competition_age',
        'lift_date',
        'birth_year',
        'Meet',
        'Date',
        'Age Category',
        'Weight Class',
        'Lifter',
        'Body Weight (Kg)',
        'Snatch Lift 1',
        'Snatch Lift 2',
        'Snatch Lift 3',
        'C&J Lift 1',
        'C&J Lift 2',
        'C&J Lift 3',
        'Best Snatch',
        'Best C&J',
        'Total',
        'qpoints',
        'qmasters',
        'sinclair',
        'sinclairmeltzerfaber',
        'sinclairhuebnermetzerfaber',
        'batch_id',
        'batch_date'
    ];
    
    const timestamp = new Date().toISOString();
    const batchId = `division_${membershipId}_${timestamp.replace(/[:\s\/,-]/g, '')}`;
    
    let csvContent = headers.join(',') + '\n';
    
    // Write each competition with athlete profile data repeated
    if (profile.competitionHistory && profile.competitionHistory.length > 0) {
        profile.competitionHistory.forEach(comp => {
            const { ageCategory, weightClass } = splitAgeCategoryAndWeightClass(comp.ageCategory);
            
            // Calculate birth year from lifter_age and lift_date
            let birthYear = '';
            if (profile.lifterAge && profile.liftDate) {
                try {
                    const age = parseInt(profile.lifterAge);
                    const liftYear = new Date(profile.liftDate).getFullYear();
                    if (!isNaN(age) && !isNaN(liftYear)) {
                        birthYear = liftYear - age;
                    }
                } catch (error) {
                    // If calculation fails, leave birth year empty
                }
            }
            
            // Calculate competition age from birth year and meet date
            let competitionAge = '';
            if (birthYear && comp.meetDate) {
                try {
                    const competitionYear = new Date(comp.meetDate).getFullYear();
                    if (!isNaN(competitionYear)) {
                        competitionAge = competitionYear - birthYear;
                    }
                } catch (error) {
                    // If calculation fails, leave competition age empty
                }
            }
            
            // Calculate Q-points using IWF formula
            let qpoints = '';
            if (comp.total && comp.bodyWeight && profile.gender) {
                try {
                    const total = parseFloat(comp.total);
                    const bodyWeight = parseFloat(comp.bodyWeight);
                    const gender = profile.gender;
                    
                    if (!isNaN(total) && !isNaN(bodyWeight) && total > 0 && bodyWeight > 0) {
                        let qPointsValue;
                        const B = bodyWeight / 100;
                        
                        if (gender === 'M') {
                            const denominator = 416.7 - 47.87 * Math.pow(B, -2) + 18.93 * Math.pow(B, 2);
                            qPointsValue = total * 463.26 / denominator;
                        } else if (gender === 'F') {
                            const denominator = 266.5 - 19.44 * Math.pow(B, -2) + 18.61 * Math.pow(B, 2);
                            qPointsValue = total * 306.54 / denominator;
                        }
                        
                        if (qPointsValue && !isNaN(qPointsValue)) {
                            qpoints = qPointsValue.toFixed(3);
                        }
                    }
                } catch (error) {
                    // If calculation fails, leave qpoints empty
                }
            }
            
            const row = [
                escapeCSV(profile.membershipId),
                escapeCSV(profile.athleteName),
                escapeCSV(profile.gender),
                escapeCSV(profile.club),
                escapeCSV(profile.wso),
                escapeCSV(profile.nationalRank),
                escapeCSV(profile.internalId),
                escapeCSV(profile.lifterAge),
                escapeCSV(competitionAge),
                escapeCSV(profile.liftDate),
                escapeCSV(birthYear),
                escapeCSV(comp.meetName),
                escapeCSV(comp.meetDate),
                escapeCSV(ageCategory),
                escapeCSV(weightClass),
                escapeCSV(comp.lifterName || profile.athleteName),
                escapeCSV(comp.bodyWeight),
                escapeCSV(comp.snatch1),
                escapeCSV(comp.snatch2),
                escapeCSV(comp.snatch3),
                escapeCSV(comp.cj1),
                escapeCSV(comp.cj2),
                escapeCSV(comp.cj3),
                escapeCSV(comp.bestSnatch),
                escapeCSV(comp.bestCJ),
                escapeCSV(comp.total),
                escapeCSV(qpoints),
                '', // qmasters placeholder
                '', // sinclair placeholder
                '', // sinclairmeltzerfaber placeholder
                '', // sinclairhuebnermetzerfaber placeholder
                escapeCSV(batchId),
                escapeCSV(timestamp)
            ];
            
            csvContent += row.join(',') + '\n';
        });
    }
    
    fs.writeFileSync(athleteFile, csvContent);
    
    return {
        filePath: athleteFile,
        competitionCount: profile.competitionHistory ? profile.competitionHistory.length : 0
    };
}

// INTEGRATED ATHLETE SCRAPING FUNCTION (from scrapeAthleteProfile2020.js)
async function scrapeAthleteProfileIntegrated(page, athleteName, ageCategory, weightClass, competitionDate) {
    console.log(`Looking up athlete: ${athleteName}`);
    console.log(`Category: ${ageCategory}, Weight: ${weightClass}, Date: ${competitionDate}`);
    
    // Calendar navigation functions (from working scraper)
    async function handleComplexDatePicker(targetYear, interfaceSelector, targetMonth = 1, targetDay = 1) {
        console.log(`🗓️ Fast navigating calendar (${interfaceSelector}) to ${targetMonth}/${targetDay}/${targetYear}...`);

        const container = await page.$(interfaceSelector);
        if (!container) throw new Error(`Could not find calendar container: ${interfaceSelector}`);

        const monthMap = {
            January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
            July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
        };

        async function getCurrentMonthYear() {
            const containerBox = await container.boundingBox();
            if (!containerBox) return null;

            const headers = await page.$$('.v-date-picker-header__value, .v-date-picker-header, [class*="date-picker"] [class*="header"]');
            let closestHeader = null;
            let minDistance = Infinity;

            for (const header of headers) {
                const isVisible = await header.evaluate(el => {
                    return el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
                });
                if (!isVisible) continue;

                const headerBox = await header.boundingBox();
                if (!headerBox) continue;

                const verticalDistance = Math.abs(headerBox.y - containerBox.y);
                if (verticalDistance < minDistance && verticalDistance < 150) {
                    minDistance = verticalDistance;
                    closestHeader = header;
                }
            }

            if (closestHeader) {
                const text = (await (await closestHeader.getProperty('textContent')).jsonValue()).trim();
                const match = text.match(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/);
                if (match) {
                    const [monthName, yearStr] = text.split(' ');
                    return { monthName, year: parseInt(yearStr, 10), raw: text };
                }
            }
            return null;
        }

        async function getPrevMonthButton() {
            const containerBox = await container.boundingBox();
            if (!containerBox) throw new Error('Could not get bounding box of calendar container');

            const buttons = await page.$$('button[aria-label="Previous month"]');
            let closestBtn = null;
            let minDistance = Infinity;

            for (const btn of buttons) {
                const isVisible = await btn.evaluate(el => {
                    return el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
                });
                if (!isVisible) continue;

                const btnBox = await btn.boundingBox();
                if (!btnBox) continue;

                const verticalDistance = Math.abs(btnBox.y - containerBox.y);
                if (verticalDistance < minDistance && verticalDistance < 150) {
                    minDistance = verticalDistance;
                    closestBtn = btn;
                }
            }

            if (!closestBtn) throw new Error('Could not find previous month button in the active calendar');
            return closestBtn;
        }

        const currentMonthYear = await getCurrentMonthYear();
        if (!currentMonthYear) throw new Error('Could not determine current month/year in date picker');
        
        const currentMonth = monthMap[currentMonthYear.monthName];
        const currentYear = currentMonthYear.year;
        
        console.log(`📅 Starting from: ${currentMonthYear.raw}`);

        const totalMonthsToGoBack = (currentYear - targetYear) * 12 + (currentMonth - targetMonth);
        
        if (totalMonthsToGoBack <= 0) {
            console.log('✅ Already at or past target month/year');
        } else {
            console.log(`🚀 Need to go back ${totalMonthsToGoBack} months - executing rapid clicks...`);
            
            const prevButton = await getPrevMonthButton();
            
            for (let i = 0; i < totalMonthsToGoBack; i++) {
                await prevButton.click();
                await page.waitForTimeout(25);
            }
            
            console.log(`✅ Completed ${totalMonthsToGoBack} rapid navigation clicks`);
        }

        console.log(`📅 Selecting day ${targetDay}`);
        await page.waitForTimeout(200);

        const clickResult = await page.evaluate((day) => {
            const allButtons = document.querySelectorAll('button');
            const dayButtons = Array.from(allButtons).filter(btn => btn.textContent.trim() === day.toString());
            
            if (dayButtons.length > 0) {
                const buttonIndex = (day === 31 && dayButtons.length > 1) ? 1 : 0;
                const dayButton = dayButtons[buttonIndex];
                dayButton.click();
                return { success: true };
            }
            return { success: false };
        }, targetDay);

        if (clickResult.success) {
            console.log(`✅ Clicked day ${targetDay}`);
            await page.waitForTimeout(25);
        } else {
            console.log(`❌ Could not find day ${targetDay} button`);
        }

        const okButtons = await container.$$('button, .v-btn, .s80-btn');
        let okClicked = false;
        for (const btn of okButtons) {
            const text = (await (await btn.getProperty('textContent')).jsonValue()).trim().toLowerCase();
            if (['ok', 'apply', 'done', 'select'].includes(text)) {
                await btn.click();
                okClicked = true;
                console.log('✅ Clicked OK/APPLY button in calendar');
                break;
            }
        }
        if (!okClicked) {
            console.log('⚠️ No OK/APPLY button found in calendar, calendar may close automatically');
        }

        console.log(`✅ Fast date picker navigation completed for ${targetMonth}/${targetDay}/${targetYear}`);
    }

    async function handleDateField(fieldSelector, targetYear, fieldType) {
        console.log(`📅 Handling ${fieldType} date field: ${fieldSelector}`);

        try {
            const fieldExists = await page.$(fieldSelector);
            if (!fieldExists) {
                console.log(`⚠️ ${fieldType} date field not found: ${fieldSelector}`);
                return;
            }

            await page.click(fieldSelector);
            await page.waitForTimeout(200);

            const datePickerInterfaces = [
                '.v-date-picker',
                '.s80-date-picker',
                '.v-menu__content',
                '[role="dialog"]',
                '.v-dialog',
                'input[type="date"]'
            ];

            let activeInterface = null;
            for (const selector of datePickerInterfaces) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        const isVisible = await element.evaluate(el => {
                            return el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
                        });
                        if (isVisible) {
                            activeInterface = selector;
                            console.log(`✅ Found active ${fieldType} date interface: ${selector}`);
                            break;
                        }
                    }
                } catch (err) {
                    // Continue checking other selectors
                }
            }

            if (!activeInterface) {
                console.log(`⚠️ No ${fieldType} date picker interface found`);
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
                return;
            }

            if (activeInterface.includes('date-picker') || activeInterface.includes('v-menu')) {
                if (fieldType === 'start') {
                    await handleComplexDatePicker(2020, activeInterface, 1, 1); // January 1, 2020
                } else if (fieldType === 'end') {
                    const lastDayDec = 31;
                    await handleComplexDatePicker(targetYear, activeInterface, 12, lastDayDec);
                } else {
                    await handleComplexDatePicker(targetYear, activeInterface);
                }

                console.log(`🔚 Waiting for ${fieldType} date calendar to close...`);
                await page.waitForTimeout(100);
            }

            console.log(`✅ ${fieldType} date field handling completed`);

        } catch (error) {
            console.error(`❌ Failed to handle ${fieldType} date field:`, error.message);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        }
    }

    try {
        console.log('Navigating to rankings page...');
        await page.goto('https://usaweightlifting.sport80.com/public/rankings/all', {
            waitUntil: 'networkidle0'
        });
        
        console.log('Page loaded successfully');
        await page.waitForSelector('text=Select Filters', {timeout: 5000});
        
        // Set weight class
        console.log('Setting weight class...');
        let targetWeightClass = `${ageCategory} ${weightClass}`;
        
        await page.click('#weight_class');
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        
        await page.type('#weight_class', targetWeightClass, {delay: 2});
        await page.waitForTimeout(500);
        await page.keyboard.press('ArrowDown');
        
        // Weight class navigation fixes from working scraper
        if ((ageCategory.includes("Men's") && (weightClass === "81kg" || weightClass === "55kg" || weightClass === "69 kg")) ||
            (ageCategory.includes("Men's 13 Under Age Group") && (weightClass === "39kg" || weightClass === "40kg" || weightClass === "44kg" || weightClass === "48kg" || weightClass === "49kg" || weightClass === "55kg")) ||
            (ageCategory.includes("Men's 11 Under Age Group") && (weightClass === "40kg" || weightClass === "44kg" || weightClass === "48kg")) ||
            (ageCategory.includes("Men's 14-15 Age Group") && (weightClass === "48kg" || weightClass === "49kg" || weightClass === "55kg")) ||
            (ageCategory.includes("Men's 16-17 Age Group") && (weightClass === "49kg" || weightClass === "55kg" || weightClass === "69 kg" || weightClass === "81kg"))) {
            await page.keyboard.press('ArrowDown');
        }
        
        if ((ageCategory.includes("Men's 13 Under Age Group") && weightClass === "36kg") ||
            (ageCategory.includes("Men's 14-15 Age Group") && weightClass === "44kg")) {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
        }
        
        await page.keyboard.press('Enter');
        
        // Set date range with working calendar navigation
        console.log('Setting date range with calendar navigation...');
        console.log(`📅 Setting START date range to ${CONFIG.TARGET_YEAR}...`);
        await handleDateField('#form__date_range_start', CONFIG.TARGET_YEAR, 'start');
        await page.waitForTimeout(100);
        
        console.log(`Date range set to: 01-01-${CONFIG.TARGET_YEAR} - 12-31-${CONFIG.TARGET_YEAR}`);
        console.log('🖱️ Clicking away from calendar to apply date filter...');
        await page.click('body');
        await page.waitForTimeout(500);
        
        // Apply filters
        console.log('Applying filters...');
        const applyButton = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], .btn'));
            return buttons.find(btn => btn.textContent?.includes('Apply'));
        });
        await applyButton.click();
        await page.waitForTimeout(6000);
        
        console.log('Filters applied');
        
        // Search for athlete
        console.log(`Searching for athlete: ${athleteName}`);
        await page.click('#search');
        await page.type('#search', athleteName, {delay: 15});
        await page.waitForTimeout(6000);
        await page.waitForNetworkIdle();
        
        console.log('Search applied, extracting profile data...');
        
        // Extract profile data (same as working scraper)
        const profileData = await page.evaluate((name) => {
            const rows = Array.from(document.querySelectorAll('tr, .athlete-row, .result-row, tbody tr'));
            const normalizedSearchName = name.replace(/\s+/g, ' ').trim();
            const athleteRow = rows.find(row => {
                const rowText = row.textContent?.replace(/\s+/g, ' ').trim();
                return rowText?.includes(normalizedSearchName);
            });
            
            if (athleteRow) {
                const cells = Array.from(athleteRow.querySelectorAll('td, .cell'));
                const cellTexts = cells.map(cell => cell.textContent?.trim() || '');
                
                return {
                    athleteName: name,
                    nationalRank: cellTexts[0],
                    membershipId: cellTexts[7],
                    club: cellTexts[6],
                    wso: cellTexts[12],
                    lifterAge: cellTexts[5],
                    liftDate: cellTexts[9],
                    total: cellTexts[2],
                    gender: cellTexts[4]
                };
            }
            
            return { athleteName: name, error: 'Athlete row not found' };
        }, athleteName);
        
        console.log('Profile data extracted:');
        console.log(`Name: ${profileData.athleteName}`);
        console.log(`Membership ID: ${profileData.membershipId}`);
        console.log(`Club: ${profileData.club}`);
        
        // Click on athlete (same logic as working scraper)
        console.log(`Clicking on athlete: ${athleteName}`);
        await page.waitForTimeout(2000);
        
        const clicked = await page.evaluate((name, targetMeetDate) => {
            const normalizedSearchName = name.replace(/\s+/g, ' ').trim();
            const rows = Array.from(document.querySelectorAll('tr, tbody tr'));
            const nameMatchingRows = rows.filter(row => {
                const rowText = row.textContent?.replace(/\s+/g, ' ').trim();
                return rowText?.includes(normalizedSearchName);
            });
            
            const matchingRow = nameMatchingRows.find(row => {
                return true; // Accept any row with the athlete name since we're in 2020 data
            });
            
            if (matchingRow) {
                const clickableEl = matchingRow.querySelector('a, span, td, div');
                const nameElements = Array.from(matchingRow.querySelectorAll('*')).filter(el => {
                    const elText = el.textContent?.replace(/\s+/g, ' ').trim();
                    return elText === normalizedSearchName;
                });
                
                const targetElement = nameElements[0] || clickableEl;
                if (targetElement) {
                    targetElement.click();
                    return true;
                }
            }
            
            const elements = Array.from(document.querySelectorAll('a, span, td, div'));
            const athleteEl = elements.find(el => {
                const elText = el.textContent?.replace(/\s+/g, ' ').trim();
                return elText === normalizedSearchName;
            });
            if (athleteEl) {
                athleteEl.click();
                return true;
            }
            
            return false;
        }, athleteName, competitionDate);
        
        if (!clicked) {
            console.log(`❌ Could not find clickable element for ${athleteName}`);
            return {
                success: false,
                message: `Could not find clickable element for ${athleteName}`,
                profileData: profileData
            };
        }
        
        // Extract competition data (same as working scraper)
        await page.waitForTimeout(2000);
        
        const competitionData = await page.evaluate(() => {
            return {
                url: window.location.href,
                internalId: window.location.href.split('/').pop()
            };
        });
        
        console.log('Competition page accessed:', competitionData.url);
        
        // Get all competition records across pages (same pagination logic)
        let allCompetitionRecords = [];
        let currentPage = 1;
        let hasMorePages = true;
        
        while (hasMorePages) {
            console.log(`Extracting data from page ${currentPage}...`);
            
            const pageRecords = await page.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('tbody tr, .competition-row, tr'));
                const records = [];
                
                rows.forEach(row => {
                    const cells = Array.from(row.querySelectorAll('td, .cell'));
                    const cellTexts = cells.map(cell => cell.textContent?.trim()).filter(text => text);
                    
                    if (cellTexts.length >= 8 && cellTexts.some(text => text.includes('-') && text.match(/\d{4}-\d{2}-\d{2}/))) {
                        records.push({
                            meetName: cellTexts[0],
                            meetDate: cellTexts[1],
                            ageCategory: cellTexts[2],
                            lifterName: cellTexts[3],
                            bodyWeight: cellTexts[4],
                            snatch1: cellTexts[5],
                            snatch2: cellTexts[6],
                            snatch3: cellTexts[7],
                            cj1: cellTexts[8],
                            cj2: cellTexts[9],
                            cj3: cellTexts[10],
                            bestSnatch: cellTexts[11],
                            bestCJ: cellTexts[12],
                            total: cellTexts[13],
                            rawData: cellTexts
                        });
                    }
                });
                
                return records;
            });
            
            console.log(`Found ${pageRecords.length} records on page ${currentPage}`);
            allCompetitionRecords = allCompetitionRecords.concat(pageRecords);
            
            // Check for next page (same logic as working scraper)
            const nextPageExists = await page.evaluate(() => {
                const vueNextButton = document.querySelector('.v-data-footer__icons-after .v-btn');
                if (vueNextButton && !vueNextButton.disabled && !vueNextButton.classList.contains('v-btn--disabled')) {
                    vueNextButton.click();
                    return true;
                }
                
                const allButtons = Array.from(document.querySelectorAll('button, a, .v-btn, [role="button"]'));
                const nextButton = allButtons.find(btn => {
                    const text = btn.textContent?.toLowerCase();
                    const classes = btn.className?.toLowerCase();
                    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase();
                    
                    return (text?.includes('next') || 
                           text?.includes('>') || 
                           text?.includes('→') ||
                           classes?.includes('next') ||
                           ariaLabel?.includes('next')) &&
                           !btn.disabled && 
                           !btn.classList.contains('disabled') && 
                           !btn.classList.contains('v-btn--disabled');
                });
                
                if (nextButton) {
                    nextButton.click();
                    return true;
                }
                
                return false;
            });
            
            if (nextPageExists) {
                await page.waitForNetworkIdle();
                currentPage++;
                
                if (currentPage > 50) {
                    hasMorePages = false;
                }
            } else {
                hasMorePages = false;
            }
        }
        
        console.log(`Extracted ${allCompetitionRecords.length} total competition records`);
        
        return {
            success: true,
            message: `Successfully accessed ${athleteName}'s complete profile with ${allCompetitionRecords.length} competition records`,
            profileData: {
                athleteName: profileData.athleteName,
                nationalRank: profileData.nationalRank,
                membershipId: profileData.membershipId,
                club: profileData.club,
                wso: profileData.wso,
                lifterAge: profileData.lifterAge,
                liftDate: profileData.liftDate,
                gender: profileData.gender,
                total: profileData.total,
                internalId: competitionData.internalId,
                profileUrl: competitionData.url,
                pagesScraped: currentPage,
                competitionHistory: allCompetitionRecords
            }
        };
        
    } catch (error) {
        console.error('Error scraping athlete profile:', error);
        throw error;
    }
}

// Main function with integrated scraping
async function processAllDivisions() {
    console.log('🚀 Starting Division-Based Systematic Athlete Scraper...');
    console.log('📋 Using integrated scraping approach');
    
    const divisions = loadDivisions();
    
    // Launch browser once for entire run
    const browser = await puppeteer.launch({headless: CONFIG.HEADLESS, slowMo: 50});
    const page = await browser.newPage();
    await page.setViewport({width: 1500, height: 1000});
    
    let totalSuccessCount = 0;
    let totalErrorCount = 0;
    let totalDivisionsProcessed = 0;
    
    try {
        // Process each division
        for (let i = 0; i < divisions.length; i++) {
            const division = divisions[i];
            console.log(`\n🏋️ Processing division ${i + 1}/${divisions.length}: ${division}`);
            
            const { ageCategory, weightClass } = splitAgeCategoryAndWeightClass(division);
            console.log(`   Age Category: ${ageCategory}`);
            console.log(`   Weight Class: ${weightClass}`);
            
            let divisionSuccessCount = 0;
            let divisionErrorCount = 0;
            
            // Test with placeholder athletes (you'll replace this with actual division athlete extraction)
            const testAthletes = [
                {
                    name: 'Test Athlete 1',
                    ageCategory: ageCategory,
                    weightClass: weightClass,
                    meetDate: `${CONFIG.TARGET_YEAR}-01-01`
                }
            ];
            
            // Process each athlete in the division
            for (let j = 0; j < testAthletes.length; j++) {
                const athlete = testAthletes[j];
                console.log(`\n🔍 Processing athlete ${j + 1}/${testAthletes.length}: ${athlete.name}`);
                
                try {
                    // Use integrated scraping function with shared page
                    const profileData = await scrapeAthleteProfileIntegrated(
                        page,
                        athlete.name,
                        athlete.ageCategory,
                        athlete.weightClass,
                        athlete.meetDate
                    );
                    
                    if (profileData.success) {
                        const membershipId = profileData.profileData.membershipId;
                        
                        if (membershipId) {
                            if (isAthleteAlreadyProcessed(membershipId)) {
                                console.log(`⏭️ Skipping ${athlete.name} - already processed`);
                                divisionSuccessCount++;
                                continue;
                            }
                            
                            console.log(`✅ Successfully processed: ${athlete.name}`);
                            console.log(`   - Membership ID: ${membershipId}`);
                            console.log(`   - Club: ${profileData.profileData.club}`);
                            
                            // Create athlete CSV file
                            const athleteFileResult = createAthleteCSV(membershipId, profileData, division);
                            
                            console.log(`   - Created: ${athleteFileResult.filePath}`);
                            console.log(`   - Competition records: ${athleteFileResult.competitionCount}`);
                            
                            divisionSuccessCount++;
                            totalSuccessCount++;
                        } else {
                            console.log(`❌ No membership ID found for: ${athlete.name}`);
                            divisionErrorCount++;
                            totalErrorCount++;
                        }
                    } else {
                        console.log(`❌ Failed to process: ${athlete.name} - ${profileData.message}`);
                        divisionErrorCount++;
                        totalErrorCount++;
                    }
                    
                } catch (error) {
                    console.log(`💥 Error processing ${athlete.name}: ${error.message}`);
                    divisionErrorCount++;
                    totalErrorCount++;
                }
                
                // Delay between athletes
                if (j < testAthletes.length - 1) {
                    console.log('⏳ Waiting 2 seconds before next athlete...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            console.log(`✅ Division ${division} completed:`);
            console.log(`   - Successful athletes: ${divisionSuccessCount}`);
            console.log(`   - Failed athletes: ${divisionErrorCount}`);
            
            totalDivisionsProcessed++;
            
            // Delay between divisions
            if (i < divisions.length - 1) {
                console.log('⏳ Waiting 5 seconds before next division...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
            // Stop after configured number of divisions for testing
            if (i >= CONFIG.MAX_DIVISIONS_FOR_TESTING - 1) {
                console.log(`🛑 Stopping after ${CONFIG.MAX_DIVISIONS_FOR_TESTING} divisions for testing`);
                break;
            }
        }
        
    } finally {
        await browser.close();
    }
    
    console.log('\n🎉 Division-Based Processing Complete!');
    console.log(`📊 Total Summary:`);
    console.log(`   📂 Divisions processed: ${totalDivisionsProcessed}`);
    console.log(`   ✅ Athletes processed successfully: ${totalSuccessCount}`);
    console.log(`   ❌ Athletes failed: ${totalErrorCount}`);
    console.log(`   📁 Individual athlete files created in: ../output/athletes/`);
    
    return {
        divisionsProcessed: totalDivisionsProcessed,
        successfulAthletes: totalSuccessCount,
        failedAthletes: totalErrorCount
    };
}

// Run the division processing
if (require.main === module) {
    processAllDivisions()
        .then(results => {
            console.log('\n🏁 Processing finished successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Processing failed:', error);
            process.exit(1);
        });
}

module.exports = {
    processAllDivisions
};