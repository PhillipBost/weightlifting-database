/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Copy the actual verifyLifterParticipationInMeet function from database-importer-custom.js
async function verifyLifterParticipationInMeet(lifterInternalId, targetMeetId) {
    // Get target meet information for enhanced matching
    const { data: targetMeet, error: meetError } = await supabase
        .from('usaw_meets')
        .select('meet_id, meet_internal_id, Meet, Date')
        .eq('meet_id', targetMeetId)
        .single();
    
    if (meetError) {
        console.log(`    ❌ Error getting meet info: ${meetError.message}`);
        return false;
    }

    const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${lifterInternalId}`;
    console.log(`    🌐 Visiting: ${memberUrl}`);
    console.log(`    🎯 Looking for: "${targetMeet.Meet}" on ${targetMeet.Date}`);

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

        // Navigate to the member page
        await page.goto(memberUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for the page to load and extract the page content
        const pageData = await page.evaluate(() => {
            // Extract meet information from the page
            const meetRows = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr'));

            const meetInfo = meetRows.map(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 2) return null;

                const meetName = cells[0]?.textContent?.trim();
                const meetDate = cells[1]?.textContent?.trim();

                return {
                    name: meetName,
                    date: meetDate
                };
            }).filter(Boolean);

            return meetInfo;
        });

        console.log(`    📊 Found ${pageData.length} meets in athlete's history:`);
        pageData.forEach((meet, index) => {
            console.log(`      ${index + 1}. "${meet.name}" on ${meet.date}`);
        });

        // Match by meet name and date
        const foundMeet = pageData.find(meet => {
            const nameMatch = meet.name === targetMeet.Meet;
            const dateMatch = meet.date === targetMeet.Date;
            return nameMatch && dateMatch;
        });

        if (foundMeet) {
            console.log(`    ✅ VERIFIED: "${foundMeet.name}" on ${foundMeet.date} found in athlete's history`);
            return true;
        } else {
            console.log(`    ❌ NOT FOUND: "${targetMeet.Meet}" on ${targetMeet.Date} not in athlete's history`);
            return false;
        }

    } catch (error) {
        console.log(`    ❌ Error accessing member page: ${error.message}`);
        return false;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function testRealTier2Verification() {
    console.log('🧪 Testing REAL Tier 2 verification for Kailee Bingman...\n');

    const lifterInternalId = 38184; // Kailee Bingman's internal_id
    const targetMeetId = 2357; // "Show Up and Lift" meet

    console.log('📋 Test Parameters:');
    console.log(`  Lifter Internal ID: ${lifterInternalId}`);
    console.log(`  Target Meet ID: ${targetMeetId}\n`);

    const result = await verifyLifterParticipationInMeet(lifterInternalId, targetMeetId);

    console.log(`\n🎯 Final Result: ${result ? 'VERIFIED ✅' : 'NOT VERIFIED ❌'}`);

    if (result) {
        console.log('🎉 SUCCESS: Kailee Bingman\'s participation in meet 2357 was verified!');
        console.log('   This means the Tier 2 verification should work correctly.');
    } else {
        console.log('❌ FAILURE: Could not verify Kailee Bingman\'s participation in meet 2357.');
        console.log('   This explains why the system creates a new record instead of using the existing one.');
    }
}

// Run the test
testRealTier2Verification().catch(console.error);