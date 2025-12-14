const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// =================================================================
// BATCH DIVISION SCRAPER - Processes specific range of divisions
// Default: Scrapes LAST 3 MONTHS (including current) to cover backlog
// Custom Date Range: Set START_DATE and END_DATE environment variables
//   Example: START_DATE=2025-09-01 END_DATE=2025-10-31 node scripts/production/nightly-division-scraper.js
// =================================================================
const CONFIG = {
    OVERWRITE_EXISTING_FILES: false,
    DELAY_BETWEEN_ATHLETES: 100,    // Reduced from 2000ms
    DELAY_BETWEEN_DIVISIONS: 2000,  // Reduced from 3000ms since less data
    TARGET_YEAR: new Date().getFullYear(),
    HEADLESS: true,
    // Get division range from environment
    DIVISION_START: parseInt(process.env.DIVISION_START || '1'),
    DIVISION_END: parseInt(process.env.DIVISION_END || '35'),
    DAY_NAME: process.env.DAY_NAME || 'Unknown',
    // For testing - process fewer divisions
    TEST_MODE: process.env.TEST_MODE === 'true',
    TEST_LIMIT: 3,
    // Date range: last 3 months including current (or custom via START_DATE/END_DATE env vars)
    MONTHS_TO_SCRAPE: 3
};

// Utility functions
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
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

function resolveDataPath(relativePath) {
    // Try multiple possible paths to support both local execution and GitHub Actions
    const possiblePaths = [
        // When running from scripts/production/ directory (local execution)
        `../../${relativePath}`,
        // When running from repository root (GitHub Actions)
        `./${relativePath}`,
        // Absolute path fallback
        relativePath
    ];

    for (const fullPath of possiblePaths) {
        const dir = path.dirname(fullPath);
        if (fs.existsSync(dir)) {
            return fullPath;
        }
    }

    // If none exist, return the GitHub Actions path and let ensureDirectoryExists create it
    return `./${relativePath}`;
}

function createExtractionIssuesLogger() {
    const issuesFilePath = resolveDataPath('data/logs/athlete_extraction_details.csv');

    // Ensure the logs directory exists
    ensureDirectoryExists(path.dirname(issuesFilePath));

    if (!fs.existsSync(issuesFilePath)) {
        const headers = ['division_number', 'division_name', 'issue_type', 'athlete_name', 'membership_id', 'row_data', 'description', 'batch_day'];
        fs.writeFileSync(issuesFilePath, headers.join(',') + '\n');
    }

    return {
        logIssue: (divisionNumber, divisionName, issueType, athleteName, membershipId, rowData, description) => {
            const row = [
                divisionNumber,
                escapeCSV(divisionName),
                issueType,
                escapeCSV(athleteName || ''),
                escapeCSV(membershipId || ''),
                escapeCSV(JSON.stringify(rowData)),
                escapeCSV(description),
                CONFIG.DAY_NAME
            ];
            fs.appendFileSync(issuesFilePath, row.join(',') + '\n');
        }
    };
}

function loadDivisions() {
    // Try multiple possible paths to support both local execution and GitHub Actions
    const possiblePaths = [
        // When running from scripts/production/ directory (local execution)
        '../../data/current/activedivisions.csv',
        '../../data/current/active divisions.csv',
        // When running from repository root (GitHub Actions)
        './data/current/activedivisions.csv',
        './data/current/active divisions.csv',
        // Absolute path fallback
        'data/current/activedivisions.csv',
        'data/current/active divisions.csv'
    ];

    let fileToUse = null;
    for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
            fileToUse = filePath;
            break;
        }
    }

    if (!fileToUse) {
        console.log('🔍 Searched for division files in these locations:');
        possiblePaths.forEach(path => console.log(`   - ${path} (${fs.existsSync(path) ? 'found' : 'not found'})`));
        throw new Error('Division file not found! Looking for activedivisions.csv or "active divisions.csv"');
    }

    console.log(`📋 Loading divisions from: ${fileToUse}`);
    const content = fs.readFileSync(fileToUse, 'utf8');
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);

    // Skip header if present
    const firstLine = lines[0];
    const isHeader = firstLine && (
        firstLine.toLowerCase().includes('division') ||
        firstLine.toLowerCase().includes('age') ||
        firstLine.toLowerCase().includes('weight')
    );

    const divisions = isHeader ? lines.slice(1) : lines;

    console.log(`📋 Loaded ${divisions.length} total divisions`);
    return divisions;
}

