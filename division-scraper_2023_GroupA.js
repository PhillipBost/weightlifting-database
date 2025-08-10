const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// =================================================================
// DIVISION-BASED SCRAPER WITH INTEGRATED ATHLETE SCRAPING
// =================================================================
const CONFIG = {
    OVERWRITE_EXISTING_FILES: true,
    DELAY_BETWEEN_ATHLETES: 2000,
    DELAY_BETWEEN_DIVISIONS: 5000,
    MAX_DIVISIONS_FOR_TESTING: Infinity, // Process ALL divisions
    TARGET_YEAR: 2023,
    HEADLESS: "new"
};

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

function createExtractionIssuesLogger() {
    const issuesFilePath = './athlete_extraction_details.csv';
    
    // Create issues file with headers if it doesn't exist
    if (!fs.existsSync(issuesFilePath)) {
        const headers = ['division_number', 'division_name', 'issue_type', 'athlete_name', 'membership_id', 'row_data', 'description'];
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
                escapeCSV(description)
            ];
            fs.appendFileSync(issuesFilePath, row.join(',') + '\n');
        }
    };
}

function loadDivisions() {
    const divisionsFile = './all divisions_GroupA_2023.csv';
    if (!fs.existsSync(divisionsFile)) {
        throw new Error('Division file not found: ./all divisions.csv');
    }
    
    const content = fs.readFileSync(divisionsFile, 'utf8');
    const lines = content.split('\n').map(line => line.trim()).filter(line => line);
    
    // Better header detection - check if first line is just "Division" or similar header text
    const firstLine = lines[0];
    const isHeader = firstLine && (
        firstLine.toLowerCase() === 'division' ||
        firstLine.toLowerCase() === 'divisions' ||
        firstLine.toLowerCase() === 'age group' ||
        firstLine.toLowerCase() === 'weight class' ||
        (firstLine.toLowerCase().includes('age') && firstLine.toLowerCase().includes('group') && !firstLine.includes('kg'))
    );
    
    const divisions = isHeader ? lines.slice(1) : lines;
    
    console.log(`📋 Loaded ${divisions.length} divisions from ./all divisions.csv`);
    console.log(`📄 ${isHeader ? 'Header detected and skipped' : 'No header detected'}`);
    console.log(`🏁 First division: ${divisions[0]}`);
    console.log(`🏁 Second division: ${divisions[1] || 'N/A'}`);
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
    return fs.existsSync(athleteFile) && !CONFIG.OVERWRITE_EXISTING_FILES; // Fixed: was OVERWRITE_EXISTING_FILES
}

