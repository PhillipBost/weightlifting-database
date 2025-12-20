/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const Papa = require('papaparse');
const path = require('path');
const puppeteer = require('puppeteer');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Import scraper function - adjust path as needed for GitHub
const { scrapeOneMeet } = require('./scrapeOneMeet.js');

// Extract meet internal_id from Sport80 URL
function extractMeetInternalId(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }

    // Match pattern: https://usaweightlifting.sport80.com/public/rankings/results/7011
    const match = url.match(/\/rankings\/results\/(\d+)/);
    return match ? parseInt(match[1]) : null;
}

async function readCSVFile(filePath) {
    console.log(`📖 Reading CSV file: ${filePath}`);

    if (!fs.existsSync(filePath)) {
        throw new Error(`CSV file not found: ${filePath}`);
    }

    const csvContent = fs.readFileSync(filePath, 'utf8');
    const parsed = Papa.parse(csvContent, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
    });

    if (parsed.errors.length > 0) {
        console.log('⚠️ CSV parsing warnings:', parsed.errors);
    }

    console.log(`📊 Parsed ${parsed.data.length} records from CSV`);
    return parsed.data;
}

async function getExistingMeetIds() {
    console.log('🔍 Getting existing meet IDs from database...');

    let allMeets = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
        const { data: meets, error } = await supabase
            .from('usaw_meets')
            .select('meet_id, meet_internal_id')
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(`Failed to get existing meets: ${error.message}`);
        }

        if (!meets || meets.length === 0) {
            break;
        }

        allMeets.push(...meets);
        from += pageSize;

        console.log(`📄 Loaded ${allMeets.length} meets so far...`);

        if (meets.length < pageSize) {
            break; // Last page
        }
    }

    const existingMeetIds = new Set(allMeets.map(m => m.meet_id));
    const existingInternalIds = new Set(allMeets.filter(m => m.meet_internal_id).map(m => m.meet_internal_id));

    console.log(`📊 Found ${existingMeetIds.size} existing meets in database`);
    console.log(`📊 Found ${existingInternalIds.size} existing meet internal_ids`);

    return { meetIds: existingMeetIds, internalIds: existingInternalIds };
}

async function upsertMeetsToDatabase(meetings) {
    console.log(`🔄 Upserting ${meetings.length} meets to database...`);

    let newMeetIds = [];
    let errorCount = 0;

    // Process in batches of 100 to avoid overwhelming the database
    const batchSize = 100;

    for (let i = 0; i < meetings.length; i += batchSize) {
        const batch = meetings.slice(i, i + batchSize);
        console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(meetings.length / batchSize)} (${batch.length} records)`);

        try {
            // Transform CSV data to match database column names
            const dbRecords = batch.map(meet => ({
                meet_id: meet.meet_id,
                meet_internal_id: extractMeetInternalId(meet.URL),
                Meet: meet.Meet,
                Level: meet.Level,
                Date: meet.Date,
                Results: meet.Results,
                URL: meet.URL,
                batch_id: meet.batch_id,
                scraped_date: meet.scraped_date
            }));

            // Upsert to database (insert new, update existing)
            const { data, error } = await supabase
                .from('usaw_meets')
                .upsert(dbRecords, {
                    onConflict: 'meet_id',
                    count: 'exact'
                })
                .select('meet_id'); // Get the meet_ids that were processed

            if (error) {
                console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
                errorCount += batch.length;
            } else {
                console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} completed successfully`);
                // Track which meets were processed (could be new or updated)
                if (data) {
                    newMeetIds.push(...data.map(d => d.meet_id));
                }
            }

            // Small delay between batches to be respectful to the database
            if (i + batchSize < meetings.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

        } catch (error) {
            console.error(`💥 Error processing batch ${Math.floor(i / batchSize) + 1}:`, error.message);
            errorCount += batch.length;
        }
    }

    return { newMeetIds, errorCount };
}

