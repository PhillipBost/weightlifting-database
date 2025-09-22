#!/usr/bin/env node

/**
 * Apply Club Analytics Schema Changes
 * 
 * Adds the required columns to the clubs table for analytics tracking:
 * - recent_meets_count
 * - active_lifters_count  
 * - analytics_updated_at
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

async function applySchemaSql() {
    log('📊 Applying club analytics schema changes...');
    
    try {
        // Read the SQL file
        const sqlFilePath = path.join(__dirname, 'add-club-analytics-columns.sql');
        const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
        
        log('📖 Read schema SQL file');
        log('🔧 Executing schema changes...');
        
        // Split SQL into individual statements (simple approach)
        const statements = sqlContent
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0 && !stmt.startsWith('--') && stmt !== 'BEGIN' && stmt !== 'COMMIT');
        
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i] + ';';
            log(`   Executing statement ${i + 1}/${statements.length}...`);
            
            // Use the rpc function to execute raw SQL
            const { error } = await supabase.rpc('exec_sql', { sql: statement });
            
            if (error) {
                // Check if it's a "column already exists" error, which is okay
                if (error.message.includes('already exists') || error.message.includes('column') && error.message.includes('exists')) {
                    log(`   ⚠️ Column already exists (this is okay): ${error.message}`);
                } else {
                    throw new Error(`SQL execution failed: ${error.message}`);
                }
            } else {
                log(`   ✅ Statement executed successfully`);
            }
        }
        
        log('✅ Schema changes applied successfully');
        
    } catch (error) {
        if (error.message.includes('exec_sql')) {
            log('❌ Could not execute SQL via RPC function');
            log('📝 Please apply the schema changes manually using the SQL in add-club-analytics-columns.sql');
            log('   This is expected in some Supabase configurations');
            
            // Read and display the SQL content
            try {
                const sqlFilePath = path.join(__dirname, 'add-club-analytics-columns.sql');
                const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
                log('\n📋 SQL to execute manually:');
                log('═'.repeat(50));
                log(sqlContent);
                log('═'.repeat(50));
            } catch (readError) {
                log('❌ Could not read SQL file for display');
            }
        } else {
            log(`❌ Error applying schema: ${error.message}`);
            throw error;
        }
    }
}

async function verifySchemChanges() {
    log('🔍 Verifying schema changes...');
    
    try {
        // Test if we can select the new columns
        const { data, error } = await supabase
            .from('clubs')
            .select('club_name, recent_meets_count, active_lifters_count, analytics_updated_at')
            .limit(1);
        
        if (error) {
            if (error.message.includes('column') && (error.message.includes('does not exist') || error.message.includes('not found'))) {
                log('❌ Schema changes not yet applied - columns missing');
                return false;
            } else {
                throw error;
            }
        }
        
        log('✅ Schema verification successful - all columns present');
        
        if (data && data.length > 0) {
            const sample = data[0];
            log('📋 Sample club data structure:');
            log(`   club_name: ${sample.club_name}`);
            log(`   recent_meets_count: ${sample.recent_meets_count}`);
            log(`   active_lifters_count: ${sample.active_lifters_count}`);
            log(`   analytics_updated_at: ${sample.analytics_updated_at}`);
        }
        
        return true;
        
    } catch (error) {
        log(`❌ Schema verification failed: ${error.message}`);
        return false;
    }
}

async function main() {
    log('🚀 Starting club analytics schema setup...');
    
    try {
        // First check if schema is already applied
        const isAlreadyApplied = await verifySchemChanges();
        
        if (isAlreadyApplied) {
            log('✅ Schema is already applied - no changes needed');
            return;
        }
        
        // Apply schema changes
        await applySchemaSql();
        
        // Verify the changes were applied
        const isNowApplied = await verifySchemChanges();
        
        if (isNowApplied) {
            log('🎉 Club analytics schema setup completed successfully!');
        } else {
            log('⚠️ Schema setup completed but verification failed');
            log('   This may require manual intervention');
        }
        
    } catch (error) {
        log(`💥 Fatal error: ${error.message}`);
        process.exit(1);
    }
}

// Handle command line execution
if (require.main === module) {
    main();
}