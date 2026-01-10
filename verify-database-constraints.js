const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function verifyDatabaseConstraints() {
    console.log('🔍 Verifying database constraints on usaw_meet_results table...\n');

    try {
        // Since Supabase doesn't easily expose constraint metadata, we'll test behavior
        console.log('🧪 Testing constraint behavior by attempting duplicate inserts...\n');

        // First, let's see what the current table structure looks like
        const { data: sampleData, error: sampleError } = await supabase
            .from('usaw_meet_results')
            .select('meet_id, lifter_id, weight_class')
            .limit(5);

        if (sampleError) {
            throw sampleError;
        }

        console.log('📋 Sample data from usaw_meet_results:');
        sampleData.forEach((row, index) => {
            console.log(`   ${index + 1}. meet_id: ${row.meet_id}, lifter_id: ${row.lifter_id}, weight_class: ${row.weight_class}`);
        });

        // Test constraint behavior by attempting duplicate inserts
        await testConstraintsBehavior();

    } catch (error) {
        console.error('❌ Error verifying database constraints:', error);
        throw error;
    }
}

async function testConstraintsBehavior() {
    console.log('\n🧪 Testing constraint behavior with duplicate (meet_id, lifter_id) but different weight_class...\n');

    try {
        // First, find an existing lifter and meet to use for testing
        const { data: existingResult, error: existingError } = await supabase
            .from('usaw_meet_results')
            .select('meet_id, lifter_id, weight_class')
            .limit(1);

        if (existingError || !existingResult || existingResult.length === 0) {
            throw new Error('Could not find existing data for testing');
        }

        const testMeetId = existingResult[0].meet_id;
        const testLifterId = existingResult[0].lifter_id;
        const originalWeightClass = existingResult[0].weight_class;

        console.log(`📋 Using existing data for test:`);
        console.log(`   meet_id: ${testMeetId}, lifter_id: ${testLifterId}, original weight_class: ${originalWeightClass}`);

        // Try to insert a duplicate with different weight class
        const differentWeightClass = originalWeightClass === '48kg' ? '+58kg' : '48kg';

        console.log(`\n📝 Attempting insert with different weight_class (${differentWeightClass})...`);
        const { data: insert1, error: error1 } = await supabase
            .from('usaw_meet_results')
            .insert({
                meet_id: testMeetId,
                lifter_id: testLifterId,
                weight_class: differentWeightClass,
                body_weight_kg: '75.0',
                total: '200',
                best_snatch: '90',
                best_cj: '110',
                lifter_name: 'Test Constraint Check',
                meet_name: 'Test Meet'
            })
            .select();

        if (error1) {
            console.log(`   ❌ Insert failed: ${error1.message}`);
            console.log('   🔍 ANALYSIS: This suggests OLD constraint is still active');
            console.log('      The database is enforcing (meet_id, lifter_id) uniqueness');
            console.log('      This means the migration to (meet_id, lifter_id, weight_class) was NOT successful');

            // Check if it's specifically a unique constraint violation
            if (error1.message.includes('duplicate key') || error1.message.includes('unique constraint')) {
                console.log('   🚨 CONFIRMED: Unique constraint violation detected');
                console.log('      Constraint details in error:', error1.message);

                if (error1.message.includes('meet_results_meet_id_lifter_id_key')) {
                    console.log('   🎯 IDENTIFIED: Old constraint "meet_results_meet_id_lifter_id_key" is still active');
                } else if (error1.message.includes('usaw_meet_results_unique_performance_key')) {
                    console.log('   🎯 IDENTIFIED: New constraint "usaw_meet_results_unique_performance_key" is active');
                }
            }
        } else {
            console.log(`   ✅ Insert succeeded`);
            console.log(`      Data: meet_id=${insert1[0].meet_id}, lifter_id=${insert1[0].lifter_id}, weight_class=${insert1[0].weight_class}`);
            console.log('   🔍 ANALYSIS: This suggests NEW constraint is active');
            console.log('      The database allows (meet_id, lifter_id) duplicates with different weight_class');
            console.log('      This means the migration to (meet_id, lifter_id, weight_class) was SUCCESSFUL');

            // Clean up the test record we just inserted
            console.log('\n🧹 Cleaning up test record...');
            await supabase
                .from('usaw_meet_results')
                .delete()
                .eq('result_id', insert1[0].result_id);
            console.log('   ✅ Test record cleaned up');
        }

        // Summary
        console.log('\n📋 CONSTRAINT VERIFICATION SUMMARY:');
        console.log('===================================');

        if (error1 && (error1.message.includes('duplicate key') || error1.message.includes('unique constraint'))) {
            console.log('🚨 OLD CONSTRAINT STILL ACTIVE: usaw_meet_results_meet_id_lifter_id_key');
            console.log('   - Database rejects (meet_id, lifter_id) duplicates even with different weight_class');
            console.log('   - Migration was NOT successful');
            console.log('   - This explains the Molly Raines upsert failure');
            console.log('   - Action needed: Execute the constraint migration properly');

            console.log('\n🔧 RECOMMENDED NEXT STEPS:');
            console.log('   1. Run BUG-2.6.2: Fix database migration execution');
            console.log('   2. Manually execute the constraint migration script');
            console.log('   3. Verify the old constraint is dropped and new constraint is created');

        } else if (!error1) {
            console.log('✅ NEW CONSTRAINT ACTIVE: usaw_meet_results_unique_performance_key');
            console.log('   - Database allows (meet_id, lifter_id) duplicates with different weight_class');
            console.log('   - Migration was SUCCESSFUL');
            console.log('   - Molly Raines case should work now');
            console.log('   - Can proceed to BUG-2.4.5: Test with Molly Raines case');

        } else {
            console.log('❓ UNEXPECTED RESULT: Unable to determine constraint state');
            console.log('   - Error was not a constraint violation');
            console.log('   - Need manual investigation');
            console.log(`   - Error details: ${error1.message}`);
        }

    } catch (error) {
        console.error('❌ Error during constraint behavior testing:', error);
        throw error;
    }
}

// Run the verification
if (require.main === module) {
    verifyDatabaseConstraints()
        .then(() => {
            console.log('\n✅ Database constraint verification completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Database constraint verification failed:', error);
            process.exit(1);
        });
}

module.exports = { verifyDatabaseConstraints, testConstraintsBehavior };