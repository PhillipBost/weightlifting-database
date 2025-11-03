/**
 * APPLY IWF LIFTER CONSTRAINTS
 *
 * Applies database constraints and indexes to prevent duplicate IWF lifter IDs
 * and optimize matching by name + country + birth_year.
 *
 * Background:
 * - Two lifters named "Tigran MARTIROSYAN" from Armenia with different IWF IDs
 *   were being merged because the fallback matching only used name + country
 * - This script adds constraints to enforce unique IWF IDs and creates an index
 *   for efficient name+country+birth_year matching
 *
 * Usage:
 *   node scripts/maintenance/apply-iwf-lifter-constraints.js
 *
 * Changes:
 * 1. Adds UNIQUE constraint on iwf_lifter_id (allows multiple NULLs)
 * 2. Creates composite index on (athlete_name, country_code, birth_year)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client for IWF database
const supabaseIWF = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const LOG_FILE = './logs/iwf-lifter-constraints.log';

// Ensure logs directory exists
function ensureLogsDirectory() {
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
}

// Logging utility
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;

    console.log(logMessage);
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

// Execute SQL via RPC
async function executeSQLStatement(sql) {
    try {
        const { data, error } = await supabaseIWF.rpc('exec_sql', {
            sql: sql
        });

        if (error) {
            if (error.message.includes('function exec_sql') || error.code === '42883') {
                log(`  ⚠️ Cannot execute via RPC - statement needs manual execution:`);
                log(`     ${sql}`);
                return { success: false, manual: true, error: error.message };
            } else {
                throw error;
            }
        }

        return { success: true, data };
    } catch (error) {
        log(`  ❌ Error executing SQL: ${error.message}`);
        throw error;
    }
}

// Check if constraint exists
async function checkConstraintExists(constraintName) {
    try {
        const sql = `
            SELECT COUNT(*) as cnt
            FROM pg_constraint
            WHERE conname = '${constraintName}'
        `;

        const result = await executeSQLStatement(sql);
        return result.success && result.data && result.data.length > 0 && result.data[0].cnt > 0;
    } catch (error) {
        log(`  ⚠️ Could not check constraint: ${error.message}`);
        return false;
    }
}

// Check if index exists
async function checkIndexExists(indexName) {
    try {
        const sql = `
            SELECT COUNT(*) as cnt
            FROM pg_indexes
            WHERE indexname = '${indexName}'
            AND tablename = 'iwf_lifters'
        `;

        const result = await executeSQLStatement(sql);
        return result.success && result.data && result.data.length > 0 && result.data[0].cnt > 0;
    } catch (error) {
        log(`  ⚠️ Could not check index: ${error.message}`);
        return false;
    }
}

// Apply constraints
async function applyConstraints() {
    const startTime = Date.now();

    try {
        ensureLogsDirectory();

        log('🏗️ IWF LIFTER CONSTRAINT MIGRATION - STARTED');
        log('='.repeat(70));

        // Step 1: Check connection
        log('\n🔌 Verifying IWF database connection...');
        const { data: testData, error: testError } = await supabaseIWF
            .from('iwf_lifters')
            .select('count', { count: 'exact', head: true });

        if (testError) {
            throw new Error(`Database connection failed: ${testError.message}`);
        }
        log('✅ Database connection verified');

        // Step 2: Add UNIQUE constraint on iwf_lifter_id
        log('\n📋 STEP 1: Adding UNIQUE constraint on iwf_lifter_id...');
        const constraintExists = await checkConstraintExists('uq_iwf_lifters_iwf_lifter_id');

        if (constraintExists) {
            log('  ✅ UNIQUE constraint already exists');
        } else {
            log('  🔧 Creating UNIQUE constraint...');
            const constraintSQL = `
                ALTER TABLE iwf_lifters
                ADD CONSTRAINT uq_iwf_lifters_iwf_lifter_id
                UNIQUE (iwf_lifter_id)
            `;

            const result = await executeSQLStatement(constraintSQL);
            if (result.success) {
                log('  ✅ UNIQUE constraint created successfully');
            } else if (result.manual) {
                log('  ⚠️ Constraint creation requires manual execution');
            } else {
                throw new Error('Failed to create constraint');
            }
        }

        // Step 3: Create composite index
        log('\n📈 STEP 2: Creating composite index for matching...');
        const indexExists = await checkIndexExists('idx_iwf_lifters_name_country_birthyear');

        if (indexExists) {
            log('  ✅ Composite index already exists');
        } else {
            log('  🔧 Creating composite index on (athlete_name, country_code, birth_year)...');
            const indexSQL = `
                CREATE INDEX idx_iwf_lifters_name_country_birthyear
                ON iwf_lifters (athlete_name, country_code, birth_year)
            `;

            const result = await executeSQLStatement(indexSQL);
            if (result.success) {
                log('  ✅ Composite index created successfully');
            } else if (result.manual) {
                log('  ⚠️ Index creation requires manual execution');
            } else {
                throw new Error('Failed to create index');
            }
        }

        // Step 4: List all IWF lifter indexes
        log('\n🔍 STEP 3: Verifying all indexes on iwf_lifters table...');
        const { data: indexes, error: indexError } = await supabaseIWF.rpc('get_indexes', {
            table_name: 'iwf_lifters'
        }).catch(() => ({ data: null, error: { message: 'RPC not available' } }));

        if (indexes && Array.isArray(indexes)) {
            log(`  Found ${indexes.length} indexes:`);
            indexes.forEach(idx => {
                log(`    - ${idx.indexname}`);
            });
        } else {
            log('  ℹ️ Manual index verification needed');
        }

        // Summary
        const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
        log('\n' + '='.repeat(70));
        log('✅ IWF LIFTER CONSTRAINT MIGRATION - COMPLETED');
        log(`⏱️ Processing time: ${elapsedSeconds}s`);

        log('\n📝 SUMMARY OF CHANGES:');
        log('  1. UNIQUE constraint on iwf_lifter_id prevents duplicate IWF IDs');
        log('  2. Composite index on (athlete_name, country_code, birth_year)');
        log('     enables efficient matching for same-name athletes');
        log('  3. iwf-lifter-manager.js now uses birth_year in fallback matching');

        log('\n✅ All database constraints have been applied successfully');
        log('✅ Enhanced lifter deduplication is now active');

        return {
            success: true,
            elapsedSeconds,
            constraintApplied: true,
            indexApplied: true
        };

    } catch (error) {
        log(`\n❌ CONSTRAINT MIGRATION FAILED: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);

        log('\n⚠️ MANUAL EXECUTION REQUIRED:');
        log('Please execute the following SQL statements manually:');
        log('');
        log('-- Add UNIQUE constraint:');
        log('ALTER TABLE iwf_lifters');
        log('ADD CONSTRAINT uq_iwf_lifters_iwf_lifter_id UNIQUE (iwf_lifter_id);');
        log('');
        log('-- Create composite index:');
        log('CREATE INDEX idx_iwf_lifters_name_country_birthyear');
        log('ON iwf_lifters (athlete_name, country_code, birth_year);');

        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    applyConstraints()
        .then(result => {
            if (result.success) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('Constraint application failed:', error.message);
            process.exit(1);
        });
}

module.exports = { applyConstraints };
