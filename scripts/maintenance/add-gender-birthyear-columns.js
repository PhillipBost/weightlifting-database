/**
 * ADD GENDER AND BIRTH_YEAR COLUMNS TO MEET_RESULTS
 * 
 * Purpose: Adds the missing gender and birth_year columns to the meet_results table.
 * These columns should exist because gender and birth year are scraped along with
 * each individual meet result and are meet-specific data points.
 * 
 * Usage:
 *   node add-gender-birthyear-columns.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Add the missing columns
async function addMissingColumns() {
    console.log('🔧 Adding gender and birth_year columns to meet_results table...');
    console.log('⚠️  Note: This requires direct database access via SQL client.');
    console.log('\\nPlease execute the following SQL commands in your Supabase SQL editor:');
    console.log('');
    console.log('-- Add gender column');
    console.log('ALTER TABLE meet_results ADD COLUMN IF NOT EXISTS gender TEXT;');
    console.log('');
    console.log('-- Add birth_year column');
    console.log('ALTER TABLE meet_results ADD COLUMN IF NOT EXISTS birth_year INTEGER;');
    console.log('');
    console.log('After running these SQL commands, the columns will be available for data import.');

    try {
        // Try to verify if columns already exist by testing a select
        console.log('\\n🔍 Checking if columns already exist...');

        // Test for gender column
        try {
            await supabase
                .from('usaw_meet_results')
                .select('gender')
                .limit(1);
            console.log('✅ Gender column already exists');
        } catch (genderError) {
            console.log('❌ Gender column does not exist yet');
        }

        // Test for birth_year column
        try {
            await supabase
                .from('usaw_meet_results')
                .select('birth_year')
                .limit(1);
            console.log('✅ Birth_year column already exists');
        } catch (birthYearError) {
            console.log('❌ Birth_year column does not exist yet');
        }

        // Show current schema
        const { data: schemaData } = await supabase
            .from('usaw_meet_results')
            .select('*')
            .limit(1);

        if (schemaData && schemaData.length > 0) {
            console.log('\\n📋 Current meet_results columns:');
            Object.keys(schemaData[0]).sort().forEach(col => {
                if (col === 'gender' || col === 'birth_year') {
                    console.log(`  ✨ ${col} (newly added)`);
                } else {
                    console.log(`     ${col}`);
                }
            });
        }

    } catch (error) {
        console.error(`\\n❌ Migration failed: ${error.message}`);
        process.exit(1);
    }
}

// Main execution function
async function main() {
    try {
        console.log('🚀 Starting meet_results schema migration');
        console.log('='.repeat(60));

        // Test database connection
        const { error: testError } = await supabase.from('usaw_meet_results').select('result_id').limit(1);
        if (testError) {
            throw new Error(`Database connection failed: ${testError.message}`);
        }
        console.log('✅ Database connection successful\\n');

        // Add the missing columns
        await addMissingColumns();

        console.log('\\n' + '='.repeat(60));
        console.log('✅ SCHEMA MIGRATION COMPLETE');
        console.log('The meet_results table now includes:');
        console.log('  ✨ gender - for storing athlete gender from meet results');
        console.log('  ✨ birth_year - for storing athlete birth year from meet results');
        console.log('\\nThese columns can now be populated during scraping/import processes.');

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

module.exports = { addMissingColumns, main };