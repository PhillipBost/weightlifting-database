const { createClient } = require('@supabase/supabase-js');
const puppeteer = require('puppeteer');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

/**
 * Comprehensive athlete verification approach:
 * 1. Get ALL athletes with internal_ids from database
 * 2. Check ALL their Sport80 member pages for target meet
 * 3. Build a mapping of which athletes participated in the meet
 * 4. Use this mapping to match scraped meet data to existing athletes
 */

async function getAllAthletesWithInternalIds() {
    console.log('📋 Getting all athletes with internal_ids from database...');
    
    let allAthletes = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
        const { data: athletes, error } = await supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .not('internal_id', 'is', null)
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(`Failed to get athletes: ${error.message}`);
        }

        if (!athletes || athletes.length === 0) {
            break;
        }

        allAthletes.push(...athletes);
        from += pageSize;
        
        console.log(`   Loaded ${allAthletes.length} athletes so far...`);
    }

    console.log(`✅ Found ${allAthletes.length} athletes with internal_ids`);
    return allAthletes;
}

async function checkAthleteParticipationInMeet(athlete, targetMeetId, targetMeetInfo, browser) {
    const memberUrl = `https://usaweightlifting.sport80.com/public/rankings/member/${athlete.internal_id}`;
    
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1500, height: 1000 });

        await page.goto(memberUrl, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        const meetHistory = await page.evaluate(() => {
            const meetRows = Array.from(document.querySelectorAll('.data-table div div.v-data-table div.v-data-table__wrapper table tbody tr'));

            return meetRows.map(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 2) return null;

                const meetName = cells[0]?.textContent?.trim();
                const meetDate = cells[1]?.textContent?.trim();

                return {
                    name: meetName,
                    date: meetDate
                };
            }).filter(Boolean);
        });

        // Check if target meet is in this athlete's history
        const foundMeet = meetHistory.find(meet => {
            const nameMatch = meet.name === targetMeetInfo.Meet;
            const dateMatch = meet.date === targetMeetInfo.Date;
            return nameMatch && dateMatch;
        });

        await page.close();

        if (foundMeet) {
            console.log(`   ✅ ${athlete.athlete_name} (ID: ${athlete.lifter_id}) participated in "${targetMeetInfo.Meet}"`);
            return {
                lifter_id: athlete.lifter_id,
                athlete_name: athlete.athlete_name,
                internal_id: athlete.internal_id,
                participated: true
            };
        }

        return null;

    } catch (error) {
        console.log(`   ❌ Error checking ${athlete.athlete_name}: ${error.message}`);
        return null;
    }
}

async function buildMeetParticipationMap(targetMeetId, limitAthletes = 50) {
    console.log(`🔍 Building participation map for meet ${targetMeetId}...`);
    
    // Get target meet info
    const { data: targetMeet, error: meetError } = await supabase
        .from('usaw_meets')
        .select('meet_id, meet_internal_id, Meet, Date')
        .eq('meet_id', targetMeetId)
        .single();
    
    if (meetError) {
        throw new Error(`Failed to get meet info: ${meetError.message}`);
    }

    console.log(`🎯 Target meet: "${targetMeet.Meet}" on ${targetMeet.Date}`);

    // Get all athletes with internal_ids (limited for testing)
    const allAthletes = await getAllAthletesWithInternalIds();
    const athletesToCheck = allAthletes.slice(0, limitAthletes); // Limit for testing
    
    console.log(`🔍 Checking ${athletesToCheck.length} athletes (limited for testing)...`);

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    const participationMap = new Map();
    let checkedCount = 0;

    try {
        for (const athlete of athletesToCheck) {
            checkedCount++;
            console.log(`🔍 Checking ${checkedCount}/${athletesToCheck.length}: ${athlete.athlete_name} (${athlete.internal_id})`);
            
            const result = await checkAthleteParticipationInMeet(athlete, targetMeetId, targetMeet, browser);
            
            if (result) {
                participationMap.set(result.athlete_name.toLowerCase(), result);
            }

            // Respectful delay
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

    } finally {
        await browser.close();
    }

    console.log(`\\n📊 PARTICIPATION MAP RESULTS:`);
    console.log(`   Checked: ${checkedCount} athletes`);
    console.log(`   Found participants: ${participationMap.size}`);
    
    if (participationMap.size > 0) {
        console.log(`   Participants:`);
        for (const [name, info] of participationMap) {
            console.log(`     - ${info.athlete_name} (ID: ${info.lifter_id}, Internal: ${info.internal_id})`);
        }
    }

    return participationMap;
}

// Test with meet 2357
async function testComprehensiveVerification() {
    console.log('🚀 Testing comprehensive athlete verification approach...');
    
    try {
        const participationMap = await buildMeetParticipationMap(2357, 20); // Test with 20 athletes
        
        // Now check if Kailee Bingman is in the map
        const kaileeKey = 'kailee bingman';
        if (participationMap.has(kaileeKey)) {
            const kailee = participationMap.get(kaileeKey);
            console.log(`\\n✅ SUCCESS: Found Kailee Bingman in participation map!`);
            console.log(`   Name: ${kailee.athlete_name}`);
            console.log(`   ID: ${kailee.lifter_id}`);
            console.log(`   Internal_ID: ${kailee.internal_id}`);
        } else {
            console.log(`\\n❌ Kailee Bingman not found in participation map`);
            console.log(`   This could mean:`);
            console.log(`   1. She wasn't in the first 20 athletes checked`);
            console.log(`   2. There's still an issue with the verification`);
        }

    } catch (error) {
        console.error('💥 Comprehensive verification failed:', error.message);
    }
}

testComprehensiveVerification();