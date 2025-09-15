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
            .from('meets')
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
        console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(meetings.length/batchSize)} (${batch.length} records)`);
        
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
        .select('lifter_id, athlete_name, birth_year, gender') // Add birth_year, gender
        .eq('athlete_name', cleanName)
        .maybeSingle();
    
    if (findError) {
        throw new Error(`Error finding lifter: ${findError.message}`);
    }
    
    if (existing) {
        return existing;
    }
    
    // Create new lifter (gender and birth_year now go in meet_results, not lifters)
    const { data: newLifter, error: createError } = await supabase
        .from('lifters')
        .insert({
            athlete_name: cleanName,
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
    // Extract lifter data for calculations (don't insert these into DB)
    const { lifter_birth_year, lifter_gender, ...dbResultData } = resultData;
    
    // Calculate competition age
    const competition_age = resultData.date && lifter_birth_year ? 
        new Date(resultData.date).getFullYear() - lifter_birth_year : null;
    
    // Calculate age-appropriate Q-scores
    const qScores = calculateAgeAppropriateQScore(
        resultData.total, 
        resultData.body_weight_kg, 
        lifter_gender, 
        competition_age
    );
    
    // Include all calculated values in meet_results
    const enhancedResultData = {
        ...dbResultData,
        competition_age,
        qpoints: qScores.qpoints,
        q_youth: qScores.q_youth,
        q_masters: qScores.q_masters,
        gender: lifter_gender || null,
        birth_year: lifter_birth_year || null
    };
    
    const { data, error } = await supabase
        .from('meet_results')
        .insert(enhancedResultData)  // Insert without the temporary lifter fields
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

				// Create meet result with lifter data for calculations
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
					total: row.Total?.toString().trim() || null,
					// Add lifter data for calculations
					lifter_birth_year: lifter.birth_year,
					lifter_gender: lifter.gender
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

function calculateAgeAppropriateQScore(total, bodyWeight, gender, age) {
    // Initialize all scores as null
    const qScores = {
        qpoints: null,
        q_youth: null,
        q_masters: null
    };
    
    // Validate input data
    if (!total || !bodyWeight || !gender || total <= 0 || bodyWeight <= 0 || !age) {
        return qScores;
    }
    
    const totalNum = parseFloat(total);
    const bwNum = parseFloat(bodyWeight);
    const B = bwNum / 100;
    
    // Age-based scoring according to Huebner's brackets:
    // Ages ≤9: No Q-scoring
    if (age <= 9) {
        return qScores;
    }
    
    // Ages 10-20: Q-youth only
    if (age >= 10 && age <= 20) {
        qScores.q_youth = calculateQScore(totalNum, B, gender);
        return qScores;
    }
    
    // Ages 21-30: Q-points only
    if (age >= 21 && age <= 30) {
        qScores.qpoints = calculateQScore(totalNum, B, gender);
        return qScores;
    }
    
    // Ages 31+: Q-masters only
    if (age >= 31) {
        qScores.q_masters = calculateQScore(totalNum, B, gender);
        return qScores;
    }
    
    return qScores;
}

function calculateQScore(totalNum, B, gender) {
    if (gender === 'M') {
        const denominator = 416.7 - 47.87 * Math.pow(B, -2) + 18.93 * Math.pow(B, 2);
        return Math.round((totalNum * 463.26 / denominator) * 1000) / 1000;
    } else if (gender === 'F') {
        const denominator = 266.5 - 19.44 * Math.pow(B, -2) + 18.61 * Math.pow(B, 2);
        return Math.round((totalNum * 306.54 / denominator) * 1000) / 1000;
    }
    
    return null;
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
        console.log('SUPABASE_SECRET_KEY defined:', !!process.env.SUPABASE_SECRET_KEY);
        console.log('SUPABASE_SECRET_KEY length:', process.env.SUPABASE_SECRET_KEY?.length || 0);
      
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
            throw new Error('Missing Supabase environment variables (SUPABASE_URL, SUPABASE_SECRET_KEY)');
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
        const existingMeetData = await getExistingMeetIds();
        
        // Determine which CSV file to import
        const currentYear = new Date().getFullYear();
        const csvFilePath = `./meets_${currentYear}.csv`;
        
        // Check if CSV file exists before attempting to read
        console.log(`🔍 Looking for CSV file: ${csvFilePath}`);
        if (!require('fs').existsSync(csvFilePath)) {
            console.log(`❌ CSV file not found: ${csvFilePath}`);
            console.log('💡 This usually means the meet scraper failed to run or complete successfully.');
            console.log('💡 Check the scraper logs or run the scraper manually first.');
            console.log('📋 Available CSV files in current directory:');
            
            const fs = require('fs');
            const csvFiles = fs.readdirSync('.').filter(file => file.endsWith('.csv') && file.startsWith('meets_'));
            if (csvFiles.length > 0) {
                csvFiles.forEach(file => console.log(`   - ${file}`));
                console.log(`💡 You might want to run the scraper first: node meet_scraper_2025.js`);
            } else {
                console.log('   - No meets_*.csv files found');
            }
            
            process.exit(1);
        }
        
        console.log(`✅ CSV file found: ${csvFilePath}`);
        
        // Read CSV data
        const meetings = await readCSVFile(csvFilePath);
        
        if (meetings.length === 0) {
            console.log('⚠️ No data found in CSV file - file exists but is empty');
            console.log('💡 This usually means the meet scraper ran but found no new meets');
            console.log('💡 or encountered an error during data extraction.');
            return;
        }
        
        console.log(`📊 Found ${meetings.length} records in CSV file`);
        
        // Add meet_internal_id to meetings and filter duplicates
        console.log('\n🔍 Processing meet internal IDs and checking for duplicates...');
        let newMeetings = [];
        let duplicatesByMeetId = 0;
        let duplicatesByInternalId = 0;
        
        for (const meeting of meetings) {
            const meetInternalId = extractMeetInternalId(meeting.URL);
            
            // Skip if already exists by meet_id
            if (existingMeetData.meetIds.has(meeting.meet_id)) {
                duplicatesByMeetId++;
                continue;
            }
            
            // Skip if already exists by meet_internal_id
            if (meetInternalId && existingMeetData.internalIds.has(meetInternalId)) {
                duplicatesByInternalId++;
                continue;
            }
            
            newMeetings.push(meeting);
        }
        
        console.log(`📊 Duplicate detection results:`);
        console.log(`   - Duplicates by meet_id: ${duplicatesByMeetId}`);
        console.log(`   - Duplicates by meet_internal_id: ${duplicatesByInternalId}`);
        console.log(`   - New meets to import: ${newMeetings.length}`);
        
        if (newMeetings.length === 0) {
            console.log('✅ No new meets to import');
            return;
        }
        
        // Import meets to database
        console.log('\n📥 Step 1: Importing meet metadata...');
        const importResult = await upsertMeetsToDatabase(newMeetings);
        
        // All processed meetings are new since we filtered duplicates
        const newMeetIds = importResult.newMeetIds;
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
        console.error('📍 Stack trace:', error.stack);
        
        // Provide helpful troubleshooting information
        console.log('\n🔧 Troubleshooting steps:');
        console.log('1. Check if the meet scraper ran successfully: node meet_scraper_2025.js');
        console.log('2. Verify Supabase environment variables are set');
        console.log('3. Check network connectivity to Supabase');
        console.log('4. Review the error message and stack trace above');
        
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