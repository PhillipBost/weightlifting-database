/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Load division codes
const DIVISION_CODES_PATH = path.join(__dirname, 'division_base64_codes.json');
let divisionCodes = {};
if (fs.existsSync(DIVISION_CODES_PATH)) {
    const divisionData = JSON.parse(fs.readFileSync(DIVISION_CODES_PATH, 'utf8'));
    divisionCodes = divisionData.division_codes;
}

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

async function debugEliSmithTier1() {
    console.log('🔍 Debug: Checking if Eli Smith appears in Tier 1 division rankings...\n');

    // Test parameters from the log
    const eventDate = '2017-01-14';
    const ageCategory = 'Open Men\'s';
    const weightClass = '69 kg';
    
    // Map to division name
    const divisionName = `${ageCategory} ${weightClass}`;
    const meetDate = new Date(eventDate);
    const activeDivisionCutoff = new Date('2025-06-01');
    const isActiveDivision = meetDate >= activeDivisionCutoff;

    let divisionCode;
    if (isActiveDivision) {
        divisionCode = divisionCodes[divisionName];
    } else {
        const inactiveName = `(Inactive) ${divisionName}`;
        divisionCode = divisionCodes[inactiveName];
    }

    // Try opposite if not found
    if (!divisionCode) {
        if (isActiveDivision) {
            const inactiveName = `(Inactive) ${divisionName}`;
            divisionCode = divisionCodes[inactiveName];
        } else {
            divisionCode = divisionCodes[divisionName];
        }
    }

    console.log(`📋 Division: ${divisionName} ${isActiveDivision ? '' : '(Inactive)'} (code: ${divisionCode})`);
    
    const startDate = addDays(meetDate, -5);
    const endDate = addDays(meetDate, 5);
    console.log(`📅 Date Range: ${formatDate(startDate)} to ${formatDate(endDate)}`);

    const url = buildRankingsURL(divisionCode, startDate, endDate);
    console.log(`🌐 URL: ${url}\n`);

    let browser;
    try {
        browser = await puppeteer.launch({
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
        await page.setViewport({ width: 1500, height: 1000 });

        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for table to load
        await page.waitForSelector('.v-data-table__wrapper tbody tr', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Extract all athletes and look for Eli Smith
        let allAthletes = [];
        let hasMorePages = true;
        let currentPage = 1;

        while (hasMorePages) {
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

                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const cellTexts = cells.map(cell => cell.textContent?.trim() || '');

                    if (cellTexts.length < 5) return null;

                    const athleteName = colMap.athleteName > -1 ? cellTexts[colMap.athleteName] : '';
                    const liftDate = colMap.liftDate > -1 ? cellTexts[colMap.liftDate] : '';

                    return {
                        athleteName: athleteName,
                        liftDate: liftDate,
                        rank: colMap.nationalRank > -1 ? cellTexts[colMap.nationalRank] : '',
                        club: colMap.club > -1 ? cellTexts[colMap.club] : '',
                        level: colMap.level > -1 ? cellTexts[colMap.level] : '',
                        wso: colMap.wso > -1 ? cellTexts[colMap.wso] : ''
                    };
                }).filter(a => a && a.athleteName);
            });

            allAthletes = allAthletes.concat(pageAthletes);
            console.log(`Page ${currentPage}: Extracted ${pageAthletes.length} athlete(s)`);

            // Look for Eli Smith on this page
            const eliSmithOnPage = pageAthletes.filter(a => 
                a.athleteName.toLowerCase().includes('eli smith') || 
                a.athleteName.toLowerCase().includes('smith')
            );
            
            if (eliSmithOnPage.length > 0) {
                console.log(`🎯 Found potential Eli Smith matches on page ${currentPage}:`);
                eliSmithOnPage.forEach(athlete => {
                    console.log(`  - Name: "${athlete.athleteName}", Date: ${athlete.liftDate}, Rank: ${athlete.rank}, Club: ${athlete.club}`);
                });
            }

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
                await new Promise(resolve => setTimeout(resolve, 1500));
                currentPage++;
            } else {
                hasMorePages = false;
            }
        }

        console.log(`\n📊 Total athletes scraped: ${allAthletes.length}`);
        
        // Look for all Smith athletes
        const smithAthletes = allAthletes.filter(a => 
            a.athleteName.toLowerCase().includes('smith')
        );
        
        console.log(`\n🔍 All athletes with "Smith" in name (${smithAthletes.length}):`);
        smithAthletes.forEach(athlete => {
            console.log(`  - Name: "${athlete.athleteName}", Date: ${athlete.liftDate}, Rank: ${athlete.rank}, Club: ${athlete.club}`);
        });

        // Look specifically for Eli Smith
        const eliSmithMatches = allAthletes.filter(a => 
            a.athleteName.toLowerCase() === 'eli smith'
        );
        
        if (eliSmithMatches.length > 0) {
            console.log(`\n✅ Found exact "Eli Smith" matches (${eliSmithMatches.length}):`);
            eliSmithMatches.forEach(athlete => {
                console.log(`  - Name: "${athlete.athleteName}", Date: ${athlete.liftDate}, Rank: ${athlete.rank}, Club: ${athlete.club}`);
            });
        } else {
            console.log(`\n❌ No exact "Eli Smith" matches found in division rankings`);
            console.log(`   This explains why Tier 1 verification failed.`);
            
            // Check if the date range or division might be wrong
            console.log(`\n🔍 Checking if any athletes have the target date ${eventDate}:`);
            const targetDateAthletes = allAthletes.filter(a => a.liftDate === eventDate);
            if (targetDateAthletes.length > 0) {
                console.log(`   Found ${targetDateAthletes.length} athletes with date ${eventDate}:`);
                targetDateAthletes.slice(0, 5).forEach(athlete => {
                    console.log(`     - ${athlete.athleteName} (${athlete.club})`);
                });
            } else {
                console.log(`   No athletes found with exact date ${eventDate}`);
                console.log(`   This suggests the meet might be in a different division or date range.`);
            }
        }

    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

// Run the debug
debugEliSmithTier1().catch(console.error);