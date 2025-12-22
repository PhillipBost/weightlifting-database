//may need some refactoring to move thru quickly
const puppeteer = require('puppeteer')
const { createCSVfromArray, writeCSV } = require('../../utils/csv_utils');
const {handleTotalAthleteString, getAmountMeetsOnPage} = require('../../utils/string_utils')
const {getAthletesOnPage} = require('../../utils/scraping_utils')
const fs = require('fs');
const path = require('path');

// Load division codes for Base64 URL lookup
const DIVISION_CODES_PATH = path.join(__dirname, '../../division_base64_codes.json');
let divisionCodes = {};
if (fs.existsSync(DIVISION_CODES_PATH)) {
    const divisionData = JSON.parse(fs.readFileSync(DIVISION_CODES_PATH, 'utf8'));
    divisionCodes = divisionData.division_codes;
    console.log(`✅ Loaded ${Object.keys(divisionCodes).length} division codes for base64 lookup`);
} else {
    console.warn(`⚠️ Division codes file not found at ${DIVISION_CODES_PATH} - Base64 lookup will be disabled`);
}

// Date utility functions
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

// Build rankings URL for base64 lookup
function buildRankingsURL(divisionCode, startDate, endDate) {
    const filters = {
        date_range_start: formatDate(startDate),
        date_range_end: formatDate(endDate),
        weight_class: divisionCode
    };

    const jsonStr = JSON.stringify(filters);
    const base64Encoded = Buffer.from(jsonStr).toString('base64');

    return `https://usaweightlifting.sport80.com/public/rankings/all?filters=${encodeURIComponent(base64Encoded)}`;
}

// Extract internal_id for a specific athlete by clicking their row
async function extractInternalIdByClicking(page, athleteName, rowIndex) {
    try {
        console.log(`    🖱️ Clicking row for: ${athleteName}...`);
        
        // Click the row and wait for navigation
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }),
            page.evaluate((rowIndex) => {
                const rows = document.querySelectorAll('.v-data-table__wrapper tbody tr');
                if (rows[rowIndex]) {
                    rows[rowIndex].click();
                }
            }, rowIndex)
        ]);
        
        // Extract internal_id from destination URL
        const currentUrl = page.url();
        const match = currentUrl.match(/\/member\/(\d+)/);
        
        if (match) {
            const internalId = parseInt(match[1]);
            console.log(`    ✅ Extracted internal_id ${internalId} for ${athleteName}`);
            
            // Navigate back to rankings page
            await page.goBack({ waitUntil: 'networkidle0', timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return internalId;
        } else {
            console.log(`    ❌ No internal_id found in URL: ${currentUrl}`);
            await page.goBack({ waitUntil: 'networkidle0', timeout: 10000 });
            return null;
        }
        
    } catch (error) {
        console.log(`    ❌ Failed to extract internal_id for ${athleteName}: ${error.message}`);
        // Try to recover by going back
        try {
            await page.goBack({ waitUntil: 'networkidle0', timeout: 5000 });
        } catch (e) {
            console.log(`    ⚠️ Cannot navigate back after error`);
        }
        return null;
    }
}