// NEW: Updated upload script function with separate window
async function runUploadScript() {
    const { spawn } = require('child_process');
    const os = require('os');
    
    console.log('\n📤 Starting CSV upload to Supabase in separate window...');
    console.log(`📅 ${new Date().toISOString()}`);
    
    try {
        if (os.platform() === 'win32') {
            // Windows - Create a batch file that closes after completion
            const batchContent = `@echo off
echo ================================================
echo ATHLETE CSV UPLOADER - BACKGROUND PROCESS
echo ================================================
echo Starting upload at %date% %time%
echo.

node athlete-csv-uploader.js

echo.
echo ================================================
echo Upload completed at %date% %time%
echo Window will close in 3 seconds...
echo ================================================
timeout /t 3 /nobreak >nul
exit`;
            
            const batchFile = path.join(process.cwd(), 'run_upload_2023.bat');
            fs.writeFileSync(batchFile, batchContent);
            
            const child = spawn('cmd', ['/c', 'start', 'cmd', '/c', 'run_upload.bat'], {
                detached: true,
                stdio: 'ignore',
                cwd: process.cwd(),
                env: { ...process.env }
            });
            
            child.unref();
            
            console.log(`✅ Upload batch file created and started: ${batchFile}`);
            console.log(`🖥️ Cmd window opened for upload process (will auto-close)`);
            
        } else {
            // Non-Windows - Use terminal approach with auto-close
            let command, args;
            
            if (os.platform() === 'darwin') {
                // macOS - Terminal closes automatically after script completion
                command = 'osascript';
                args = ['-e', `tell application "Terminal" to do script "cd \\"${process.cwd()}\\" && echo 'ATHLETE CSV UPLOADER - BACKGROUND PROCESS' && node athlete-csv-uploader.js && sleep 2 && exit"`];
            } else {
                // Linux - Terminal closes automatically
                command = 'gnome-terminal';
                args = ['--', 'bash', '-c', `cd "${process.cwd()}" && echo "ATHLETE CSV UPLOADER - BACKGROUND PROCESS" && node athlete-csv-uploader.js && echo "Upload completed. Closing in 2 seconds..." && sleep 2`];
            }
            
            const child = spawn(command, args, {
                detached: true,
                stdio: 'ignore',
                cwd: process.cwd(),
                env: { ...process.env }
            });
            
            child.unref();
            console.log(`✅ Upload process started in separate terminal (will auto-close)`);
        }
        
        console.log(`📋 Upload running independently - division scraping will continue`);
        console.log(`💡 Monitor the separate window for upload progress`);
        
        // Return immediately without waiting
        return 0;
        
    } catch (error) {
        console.log(`❌ Failed to start upload in separate window: ${error.message}`);
        console.log(`⚠️ Continuing without upload - run athlete-csv-uploader.js manually later`);
        return 1;
    }
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
    
    // Write data rows
    if (profile.competitionHistory && profile.competitionHistory.length > 0) {
        // If we have detailed competition history, write each competition
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
    } else {
        // NEW: If we only have basic athlete data (no competition history), 
        // write a single row with the available info
        
        // Parse division info from sourceDivision
        const { ageCategory, weightClass } = splitAgeCategoryAndWeightClass(sourceDivision);
        
        // Calculate birth year if possible
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
        
        const row = [
            escapeCSV(profile.membershipId),
            escapeCSV(profile.athleteName),
            escapeCSV(profile.gender),
            escapeCSV(profile.club),
            escapeCSV(profile.wso),
            escapeCSV(profile.nationalRank),
            escapeCSV(profile.internalId),
            escapeCSV(profile.lifterAge),
            '', // competition_age - not available
            escapeCSV(profile.liftDate),
            escapeCSV(birthYear),
            '', // Meet - not available from division page
            '', // Date - not available from division page  
            escapeCSV(ageCategory),
            escapeCSV(weightClass),
            escapeCSV(profile.athleteName),
            '', // Body Weight - not available from division page
            '', // Snatch Lift 1 - not available from division page
            '', // Snatch Lift 2 - not available from division page
            '', // Snatch Lift 3 - not available from division page
            '', // C&J Lift 1 - not available from division page
            '', // C&J Lift 2 - not available from division page
            '', // C&J Lift 3 - not available from division page
            '', // Best Snatch - not available from division page
            '', // Best C&J - not available from division page
            escapeCSV(profile.total),
            '', // qpoints - can't calculate without body weight
            '', // qmasters placeholder
            '', // sinclair placeholder
            '', // sinclairmeltzerfaber placeholder
            '', // sinclairhuebnermetzerfaber placeholder
            escapeCSV(batchId),
            escapeCSV(timestamp)
        ];
        
        csvContent += row.join(',') + '\n';
    }
    
    fs.writeFileSync(athleteFile, csvContent);
    
    return {
        filePath: athleteFile,
        competitionCount: profile.competitionHistory ? profile.competitionHistory.length : 0
    };
}

