// Load environment variables from .env file
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const Papa = require('papaparse');
const path = require('path');

// Initialize Supabase client - SIMPLE VERSION
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// MINIMAL timeout wrapper - only for the most critical operations
function withTimeout(promise, timeoutMs = 30000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

async function readAthleteCSVFile(filePath) {
    console.log(`📖 Reading athlete CSV file: ${path.basename(filePath)}`);
    
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
        console.log(`⚠️ CSV parsing warnings for ${path.basename(filePath)}:`, parsed.errors.slice(0, 3));
    }
    
    // Filter out rows without athlete_name (essential for matching)
    const validRows = parsed.data.filter(row => 
        row && row.athlete_name && row.athlete_name.toString().trim() !== ''
    );
    
    console.log(`📊 Parsed ${validRows.length} valid records from ${path.basename(filePath)}`);
    return validRows;
}

async function getAllAthleteCSVFiles() {
    const athletesDir = 'output/athletes';
    console.log(`🔍 Scanning for athlete CSV files in: ${athletesDir}`);
    
    if (!fs.existsSync(athletesDir)) {
        throw new Error(`Athletes directory not found: ${athletesDir}`);
    }
    
    const files = fs.readdirSync(athletesDir)
        .filter(file => file.startsWith('athlete_') && file.endsWith('.csv'))
        .map(file => path.join(athletesDir, file));
    
    console.log(`📁 Found ${files.length} athlete CSV files`);
    return files;
}

function createErrorLogger() {
    const errorFilePath = './athlete_upload_errors.csv';
    const newLiftersFilePath = './new_lifters_created.csv';
    
    // Create error file with headers if it doesn't exist
    if (!fs.existsSync(errorFilePath)) {
        const headers = ['timestamp', 'athlete_name', 'membership_number', 'error_type', 'error_message'];
        fs.writeFileSync(errorFilePath, headers.join(',') + '\n');
    }
    
    // Create new lifters file with headers if it doesn't exist
    if (!fs.existsSync(newLiftersFilePath)) {
        const headers = ['timestamp', 'athlete_name', 'membership_number', 'scraped_gender', 'scraped_club_name', 'scraped_wso', 'scraped_birth_year', 'scraped_national_rank', 'division', 'note'];
        fs.writeFileSync(newLiftersFilePath, headers.join(',') + '\n');
    }
    
    return {
        logError: (athleteName, membershipNumber, errorType, errorMessage) => {
            const timestamp = new Date().toISOString();
            const row = [
                timestamp,
                `"${athleteName || ''}"`,
                membershipNumber || '',
                errorType,
                `"${errorMessage}"`
            ];
            fs.appendFileSync(errorFilePath, row.join(',') + '\n');
        },
        logNewLifter: (athleteData) => {
            const timestamp = new Date().toISOString();
            const row = [
                timestamp,
                `"${athleteData.athlete_name || ''}"`,
                athleteData.membership_number || '',
                `"${athleteData.gender || ''}"`,
                `"${athleteData.club_name || ''}"`,
                `"${athleteData.wso || ''}"`,
                athleteData.birth_year || '',
                athleteData.national_rank || '',
                `"${athleteData.division || ''}"`,
                '"Created from division scraper - no meet results found"'
            ];
            fs.appendFileSync(newLiftersFilePath, row.join(',') + '\n');
        }
    };
}