// Scrape division rankings for base64 lookup
async function scrapeDivisionRankings(page, divisionCode, startDate, endDate, targetAthleteName = null) {
    try {
        const url = buildRankingsURL(divisionCode, startDate, endDate);
        console.log(`    🌐 Base64 lookup URL: ${url}`);

        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for table to load
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Extract athletes from the page
        const pageAthletes = await page.evaluate(() => {
            const headers = Array.from(document.querySelectorAll('.v-data-table__wrapper thead th'))
                .map(th => th.textContent.trim().toLowerCase());

            // Dynamic column mapping
            const colMap = {
                nationalRank: headers.findIndex(h => h.includes('rank')),
                athleteName: headers.findIndex(h => h.includes('athlete') || h.includes('lifter') && !h.includes('age')),
                lifterAge: headers.findIndex(h => h.includes('lifter') && h.includes('age') || h.includes('comp') && h.includes('age') && !h.includes('category')),
                club: headers.findIndex(h => h.includes('club') || h.includes('team')),
                liftDate: headers.findIndex(h => h.includes('date')),
                level: headers.findIndex(h => h.includes('level')),
                wso: headers.findIndex(h => h.includes('wso') || h.includes('lws') || h.includes('state')),
                total: headers.findIndex(h => h.includes('total')),
                gender: headers.findIndex(h => h.includes('gender'))
            };

            // Fallbacks
            if (colMap.nationalRank === -1) colMap.nationalRank = 0;
            if (colMap.athleteName === -1) colMap.athleteName = 3;
            if (colMap.club === -1) colMap.club = 6;
            if (colMap.liftDate === -1) colMap.liftDate = 9;
            if (colMap.level === -1) colMap.level = 11;
            if (colMap.wso === -1) colMap.wso = 12;

            const rows = Array.from(document.querySelectorAll('.v-data-table__wrapper tbody tr'));

            return rows.map((row, index) => {
                const cells = Array.from(row.querySelectorAll('td'));
                const cellTexts = cells.map(cell => cell.textContent?.trim() || '');

                if (cellTexts.length < 5) return null;

                const rawAge = colMap.lifterAge > -1 ? cellTexts[colMap.lifterAge] : '';
                const numericAge = rawAge.match(/\d{1,3}/)?.[0] || '';

                // Extract internal_id from the athlete name link (if available)
                let internalId = null;
                if (colMap.athleteName > -1) {
                    const nameCell = cells[colMap.athleteName];
                    const link = nameCell.querySelector('a[href*="/member/"]');
                    if (link) {
                        const href = link.getAttribute('href');
                        const match = href.match(/\/member\/(\d+)/);
                        if (match) {
                            internalId = parseInt(match[1]);
                        }
                    }
                }

                return {
                    nationalRank: colMap.nationalRank > -1 ? cellTexts[colMap.nationalRank] : '',
                    athleteName: colMap.athleteName > -1 ? cellTexts[colMap.athleteName] : '',
                    internalId: internalId,
                    lifterAge: numericAge,
                    club: colMap.club > -1 ? cellTexts[colMap.club] : '',
                    liftDate: colMap.liftDate > -1 ? cellTexts[colMap.liftDate] : '',
                    level: colMap.level > -1 ? cellTexts[colMap.level] : '',
                    wso: colMap.wso > -1 ? cellTexts[colMap.wso] : '',
                    total: colMap.total > -1 ? cellTexts[colMap.total] : '',
                    gender: colMap.gender > -1 ? cellTexts[colMap.gender] : '',
                    rowIndex: index,
                    isClickable: row.classList.contains('row-clickable')
                };
            }).filter(a => a && a.athleteName);
        });

        // Note: We don't extract internal_ids for all athletes here because clicking
        // rows is a "one-way street" - after clicking one row, others become unclickable.
        // Instead, we extract internal_id only for the specific target athlete if provided.
        
        if (targetAthleteName) {
            // Find the target athlete in the results
            const targetAthlete = pageAthletes.find(a => 
                a.athleteName.toLowerCase().includes(targetAthleteName.toLowerCase()) ||
                targetAthleteName.toLowerCase().includes(a.athleteName.toLowerCase())
            );
            
            if (targetAthlete && targetAthlete.isClickable && !targetAthlete.internalId) {
                const extractedId = await extractInternalIdByClicking(page, targetAthlete.athleteName, targetAthlete.rowIndex);
                if (extractedId) {
                    targetAthlete.internalId = extractedId;
                }
            }
        }

        // Clean up temporary properties
        pageAthletes.forEach(athlete => {
            delete athlete.rowIndex;
            delete athlete.isClickable;
        });

        console.log(`    ✅ Base64 lookup found ${pageAthletes.length} athletes`);
        return pageAthletes;

    } catch (error) {
        console.log(`    ❌ Error in base64 lookup: ${error.message}`);
        return [];
    }
}

