/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const Papa = require('papaparse');
const path = require('path');

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

// Lifter management with proper foreign key resolution
async function findOrCreateLifter(lifterName, additionalData = {}) {
    const cleanName = lifterName?.toString().trim();
    if (!cleanName) {
        throw new Error('Lifter name is required');
    }

    console.log(`  🔍 Looking for lifter: "${cleanName}"`);

    // First try to find existing lifter by name
    const { data: existing, error: findError } = await supabase
        .from('usaw_lifters')
        .select('lifter_id, athlete_name')
        .eq('athlete_name', cleanName)
        .maybeSingle();

    if (findError) {
        throw new Error(`Error finding lifter: ${findError.message}`);
    }

    if (existing) {
        console.log(`  ✅ Found existing lifter: ${cleanName} (ID: ${existing.lifter_id})`);
        
        // Run base64 URL lookup protocol for existing lifter
        console.log(`  🔍 Running base64 URL lookup protocol for existing lifter...`);
        // TODO: Implement base64 URL lookup protocol here
        
        return existing;
    }

    // Create new lifter (gender and birth_year now go in meet_results, not lifters)
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

                // Find or create lifter with foreign key resolution
                const lifter = await findOrCreateLifter(lifterName);

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
                    total: row.Total?.toString().trim() || null,
                };

                // Insert the result with proper lifter_id
                const { data, error } = await supabase
                    .from('usaw_meet_results')
                    .insert(resultData)
                    .select()
                    .single();

                if (error) {
                    // Check if it's a duplicate constraint violation
                    if (error.code === '23505') {
                        console.log(`  ⚠️ Duplicate result skipped for lifter: ${lifterName}`);
                    } else {
                        console.error(`  ❌ Error inserting result for ${lifterName}:`, error.message);
                        errorCount++;
                    }
                } else {
                    processedCount++;
                }

                // Progress indicator
                if ((index + 1) % 10 === 0) {
                    console.log(`    📈 Processed ${index + 1}/${validResults.length} lifters`);
                }

            } catch (error) {
                console.error(`💥 Error processing lifter ${index + 1}:`, error.message);
                errorCount++;
            }
        }

        console.log(`  ✅ Completed: ${processedCount} results, ${errorCount} errors`);
        return { processed: processedCount, errors: errorCount };

    } catch (error) {
        console.error(`💥 Error processing file ${fileName}:`, error.message);
        return { processed: 0, errors: 1 };
    }
}

module.exports = {
    getExistingMeetIds,
    upsertMeetsToDatabase,
    processMeetCsvFile,
    extractMeetInternalId,
    readCSVFile,
    findOrCreateLifter
};