async function createNewLifter(athleteData) {
    const lifterData = {
        athlete_name: athleteData.athlete_name.toString().trim(),
        membership_number: athleteData.membership_number ? parseInt(athleteData.membership_number) : null,
        internal_id: null, // Will be populated later by internal_id script
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    const { data: newLifter, error } = await supabase
        .from('lifters')
        .insert(lifterData)
        .select('lifter_id')
        .single();
    
    if (error) {
        throw new Error(`Error creating new lifter: ${error.message}`);
    }
    
    console.log(`  ➕ Created new lifter: ${athleteData.athlete_name} (ID: ${newLifter.lifter_id})`);
    return newLifter.lifter_id;
}

async function findLifterByName(athleteName) {
    const { data: lifters, error } = await supabase
        .from('lifters')
        .select('lifter_id, athlete_name, membership_number')
        .eq('athlete_name', athleteName);
    
    if (error) {
        throw new Error(`Error finding lifter: ${error.message}`);
    }
    
    return lifters;
}

async function batchUpdateLifters(lifterUpdates) {
    if (lifterUpdates.length === 0) return;
    
    console.log(`  🔄 Batch updating ${lifterUpdates.length} lifters...`);
    
    const batchSize = 50;
    for (let i = 0; i < lifterUpdates.length; i += batchSize) {
        const batch = lifterUpdates.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(lifterUpdates.length / batchSize);
        
        console.log(`    📦 Processing update batch ${batchNumber}/${totalBatches} (${batch.length} lifters)...`);
        
        // Update each lifter in the batch
        const updatePromises = batch.map(update => 
            supabase
                .from('lifters')
                .update({
                    membership_number: update.membership_number,
                    updated_at: new Date().toISOString()
                })
                .eq('lifter_id', update.lifter_id)
        );
        
        await Promise.all(updatePromises);
        
        // Small delay between batches
        if (i + batchSize < lifterUpdates.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    console.log(`    ✅ Completed updating ${lifterUpdates.length} lifters`);
}

async function updateRecentMeetResultsWithBiographicalData(lifterId, athleteData, errorLogger) {
    // Update recent meet results with biographical data from division scraper
    
    // Skip if no useful biographical data to update
    if (!athleteData.wso && !athleteData.club_name && !athleteData.gender && !athleteData.birth_year && !athleteData.national_rank) {
        return { updated: 0, errors: 0 };
    }
    
    try {
        // Calculate date range: first day of previous month to today
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        
        let previousMonth = currentMonth - 1;
        let previousMonthYear = currentYear;
        if (previousMonth < 0) {
            previousMonth = 11;
            previousMonthYear = currentYear - 1;
        }
        
        const startDate = new Date(previousMonthYear, previousMonth, 1);
        const dateString = startDate.toISOString().split('T')[0];
        
        console.log(`  🔄 Updating meet_results for lifter ${lifterId} since ${dateString}`);
        
        // Find ALL meet results in the date range (not just empty ones)
        const { data: meetResults, error: findError } = await supabase
            .from('meet_results')
            .select('result_id, date, meet_name')
            .eq('lifter_id', lifterId)
            .gte('date', dateString);
        
        if (findError) {
            throw new Error(`Error finding meet results: ${findError.message}`);
        }
        
        if (!meetResults || meetResults.length === 0) {
            return { updated: 0, errors: 0 };
        }
        
        console.log(`  📊 Found ${meetResults.length} meet_results to update`);
        
        // Update ALL matching records with biographical data
        const updateData = {
            updated_at: new Date().toISOString()
        };
        
        // Add fields that exist and have values
        if (athleteData.wso) updateData.wso = athleteData.wso.toString().trim();
        if (athleteData.club_name) updateData.club_name = athleteData.club_name.toString().trim();
        if (athleteData.gender) updateData.gender = athleteData.gender.toString().trim();
        if (athleteData.national_rank) updateData.national_rank = parseInt(athleteData.national_rank) || null;
        if (athleteData.birth_year) updateData.birth_year = parseInt(athleteData.birth_year) || null;
        
        // Calculate competition_age for each meet result since trigger isn't working
        if (athleteData.birth_year) {
            const birthYear = parseInt(athleteData.birth_year);
            for (const result of meetResults) {
                if (result.date) {
                    const competitionYear = new Date(result.date).getFullYear();
                    const competitionAge = competitionYear - birthYear;
                    
                    await supabase
                        .from('meet_results')
                        .update({
                            ...updateData,
                            competition_age: competitionAge
                        })
                        .eq('result_id', result.result_id);
                }
            }
            
            console.log(`  ✅ Updated ${meetResults.length} meet_results with biographical data and competition_age`);
            return { updated: meetResults.length, errors: 0 };
        }
        
        // Bulk update for cases without birth_year (no competition_age calculation needed)
        const { error: updateError } = await supabase
            .from('meet_results')
            .update(updateData)
            .in('result_id', meetResults.map(r => r.result_id));
        
        if (updateError) {
            throw new Error(`Error updating meet results: ${updateError.message}`);
        }
        
        console.log(`  ✅ Updated ${meetResults.length} meet_results with biographical data`);
        
        return { updated: meetResults.length, errors: 0 };
        
    } catch (error) {
        console.error(`  💥 Error updating meet_results:`, error.message);
        errorLogger.logError(
            athleteData.athlete_name,
            athleteData.membership_number,
            'MEET_RESULTS_UPDATE_ERROR',
            error.message
        );
        return { updated: 0, errors: 1 };
    }
}

async function processAthleteCSVFile(filePath, errorLogger) {
    const fileName = path.basename(filePath);
    console.log(`\n📄 Processing: ${fileName}`);
    
    try {
        const athleteRecords = await readAthleteCSVFile(filePath);
        
        if (athleteRecords.length === 0) {
            console.log(`  ⚠️ No valid records found in ${fileName}`);
            return { 
                updated: 0, 
                created: 0, 
                meetResultsUpdated: 0,
                notFound: 0, 
                duplicates: 0, 
                errors: 0, 
                success: true 
            };
        }
        
        // Process records and prepare updates
        const lifterUpdates = [];
        const newLifters = [];
        let meetResultsUpdated = 0;
        let notFoundCount = 0;
        let duplicateCount = 0;
        let errorCount = 0;
        
        console.log(`  🔍 Looking up ${athleteRecords.length} athletes...`);
        
        let processedCount = 0;
        for (const athleteData of athleteRecords) {
            processedCount++;
            
            if (processedCount % 25 === 0) {
                console.log(`  📊 Progress: ${processedCount}/${athleteRecords.length} athletes processed`);
            }
            
            try {
                const athleteName = athleteData.athlete_name.toString().trim();
                const matchingLifters = await findLifterByName(athleteName);
                
                if (matchingLifters.length === 0) {
                    // Create new lifter
                    console.log(`  ➕ Will create new lifter: ${athleteName}`);
                    newLifters.push(athleteData);
                    continue;
                }
                
                if (matchingLifters.length > 1) {
                    // Try to disambiguate using additional criteria
                    console.log(`  🔍 Found ${matchingLifters.length} lifters named "${athleteName}" - attempting disambiguation...`);
                    
                    let bestMatch = null;
                    let exactMatches = [];
                    
                    // Strategy 1: Match by membership number if available
                    if (athleteData.membership_number) {
                        const membershipMatches = matchingLifters.filter(l => 
                            l.membership_number && l.membership_number.toString() === athleteData.membership_number.toString()
                        );
                        if (membershipMatches.length === 1) {
                            bestMatch = membershipMatches[0];
                            console.log(`    ✅ Matched by membership number: ${athleteData.membership_number}`);
                        } else if (membershipMatches.length > 1) {
                            console.log(`    ⚠️  Multiple lifters with same membership ${athleteData.membership_number}`);
                        }
                    }
                    
                    // Note: WSO/Club matching removed due to schema migration
                    // WSO and club_name are now in meet_results table, not lifters table
                    
                    // Strategy 4: Create new lifter if no clear match (this is the key fix!)
                    if (!bestMatch && exactMatches.length === 0) {
                        console.log(`    ➕ No clear match found - will create new lifter for ${athleteName}`);
                        console.log(`       New lifter details: Membership=${athleteData.membership_number}`);
                        newLifters.push(athleteData);
                        continue;
                    }
                    
                    // If still ambiguous, log error and skip
                    if (!bestMatch) {
                        console.log(`    ❌ Still ambiguous after disambiguation - logging as duplicate`);
                        errorLogger.logError(athleteName, athleteData.membership_number, 'DUPLICATE_NAMES', 
                            `Found ${matchingLifters.length} lifters, ${exactMatches.length} potential matches after disambiguation`);
                        duplicateCount++;
                        continue;
                    }
                    
                    // Use the best match we found
                    const lifter = bestMatch;
                    const lifterId = lifter.lifter_id;
                    console.log(`    ✅ Using lifter_id ${lifterId} for ${athleteName}`);
                } else {
                    // Found exactly one lifter (original logic)
                    var lifter = matchingLifters[0];
                    var lifterId = lifter.lifter_id;
                }
                
                // Check if membership number needs updating
                const membershipChanged = athleteData.membership_number && 
                    lifter.membership_number !== parseInt(athleteData.membership_number);
                
                if (membershipChanged) {
                    console.log(`  🔄 Membership change detected for ${athleteName}: ${lifter.membership_number} → ${athleteData.membership_number}`);
                }
                
                // Prepare lifter update (only membership number now)
                const updateData = {
                    lifter_id: lifterId,
                    membership_number: athleteData.membership_number ? parseInt(athleteData.membership_number) : lifter.membership_number,
                    athlete_name: athleteName
                };
                
                lifterUpdates.push(updateData);
                
                // Update recent meet_results with biographical data
                const meetResultsUpdate = await updateRecentMeetResultsWithBiographicalData(
                    lifterId, 
                    athleteData, 
                    errorLogger
                );
                meetResultsUpdated += meetResultsUpdate.updated;
                errorCount += meetResultsUpdate.errors;
                
            } catch (error) {
                errorLogger.logError(athleteData.athlete_name, athleteData.membership_number, 'LOOKUP_ERROR', error.message);
                errorCount++;
            }
        }
        
        // Batch update existing lifters
        if (lifterUpdates.length > 0) {
            await batchUpdateLifters(lifterUpdates);
        }
        
        // Create new lifters one by one
        let newLiftersCreated = 0;
        if (newLifters.length > 0) {
            console.log(`  ➕ Creating ${newLifters.length} new lifters...`);
            for (let i = 0; i < newLifters.length; i++) {
                const athleteData = newLifters[i];
                
                if (i > 0 && i % 10 === 0) {
                    console.log(`    📈 Created ${i}/${newLifters.length} new lifters so far...`);
                }
                
                try {
                    const newLifterId = await createNewLifter(athleteData);
                    
                    // Also update meet_results for the new lifter
                    const meetResultsUpdate = await updateRecentMeetResultsWithBiographicalData(
                        newLifterId, 
                        athleteData, 
                        errorLogger
                    );
                    meetResultsUpdated += meetResultsUpdate.updated;
                    errorCount += meetResultsUpdate.errors;
                    
                    // Create division string from Age Category and Weight Class for logging
                    const divisionString = `${athleteData['Age Category'] || ''} ${athleteData['Weight Class'] || ''}`.trim();
                    const enrichedAthleteData = {
                        ...athleteData,
                        division: divisionString
                    };
                    errorLogger.logNewLifter(enrichedAthleteData);
                    newLiftersCreated++;
                } catch (error) {
                    errorLogger.logError(athleteData.athlete_name, athleteData.membership_number, 'CREATE_ERROR', error.message);
                    errorCount++;
                }
                
                // Add brief pause after every 5 new lifters created
                if (newLiftersCreated > 0 && newLiftersCreated % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
        }
        
        console.log(`  📊 Results: ${lifterUpdates.length} updated, ${newLiftersCreated} created, ${meetResultsUpdated} meet_results updated, ${duplicateCount} duplicates, ${errorCount} errors`);
        
        return { 
            updated: lifterUpdates.length, 
            created: newLiftersCreated,
            meetResultsUpdated: meetResultsUpdated,
            notFound: notFoundCount, 
            duplicates: duplicateCount, 
            errors: errorCount,
            success: errorCount === 0
        };
        
    } catch (error) {
        console.error(`💥 Error processing file ${fileName}:`, error.message);
        return { 
            updated: 0, 
            created: 0, 
            meetResultsUpdated: 0,
            notFound: 0, 
            duplicates: 0, 
            errors: 1, 
            success: false 
        };
    }
}

async function main() {
    console.log('🏋️ Athlete CSV to Supabase Upload Started (Nightly Version)');
    console.log('========================================================');
    console.log(`🕐 Start time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
    
    try {
        // Check Supabase connection
        console.log('🔗 Testing Supabase connection...');
        
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
            throw new Error('Missing Supabase environment variables (SUPABASE_URL, SUPABASE_SECRET_KEY)');
        }
        
        // Test connection - ONLY add timeout here where it's most likely to hang
        const { data: testData, error: testError } = await withTimeout(
            supabase
                .from('lifters')
                .select('lifter_id')
                .limit(1),
            10000
        );
        
        if (testError) {
            throw new Error(`Supabase connection failed: ${testError.message}`);
        }
        console.log('✅ Supabase connection successful');
        
        // Create error logger
        const errorLogger = createErrorLogger();
        
        // Get all athlete CSV files
        const csvFiles = await getAllAthleteCSVFiles();
        
        if (csvFiles.length === 0) {
            console.log('⚠️ No athlete CSV files found');
            return;
        }
        
        console.log(`\n📥 Processing ${csvFiles.length} athlete CSV files...`);
        
        let totalUpdated = 0;
        let totalCreated = 0;
        let totalMeetResultsUpdated = 0;
        let totalNotFound = 0;
        let totalDuplicates = 0;
        let totalErrors = 0;
        let filesProcessed = 0;
        
        // Process files one at a time
        for (const filePath of csvFiles) {
            const fileName = path.basename(filePath);
            console.log(`\n🔄 Starting file: ${fileName} (${filesProcessed + 1}/${csvFiles.length})`);
            
            try {
                const result = await processAthleteCSVFile(filePath, errorLogger);
                totalUpdated += result.updated;
                totalCreated += result.created || 0;
                totalMeetResultsUpdated += result.meetResultsUpdated || 0;
                totalNotFound += result.notFound;
                totalDuplicates += result.duplicates;
                totalErrors += result.errors;
                filesProcessed++;
                
                console.log(`✅ Completed file: ${fileName}`);
                
                // Delete CSV file if processing was successful (no errors)
                if (result.success) {
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`🗑️ Deleted: ${fileName}`);
                    } catch (deleteError) {
                        console.log(`⚠️ Could not delete ${fileName}: ${deleteError.message}`);
                    }
                } else {
                    console.log(`📄 Kept: ${fileName} (had errors)`);
                }
                
            } catch (fileError) {
                console.log(`💥 Error processing file ${fileName}:`, fileError.message);
                totalErrors++;
                filesProcessed++;
            }
            
            // Progress indicator
            if (filesProcessed % 25 === 0) {
                console.log(`\n📄 Progress: ${filesProcessed}/${csvFiles.length} files processed`);
            }
        }
        
        // Report results
        console.log('\n📊 Athlete Update Summary:');
        console.log(`📁 CSV files processed: ${filesProcessed}`);
        console.log(`✅ Lifters updated: ${totalUpdated}`);
        console.log(`➕ New lifters created: ${totalCreated}`);
        console.log(`🏋️ Meet_results updated: ${totalMeetResultsUpdated}`);
        console.log(`❓ Not found: ${totalNotFound}`);
        console.log(`👥 Duplicate names: ${totalDuplicates}`);
        console.log(`❌ Errors: ${totalErrors}`);
        console.log(`📄 Error log: ./athlete_upload_errors.csv`);
        if (totalCreated > 0) {
            console.log(`🆕 New lifters log: ./new_lifters_created.csv`);
        }
        
        if (totalErrors + totalNotFound + totalDuplicates > 0) {
            console.log('⚠️ Some records had issues. Check error logs for details.');
        } else {
            console.log('✅ All records processed successfully!');
        }
        
        console.log(`🕐 End time: ${new Date().toLocaleString()}`);
        
    } catch (error) {
        console.error('💥 Athlete CSV upload failed:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = {
    main
};