// Perform base64 lookup fallback for athletes missing internal_ids
async function performBase64LookupFallback(page, filePath) {
    console.log('🔍 Starting base64 lookup fallback for athletes missing internal_ids...');
    
    if (Object.keys(divisionCodes).length === 0) {
        console.log('⚠️ No division codes available - skipping base64 lookup fallback');
        return;
    }

    // Read the current CSV file to find athletes missing internal_ids
    if (!fs.existsSync(filePath)) {
        console.log('⚠️ CSV file not found - skipping base64 lookup fallback');
        return;
    }

    const csvContent = fs.readFileSync(filePath, 'utf8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
        console.log('⚠️ No athlete data found - skipping base64 lookup fallback');
        return;
    }

    const headers = lines[0].split('|');
    const internalIdIndex = headers.findIndex(h => h.trim() === 'Internal_ID');
    const nameIndex = headers.findIndex(h => h.trim() === 'Name' || h.includes('Name'));
    const ageCategoryIndex = headers.findIndex(h => h.trim() === 'Age Category');
    const weightClassIndex = headers.findIndex(h => h.trim() === 'Weight Class');

    if (internalIdIndex === -1 || nameIndex === -1) {
        console.log('⚠️ Required columns not found - skipping base64 lookup fallback');
        return;
    }

    // Find athletes missing internal_ids
    const athletesNeedingLookup = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split('|');
        const internalId = cells[internalIdIndex]?.trim();
        
        if (!internalId || internalId === 'null' || internalId === '') {
            const athleteName = cells[nameIndex]?.trim();
            const ageCategory = ageCategoryIndex > -1 ? cells[ageCategoryIndex]?.trim() : '';
            const weightClass = weightClassIndex > -1 ? cells[weightClassIndex]?.trim() : '';
            
            if (athleteName) {
                athletesNeedingLookup.push({
                    lineIndex: i,
                    name: athleteName,
                    ageCategory: ageCategory,
                    weightClass: weightClass,
                    originalLine: lines[i]
                });
            }
        }
    }

    console.log(`📊 Found ${athletesNeedingLookup.length} athletes missing internal_ids`);

    if (athletesNeedingLookup.length === 0) {
        return;
    }

    // Attempt base64 lookup for missing athletes
    let enrichedCount = 0;
    const updatedLines = [...lines];

    // Create a reasonable date range for lookup (last 2 years)
    const endDate = new Date();
    const startDate = addDays(endDate, -730); // 2 years back

    console.log(`🔍 Attempting base64 lookup for ${athletesNeedingLookup.length} athletes missing internal_ids...`);

    for (const [athleteIndex, athlete] of athletesNeedingLookup.entries()) {
        console.log(`🔍 Base64 lookup ${athleteIndex + 1}/${athletesNeedingLookup.length}: ${athlete.name}`);
        
        // Try to find a matching division code
        let matchingDivisionCode = null;
        const searchKey = `${athlete.ageCategory} ${athlete.weightClass}`.trim();
        
        // Look for exact match first
        if (divisionCodes[searchKey]) {
            matchingDivisionCode = divisionCodes[searchKey];
        } else {
            // Try partial matches
            for (const [divisionName, code] of Object.entries(divisionCodes)) {
                if (divisionName.includes(athlete.ageCategory) && divisionName.includes(athlete.weightClass)) {
                    matchingDivisionCode = code;
                    break;
                }
            }
        }

        if (!matchingDivisionCode) {
            console.log(`    ⚠️ No matching division code found for ${searchKey}`);
            continue;
        }

        try {
            const scrapedAthletes = await scrapeDivisionRankings(page, matchingDivisionCode, startDate, endDate, athlete.name);
            
            // Look for matching athlete by name
            const matchingAthlete = scrapedAthletes.find(scraped => 
                scraped.athleteName.toLowerCase().includes(athlete.name.toLowerCase()) ||
                athlete.name.toLowerCase().includes(scraped.athleteName.toLowerCase())
            );

            if (matchingAthlete && matchingAthlete.internalId) {
                console.log(`    ✅ Found internal_id ${matchingAthlete.internalId} for ${athlete.name}`);
                
                // Update the line with the found internal_id
                const cells = athlete.originalLine.split('|');
                cells[internalIdIndex] = matchingAthlete.internalId.toString();
                updatedLines[athlete.lineIndex] = cells.join('|');
                enrichedCount++;
            } else {
                console.log(`    ❌ No matching athlete found in base64 lookup for ${athlete.name}`);
            }

            // Respectful delay between lookups (increased to be more server-friendly)
            await new Promise(resolve => setTimeout(resolve, 1500));

        } catch (error) {
            console.log(`    ❌ Base64 lookup failed for ${athlete.name}: ${error.message}`);
        }
    }

    // Write updated CSV if any athletes were enriched
    if (enrichedCount > 0) {
        const updatedCsv = updatedLines.join('\n');
        fs.writeFileSync(filePath, updatedCsv);
        console.log(`✅ Successfully enriched ${enrichedCount}/${athletesNeedingLookup.length} athletes with internal_ids via base64 lookup`);
    } else {
        console.log(`ℹ️ No athletes were enriched via base64 lookup (0/${athletesNeedingLookup.length} attempts successful)`);
    }
    
    // Summary of identification coverage
    const totalAthletes = lines.length - 1; // Subtract header
    const athletesWithIds = totalAthletes - athletesNeedingLookup.length + enrichedCount;
    console.log(`📊 Final internal_id coverage: ${athletesWithIds}/${totalAthletes} athletes (${Math.round(athletesWithIds/totalAthletes*100)}%)`);
    console.log(`📊 Athletes requiring name-only matching: ${totalAthletes - athletesWithIds}`);
}