// INTEGRATED ATHLETE SCRAPING FUNCTION (from scrapeAthleteProfile2020.js)
async function scrapeAthleteProfileIntegrated(page, athleteName, ageCategory, weightClass, competitionDate, divisionIndex = 0, issuesLogger = null, divisionNumber = 0, divisionName = '') {
    console.log(`Looking up athlete: ${athleteName}`);
    console.log(`Category: ${ageCategory}, Weight: ${weightClass}, Date: ${competitionDate}`);
    
    // Calendar navigation functions (from working scraper)
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
            
            // Verify we're at the correct month/year after rapid navigation
            const finalMonthYear = await getCurrentMonthYear();
            if (finalMonthYear) {
                const finalMonth = monthMap[finalMonthYear.monthName];
                const finalYear = finalMonthYear.year;
                console.log(`📅 Final position: ${finalMonthYear.raw}`);
                
                if (finalMonth !== targetMonth || finalYear !== targetYear) {
                    console.log(`⚠️ Rapid navigation ended at wrong position. Expected: ${targetMonth}/${targetYear}, Got: ${finalMonth}/${finalYear}`);
                }
            }

		}

		// Now click on the target day
        console.log(`📅 Selecting day ${targetDay}`);
        await page.waitForTimeout(200); // Increased wait time for calendar to fully render

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
            await page.waitForTimeout(25);
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

    async function handleDateField(page, fieldSelector, targetYear, fieldType) {
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
			await page.waitForTimeout(200);

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
				// Try pressing Escape to close any open interface
				await page.keyboard.press('Escape');
				await page.waitForTimeout(500);
				return;
			}

			// If we have a complex date picker, handle it
			if (activeInterface.includes('date-picker') || activeInterface.includes('v-menu')) {
				// Set Sept 1, 2018 for start field
				if (fieldType === 'start') {
					await handleComplexDatePicker(page, 2023, activeInterface, 1, 1); // Jan 1
				} else if (fieldType === 'end') {
					// Set last day of Dec for end field
					const lastDayDec = 31; // December always has 31 days
					await handleComplexDatePicker(page, 2023, activeInterface, 12, lastDayDec); // December 31
				} else {
					await handleComplexDatePicker(page, targetYear, activeInterface); // Default for other
				}

				// Close this individual calendar
				console.log(`🔚 Waiting for ${fieldType} date calendar to close...`);
				await page.waitForTimeout(100);

			} else {
				console.log(`⚠️ Unknown ${fieldType} date interface, attempting generic navigation...`);
				// Handle generic case if needed
			}

			console.log(`✅ ${fieldType} date field handling completed`);

		} catch (error) {
			console.error(`❌ Failed to handle ${fieldType} date field:`, error.message);

			// Always try to close any open calendar
			await page.keyboard.press('Escape');
			await page.waitForTimeout(500);
		}
	}

    try {
		// Check if this is the first division (you'll need to pass a parameter for this)
		if (divisionIndex === 0) {
			console.log('Navigating to rankings page...');
			await page.goto('https://usaweightlifting.sport80.com/public/rankings/all', {
				waitUntil: 'networkidle0'
			});
		} else {
			// For subsequent divisions, click the Show Filters button
			console.log('Clicking Show Filters button to reset division selection...');
			
			// Try multiple selectors for the filter button
			const filterButtonSelectors = [
				'button[aria-label="Show Filters"]',
				'.s80-btn.icon',
				'button.s80-btn[aria-label="Show Filters"]',
				'.mdi-filter-variant'
			];
			
			let filterButtonClicked = false;
			for (const selector of filterButtonSelectors) {
				try {
					const button = await page.$(selector);
					if (button) {
						await button.click();
						filterButtonClicked = true;
						console.log(`✅ Clicked filter button using selector: ${selector}`);
						break;
					}
				} catch (err) {
					// Try next selector
				}
			}
			
			if (!filterButtonClicked) {
				console.log('⚠️ Filter button not found, falling back to page refresh...');
				await page.goto('https://usaweightlifting.sport80.com/public/rankings/all', {
					waitUntil: 'networkidle0'
				});
			}
			
			await page.waitForTimeout(2000);
		}
		
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
		console.log(`📅 Setting START date range to 2012...`);
		await handleDateField(page, '#form__date_range_start', 2012, 'start');
		await page.waitForTimeout(100);

		console.log(`📅 Setting END date range to 2017...`);
		await handleDateField(page, '#form__date_range_end', 2017, 'end');
		await page.waitForTimeout(100);

		console.log(`Date range set to: 01-01-2012 - 12-31-2017`);
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
		await page.waitForTimeout(30000);

		console.log('Filters applied');
        
        // Extract all athletes from the division results page (no searching/clicking individual athletes)
        console.log('📊 Extracting all athletes from division results...');
        
        // Get pagination info to see how many pages we need to process
        const paginationInfo = await page.evaluate(() => {
			const paginationText = document.querySelector('.v-data-footer__pagination, .pagination, [class*="pagination"]');
			
			// Look for the specific H2 element with accurate record count
			const recordsHeader = document.querySelector('h2.flex-shrink-0.align-self-end.subtitle-1');
			const totalRecords = recordsHeader ? recordsHeader.textContent.match(/(\d+)\s+Records/)?.[1] : 'Unknown';
			
			return {
				paginationText: paginationText ? paginationText.textContent : 'No pagination found',
				totalRecords: totalRecords || 'Unknown'
			};
		});
        
        console.log(`📈 Division stats: ${paginationInfo.totalRecords} total records`);
        console.log(`📄 Pagination: ${paginationInfo.paginationText}`);
        
        // Collect all athletes from all pages in this division
        let allDivisionAthletes = [];
        let currentPage = 1;
        let hasMorePages = true;
        
        while (hasMorePages) {
            console.log(`📄 Extracting athletes from page ${currentPage}...`);
            
            const pageAthletes = await page.evaluate((divisionNum, divisionName) => {
    const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr:not(.v-data-footer__row)'));
    const athletes = [];
    const issues = [];
    
    rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('td, .cell'));
        const cellTexts = cells.map(cell => cell.textContent?.trim() || '');
        
        // Skip completely empty rows
        if (cellTexts.every(cell => !cell)) {
            issues.push({
                issueType: 'EMPTY_ROW',
                rowData: cellTexts,
                description: `Row ${rowIndex}: Completely empty row`
            });
            return;
        }
        
        // Check if row has enough columns
        if (cellTexts.length < 8) {
            issues.push({
                issueType: 'INSUFFICIENT_COLUMNS',
                athleteName: cellTexts[3] || cellTexts[1] || cellTexts[0],
                rowData: cellTexts,
                description: `Row ${rowIndex}: Only ${cellTexts.length} columns, need at least 8`
            });
            return;
        }
        
        // Check if membership ID exists
        if (!cellTexts[7]) {
            issues.push({
                issueType: 'NO_MEMBERSHIP_ID',
                athleteName: cellTexts[3] || '',
                membershipId: '',
                rowData: cellTexts,
                description: `Row ${rowIndex}: No membership ID in column 7`
            });
            return;
        }
        
        // Valid athlete row
        console.log('TABLE ROW DATA:', cellTexts.slice(0, 12));
        athletes.push({
            nationalRank: cellTexts[0],
            athleteName: cellTexts[3], 
            total: cellTexts[2],
            gender: cellTexts[4],
            lifterAge: cellTexts[5],
            club: cellTexts[6],
            membershipId: cellTexts[7],
            liftDate: cellTexts[9],
            wso: cellTexts[12]
        });
    });
    
    return { athletes, issues };
}, divisionNumber, divisionName);