function loadDivisionCodes() {
    // Try multiple possible paths to support both local execution and GitHub Actions
    const possiblePaths = [
        // When running from scripts/production/ directory (local execution)
        '../../division_base64_codes.json',
        // When running from repository root (GitHub Actions)
        './division_base64_codes.json',
        // Absolute path fallback
        'division_base64_codes.json'
    ];

    let fileToUse = null;
    for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
            fileToUse = filePath;
            break;
        }
    }

    if (!fileToUse) {
        console.log('🔍 Searched for division codes file in these locations:');
        possiblePaths.forEach(path => console.log(`   - ${path} (${fs.existsSync(path) ? 'found' : 'not found'})`));
        throw new Error('Division codes file not found! Looking for division_base64_codes.json');
    }

    const content = fs.readFileSync(fileToUse, 'utf8');
    const data = JSON.parse(content);
    return data.division_codes || {};
}

function getDivisionsForBatch(divisions) {
    let batchDivisions = [];
    
    // Support both range (DIVISION_START/END) and list (DIVISION_LIST) modes
    if (process.env.DIVISION_LIST) {
        // Parse comma-separated or range-based list: "1,5,10-15,32,50-52"
        const parts = process.env.DIVISION_LIST.split(',').map(p => p.trim());
        const indices = new Set();
        
        for (const part of parts) {
            if (part.includes('-')) {
                // Handle range like "10-15"
                const [start, end] = part.split('-').map(p => parseInt(p.trim()));
                for (let i = start; i <= end; i++) {
                    indices.add(i - 1); // Convert to 0-based index
                }
            } else {
                // Handle individual number like "32"
                const num = parseInt(part);
                if (!isNaN(num)) {
                    indices.add(num - 1); // Convert to 0-based index
                }
            }
        }
        
        // Sort indices and get corresponding divisions
        const sortedIndices = Array.from(indices).sort((a, b) => a - b);
        batchDivisions = sortedIndices.map(idx => divisions[idx]).filter(d => d);
        
        console.log(`📅 ${CONFIG.DAY_NAME} Batch Configuration:`);
        console.log(`   Total divisions available: ${divisions.length}`);
        console.log(`   Division list: ${process.env.DIVISION_LIST}`);
        console.log(`   Selected divisions: ${sortedIndices.map(i => i + 1).join(', ')}`);
        console.log(`   Actual divisions to process: ${batchDivisions.length}`);
        
        if (batchDivisions.length > 0) {
            console.log(`   Divisions: ${batchDivisions.join(', ')}`);
        }
    } else {
        // Original range-based logic
        const startIdx = CONFIG.DIVISION_START - 1;
        const endIdx = CONFIG.DIVISION_END;
        
        batchDivisions = divisions.slice(startIdx, endIdx);

        console.log(`📅 ${CONFIG.DAY_NAME} Batch Configuration:`);
        console.log(`   Total divisions available: ${divisions.length}`);
        console.log(`   Requested range: ${CONFIG.DIVISION_START} to ${CONFIG.DIVISION_END}`);
        console.log(`   Actual divisions to process: ${batchDivisions.length}`);

        if (batchDivisions.length > 0) {
            console.log(`   First division: ${batchDivisions[0]}`);
            console.log(`   Last division: ${batchDivisions[batchDivisions.length - 1]}`);
        }
    }

    if (CONFIG.TEST_MODE) {
        console.log(`⚠️  TEST MODE: Limiting to ${CONFIG.TEST_LIMIT} divisions`);
        return batchDivisions.slice(0, CONFIG.TEST_LIMIT);
    }

    return batchDivisions;
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

function isAthleteAlreadyProcessed(membershipId) {
    if (!membershipId) return false;

    const athleteFile = path.join('./output/athletes', `athlete_${membershipId}.csv`);
    return fs.existsSync(athleteFile) && !CONFIG.OVERWRITE_EXISTING_FILES;
}

function createAthleteCSV(membershipId, profileData, sourceDivision) {
    const athletesDir = './output/athletes';
    ensureDirectoryExists(athletesDir);

    const athleteFile = path.join(athletesDir, `athlete_${membershipId}.csv`);
    const profile = profileData.profileData;

    const headers = [
        'membership_number', 'athlete_name', 'gender', 'club_name', 'wso',
        'national_rank', 'internal_id', 'lifter_age', 'competition_age',
        'lift_date', 'birth_year', 'Meet', 'Date', 'Age Category',
        'Weight Class', 'Lifter', 'Body Weight (Kg)', 'Snatch Lift 1',
        'Snatch Lift 2', 'Snatch Lift 3', 'C&J Lift 1', 'C&J Lift 2',
        'C&J Lift 3', 'Best Snatch', 'Best C&J', 'Total', 'qpoints',
        'qmasters', 'sinclair', 'sinclairmeltzerfaber',
        'sinclairhuebnermetzerfaber', 'batch_id', 'batch_date'
    ];

    const timestamp = new Date().toISOString();
    const batchId = `${CONFIG.DAY_NAME.toLowerCase()}_${membershipId}_${Date.now()}`;

    let csvContent = headers.join(',') + '\n';

    const { ageCategory, weightClass } = splitAgeCategoryAndWeightClass(sourceDivision);

    let birthYear = '';
    if (profile.lifterAge && profile.liftDate) {
        try {
            const age = parseInt(profile.lifterAge);
            const liftYear = new Date(profile.liftDate).getFullYear();
            if (!isNaN(age) && !isNaN(liftYear)) {
                birthYear = liftYear - age;
            }
        } catch (error) { }
    }

    // Debug: Log if birth_year couldn't be calculated
    if (!birthYear && profile.lifterAge) {
        console.log(`   ⚠️ Warning: Could not calculate birth_year for ${profile.athleteName}: lifterAge=${profile.lifterAge}, liftDate=${profile.liftDate}`);
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
        escapeCSV(profile.lifterAge), // competition_age = lifter_age from rankings page
        escapeCSV(profile.liftDate),
        escapeCSV(birthYear),
        '', '', // Meet, Date
        escapeCSV(ageCategory),
        escapeCSV(weightClass),
        escapeCSV(profile.athleteName),
        '', '', '', '', '', '', '', // Body weight and lifts
        '', '', // Best lifts
        escapeCSV(profile.total),
        '', '', '', '', '', // Points calculations
        escapeCSV(batchId),
        escapeCSV(timestamp)
    ];

    csvContent += row.join(',') + '\n';
    fs.writeFileSync(athleteFile, csvContent);

    return { filePath: athleteFile };
}

// Calendar navigation functions (from your original nightly-division-scraper.js)
async function handleComplexDatePicker(page, targetYear, interfaceSelector, targetMonth = 1, targetDay = 1) {
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

    async function getNextMonthButton() {
        const containerBox = await container.boundingBox();
        if (!containerBox) throw new Error('Could not get bounding box of calendar container');

        const buttons = await page.$$('button[aria-label="Next month"]');
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

        if (!closestBtn) throw new Error('Could not find next month button in the active calendar');
        return closestBtn;
    }

    const currentMonthYear = await getCurrentMonthYear();
    if (!currentMonthYear) throw new Error('Could not determine current month/year in date picker');

    const currentMonth = monthMap[currentMonthYear.monthName];
    const currentYear = currentMonthYear.year;

    console.log(`📅 Starting from: ${currentMonthYear.raw}`);

    const totalMonthsDifference = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);

    if (totalMonthsDifference === 0) {
        console.log('✅ Already at target month/year');
    } else if (totalMonthsDifference > 0) {
        // Need to go forward
        console.log(`🚀 Need to go forward ${totalMonthsDifference} months - executing rapid clicks...`);

        const nextButton = await getNextMonthButton();

        for (let i = 0; i < totalMonthsDifference; i++) {
            await nextButton.click();
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        console.log(`✅ Completed ${totalMonthsDifference} forward navigation clicks`);
    } else {
        // Need to go backward
        const totalMonthsToGoBack = Math.abs(totalMonthsDifference);
        console.log(`🚀 Need to go back ${totalMonthsToGoBack} months - executing rapid clicks...`);

        const prevButton = await getPrevMonthButton();

        for (let i = 0; i < totalMonthsToGoBack; i++) {
            await prevButton.click();
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        console.log(`✅ Completed ${totalMonthsToGoBack} backward navigation clicks`);
    }

    // Verify we're at the correct month/year after navigation
    const finalMonthYear = await getCurrentMonthYear();
    if (finalMonthYear) {
        const finalMonth = monthMap[finalMonthYear.monthName];
        const finalYear = finalMonthYear.year;
        console.log(`📅 Final position: ${finalMonthYear.raw}`);

        if (finalMonth !== targetMonth || finalYear !== targetYear) {
            console.log(`⚠️ Navigation ended at wrong position. Expected: ${targetMonth}/${targetYear}, Got: ${finalMonth}/${finalYear}`);
        }
    }

    // Now click on the target day
    console.log(`📅 Selecting day ${targetDay}`);
    await new Promise(resolve => setTimeout(resolve, 200));

    const clickResult = await page.evaluate((day) => {
        const allButtons = document.querySelectorAll('button');
        const dayButtons = Array.from(allButtons).filter(btn => btn.textContent.trim() === day.toString());

        if (dayButtons.length > 0) {
            const buttonIndex = (dayButtons.length > 1) ? 1 : 0;
            const dayButton = dayButtons[buttonIndex];
            dayButton.click();
            return { success: true };
        }
        return { success: false };
    }, targetDay);

    if (clickResult.success) {
        console.log(`✅ Clicked day ${targetDay}`);
        await new Promise(resolve => setTimeout(resolve, 25));
    } else {
        console.log(`❌ Could not find day ${targetDay} button`);
    }

    // After selecting the day, click the OK button inside the calendar container    
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

async function handleDateField(page, fieldSelector, targetYear, fieldType, targetMonth = 1, targetDay = 1) {
    console.log(`📅 Handling ${fieldType} date field: ${fieldSelector}`);

    try {
        // Check if the field exists
        const fieldExists = await page.$(fieldSelector);
        if (!fieldExists) {
            console.log(`⚠️ ${fieldType} date field not found: ${fieldSelector}`);
            return;
        }

        // Click the date field to open its calendar
        await page.click(fieldSelector);
        await new Promise(resolve => setTimeout(resolve, 200));

        // Look for various date picker interfaces that might have opened
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
            await new Promise(resolve => setTimeout(resolve, 500));
            return;
        }

        if (activeInterface.includes('date-picker') || activeInterface.includes('v-menu')) {
            await handleComplexDatePicker(page, targetYear, activeInterface, targetMonth, targetDay);
            console.log(`🔚 Waiting for ${fieldType} date calendar to close...`);
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`✅ ${fieldType} date field handling completed`);

    } catch (error) {
        console.error(`❌ Failed to handle ${fieldType} date field:`, error.message);
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

// Build rankings URL with base64-encoded filters
function buildRankingsURL(divisionName, divisionCodes, startDate, endDate) {
    const weightClassCode = divisionCodes[divisionName];
    
    if (!weightClassCode) {
        throw new Error(`No division code found for: ${divisionName}`);
    }

    // Format dates as YYYY-MM-DD
    const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

    const filters = {
        date_range_start: startDateStr,
        date_range_end: endDateStr,
        weight_class: weightClassCode
    };

    const jsonStr = JSON.stringify(filters);
    const base64Encoded = Buffer.from(jsonStr).toString('base64');

    return `https://usaweightlifting.sport80.com/public/rankings/all?filters=${encodeURIComponent(base64Encoded)}`;
}

// Main scraping function for a division
async function scrapeDivisionAthletes(page, division, divisionIndex, globalDivisionNumber, issuesLogger, divisionCodes) {
    console.log(`\n🏋️ Scraping division #${globalDivisionNumber}: ${division}`);

    try {
        // Calculate date range
        let startDate, endDate;

        if (process.env.START_DATE && process.env.END_DATE) {
            // Custom date range from environment variables (format: YYYY-MM-DD)
            startDate = new Date(process.env.START_DATE);
            endDate = new Date(process.env.END_DATE);

            const startMonth = startDate.getMonth() + 1;
            const startDay = startDate.getDate();
            const startYear = startDate.getFullYear();
            const endMonth = endDate.getMonth() + 1;
            const endDay = endDate.getDate();
            const endYear = endDate.getFullYear();

            console.log(`📅 Using custom date range: ${startMonth}/${startDay}/${startYear} to ${endMonth}/${endDay}/${endYear}`);
            console.log(`   (Custom range from START_DATE and END_DATE environment variables)`);
        } else {
            // Default: last N months (CONFIG.MONTHS_TO_SCRAPE) including current
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth() + 1;

            const monthsBack = Math.max(1, CONFIG.MONTHS_TO_SCRAPE - 1);
            startDate = new Date(currentYear, currentMonth - 1 - monthsBack, 1);

            endDate = new Date(currentYear, currentMonth, 0); // Last day of current month

            const startMonth = startDate.getMonth() + 1;
            const startDay = startDate.getDate();
            const startYear = startDate.getFullYear();
            const endMonth = endDate.getMonth() + 1;
            const endDay = endDate.getDate();
            const endYear = endDate.getFullYear();

            console.log(`📅 Using date range: ${startMonth}/${startDay}/${startYear} to ${endMonth}/${endDay}/${endYear}`);
            console.log(`   (Last ${CONFIG.MONTHS_TO_SCRAPE} months including current)`);
        }

        // Build and navigate to URL with base64-encoded filters
        const rankingsURL = buildRankingsURL(division, divisionCodes, startDate, endDate);
        console.log(`🌐 Navigating to: ${rankingsURL}`);
        
        await page.goto(rankingsURL, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for page to fully populate (3-5 seconds for dynamic content)
        console.log(`⏳ Waiting for page to fully load and populate...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Filters are already applied via URL, no need to click Apply button

        // Extract athletes from results
        let allAthletes = [];
        let hasMorePages = true;
        let currentPage = 1;

        while (hasMorePages) {
            const pageAthletes = await page.evaluate(() => {
                // Dynamic Column Mapping
                const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                    .map(th => th.textContent.trim().toLowerCase());

                // Map required fields to column indices
                // Prefer an explicit "lifter age" column; avoid "age category" contamination
                const lifterAgeIdx = (() => {
                    const lifterAge = headers.findIndex(h => h.includes('lifter') && h.includes('age'));
                    if (lifterAge !== -1) return lifterAge;

                    const compAge = headers.findIndex(h => h.includes('comp') && h.includes('age') && !h.includes('category'));
                    if (compAge !== -1) return compAge;

                    const ageOnly = headers.findIndex(h => h.includes('age') && !h.includes('category'));
                    return ageOnly; // may be -1 if no usable age column exists
                })();

                const colMap = {
                    nationalRank: headers.findIndex(h => h.includes('rank')),
                    athleteName: headers.findIndex(h => h.includes('athlete') || h.includes('lifter') && !h.includes('age')),
                    total: headers.findIndex(h => h.includes('total')),
                    gender: headers.findIndex(h => h.includes('gender')),
                    lifterAge: lifterAgeIdx,
                    club: headers.findIndex(h => h.includes('club') || h.includes('team')),
                    membershipId: headers.findIndex(h => h.includes('member') || h.includes('id')),
                    liftDate: headers.findIndex(h => h.includes('date')),
                    wso: headers.findIndex(h => h.includes('wso') || h.includes('lws') || h.includes('state'))
                };

                // Fallback to hardcoded indices if headers aren't found (backward compatibility)
                if (colMap.athleteName === -1) colMap.athleteName = 3;
                if (colMap.total === -1) colMap.total = 2;
                if (colMap.gender === -1) colMap.gender = 4;
                if (colMap.club === -1) colMap.club = 6;
                if (colMap.membershipId === -1) colMap.membershipId = 7;
                if (colMap.liftDate === -1) colMap.liftDate = 9;
                if (colMap.wso === -1) colMap.wso = 12;
                if (colMap.nationalRank === -1) colMap.nationalRank = 0;

                const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));
                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const cellTexts = cells.map(cell => cell.textContent?.trim() || '');

                    if (cellTexts.length < 5) return null; // Basic validation

                    const rawAge = colMap.lifterAge > -1 ? cellTexts[colMap.lifterAge] : '';
                    const numericAge = rawAge.match(/\d{1,3}/)?.[0] || '';

                    return {
                        nationalRank: colMap.nationalRank > -1 ? cellTexts[colMap.nationalRank] : '',
                        athleteName: colMap.athleteName > -1 ? cellTexts[colMap.athleteName] : '',
                        total: colMap.total > -1 ? cellTexts[colMap.total] : '',
                        gender: colMap.gender > -1 ? cellTexts[colMap.gender] : '',
                        lifterAge: numericAge,
                        club: colMap.club > -1 ? cellTexts[colMap.club] : '',
                        membershipId: colMap.membershipId > -1 ? cellTexts[colMap.membershipId] : '',
                        liftDate: colMap.liftDate > -1 ? cellTexts[colMap.liftDate] : '',
                        wso: colMap.wso > -1 ? cellTexts[colMap.wso] : ''
                    };
                }).filter(a => a && a.membershipId);
            });

            allAthletes = allAthletes.concat(pageAthletes);
            console.log(`   Page ${currentPage}: Found ${pageAthletes.length} athletes (Total: ${allAthletes.length})`);

            // Check for next page
            const nextPageExists = await page.evaluate(() => {
                const nextBtn = document.querySelector('.v-data-footer__icons-after .v-btn:not([disabled])');
                if (nextBtn && !nextBtn.disabled) {
                    nextBtn.click();
                    return true;
                }
                return false;
            });

            if (nextPageExists) {
                await new Promise(resolve => setTimeout(resolve, 1500)); // Reduced wait time
                currentPage++;
            } else {
                hasMorePages = false;
            }
        }

        // Remove duplicates
        const uniqueAthletes = allAthletes.filter((athlete, index, arr) =>
            arr.findIndex(a => a.membershipId === athlete.membershipId) === index
        );

        console.log(`   Total unique athletes: ${uniqueAthletes.length}`);

        return {
            success: true,
            athletes: uniqueAthletes,
            totalFound: uniqueAthletes.length
        };

    } catch (error) {
        console.error(`❌ Error scraping division: ${error.message}`);
        issuesLogger.logIssue(
            globalDivisionNumber,
            division,
            'DIVISION_SCRAPE_ERROR',
            '',
            '',
            {},
            error.message
        );
        return {
            success: false,
            athletes: [],
            totalFound: 0
        };
    }
}

// Upload function for batch - uses YOUR EXISTING athlete-csv-uploader.js
async function uploadBatchToSupabase() {
    const { spawn } = require('child_process');

    console.log('\n📤 Uploading batch to Supabase using existing uploader...');

    // Check for YOUR existing uploader
    const uploaderPath = './scripts/production/athlete-csv-uploader.js';
    if (!fs.existsSync(uploaderPath)) {
        console.log('⚠️  athlete-csv-uploader.js not found - skipping upload');
        console.log('   This should be your existing uploader that updates the lifters table');
        console.log('   Run manually later: node athlete-csv-uploader.js');
        return;
    }

    // Count files before upload
    const athletesDir = './output/athletes';
    let fileCountBefore = 0;
    if (fs.existsSync(athletesDir)) {
        fileCountBefore = fs.readdirSync(athletesDir).filter(f => f.endsWith('.csv')).length;
        console.log(`   Files to upload: ${fileCountBefore}`);
    }

    try {
        // Run YOUR existing uploader which handles the lifters table properly
        await new Promise((resolve, reject) => {
            const child = spawn('node', [uploaderPath], {
                stdio: 'inherit',
                env: { ...process.env }
            });

            child.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Upload completed successfully');
                    resolve();
                } else {
                    // Non-zero exit code is OK - your uploader exits with 1 if there were some errors
                    console.log(`⚠️  Upload completed with warnings (exit code: ${code})`);
                    resolve(); // Still resolve, don't reject
                }
            });

            child.on('error', (error) => {
                console.log(`❌ Failed to start uploader: ${error.message}`);
                reject(error);
            });
        });

        // Count remaining files after upload
        let fileCountAfter = 0;
        if (fs.existsSync(athletesDir)) {
            fileCountAfter = fs.readdirSync(athletesDir).filter(f => f.endsWith('.csv')).length;
            console.log(`   Files remaining: ${fileCountAfter}`);
            console.log(`   Files processed: ${fileCountBefore - fileCountAfter}`);
        }

    } catch (error) {
        console.log(`⚠️  Upload process failed: ${error.message}`);
        console.log('   You can run manually later: node athlete-csv-uploader.js');
    }
}

// Main processing function
async function processBatchDivisions() {
    console.log('🚀 Starting Batch Division Scraper');
    console.log(`📅 Day: ${CONFIG.DAY_NAME}`);
    console.log(`🎯 Division Range: ${CONFIG.DIVISION_START} to ${CONFIG.DIVISION_END}`);
    console.log(`📆 Date Range: Last ${CONFIG.MONTHS_TO_SCRAPE} months (including current)`);
    console.log(`🕐 Start time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);

    const allDivisions = loadDivisions();
    const divisionCodes = loadDivisionCodes();
    const batchDivisions = getDivisionsForBatch(allDivisions);

    if (batchDivisions.length === 0) {
        console.log('❌ No divisions to process in this range');
        return;
    }

    // Setup logging
    const logFile = resolveDataPath(`data/logs/completed_divisions_${CONFIG.DAY_NAME.toLowerCase()}.csv`);

    // Ensure the logs directory exists
    ensureDirectoryExists(path.dirname(logFile));

    if (!fs.existsSync(logFile)) {
        const headers = ['division_number', 'division_name', 'timestamp', 'athletes_found',
            'athletes_processed', 'athletes_skipped', 'status', 'time_seconds'];
        fs.writeFileSync(logFile, headers.join(',') + '\n');
    }

    const issuesLogger = createExtractionIssuesLogger();

    async function launchBrowser() {
        const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

        const browserInstance = await puppeteer.launch({
            headless: 'new', // use modern headless everywhere for stability
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-client-side-phishing-detection',
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',
                '--disable-features=TranslateUI',
                '--disable-hang-monitor',
                '--disable-ipc-flooding-protection',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-renderer-backgrounding',
                '--disable-sync',
                '--force-color-profile=srgb',
                '--metrics-recording-only',
                '--no-default-browser-check',
                '--password-store=basic',
                '--use-mock-keychain',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080'
            ],
            defaultViewport: {
                width: 1920,
                height: 1080
            },
            slowMo: isGitHubActions ? 0 : 25
        });

        console.log('✅ Browser launched successfully');

        const pageInstance = await browserInstance.newPage();
        await pageInstance.setViewport({ width: 1500, height: 1000 });
        pageInstance.setDefaultNavigationTimeout(120000);
        pageInstance.setDefaultTimeout(120000);

        return { browserInstance, pageInstance };
    }

    let { browserInstance: browser, pageInstance: page } = await launchBrowser();

    let totalAthletesProcessed = 0;
    let totalDivisionsProcessed = 0;

    try {
        for (let i = 0; i < batchDivisions.length; i++) {
            const division = batchDivisions[i];
            const globalDivisionNumber = CONFIG.DIVISION_START + i;
            const startTime = Date.now();

            console.log(`\n${'='.repeat(60)}`);
            console.log(`Processing ${i + 1}/${batchDivisions.length} (Global #${globalDivisionNumber})`);

            let result;
            let attempt = 0;

            while (attempt < 2) {
                try {
                    result = await scrapeDivisionAthletes(
                        page,
                        division,
                        i,
                        globalDivisionNumber,
                        issuesLogger,
                        divisionCodes
                    );
                    break; // success
                } catch (err) {
                    const msg = err && err.message ? err.message : String(err);
                    if (msg.includes('ECONNRESET') || msg.includes('WebSocket') || msg.includes('Target closed')) {
                        console.log('⚠️ Browser/page crashed (ECONNRESET/WS). Relaunching and retrying once...');
                        attempt++;
                        try { await browser.close(); } catch (_) {}
                        const relaunched = await launchBrowser();
                        browser = relaunched.browserInstance;
                        page = relaunched.pageInstance;
                        continue;
                    }
                    throw err;
                }
            }

            let athletesProcessed = 0;
            let athletesSkipped = 0;

            if (result.success && result.athletes.length > 0) {
                // Process each athlete
                for (const athlete of result.athletes) {
                    if (!athlete.membershipId) continue;

                    if (isAthleteAlreadyProcessed(athlete.membershipId)) {
                        athletesSkipped++;
                        continue;
                    }

                    try {
                        const profileData = {
                            success: true,
                            profileData: {
                                athleteName: athlete.athleteName,
                                nationalRank: athlete.nationalRank,
                                membershipId: athlete.membershipId,
                                club: athlete.club,
                                wso: athlete.wso,
                                lifterAge: athlete.lifterAge,
                                liftDate: athlete.liftDate,
                                gender: athlete.gender,
                                total: athlete.total,
                                internalId: '',
                                competitionHistory: []
                            }
                        };

                        createAthleteCSV(athlete.membershipId, profileData, division);
                        athletesProcessed++;
                        totalAthletesProcessed++;

                    } catch (error) {
                        console.error(`   ❌ Error processing ${athlete.athleteName}: ${error.message}`);
                        issuesLogger.logIssue(
                            globalDivisionNumber,
                            division,
                            'ATHLETE_PROCESS_ERROR',
                            athlete.athleteName,
                            athlete.membershipId,
                            athlete,
                            error.message
                        );
                    }
                }
            }

            // Log division completion
            const timeSeconds = Math.round((Date.now() - startTime) / 1000);
            const logRow = [
                globalDivisionNumber,
                escapeCSV(division),
                new Date().toISOString(),
                result.totalFound,
                athletesProcessed,
                athletesSkipped,
                result.success ? 'SUCCESS' : 'FAILED',
                timeSeconds
            ];
            fs.appendFileSync(logFile, logRow.join(',') + '\n');

            console.log(`   ✅ Division complete: ${athletesProcessed} processed, ${athletesSkipped} skipped`);
            console.log(`   ⏱️ Time: ${timeSeconds} seconds`);
            totalDivisionsProcessed++;

            // Upload batch every 10 divisions or at the end
            if ((i + 1) % 10 === 0 || i === batchDivisions.length - 1) {
                await uploadBatchToSupabase();
            }

            // Delay between divisions
            if (i < batchDivisions.length - 1) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_DIVISIONS));
            }
        }

    } catch (error) {
        console.error('💥 Fatal error:', error);
        throw error;
    } finally {
        await browser.close();
    }

    // Final upload
    await uploadBatchToSupabase();

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Batch Processing Complete!');
    console.log(`📊 Summary for ${CONFIG.DAY_NAME}:`);
    console.log(`   Divisions processed: ${totalDivisionsProcessed}/${batchDivisions.length}`);
    console.log(`   Athletes processed: ${totalAthletesProcessed}`);
    console.log(`   Athletes CSV files created: ${totalAthletesProcessed}`);

    // Check how many files remain
    const athletesDir = './output/athletes';
    if (fs.existsSync(athletesDir)) {
        const remainingFiles = fs.readdirSync(athletesDir).filter(f => f.endsWith('.csv'));
        console.log(`   Files pending upload: ${remainingFiles.length}`);
    }

    console.log(`🕐 End time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);

    return {
        divisionsProcessed: totalDivisionsProcessed,
        athletesProcessed: totalAthletesProcessed
    };
}

// Run the scraper
if (require.main === module) {
    processBatchDivisions()
        .then((results) => {
            console.log('✅ Batch completed successfully');
            console.log(`📈 Final stats: ${results.divisionsProcessed} divisions, ${results.athletesProcessed} athletes`);
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Batch failed:', error);
            process.exit(1);
        });
}

module.exports = { processBatchDivisions };