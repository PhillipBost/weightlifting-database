/**
 * Execute the database constraint migration with proper error handling
 * This script manually executes the constraint migration to fix the issue
 * where the old constraint is still active.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function executeConstraintMigration() {
    console.log('🔧 Executing Database Constraint Migration');
    console.log('=' .repeat(60));
    console.log('Purpose: Fix constraint to allow multiple weight classes per athlete per meet');
    console.log('Issue: Old constraint (meet_id, lifter_id) prevents Molly Raines case');
    console.log('Solution: New constraint (meet_id, lifter_id, weight_class)');
    
    try {
        // Step 1: Verify current constraint state
        console.log('\n📋 Step 1: Verifying current constraint state...');
        await verifyCurrentConstraints();
        
        // Step 2: Execute migration steps individually with error handling
        console.log('\n🚀 Step 2: Executing migration steps...');
        
        // Step 2a: Drop old constraint
        console.log('\n   2a. Dropping old constraint...');
        await dropOldConstraint();
        
        // Step 2b: Handle null weight_class values
        console.log('\n   2b. Handling null weight_class values...');
        await handleNullWeightClass();
        
        // Step 2c: Add NOT NULL constraint to weight_class
        console.log('\n   2c. Adding NOT NULL constraint to weight_class...');
        await addNotNullConstraint();
        
        // Step 2d: Create new constraint
        console.log('\n   2d. Creating new constraint...');
        await createNewConstraint();
        
        // Step 3: Verify migration success
        console.log('\n✅ Step 3: Verifying migration success...');
        await verifyMigrationSuccess();
        
        // Step 4: Test new constraint behavior
        console.log('\n🧪 Step 4: Testing new constraint behavior...');
        await testNewConstraintBehavior();
        
        console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!');
        console.log('\n📋 Summary:');
        console.log('   ✅ Old constraint dropped: meet_results_meet_id_lifter_id_key');
        console.log('   ✅ New constraint created: meet_results_meet_id_lifter_id_weight_class_key');
        console.log('   ✅ Database now allows multiple weight classes per athlete per meet');
        console.log('   ✅ Molly Raines case should now work');
        
        console.log('\n🔧 Next Steps:');
        console.log('   1. Update application code to use new constraint in upsert operations');
        console.log('   2. Test with BUG-2.4.5: Test with Molly Raines case');
        console.log('   3. Verify all existing functionality still works');
        
    } catch (error) {
        console.error('\n❌ MIGRATION FAILED:', error.message);
        console.error('Stack trace:', error.stack);
        
        console.log('\n🔄 Recovery Options:');
        console.log('   1. Check database connection and permissions');
        console.log('   2. Review error details above');
        console.log('   3. Run rollback migration if needed: migrations/rollback-meet-results-constraint.sql');
        console.log('   4. Contact database administrator if issues persist');
        
        throw error;
    }
}

async function verifyCurrentConstraints() {
    try {
        // Use a direct SQL query to check constraints since Supabase doesn't expose constraint metadata easily
        const { data, error } = await supabase.rpc('exec_sql', {
            sql: `
                SELECT 
                    constraint_name,
                    constraint_type
                FROM information_schema.table_constraints 
                WHERE table_name = 'usaw_meet_results' 
                AND constraint_type = 'UNIQUE'
                ORDER BY constraint_name;
            `
        });
        
        if (error) {
            throw new Error(`Failed to query constraints: ${error.message}`);
        }
        
        console.log('   Current unique constraints on usaw_meet_results:');
        if (data && data.length > 0) {
            data.forEach(constraint => {
                console.log(`     • ${constraint.constraint_name} (${constraint.constraint_type})`);
            });
        } else {
            console.log('     • No unique constraints found');
        }
        
        // Check specifically for our constraints
        const hasOldConstraint = data && data.some(c => c.constraint_name === 'meet_results_meet_id_lifter_id_key');
        const hasNewConstraint = data && data.some(c => c.constraint_name === 'meet_results_meet_id_lifter_id_weight_class_key');
        
        console.log(`   Old constraint present: ${hasOldConstraint ? '✅ YES' : '❌ NO'}`);
        console.log(`   New constraint present: ${hasNewConstraint ? '✅ YES' : '❌ NO'}`);
        
        if (hasNewConstraint && !hasOldConstraint) {
            throw new Error('Migration appears to already be complete. New constraint exists and old constraint is gone.');
        }
        
        if (!hasOldConstraint && !hasNewConstraint) {
            console.log('   ⚠️ WARNING: Neither constraint found. This is unexpected.');
        }
        
    } catch (error) {
        if (error.message.includes('already be complete')) {
            throw error;
        }
        console.log(`   ⚠️ Could not verify constraints via SQL: ${error.message}`);
        console.log('   Proceeding with migration anyway...');
    }
}

async function dropOldConstraint() {
    try {
        const { data, error } = await supabase.rpc('exec_sql', {
            sql: 'ALTER TABLE usaw_meet_results DROP CONSTRAINT IF EXISTS meet_results_meet_id_lifter_id_key;'
        });
        
        if (error) {
            throw new Error(`Failed to drop old constraint: ${error.message}`);
        }
        
        console.log('     ✅ Old constraint dropped successfully');
        
    } catch (error) {
        console.error('     ❌ Failed to drop old constraint:', error.message);
        throw error;
    }
}

async function handleNullWeightClass() {
    try {
        // First check for null values
        const { data: nullCheck, error: nullError } = await supabase.rpc('exec_sql', {
            sql: `
                SELECT COUNT(*) as null_count 
                FROM usaw_meet_results 
                WHERE weight_class IS NULL OR weight_class = '';
            `
        });
        
        if (nullError) {
            throw new Error(`Failed to check for null weight_class: ${nullError.message}`);
        }
        
        const nullCount = nullCheck && nullCheck.length > 0 ? nullCheck[0].null_count : 0;
        console.log(`     Found ${nullCount} records with null/empty weight_class`);
        
        if (nullCount > 0) {
            // Update null values
            const { data, error } = await supabase.rpc('exec_sql', {
                sql: `
                    UPDATE usaw_meet_results 
                    SET weight_class = 'Unknown' 
                    WHERE weight_class IS NULL OR weight_class = '';
                `
            });
            
            if (error) {
                throw new Error(`Failed to update null weight_class values: ${error.message}`);
            }
            
            console.log(`     ✅ Updated ${nullCount} records to have weight_class = 'Unknown'`);
        } else {
            console.log('     ✅ All records already have valid weight_class values');
        }
        
    } catch (error) {
        console.error('     ❌ Failed to handle null weight_class values:', error.message);
        throw error;
    }
}

async function addNotNullConstraint() {
    try {
        const { data, error } = await supabase.rpc('exec_sql', {
            sql: 'ALTER TABLE usaw_meet_results ALTER COLUMN weight_class SET NOT NULL;'
        });
        
        if (error) {
            throw new Error(`Failed to add NOT NULL constraint: ${error.message}`);
        }
        
        console.log('     ✅ NOT NULL constraint added to weight_class');
        
    } catch (error) {
        console.error('     ❌ Failed to add NOT NULL constraint:', error.message);
        throw error;
    }
}

async function createNewConstraint() {
    try {
        const { data, error } = await supabase.rpc('exec_sql', {
            sql: `
                ALTER TABLE usaw_meet_results 
                ADD CONSTRAINT meet_results_meet_id_lifter_id_weight_class_key 
                UNIQUE (meet_id, lifter_id, weight_class);
            `
        });
        
        if (error) {
            throw new Error(`Failed to create new constraint: ${error.message}`);
        }
        
        console.log('     ✅ New constraint created successfully');
        
    } catch (error) {
        console.error('     ❌ Failed to create new constraint:', error.message);
        throw error;
    }
}

async function verifyMigrationSuccess() {
    try {
        const { data, error } = await supabase.rpc('exec_sql', {
            sql: `
                SELECT 
                    constraint_name,
                    constraint_type
                FROM information_schema.table_constraints 
                WHERE table_name = 'usaw_meet_results' 
                AND constraint_type = 'UNIQUE'
                ORDER BY constraint_name;
            `
        });
        
        if (error) {
            throw new Error(`Failed to verify constraints: ${error.message}`);
        }
        
        console.log('   Final constraint state:');
        if (data && data.length > 0) {
            data.forEach(constraint => {
                console.log(`     • ${constraint.constraint_name}`);
            });
        }
        
        const hasOldConstraint = data && data.some(c => c.constraint_name === 'meet_results_meet_id_lifter_id_key');
        const hasNewConstraint = data && data.some(c => c.constraint_name === 'meet_results_meet_id_lifter_id_weight_class_key');
        
        if (hasOldConstraint) {
            throw new Error('VERIFICATION FAILED: Old constraint still exists');
        }
        
        if (!hasNewConstraint) {
            throw new Error('VERIFICATION FAILED: New constraint was not created');
        }
        
        console.log('   ✅ Migration verification successful');
        console.log('     • Old constraint removed');
        console.log('     • New constraint created');
        
    } catch (error) {
        console.error('   ❌ Migration verification failed:', error.message);
        throw error;
    }
}

async function testNewConstraintBehavior() {
    try {
        console.log('   Testing that new constraint allows multiple weight classes...');
        
        // Find an existing record to test with
        const { data: existingData, error: existingError } = await supabase
            .from('usaw_meet_results')
            .select('meet_id, lifter_id, weight_class, lifter_name')
            .limit(1);
            
        if (existingError || !existingData || existingData.length === 0) {
            console.log('   ⚠️ Could not find existing data for testing, skipping behavior test');
            return;
        }
        
        const testRecord = existingData[0];
        const differentWeightClass = testRecord.weight_class === '48kg' ? '+58kg' : '48kg';
        
        console.log(`   Testing with: meet_id=${testRecord.meet_id}, lifter_id=${testRecord.lifter_id}`);
        console.log(`   Original weight_class: ${testRecord.weight_class}, Test weight_class: ${differentWeightClass}`);
        
        // Try to insert a record with same meet_id and lifter_id but different weight_class
        const { data: insertData, error: insertError } = await supabase
            .from('usaw_meet_results')
            .insert({
                meet_id: testRecord.meet_id,
                lifter_id: testRecord.lifter_id,
                weight_class: differentWeightClass,
                body_weight_kg: '75.0',
                total: '200',
                best_snatch: '90',
                best_cj: '110',
                lifter_name: testRecord.lifter_name || 'Test Constraint',
                meet_name: 'Test Meet for Constraint'
            })
            .select();
            
        if (insertError) {
            if (insertError.message.includes('duplicate key') || insertError.message.includes('unique constraint')) {
                throw new Error(`New constraint test FAILED: ${insertError.message}`);
            } else {
                console.log(`   ⚠️ Insert failed for other reason: ${insertError.message}`);
                console.log('   This may be expected (e.g., foreign key constraints)');
            }
        } else {
            console.log('   ✅ Insert succeeded - new constraint allows multiple weight classes');
            
            // Clean up the test record
            if (insertData && insertData.length > 0) {
                await supabase
                    .from('usaw_meet_results')
                    .delete()
                    .eq('result_id', insertData[0].result_id);
                console.log('   🧹 Test record cleaned up');
            }
        }
        
    } catch (error) {
        console.error('   ❌ Constraint behavior test failed:', error.message);
        throw error;
    }
}

// Execute the migration
if (require.main === module) {
    executeConstraintMigration()
        .then(() => {
            console.log('\n✅ Constraint migration completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Constraint migration failed');
            process.exit(1);
        });
}

module.exports = { executeConstraintMigration };