// Log issues to CSV file
if (issuesLogger && pageAthletes.issues) {
    pageAthletes.issues.forEach(issue => {
        issuesLogger.logIssue(
            divisionNumber,
            divisionName,
            issue.issueType,
            issue.athleteName || '',
            issue.membershipId || '',
            issue.rowData,
            issue.description
        );
    });
}

// Use the athletes from the result
const actualAthletes = Array.isArray(pageAthletes.athletes) ? pageAthletes.athletes : [];
            
            console.log(`👥 Found ${actualAthletes.length} athletes on page ${currentPage} (Total so far: ${allDivisionAthletes.length + actualAthletes.length}/${paginationInfo.totalRecords})`);
			allDivisionAthletes = allDivisionAthletes.concat(actualAthletes);
            
            // Improved next page detection - try multiple selectors
            const nextPageExists = await page.evaluate(() => {
                // Try multiple selectors for next page button
                const selectors = [
                    '.v-data-footer__icons-after .v-btn:not([disabled])',
                    '.v-pagination__next:not([disabled])', 
                    'button[aria-label="Next page"]:not([disabled])',
                    '.pagination .next:not(.disabled)'
                ];
                
                for (const selector of selectors) {
                    const button = document.querySelector(selector);
                    if (button && !button.disabled && !button.classList.contains('v-btn--disabled') && !button.classList.contains('disabled')) {
                        console.log(`Found next button with selector: ${selector}`);
                        button.click();
                        return true;
                    }
                }
                
                console.log('No next page button found');
                return false;
            });
            
            if (nextPageExists) {
                console.log(`✅ Clicked next page, waiting for page ${currentPage + 1} to load...`);
                
                // Wait longer for pagination to complete
                try {
                    await page.waitForNetworkIdle({timeout: 10000}); // Increased timeout
                } catch (timeoutError) {
                    console.log(`⚠️ Network timeout, using fixed delay instead`);
                    await page.waitForTimeout(8000); // Longer fixed delay
                }
                
                currentPage++;
            } else {
                console.log(`🏁 No more pages found after page ${currentPage}`);
                hasMorePages = false;
            }
        }
        
        console.log(`🎯 Total athletes found in division: ${allDivisionAthletes.length} (Expected: ${paginationInfo.totalRecords})`);
        
        // Warn if we didn't get expected number
        if (paginationInfo.totalRecords !== 'Unknown') {
            const expected = parseInt(paginationInfo.totalRecords);
            if (!isNaN(expected) && allDivisionAthletes.length !== expected) {
                console.log(`⚠️ WARNING: Found ${allDivisionAthletes.length} but expected ${expected} athletes`);
            }
        }
        
        // Remove duplicates based on membership ID
        const uniqueAthletes = allDivisionAthletes.filter((athlete, index, arr) => 
            arr.findIndex(a => a.membershipId === athlete.membershipId) === index
        );
        
		// Log duplicates that were removed
		if (issuesLogger && allDivisionAthletes.length > uniqueAthletes.length) {
			const duplicateCount = allDivisionAthletes.length - uniqueAthletes.length;
			const seenIds = new Set();
			const duplicates = [];
			
			allDivisionAthletes.forEach(athlete => {
				if (seenIds.has(athlete.membershipId)) {
					duplicates.push(athlete);
				} else {
					seenIds.add(athlete.membershipId);
				}
			});
			
			duplicates.forEach(duplicate => {
				issuesLogger.logIssue(
					divisionNumber,
					divisionName,
					'DUPLICATE_MEMBERSHIP_ID',
					duplicate.athleteName,
					duplicate.membershipId,
					duplicate,
					`Duplicate athlete with membership ID ${duplicate.membershipId}`
				);
			});
		}
		
        console.log(`✨ Unique athletes after deduplication: ${uniqueAthletes.length}`);
        
        // For each athlete, create a simple profile data structure and CSV
        return {
			success: true,
			athletes: uniqueAthletes,
			totalFound: uniqueAthletes.length,
			expectedTotal: paginationInfo.totalRecords  // ← Add this line
		};
        
    } catch (error) {
        console.error('Error scraping division athletes:', error);
        throw error;
    }
}

