const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const Papa = require('papaparse');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Import scraper function - adjust path as needed for GitHub
const { scrapeOneMeet } = require('./scrapeOneMeet.js');

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
            .from('meets')
            .select('meet_id')
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
    
    const existingIds = new Set(allMeets.map(m => m.meet_id));
    console.log(`📊 Found ${existingIds.size} existing meets in database`);
    return existingIds;
}

async function upsertMeetsToDatabase(meetings) {
    console.log(`🔄 Upserting ${meetings.length} meets to database...`);
    
    let newMeetIds = [];
    let errorCount = 0;
    
    // Process in batches of 100 to avoid overwhelming the database
    const batchSize = 100;
    
    for (let i = 0; i < meetings.length; i += batchSize) {
        const batch = meetings.slice(i, i + batchSize);
        console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(meetings.length/batchSize)} (${batch.length} records)`);
        
        try {
            // Transform CSV data to match database column names
            const dbRecords = batch.map(meet => ({
                meet_id: meet.meet_id,
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
                .from('meets')
                .upsert(dbRecords, { 
                    onConflict: 'meet_id',
                    count: 'exact'
                })
                .select('meet_id'); // Get the meet_ids that were processed
            
            if (error) {
                console.error(`❌ Batch ${Math.floor(i/batchSize) + 1} failed:`, error);
                errorCount += batch.length;
            } else {
                console.log(`✅ Batch ${Math.floor(i/batchSize) + 1} completed successfully`);
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
            console.error(`💥 Error processing batch ${Math.floor(i/batchSize) + 1}:`, error.message);
            errorCount += batch.length;
        }
    }
    
    return { newMeetIds, errorCount };
}

async function scrapeAndImportMeetResults(newMeetIds, meetings) {
    if (newMeetIds.length === 0) {
        console.log('📊 No new meets to process for results');
        return { processed: 0, errors: 0 };
    }
    
    console.log(`🏋️ Processing individual results for ${newMeetIds.length} meets...`);
    
    // Filter meetings to only the new ones
    const newMeetIdsSet = new Set(newMeetIds);
    const meetsToProcess = meetings.filter(m => newMeetIdsSet.has(m.meet_id));
    
    console.log(`📋 Found ${meetsToProcess.length} meets to scrape results for`);
    
    let processedResults = 0;
    let errorCount = 0;
    const tempFiles = [];
    
    try {
        // Step 1: Create temporary CSV files for each new meet
        for (let i = 0; i < meetsToProcess.length; i++) {
            const meet = meetsToProcess[i];
            const tempCsvFile = `./temp_meet_${meet.meet_id}.csv`;
            tempFiles.push(tempCsvFile);
            
            console.log(`\n📋 [${i + 1}/${meetsToProcess.length}] Scraping: ${meet.Meet}`);
            console.log(`📅 Date: ${meet.Date} | Level: ${meet.Level}`);
            console.log(`📁 Temp file: ${tempCsvFile}`);
            
            try {
                // Skip if temp file already exists (from previous run)
                if (fs.existsSync(tempCsvFile)) {
                    console.log(`📄 Temp file already exists, skipping scrape`);
                    continue;
                }
                
                await scrapeOneMeet(meet.meet_id, tempCsvFile);
                
                // Verify file was created and has content
                if (fs.existsSync(tempCsvFile)) {
                    const stats = fs.statSync(tempCsvFile);
                    if (stats.size > 100) {
                        console.log(`✅ Successfully scraped results (${stats.size} bytes)`);
                    } else {
                        console.log(`⚠️ File created but small (${stats.size} bytes) - may be empty`);
                    }
                } else {
                    console.log(`❌ No file created for meet ${meet.meet_id}`);
                    errorCount++;
                }
                
                // Small delay between requests to be respectful
                if (i < meetsToProcess.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (error) {
                console.error(`❌ Failed to scrape meet ${meet.meet_id}:`, error.message);
                errorCount++;
            }
        }
        
        // Step 2: Import results from temporary CSV files to database
        console.log(`\n📥 Importing results from ${tempFiles.length} temporary CSV files...`);
        
        for (const tempFile of tempFiles) {
            if (!fs.existsSync(tempFile)) {
                console.log(`⚠️ Temp file missing: ${tempFile}`);
                continue;
            }
            
            const meetId = parseInt(tempFile.match(/temp_meet_(\d+)\.csv/)[1]);
            const meetInfo = meetsToProcess.find(m => m.meet_id === meetId);
            
            try {
                const result = await processMeetCsvFile(tempFile, meetId, meetInfo.Meet);
                processedResults += result.processed;
                errorCount += result.errors;
                
            } catch (error) {
                console.error(`❌ Failed to import results from ${tempFile}:`, error.message);
                errorCount++;
            }
        }
        
    } finally {
        // Step 3: Clean up temporary files
        console.log(`\n🧹 Cleaning up ${tempFiles.length} temporary files...`);
        for (const tempFile of tempFiles) {
            try {
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                    console.log(`🗑️ Deleted: ${tempFile}`);
                }
            } catch (error) {
                console.log(`⚠️ Could not delete ${tempFile}: ${error.message}`);
            }
        }
    }
    
    return { processed: processedResults, errors: errorCount };
}

// Meet results import functions (adapted from meet_file_importer.js)
async function findOrCreateLifter(lifterName, additionalData = {}) {
    const cleanName = lifterName?.toString().trim();
    if (!cleanName) {
        throw new Error('Lifter name is required');
    }
    
    // First try to find existing lifter by name
    const { data: existing, error: findError } = await supabase
        .from('lifters')
        .select('*')
        .eq('athlete_name', cleanName)
        .maybeSingle();
    
    if (findError) {
        throw new Error(`Error finding lifter: ${findError.message}`);
    }
    
    if (existing) {
        return existing;
    }
    
    // Create new lifter
    const { data: newLifter, error: createError } = await supabase
        .from('lifters')
        .insert({
            athlete_name: cleanName,
            gender: additionalData.gender || null,
            membership_number: additionalData.membership_number || null,
        })
        .select()
        .single();
    
    if (createError) {
        throw new Error(`Error creating lifter: ${createError.message}`);
    }
    
    console.log(`  ➕ Created new lifter: ${cleanName}`);
    return newLifter;
}

async function createMeetResult(resultData) {
    const { data, error } = await supabase
        .from('meet_results')
        .insert(resultData)
        .select()
        .single();
    
    if (error) {
        // Check if it's a duplicate constraint violation
        if (error.code === '23505') {
            console.log(`  ⚠️ Duplicate result skipped for lifter ID ${resultData.lifter_id}`);
            return null;
        }
        throw new Error(`Error creating meet result: ${error.message}`);
    }
    
    return data;
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
        
        // Process each lifter result
        for (const [index, row] of validResults.entries()) {
            try {
                // Find or create lifter
                const lifter = await findOrCreateLifter(row.Lifter);
                
                // Create meet result
                const resultData = {
                    meet_id: meetId,
                    lifter_id: lifter.lifter_id,
                    meet_name: row.Meet?.trim() || null,
                    date: row.Date?.trim() || null,
                    age_category: row['Age Category']?.trim() || null,
                    weight_class: row['Weight Class']?.trim() || null,
                    lifter_name: row.Lifter?.trim() || null,
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
                
                await createMeetResult(resultData);
                processedCount++;
                
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

async function getExistingMeetCount() {
    console.log('📊 Checking existing meet count in database...');
    
    try {
        const { count, error } = await supabase
            .from('meets')
            .select('*', { count: 'exact', head: true });
        
        if (error) {
            console.error('⚠️ Could not get existing count:', error);
            return null;
        }
        
        console.log(`📈 Database currently has ${count} meets`);
        return count;
    } catch (error) {
        console.error('⚠️ Error getting existing count:', error.message);
        return null;
    }
}

async function main() {
    console.log('🗄️ Enhanced Database Import Started');
    console.log('===================================');
    console.log(`🕐 Start time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    
    try {
        // Check Supabase connection
        console.log('🔗 Testing Supabase connection...');
        console.log('🔍 Secret check:');
        console.log('SUPABASE_URL defined:', !!process.env.SUPABASE_URL);
        console.log('SUPABASE_URL length:', process.env.SUPABASE_URL?.length || 0);
        console.log('SUPABASE_ANON_KEY defined:', !!process.env.SUPABASE_ANON_KEY);
        console.log('SUPABASE_ANON_KEY length:', process.env.SUPABASE_ANON_KEY?.length || 0);
      
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
            throw new Error('Missing Supabase environment variables (SUPABASE_URL, SUPABASE_ANON_KEY)');
        }
        
        // Test connection
        const { data: testData, error: testError } = await supabase
            .from('meets')
            .select('meet_id')
            .limit(1);
        
        if (testError) {
            throw new Error(`Supabase connection failed: ${testError.message}`);
        }
        console.log('✅ Supabase connection successful');
        
        // Get existing meets before import
        const beforeCount = await getExistingMeetCount();
        const existingMeetIds = await getExistingMeetIds();
        
        // Determine which CSV file to import
        const currentYear = new Date().getFullYear();
        const csvFilePath = `./meets_${currentYear}.csv`;
        
        // Read CSV data
        const meetings = await readCSVFile(csvFilePath);
        
        if (meetings.length === 0) {
            console.log('⚠️ No data found in CSV file');
            return;
        }
        
        // Import meets to database
        console.log('\n📥 Step 1: Importing meet metadata...');
        const importResult = await upsertMeetsToDatabase(meetings);
        
        // Find truly new meets (not just updated)
        const newMeetIds = importResult.newMeetIds.filter(id => !existingMeetIds.has(id));
        console.log(`📊 New meets detected: ${newMeetIds.length}`);
        
        // Import individual meet results for new meets only
        console.log('\n📥 Step 2: Importing individual meet results...');
        const resultsImport = await scrapeAndImportMeetResults(newMeetIds, meetings);
        
        const afterCount = await getExistingMeetCount();
        
        // Report results
        console.log('\n📊 Enhanced Import Summary:');
        console.log(`📁 CSV records processed: ${meetings.length}`);
        console.log(`💾 Database before: ${beforeCount || 'unknown'} meets`);
        console.log(`💾 Database after: ${afterCount || 'unknown'} meets`);
        console.log(`➕ Net change: ${afterCount && beforeCount ? afterCount - beforeCount : 'unknown'} meets`);
        console.log(`🆕 New meets processed: ${newMeetIds.length}`);
        console.log(`🏋️ Meet results imported: ${resultsImport.processed}`);
        console.log(`❌ Errors: ${importResult.errorCount + resultsImport.errors}`);
        
        if (importResult.errorCount + resultsImport.errors > 0) {
            console.log('⚠️ Some records failed to import. Check the logs above for details.');
        } else {
            console.log('✅ All records processed successfully!');
        }
        
        console.log(`🕐 End time: ${new Date().toLocaleString()}`);
        
    } catch (error) {
        console.error('💥 Enhanced database import failed:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = {
    main,
    readCSVFile,
    upsertMeetsToDatabase
};