/**
 * MIGRATE NATIONAL_RANK FROM LIFTERS TO MEET_RESULTS
 * 
 * Purpose: Migrates national_rank data from the lifters table to 
 * meet_results table, then removes club_name, wso, and national_rank 
 * columns from lifters table.
 * 
 * Usage:
 *   node migrate-national-rank.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Migrate national_rank data in batches
async function migrateNationalRank() {
    console.log('🔄 Starting migration of national_rank from lifters to meet_results...');
    
    let totalLifters = 0;
    let totalMeetResults = 0;
    let processedLifters = 0;
    let updatedResults = 0;
    
    try {
        // Get total counts for progress tracking
        const { count: lifterCount } = await supabase
            .from('lifters')
            .select('lifter_id', { count: 'exact' })
            .not('national_rank', 'is', null);
        
        const { count: resultCount } = await supabase
            .from('meet_results')
            .select('result_id', { count: 'exact' });
        
        totalLifters = lifterCount || 0;
        totalMeetResults = resultCount || 0;
        
        console.log(`📊 Found ${totalLifters} lifters with national_rank data`);
        console.log(`📊 Found ${totalMeetResults} total meet results to potentially update`);
        
        const batchSize = 100;
        let offset = 0;
        
        while (true) {
            // Get batch of lifters with national_rank data
            const { data: lifters, error: liftersError } = await supabase
                .from('lifters')
                .select('lifter_id, national_rank')
                .not('national_rank', 'is', null)
                .range(offset, offset + batchSize - 1);
            
            if (liftersError) {
                throw new Error(`Failed to fetch lifters: ${liftersError.message}`);
            }
            
            if (!lifters || lifters.length === 0) {
                break;
            }
            
            console.log(`\n📦 Processing batch ${Math.floor(offset/batchSize) + 1}: ${lifters.length} lifters (offset ${offset})`);
            
            // Process each lifter in the batch
            for (const lifter of lifters) {
                processedLifters++;
                
                if (processedLifters % 50 === 0) {
                    console.log(`  📊 Progress: ${processedLifters}/${totalLifters} lifters processed`);
                }
                
                try {
                    // Update all meet_results for this lifter_id
                    const { data: updateData, error: updateError } = await supabase
                        .from('meet_results')
                        .update({
                            national_rank: lifter.national_rank,
                            updated_at: new Date().toISOString()
                        })
                        .eq('lifter_id', lifter.lifter_id)
                        .select('result_id');
                    
                    if (updateError) {
                        console.error(`    ❌ Error updating meet_results for lifter_id ${lifter.lifter_id}: ${updateError.message}`);
                        continue;
                    }
                    
                    const updatedCount = updateData ? updateData.length : 0;
                    updatedResults += updatedCount;
                    
                    if (updatedCount > 0) {
                        console.log(`    ✅ Updated ${updatedCount} meet results for lifter_id ${lifter.lifter_id}`);
                    }
                    
                } catch (error) {
                    console.error(`    ❌ Error processing lifter_id ${lifter.lifter_id}: ${error.message}`);
                }
            }
            
            offset += batchSize;
        }
        
        console.log(`\n📊 Migration Summary:`);
        console.log(`  • Processed ${processedLifters} lifters`);
        console.log(`  • Updated ${updatedResults} meet results`);
        
        return { processedLifters, updatedResults };
        
    } catch (error) {
        console.error(`\n❌ Migration failed: ${error.message}`);
        throw error;
    }
}

// Remove columns from lifters table after successful migration
async function removeColumnsFromLifters() {
    console.log(`\n🗑️  Removing club_name, wso, and national_rank columns from lifters table...`);
    console.log('⚠️  Note: This requires direct database access via SQL client.');
    console.log('\\nPlease execute the following SQL commands in your Supabase SQL editor:');
    console.log('');
    console.log('-- Remove club_name column from lifters');
    console.log('ALTER TABLE lifters DROP COLUMN IF EXISTS club_name;');
    console.log('');
    console.log('-- Remove wso column from lifters'); 
    console.log('ALTER TABLE lifters DROP COLUMN IF EXISTS wso;');
    console.log('');
    console.log('-- Remove national_rank column from lifters'); 
    console.log('ALTER TABLE lifters DROP COLUMN IF EXISTS national_rank;');
    console.log('');
    console.log('After running these commands, lifters will only contain athlete profile data.');
}

// Verify the migration worked
async function verifyMigration() {
    console.log(`\n🔍 Verifying migration results...`);
    
    try {
        // Check sample of meet_results have national_rank populated
        const { data: sampleResults, error: sampleError } = await supabase
            .from('meet_results')
            .select('result_id, lifter_id, lifter_name, national_rank')
            .not('national_rank', 'is', null)
            .limit(5);
        
        if (sampleError) {
            throw new Error(`Failed to verify migration: ${sampleError.message}`);
        }
        
        console.log(`✅ Sample meet_results with migrated national_rank:`);
        sampleResults.forEach((result, i) => {
            console.log(`  ${i+1}. ${result.lifter_name} (lifter_id: ${result.lifter_id}) - National Rank: ${result.national_rank}`);
        });
        
        // Count total results with national_rank data
        const { count: rankCount } = await supabase
            .from('meet_results')
            .select('result_id', { count: 'exact' })
            .not('national_rank', 'is', null);
        
        console.log(`\n📊 Total meet_results with national_rank data: ${rankCount}`);
        
    } catch (error) {
        console.error(`❌ Verification failed: ${error.message}`);
    }
}

// Main execution function
async function main() {
    try {
        console.log('🚀 Starting national_rank migration');
        console.log('='.repeat(60));
        
        // Test database connection
        const { error: testError } = await supabase.from('lifters').select('lifter_id').limit(1);
        if (testError) {
            throw new Error(`Database connection failed: ${testError.message}`);
        }
        console.log('✅ Database connection successful');
        
        // Run the migration
        const results = await migrateNationalRank();
        
        // Verify the migration worked
        await verifyMigration();
        
        // Show instructions to remove columns from lifters table
        await removeColumnsFromLifters();
        
        console.log('\\n' + '='.repeat(60));
        console.log('✅ MIGRATION COMPLETE');
        console.log(`📊 Successfully migrated data for ${results.processedLifters} lifters`);
        console.log(`📊 Updated ${results.updatedResults} meet result records`);
        console.log('\\n⚠️  Don\'t forget to run the SQL commands above to remove the columns from lifters table!');
        
    } catch (error) {
        console.error(`\\n❌ Migration failed: ${error.message}`);
        console.error(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { migrateNationalRank, verifyMigration, main };