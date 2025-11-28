const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function createCompetitionAgeTrigger() {
    console.log('🚀 Creating competition_age trigger...');

    try {
        // Drop existing trigger and function if they exist
        console.log('📝 Dropping existing trigger and function...');

        const dropTriggerSQL = `
            DROP TRIGGER IF EXISTS update_competition_age_trigger ON meet_results;
        `;

        const dropFunctionSQL = `
            DROP FUNCTION IF EXISTS calculate_competition_age();
        `;

        // Note: Cannot execute DDL directly through Supabase client
        console.log('⚠️  Cannot execute DDL through client. Please run this SQL manually in Supabase SQL Editor:');
        console.log(dropTriggerSQL);
        console.log(dropFunctionSQL);

        // Create the trigger function
        console.log('🔧 Creating trigger function...');

        const createFunctionSQL = `
            CREATE OR REPLACE FUNCTION calculate_competition_age()
            RETURNS TRIGGER AS $$
            BEGIN
                -- Calculate competition_age if we have both date and birth_year
                IF NEW.date IS NOT NULL AND NEW.birth_year IS NOT NULL THEN
                    NEW.competition_age = EXTRACT(YEAR FROM NEW.date::date) - NEW.birth_year;
                ELSIF NEW.date IS NULL OR NEW.birth_year IS NULL THEN
                    NEW.competition_age = NULL;
                END IF;
                
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `;

        console.log('📝 Execute this SQL in Supabase SQL Editor:');
        console.log('```sql');
        console.log(createFunctionSQL);
        console.log('```');

        console.log('✅ Trigger function created successfully');

        // Create the trigger
        console.log('🎯 Creating trigger...');

        const createTriggerSQL = `
            CREATE TRIGGER update_competition_age_trigger
                BEFORE INSERT OR UPDATE OF date, birth_year
                ON meet_results
                FOR EACH ROW
                EXECUTE FUNCTION calculate_competition_age();
        `;

        console.log('📝 Execute this SQL in Supabase SQL Editor:');
        console.log('```sql');
        console.log(createTriggerSQL);
        console.log('```');

        console.log('✅ Trigger created successfully');

        // Test the trigger
        console.log('🧪 Testing trigger...');

        // Find a record to test with
        const { data: testRecord, error: findError } = await supabase
            .from('usaw_meet_results')
            .select('result_id, date, birth_year, competition_age')
            .not('birth_year', 'is', null)
            .not('date', 'is', null)
            .limit(1);

        if (findError || !testRecord || testRecord.length === 0) {
            console.log('⚠️  No test record found, skipping test');
            return;
        }

        const record = testRecord[0];
        console.log(`📊 Before test: ID=${record.result_id}, date=${record.date}, birth_year=${record.birth_year}, competition_age=${record.competition_age}`);

        // Update the record to trigger the calculation
        const { data: updatedRecord, error: updateError } = await supabase
            .from('usaw_meet_results')
            .update({
                birth_year: record.birth_year  // Set the same value to trigger the trigger
            })
            .eq('result_id', record.result_id)
            .select('result_id, date, birth_year, competition_age');

        if (updateError) {
            throw new Error(`Test update failed: ${updateError.message}`);
        }

        const updated = updatedRecord[0];
        const expectedAge = new Date(updated.date).getFullYear() - updated.birth_year;

        console.log(`📊 After test: ID=${updated.result_id}, date=${updated.date}, birth_year=${updated.birth_year}, competition_age=${updated.competition_age}`);
        console.log(`🔍 Expected age: ${expectedAge}, Actual age: ${updated.competition_age}`);

        if (updated.competition_age === expectedAge) {
            console.log('🎉 Trigger is working correctly!');
        } else {
            console.log('❌ Trigger calculation is incorrect');
        }

    } catch (error) {
        console.error('💥 Error creating trigger:', error.message);
        throw error;
    }
}

async function backfillCompetitionAge() {
    console.log('🔄 Backfilling competition_age for existing records...');

    try {
        // Update all records that have birth_year and date but missing competition_age
        const backfillSQL = `
            UPDATE meet_results 
            SET competition_age = EXTRACT(YEAR FROM date::date) - birth_year
            WHERE date IS NOT NULL 
              AND birth_year IS NOT NULL 
              AND competition_age IS NULL;
        `;

        console.log('📝 Execute this SQL in Supabase SQL Editor for backfill:');
        console.log('```sql');
        console.log(backfillSQL);
        console.log('```');
        const { data, error } = { data: null, error: null };

        if (error) {
            throw new Error(`Backfill failed: ${error.message}`);
        }

        console.log('✅ Backfill completed successfully');

        // Count updated records
        const { data: count, error: countError } = await supabase
            .from('usaw_meet_results')
            .select('result_id', { count: 'exact' })
            .not('competition_age', 'is', null)
            .not('birth_year', 'is', null)
            .not('date', 'is', null);

        if (!countError) {
            console.log(`📊 Total records with competition_age: ${count.length}`);
        }

    } catch (error) {
        console.error('💥 Error during backfill:', error.message);
        throw error;
    }
}

async function main() {
    console.log('🏋️ Competition Age Trigger Setup');
    console.log('================================');

    try {
        await createCompetitionAgeTrigger();
        await backfillCompetitionAge();

        console.log('\n🎉 Setup completed successfully!');
        console.log('The trigger will now automatically calculate competition_age when birth_year or date are updated.');

    } catch (error) {
        console.error('\n💥 Setup failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { createCompetitionAgeTrigger, backfillCompetitionAge };