async function scrapeOneMeet(meetNumber, filePath){
    let baseUrl = 'https://usaweightlifting.sport80.com/public/rankings/results/'
    let url = baseUrl + meetNumber;
    
    
    const browser = await puppeteer.launch({
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
    await page.setViewport({width:1500, height:1000})
    await page.goto(url, {
        waitUntil: 'networkidle0'
    })
    
    
    async function getPageData(){    
        return await page.$eval(
             ".data-table div div.v-data-table div.v-data-footer div.v-data-footer__pagination",
             x =>  x.textContent
        )
    }
    
        
    const tableHeaderData = await page.evaluate(()=>{
        let elArr = Array.from(document.querySelectorAll(".data-table div div.v-data-table div.v-data-table__wrapper table thead tr th > span"))
        elArr = elArr.map((x)=>{
            return  x.textContent
        })
        return elArr
    })

	if(tableHeaderData.length > 0){
		// Modify headers to match our split age category/weight class
		if (tableHeaderData.length >= 3) {
			// Replace the combined "Age Category" header with separate headers
			tableHeaderData.splice(2, 1, 'Age Category', 'Weight Class');
		}
		
		// Add Internal_ID column header
		tableHeaderData.push('Internal_ID');
    
		let headerCSV = tableHeaderData.join('|');
		headerCSV += '\n'
		writeCSV(filePath, headerCSV);
    }else{
        await browser.close()
        throw new Error('no meet available')
    }


    ///hunting in here
    await getAthletesOnPage(getAmountMeetsOnPage(await getPageData()), page, filePath);
    // console.log(await getPageData())

    console.log('Initial page data:', await getPageData());
	while(await handleTotalAthleteString(await getPageData())){
        // console.log('getting resourses...')
        await Promise.all([
            page.waitForNetworkIdle(),
            page.click('.data-table div div.v-data-table div.v-data-footer div.v-data-footer__icons-after'),
        ]);
        // console.log(await getPageData())
        await getAthletesOnPage(getAmountMeetsOnPage(await getPageData()), page, filePath)
    }
	console.log('Final page data:', await getPageData());

    // console.log('getting resourses...')
    // console.log(await getPageData())
    // console.log('done scraping')

    // Perform base64 lookup fallback for athletes missing internal_ids
    try {
        await performBase64LookupFallback(page, filePath);
    } catch (error) {
        console.log('⚠️ Base64 lookup fallback failed:', error.message);
    }

    await browser.close();
}


// scrapeOneMeet(444,'./meet_1.csv')
module.exports = {
    scrapeOneMeet:scrapeOneMeet
}