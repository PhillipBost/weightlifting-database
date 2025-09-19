/**
 * APPLY SCHEMA CHANGES
 * 
 * Applies the new location fields to meets and clubs tables
 * 
 * Usage: node apply-schema-changes.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Configuration
const SCHEMA_DIR = './scripts/schema';
const LOG_FILE = './logs/schema-changes.log';

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
    const logMessage = `[${timestamp}] ${message}\n`;
    
    console.log(message);
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Execute SQL from file
async function executeSQLFile(filePath) {
    log(`📄 Reading SQL file: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
        throw new Error(`SQL file not found: ${filePath}`);
    }
    
    const sqlContent = fs.readFileSync(filePath, 'utf8');
    const statements = sqlContent
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    log(`📝 Found ${statements.length} SQL statements to execute`);
    
    for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        
        // Skip comment statements
        if (statement.startsWith('COMMENT ON')) {
            log(`  💬 Executing comment statement ${i + 1}...`);
        } else {
            log(`  🔧 Executing statement ${i + 1}: ${statement.substring(0, 50)}...`);
        }
        
        try {
            // For DDL statements, we need to use raw SQL execution
            // Since Supabase doesn't have a direct SQL execution method in the client,
            // we'll use the RPC approach or handle it differently
            
            // First, try to execute as a simple query
            const { data, error } = await supabase.rpc('exec_sql', { 
                sql: statement + ';'
            });
            
            if (error) {
                // If RPC doesn't work, we'll log the statement for manual execution
                if (error.message.includes('function exec_sql') || error.code === '42883') {
                    log(`  ⚠️ Cannot execute via RPC - statement needs manual execution:`);
                    log(`     ${statement};`);
                } else {
                    throw error;
                }
            } else {
                log(`  ✅ Statement executed successfully`);
            }
            
        } catch (error) {
            log(`  ❌ Error executing statement: ${error.message}`);
            throw error;
        }
    }
}

// Check if columns already exist
async function checkExistingColumns(tableName, columnNames) {
    log(`🔍 Checking existing columns in ${tableName} table...`);
    
    try {
        // Try to select from the table with all the new columns
        const selectColumns = columnNames.join(', ');
        const { data, error } = await supabase
            .from(tableName)
            .select(selectColumns)
            .limit(1);
        
        if (error) {
            // If error mentions missing columns, those columns don't exist yet
            const missingColumns = [];
            for (const column of columnNames) {
                if (error.message.includes(column)) {
                    missingColumns.push(column);
                }
            }
            
            if (missingColumns.length > 0) {
                log(`  📋 Missing columns in ${tableName}: ${missingColumns.join(', ')}`);
                return { exist: false, missing: missingColumns };
            } else {
                // Different error - throw it
                throw error;
            }
        } else {
            log(`  ✅ All columns already exist in ${tableName}`);
            return { exist: true, missing: [] };
        }
        
    } catch (error) {
        log(`  ❌ Error checking columns: ${error.message}`);
        return { exist: false, missing: columnNames, error: error.message };
    }
}

// Main function to apply schema changes
async function applySchemaChanges() {
    const startTime = Date.now();
    
    try {
        ensureLogsDirectory();
        
        log('🏗️ Starting database schema changes...');
        log('='.repeat(60));
        
        // Check current schema state
        const meetsColumns = [
            'address', 'street_address', 'city', 'state', 'zip_code', 'country',
            'latitude', 'longitude', 'elevation_meters', 'elevation_source', 
            'elevation_fetched_at', 'geocode_display_name', 'geocode_precision_score',
            'geocode_success', 'geocode_error', 'geocode_strategy_used', 
            'location_text', 'date_range', 'wso_geography'
        ];
        
        const clubsColumns = ['wso_geography'];
        
        log('\n📊 PHASE 1: Checking current schema state...');
        const meetsCheck = await checkExistingColumns('meets', meetsColumns);
        const clubsCheck = await checkExistingColumns('clubs', clubsColumns);
        
        // Apply meets table changes if needed
        if (!meetsCheck.exist) {
            log('\n🏟️ PHASE 2: Adding location fields to meets table...');
            const meetsSchemaFile = path.join(SCHEMA_DIR, 'add-location-fields-to-meets.sql');
            await executeSQLFile(meetsSchemaFile);
            log('✅ Meets table schema updated successfully');
        } else {
            log('\n✅ Meets table schema is already up to date');
        }
        
        // Apply clubs table changes if needed  
        if (!clubsCheck.exist) {
            log('\n🏋️ PHASE 3: Adding WSO geography field to clubs table...');
            const clubsSchemaFile = path.join(SCHEMA_DIR, 'add-wso-geography-to-clubs.sql');
            await executeSQLFile(clubsSchemaFile);
            log('✅ Clubs table schema updated successfully');
        } else {
            log('\n✅ Clubs table schema is already up to date');
        }
        
        // Final verification
        log('\n🔍 PHASE 4: Verifying schema changes...');
        const finalMeetsCheck = await checkExistingColumns('meets', meetsColumns);
        const finalClubsCheck = await checkExistingColumns('clubs', clubsColumns);
        
        // Summary
        log('\n' + '='.repeat(60));
        log('🎉 SCHEMA CHANGES COMPLETE');
        log(`📊 Meets table: ${finalMeetsCheck.exist ? '✅ Ready' : '❌ Still missing columns'}`);
        log(`📊 Clubs table: ${finalClubsCheck.exist ? '✅ Ready' : '❌ Still missing columns'}`);
        log(`⏱️ Processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);
        
        if (!finalMeetsCheck.exist || !finalClubsCheck.exist) {
            log('\n⚠️ Some schema changes may need to be applied manually.');
            log('Please check the log for SQL statements that need manual execution.');
        }
        
        return {
            success: finalMeetsCheck.exist && finalClubsCheck.exist,
            meets: finalMeetsCheck,
            clubs: finalClubsCheck
        };
        
    } catch (error) {
        log(`\n❌ Schema changes failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    applySchemaChanges()
        .then(result => {
            if (result.success) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('Schema application failed:', error.message);
            process.exit(1);
        });
}

module.exports = { applySchemaChanges };