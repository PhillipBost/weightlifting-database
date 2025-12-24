/**
 * Execute the database constraint migration
 * This will modify the unique constraint to allow multiple results per athlete per meet
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

async function runConstraintMigration() {
    console.log('🔧 Running database constraint migration');
    console.log('=' .repeat(60));
    
    try {
        // 1. Read the migration SQL
        const migrationPath = path.join(__dirname, 'migrations', 'fix-meet-results-constraint.sql');
        const migrationSQL = await fs.readFile(migrationPath, 'utf8');
        
        console.log('📄 Migration SQL loaded from:', migrationPath);
        
        // 2. Show what we're about to do
        console.log('\n🎯 Migration will:');
        console.log('   1. Drop constraint: meet_results_meet_id_lifter_id_key');
        console.log('   2. Ensure weight_class is never null');
        console.log('   3. Add NOT NULL constraint to weight_class');
        console.log('   4. Create new constraint: meet_results_meet_id_lifter_id_weight_class_key');
        console.log('   5. Verify migration success');
        
        // 3. Ask for confirmation
        console.log('\n⚠️  WARNING: This will modify the database schema!');
        console.log('   Make sure you have a backup and are running on the correct environment.');
        
        // For safety, require manual confirmation
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
            rl.question('\n❓ Do you want to proceed with the migration? (yes/no): ', resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== 'yes') {
            console.log('❌ Migration cancelled by user');
            return;
        }
        
        // 4. Execute the migration
        console.log('\n🚀 Executing migration...');
        
        // Split SQL into individual statements and execute them
        const statements = migrationSQL
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt && !stmt.startsWith('--') && stmt !== 'BEGIN' && stmt !== 'COMMIT');
        
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            if (statement.startsWith('DO $$') || statement.includes('ALTER TABLE') || statement.includes('SELECT')) {
                console.log(`   Executing statement ${i + 1}/${statements.length}...`);
                
                const { data, error } = await supabase.rpc('exec_sql', { sql: statement });
                
                if (error) {
                    console.error(`   ❌ Error in statement ${i + 1}:`, error.message);
                    throw error;
                } else {
                    console.log(`   ✅ Statement ${i + 1} completed`);
                }
            }
        }
        
        // 5. Verify the migration
        console.log('\n🔍 Verifying migration...');
        
        const { data: constraints, error: constraintError } = await supabase
            .from('information_schema.table_constraints')
            .select('constraint_name, constraint_type')
            .eq('table_name', 'usaw_meet_results')
            .eq('constraint_type', 'UNIQUE');
            
        if (constraintError) {
            console.log('⚠️ Could not verify constraints:', constraintError.message);
        } else {
            console.log('📊 Current unique constraints:');
            constraints.forEach(constraint => {
                console.log(`   • ${constraint.constraint_name}`);
            });
            
            const hasNewConstraint = constraints.some(c => 
                c.constraint_name === 'meet_results_meet_id_lifter_id_weight_class_key'
            );
            
            if (hasNewConstraint) {
                console.log('✅ New constraint created successfully!');
            } else {
                console.log('❌ New constraint not found!');
            }
        }
        
        console.log('\n🎉 Migration completed!');
        console.log('\n📋 Next steps:');
        console.log('   1. Update application code to use new constraint');
        console.log('   2. Test with Molly Raines case');
        console.log('   3. Validate data integrity');
        
    } catch (error) {
        console.error(`❌ Migration failed: ${error.message}`);
        console.error(error.stack);
        console.log('\n🔄 If needed, run rollback migration to restore original state');
    }
}

runConstraintMigration().catch(console.error);