// Main function with integrated scraping
async function processAllDivisions() {
    console.log('🚀 Starting Division-Based Systematic Athlete Scraper...');
    console.log('📋 Using integrated scraping approach');
    
    const divisions = loadDivisions();
    
    // Create completed divisions log
    const completedDivisionsLog = './completed_divisionsA.csv';
    const logHeaders = [
        'division_number',
        'division_name',
        'timestamp',
		'expected_athletes',
        'athletes_scraped',
        'athletes_successful',
        'athletes_failed', 
        'upload_status',
        'total_time_seconds'
    ];
    
    // Create log file with headers if it doesn't exist
    if (!fs.existsSync(completedDivisionsLog)) {
        fs.writeFileSync(completedDivisionsLog, logHeaders.join(',') + '\n');
        console.log(`📊 Created division completion log: ${completedDivisionsLog}`);
    }
    
    function logCompletedDivision(divisionNumber, divisionName, expectedAthletes, athletesScraped, athletesSuccessful, athletesFailed, uploadStatus, startTime) {
		const timestamp = new Date().toISOString();
		const totalTimeSeconds = Math.round((Date.now() - startTime) / 1000);
		
		const logRow = [
			divisionNumber,
			escapeCSV(divisionName),
			timestamp,
			expectedAthletes,  // ← Add this line
			athletesScraped,
			athletesSuccessful,
			athletesFailed,
			uploadStatus,
			totalTimeSeconds
		];
		
		fs.appendFileSync(completedDivisionsLog, logRow.join(',') + '\n');
	}
    
    // Launch browser once for entire run
    const browser = await puppeteer.launch({headless: CONFIG.HEADLESS, slowMo: 50});
    const page = await browser.newPage();
    await page.setViewport({width: 1500, height: 1000});
	const issuesLogger = createExtractionIssuesLogger();
    
    let totalSuccessCount = 0;
    let totalErrorCount = 0;
    let totalDivisionsProcessed = 0;
    
    try {
        // Process each division
        for (let i = 0; i < divisions.length; i++) {
            const division = divisions[i];
            const divisionStartTime = Date.now();
            console.log(`\n🏋️ Processing division ${i + 1}/${divisions.length}: ${division}`);
            
            const { ageCategory, weightClass } = splitAgeCategoryAndWeightClass(division);
            console.log(`   Age Category: ${ageCategory}`);
            console.log(`   Weight Class: ${weightClass}`);
            
            let divisionSuccessCount = 0;
            let divisionErrorCount = 0;
            let divisionErrors = []; // Track specific errors for this division
            let totalAthletesSeen = 0;
            
            // Now we have all athletes from the division - process them directly
            const divisionResult = await scrapeAthleteProfileIntegrated(
				page,
				'', // No individual athlete name needed
				ageCategory,
				weightClass,
				`${CONFIG.TARGET_YEAR}-01-01`,
				i, // Pass the division index (i)
				issuesLogger, // ADD THIS
				i + 1, // division number
				division // division name
			);
            
            if (divisionResult.success && divisionResult.athletes) {
                console.log(`📊 Processing ${divisionResult.athletes.length} athletes from division results...`);
                totalAthletesSeen = divisionResult.athletes.length;
                // Process each athlete found in the division
                for (let j = 0; j < divisionResult.athletes.length; j++) {
                    const athlete = divisionResult.athletes[j];
                    
                    if (!athlete.membershipId) {
                        console.log(`⏭️ Skipping athlete ${j + 1} - no membership ID`);
                        divisionErrorCount++;
                        divisionErrors.push(`No membership ID: ${athlete.athleteName || 'Unknown'}`);
                        continue;
                    }
                    
                    console.log(`👤 Processing athlete ${j + 1}/${divisionResult.athletes.length}: ${athlete.athleteName} (${athlete.membershipId})`);
                    
                    if (isAthleteAlreadyProcessed(athlete.membershipId)) {
                        console.log(`⏭️ Skipping ${athlete.athleteName} - already processed`);
                        divisionSuccessCount++;
                        continue;
                    }
                    
                    try {
                        // Create a simple profile data structure for CSV creation
                        console.log('DEBUG - Athlete data:', {
							name: athlete.athleteName,
							membership: athlete.membershipId,
							club: athlete.club
						});
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
                                internalId: '', // Not available from division page
                                competitionHistory: [] // We only have basic info from division page
                            }
                        };
                        
                        // Create athlete CSV file with basic info
                        const athleteFileResult = createAthleteCSV(athlete.membershipId, profileData, division);
                        
                        console.log(`✅ Created: ${athleteFileResult.filePath}`);
                        console.log(`   - Name: ${athlete.athleteName}`);
                        console.log(`   - Club: ${athlete.club}`);
                        console.log(`   - WSO: ${athlete.wso}`);
                        console.log(`   - Division: ${division}`); // Added for debugging
                        
                        divisionSuccessCount++;
                        totalSuccessCount++;
                        
                    } catch (error) {
                        console.log(`💥 Error processing ${athlete.athleteName}: ${error.message}`);
                        divisionErrorCount++;
                        totalErrorCount++;
                        divisionErrors.push(`${athlete.athleteName}: ${error.message}`);
                    }
                    
                    // Small delay between athletes
                    if (j < divisionResult.athletes.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
            } else {
                console.log(`❌ Failed to get athletes from division: ${division}`);
                divisionErrorCount++;
                totalErrorCount++;
                divisionErrors.push(`Failed to scrape division: ${division}`);
            }
            
            console.log(`✅ Division ${division} completed:`);
            console.log(`   - Successful athletes: ${divisionSuccessCount}`);
            console.log(`   - Failed athletes: ${divisionErrorCount}`);
            
            // Show concise error summary if there were errors
            if (divisionErrors.length > 0) {
                console.log(`   ⚠️ Errors (${divisionErrors.length}):`);
                // Show first 3 errors, then summary if more
                const errorsToShow = divisionErrors.slice(0, 3);
                errorsToShow.forEach(error => console.log(`     • ${error}`));
                
                if (divisionErrors.length > 3) {
                    console.log(`     • ...and ${divisionErrors.length - 3} more errors`);
                }
            }
            
            // NEW: Upload with separate window approach
            if (divisionSuccessCount > 0) {
                try {
                    console.log(`\n📤 Uploading ${divisionSuccessCount} athlete CSV files from division ${i + 1}/${divisions.length}...`);
                    await runUploadScript();
                    console.log(`✅ Division ${i + 1} upload started in separate window (will auto-close)!`);
                    
                    // Log the completed division
                    logCompletedDivision(
                        i + 1,
                        division,
                        divisionResult.expectedTotal,
                        totalAthletesSeen,
						divisionSuccessCount,
                        divisionErrorCount,
                        'UPLOAD_STARTED',
                        divisionStartTime
                    );
                } catch (uploadError) {
                    console.log(`⚠️ Division ${i + 1} upload failed to start:`, uploadError.message);
                    console.log('💡 Continuing to next division... You can manually upload later with: node athlete-csv-uploader.js');
                    
                    // Log the completed division with upload failure
                    logCompletedDivision(
                        i + 1,
                        division,
						divisionResult.expectedTotal,
                        totalAthletesSeen,
                        divisionSuccessCount,
                        divisionErrorCount,
                        'UPLOAD_FAILED',
                        divisionStartTime
                    );
                }
            } else {
                console.log(`📝 No new athletes in division ${i + 1} - skipping upload`);
                
                // Log the completed division with no upload needed
                logCompletedDivision(
                    i + 1,
                    division,
                    divisionResult.expectedTotal,
					totalAthletesSeen,
					divisionSuccessCount,
                    'NO_UPLOAD_NEEDED',
                    divisionStartTime
                );
            }
            
            totalDivisionsProcessed++;
            
            // Delay between divisions
            if (i < divisions.length - 1) {
                console.log('⏳ Waiting 5 seconds before next division...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
            // Stop after configured number of divisions for testing
            if (CONFIG.MAX_DIVISIONS_FOR_TESTING !== Infinity && i >= CONFIG.MAX_DIVISIONS_FOR_TESTING - 1) {
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
    console.log(`   📤 CSV uploads started in separate windows after each division`);
    
    // Final summary - uploads are running independently
    console.log('\n🚀 Complete pipeline finished successfully!');
    console.log('💡 Uploads are running in separate windows - monitor those for upload progress');
    console.log('📋 Any remaining CSV files can be uploaded manually with: node athlete-csv-uploader.js');
    
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