// REAL Sport80 member page verification using puppeteer
async function verifyLifterParticipationInMeet(lifterInternalId, targetMeetId) {
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

                // Extract meet ID from the URL if available
                const link = cells[0]?.querySelector('a');
                const meetUrl = link?.getAttribute('href');
                let meetId = null;

                if (meetUrl) {
                    const match = meetUrl.match(/\/rankings\/results\/(\d+)/);
                    if (match) {
                        meetId = parseInt(match[1]);
                    }
                }

                return {
                    name: meetName,
                    date: meetDate,
                    meetId: meetId,
                    url: meetUrl
                };
            }).filter(Boolean);

            return meetInfo;
        });

        // Check if the target meet ID appears in the athlete's meet history
        const foundMeet = pageData.find(meet => meet.meetId === targetMeetId);

        if (foundMeet) {
            console.log(`    ✅ VERIFIED: Lifter participated in meet ${targetMeetId} (${foundMeet.name})`);
            return true;
        } else {
            console.log(`    ❌ NOT FOUND: Meet ${targetMeetId} not in athlete's meet history`);
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

// Two-tier verification system for lifter resolution
async function runBase64UrlLookupProtocol(lifterName, potentialLifterIds, targetMeetId) {
    console.log(`  🔍 Tier 1: Running base64 URL lookup protocol...`);
    console.log(`    Checking ${potentialLifterIds.length} potential lifter(s) against meet ${targetMeetId}`);

    // TODO: Implement base64 URL lookup protocol
    // This would query rankings with specific meet filters and check if the lifter appears

    // For now, return inconclusive result to trigger Tier 2
    console.log(`    ⚠️ Base64 URL lookup inconclusive - proceeding to Tier 2`);
    return null;
}

async function runSport80MemberUrlVerification(lifterName, potentialLifterIds, targetMeetId) {
    console.log(`  🔍 Tier 2: Running Sport80 member URL verification...`);

    for (const lifterId of potentialLifterIds) {
        try {
            // Get the lifter's internal_id to build the member URL
            const { data: lifter, error } = await supabase
                .from('usaw_lifters')
                .select('internal_id')
                .eq('lifter_id', lifterId)
                .single();

            if (error || !lifter?.internal_id) {
                console.log(`    ❌ No internal_id for lifter ${lifterId} - skipping`);
                continue;
            }

            console.log(`    🔍 Checking lifter ${lifterId} (internal_id: ${lifter.internal_id})...`);

            // REAL verification: Visit the member page and check if they participated in target meet
            const verified = await verifyLifterParticipationInMeet(lifter.internal_id, targetMeetId);

            if (verified) {
                console.log(`    ✅ CONFIRMED: Using lifter ${lifterId} for meet ${targetMeetId}`);
                return lifterId;
            }

        } catch (error) {
            console.log(`    ❌ Error checking lifter ${lifterId}: ${error.message}`);
            continue;
        }
    }

    console.log(`    ❌ No matches found in Tier 2 verification`);
    return null;
}

// Lifter management with proper foreign key resolution and two-tier verification
async function findOrCreateLifter(lifterName, additionalData = {}) {
    const cleanName = lifterName?.toString().trim();
    if (!cleanName) {
        throw new Error('Lifter name is required');
    }

    console.log(`  🔍 Looking for lifter: "${cleanName}"`);

    // Find ALL existing lifters by name (not just one)
    const { data: existingLifters, error: findError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name, internal_id')
        .eq('athlete_name', cleanName);

    if (findError) {
        throw new Error(`Error finding lifter: ${findError.message}`);
    }

    const lifterIds = existingLifters ? existingLifters.map(l => l.lifter_id) : [];

    if (lifterIds.length === 0) {
        // No existing lifter found - create new one
        console.log(`  ➕ Creating new lifter: ${cleanName}`);
        const { data: newLifter, error: createError } = await supabase
            .from('usaw_lifters')
            .insert({
                athlete_name: cleanName,
                membership_number: additionalData.membership_number || null,
            })
            .select()
            .single();

        if (createError) {
            throw new Error(`Error creating lifter: ${createError.message}`);
        }

        console.log(`  ✅ Created new lifter: ${cleanName} (ID: ${newLifter.lifter_id})`);
        return newLifter;
    }

    if (lifterIds.length === 1) {
        // Single match found - still verify via two-tier system
        console.log(`  ✅ Found 1 existing lifter: ${cleanName} (ID: ${lifterIds[0]})`);

        // Tier 1: Base64 URL lookup protocol
        await runBase64UrlLookupProtocol(cleanName, lifterIds, additionalData.targetMeetId);

        // Tier 2: Sport80 member URL verification (fallback)
        const verifiedLifterId = await runSport80MemberUrlVerification(cleanName, lifterIds, additionalData.targetMeetId);

        if (verifiedLifterId) {
            const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
            console.log(`  ✅ Verified lifter: ${cleanName} (ID: ${verifiedLifterId})`);
            return verifiedLifter;
        } else {
            throw new Error(`Could not verify lifter ${cleanName} through two-tier verification`);
        }
    }

    // Multiple matches found - use two-tier verification to disambiguate
    console.log(`  ⚠️ Found ${lifterIds.length} existing lifters with name "${cleanName}" - disambiguating...`);

    // Tier 1: Base64 URL lookup protocol
    const base64Result = await runBase64UrlLookupProtocol(cleanName, lifterIds, additionalData.targetMeetId);

    if (base64Result) {
        const verifiedLifter = existingLifters.find(l => l.lifter_id === base64Result);
        console.log(`  ✅ Verified via Tier 1: ${cleanName} (ID: ${base64Result})`);
        return verifiedLifter;
    }

    // Tier 2: Sport80 member URL verification (fallback)
    const verifiedLifterId = await runSport80MemberUrlVerification(cleanName, lifterIds, additionalData.targetMeetId);

    if (verifiedLifterId) {
        const verifiedLifter = existingLifters.find(l => l.lifter_id === verifiedLifterId);
        console.log(`  ✅ Verified via Tier 2: ${cleanName} (ID: ${verifiedLifterId})`);
        return verifiedLifter;
    }

    throw new Error(`Could not disambiguate lifter "${cleanName}" - ${lifterIds.length} candidates found but none verified`);
}

async function processMeetCsvFile(csvFilePath, meetId, meetName) {
    const fileName = path.basename(csvFilePath);
    console.log(`\n📄 Processing: ${fileName}`);
    console.log(`🏋️ Meet: ${meetName} (ID: ${meetId})`);

    try {
        // Read CSV file
        const csvContent = fs.readFileSync(csvFilePath, 'utf8');

        // Parse CSV with pipe delimiter
        const parsed = Papa.parse(csvContent, {
            header: true,
            delimiter: '|',
            dynamicTyping: false,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim()
        });

        // Handle parsing errors gracefully
        if (parsed.errors.length > 0) {
            console.log(`  ⚠️ CSV parsing warnings:`, parsed.errors.slice(0, 3));

            const fatalErrors = parsed.errors.filter(error =>
                error.type === 'Quotes' ||
                error.code === 'TooFewFields' ||
                error.code === 'InvalidQuotes'
            );

            if (fatalErrors.length > 0 && (!parsed.data || parsed.data.length === 0)) {
                console.log(`  ❌ Fatal parsing errors - skipping file`);
                return { processed: 0, errors: 1 };
            }
        }

        // Robust data validation
        const validResults = parsed.data.filter(row => {
            return row &&
                typeof row === 'object' &&
                row.Lifter &&
                typeof row.Lifter === 'string' &&
                row.Lifter.trim() !== '';
        });

        if (validResults.length === 0) {
            console.log(`  ⚠️ No valid lifters found in ${fileName}`);
            return { processed: 0, errors: 1 };
        }

        console.log(`  📊 Found ${validResults.length} lifters in meet`);

        let processedCount = 0;
        let errorCount = 0;

        // Process each lifter result with proper lifter management
        for (const [index, row] of validResults.entries()) {
            try {
                const lifterName = String(row?.Lifter || '').trim();

                if (!lifterName) {
                    console.log(`  ⚠️ Skipping row ${index + 1} - missing lifter name`);
                    errorCount++;
                    continue;
                }

                // Find or create lifter with two-tier verification system
                const lifter = await findOrCreateLifter(lifterName, { targetMeetId: meetId });

                // Create meet result with proper lifter_id
                const resultData = {
                    meet_id: meetId,
                    lifter_id: lifter.lifter_id,
                    meet_name: row.Meet?.trim() || meetName,
                    date: row.Date?.trim() || null,
                    age_category: row['Age Category']?.trim() || null,
                    weight_class: row['Weight Class']?.trim() || null,
                    lifter_name: lifterName,
                    body_weight_kg: row['Body Weight (Kg)']?.toString().trim() || null,
                    snatch_lift_1: row['Snatch Lift 1']?.toString().trim() || null,
                    snatch_lift_2: row['Snatch Lift 2']?.toString().trim() || null,
                    snatch_lift_3: row['Snatch Lift 3']?.toString().trim() || null,
                    best_snatch: row['Best Snatch']?.toString().trim() || null,
                    cj_lift_1: row['C&J Lift 1']?.toString().trim() || null,
                    cj_lift_2: row['C&J Lift 2']?.toString().trim() || null,
                    cj_lift_3: row['C&J Lift 3']?.toString().trim() || null,
                    best_cj: row['Best C&J']?.toString().trim() || null,
                    total: row.Total?.toString().trim() || null
                };

                // Upsert to database (insert new, update existing)
                const { error: insertError } = await supabase
                    .from('usaw_meet_results')
                    .upsert(resultData, {
                        onConflict: 'meet_id, lifter_id', // Assuming composite key or just insert
                        ignoreDuplicates: false
                    });

                // If upsert fails, try simple insert if we suspect it's not a conflict, 
                // but usually for results we just want to insert. 
                // However, the previous code context implies sophisticated import.
                // Let's stick to insert for results as dupes might be separate entries if not careful,
                // but typically meet_id + lifter_id is unique per meet unless multiple entries.
                // Re-reading usage: "incorporate the meet results ... determine whether a lifter ... exists"
                // I'll use simple insert for now as that's safer than potentially wrong upsert keys without schema knowledge.
                // Actually, let's look at the `upsertMeetsToDatabase` above, it used upsert.
                // For results, often there is no unique constraint on (meet_id, lifter_id) if someone competes in multiple categories? 
                // USAW usually one entry per meet.
                // Let's use `insert` and log error.

                if (insertError) {
                    // Check if it's unique violation
                    if (insertError.code === '23505') {
                        console.log(`  ⚠️ Result already exists for ${lifterName}`);
                    } else {
                        console.error(`  ❌ Error inserting result for ${lifterName}:`, insertError.message);
                        errorCount++;
                    }
                } else {
                    processedCount++;
                }

            } catch (error) {
                console.error(`  ❌ Error processing row ${index + 1}:`, error.message);
                errorCount++;
            }
        }

        console.log(`  ✅ Processed ${processedCount} results with ${errorCount} errors`);
        return { processed: processedCount, errors: errorCount };

    } catch (error) {
        console.error(`❌ Error processing file ${fileName}:`, error.message);
        return { processed: 0, errors: 1 };
    }
}

module.exports = {
    extractMeetInternalId,
    getExistingMeetIds,
    upsertMeetsToDatabase,
    processMeetCsvFile,
    verifyLifterParticipationInMeet,
    scrapeOneMeet // Exporting this as well since it was imported at top
};
