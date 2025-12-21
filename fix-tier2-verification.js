// Fix for Tier 2 verification - match by meet name and date instead of meet ID

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function getTargetMeetInfo(targetMeetId) {
    // Get meet details from database
    const { data: meetData, error } = await supabase
        .from('usaw_meets')
        .select('meet_id, meet_internal_id, Meet, Date')
        .eq('meet_id', targetMeetId)
        .single();
    
    if (error) {
        throw new Error(`Failed to get meet info: ${error.message}`);
    }
    
    return meetData;
}

// Enhanced verification function that matches by name and date
async function verifyLifterParticipationInMeetEnhanced(lifterInternalId, targetMeetId) {
    const puppeteer = require('puppeteer');
    
    // Get target meet information
    const targetMeet = await getTargetMeetInfo(targetMeetId);
    console.log(`    🎯 Target: "${targetMeet.Meet}" on ${targetMeet.Date}`);
    
    const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${lifterInternalId}`;
    console.log(`    🌐 Visiting: ${memberUrl}`);

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

        await page.goto(memberUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        const pageData = await page.evaluate(() => {
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

        // Enhanced matching: check by name AND date
        const foundMeet = pageData.find(meet => {
            const nameMatch = meet.name === targetMeet.Meet;
            const dateMatch = meet.date === targetMeet.Date;
            return nameMatch && dateMatch;
        });

        if (foundMeet) {
            console.log(`    ✅ VERIFIED: Found "${foundMeet.name}" on ${foundMeet.date}`);
            return true;
        } else {
            console.log(`    ❌ NOT FOUND: "${targetMeet.Meet}" on ${targetMeet.Date} not in athlete's history`);
            console.log(`    📋 Available meets:`);
            pageData.slice(0, 5).forEach(meet => {
                console.log(`       "${meet.name}" (${meet.date})`);
            });
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

// Test the enhanced verification
async function testEnhancedVerification() {
    console.log('🔍 Testing enhanced Tier 2 verification for Kailee Bingman...');
    
    try {
        const lifterInternalId = 38184; // Kailee's internal_id
        const targetMeetId = 2357; // Meet ID
        
        const result = await verifyLifterParticipationInMeetEnhanced(lifterInternalId, targetMeetId);
        
        console.log('\\n🔍 ENHANCED VERIFICATION RESULT:');
        if (result) {
            console.log('✅ VERIFICATION PASSED - Meet found by name and date match');
            console.log('🎯 FIX CONFIRMED: Enhanced matching works correctly');
        } else {
            console.log('❌ VERIFICATION FAILED - Meet not found even with enhanced matching');
        }
        
    } catch (error) {
        console.error('💥 Enhanced test failed:', error.message);
    }
}

testEnhancedVerification();