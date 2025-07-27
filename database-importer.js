const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const Papa = require('papaparse');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

async function upsertMeetsToDatabase(meetings) {
    console.log(`🔄 Upserting ${meetings.length} meets to database...`);
    
    let newCount = 0;
    let updatedCount = 0;
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
                });
            
            if (error) {
                console.error(`❌ Batch ${Math.floor(i/batchSize) + 1} failed:`, error);
                errorCount += batch.length;
            } else {
                console.log(`✅ Batch ${Math.floor(i/batchSize) + 1} completed successfully`);
                // Note: Supabase doesn't return detailed upsert counts, so we'll estimate
                newCount += batch.length; // This is an approximation
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
    
    return { newCount, updatedCount, errorCount };
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
    console.log('🗄️ Database Import Started');
    console.log('==========================');
    console.log(`🕐 Start time: ${new Date().toLocaleString()}`);
    
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
        
        console.log('🧪 Testing basic Supabase connection...');
        
        try {
            // Test 1: Simple select
            const { data: testData, error: testError } = await supabase
                .from('meets')
                .select('meet_id')
                .limit(1);
            
            console.log('✅ Test query result:', { 
                success: !testError, 
                dataLength: testData?.length, 
                error: testError ? {
                    message: testError.message,
                    details: testError.details,
                    hint: testError.hint,
                    code: testError.code
                } : null 
            });
            
            // Test 2: Count query (more detailed)
            const { count, error: countError } = await supabase
                .from('meets')
                .select('*', { count: 'exact', head: true });
                
            console.log('📊 Count query result:', { 
                count: count, 
                error: countError ? {
                    message: countError.message,
                    details: countError.details,
                    hint: countError.hint,
                    code: countError.code
                } : null 
            });
            
        } catch (err) {
            console.log('💥 Connection test threw exception:', err.message);
        }

        const beforeCount = await getExistingMeetCount();
        
        // Determine which CSV file to import
        const currentYear = new Date().getFullYear();
        const csvFilePath = `./meets_${currentYear}.csv`;
        
        // Read CSV data
        const meetings = await readCSVFile(csvFilePath);
        
        if (meetings.length === 0) {
            console.log('⚠️ No data found in CSV file');
            return;
        }
        
        // Import to database
        const result = await upsertMeetsToDatabase(meetings);
        
        const afterCount = await getExistingMeetCount();
        
        // Report results
        console.log('\n📊 Import Summary:');
        console.log(`📁 CSV records processed: ${meetings.length}`);
        console.log(`💾 Database before: ${beforeCount || 'unknown'} meets`);
        console.log(`💾 Database after: ${afterCount || 'unknown'} meets`);
        console.log(`➕ Net change: ${afterCount && beforeCount ? afterCount - beforeCount : 'unknown'} meets`);
        console.log(`❌ Errors: ${result.errorCount}`);
        
        if (result.errorCount > 0) {
            console.log('⚠️ Some records failed to import. Check the logs above for details.');
        } else {
            console.log('✅ All records processed successfully!');
        }
        
        console.log(`🕐 End time: ${new Date().toLocaleString()}`);
        
    } catch (error) {
        console.error('💥 Database import failed:', error.message);
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
