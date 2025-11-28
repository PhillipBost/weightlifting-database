/**
 * MEET ENTRY DATABASE IMPORT
 * 
 * Imports meet entry data from meet-entry-scraper.js output to Supabase
 * Creates meet_entries table and imports all scraped entry data
 * 
 * Usage: node meet-entry-import.js
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
const INPUT_FILE = './output/meet_entries.json';
const LOG_FILE = './logs/meet-entry-import.log';

// Logging utility
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    console.log(message);
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Create meet_entries table if it doesn't exist
async function createMeetEntriesTable() {
    log('Creating meet_entries table if it doesn\'t exist...');

    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS meet_entries (
            id SERIAL PRIMARY KEY,
            meet_id BIGINT REFERENCES meets(meet_id), -- Foreign key to meets table
            meet_name TEXT,
            entry_url TEXT,
            entry_meet_id INTEGER, -- Sport80 entry meet ID (from URL)
            member_id INTEGER,
            first_name TEXT,
            last_name TEXT,
            full_name TEXT, -- Computed: first_name + last_name
            state TEXT,
            birth_year INTEGER,
            weightlifting_age INTEGER,
            club TEXT,
            gender TEXT,
            division_declaration TEXT,
            weight_class_declaration TEXT,
            entry_total_declaration INTEGER,
            date_range TEXT,
            location TEXT,
            scraped_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            
            -- Indexes for common queries
            UNIQUE(entry_meet_id, member_id, meet_name) -- Prevent duplicate entries
        );
        
        -- Create indexes for performance
        CREATE INDEX IF NOT EXISTS idx_meet_entries_meet_id ON meet_entries(meet_id);
        CREATE INDEX IF NOT EXISTS idx_meet_entries_member_id ON meet_entries(member_id);
        CREATE INDEX IF NOT EXISTS idx_meet_entries_entry_meet_id ON meet_entries(entry_meet_id);
        CREATE INDEX IF NOT EXISTS idx_meet_entries_full_name ON meet_entries(full_name);
        CREATE INDEX IF NOT EXISTS idx_meet_entries_scraped_at ON meet_entries(scraped_at);
    `;

    const { error } = await supabase.rpc('exec_sql', { sql: createTableSQL });

    if (error) {
        // Fallback: try individual table creation (RPC might not exist)
        log('RPC method failed, attempting direct table creation...');

        // Note: This is a simplified version - you might need to run the full SQL manually
        throw new Error(`Failed to create table: ${error.message}. Please run the SQL manually in Supabase.`);
    }

    log('✅ meet_entries table ready');
}

// Extract entry meet ID from URL
function extractEntryMeetId(entryUrl) {
    if (!entryUrl) return null;

    // Extract from URL like: /public/events/13523/entries/20195
    const match = entryUrl.match(/\/events\/(\d+)\/entries\/\d+/);
    return match ? parseInt(match[1]) : null;
}

// Link meet entries to existing meets in database
async function linkMeetToDatabase(meetName, entryMeetId) {
    // Try to find matching meet in database
    const { data: existingMeets, error } = await supabase
        .from('usaw_meets')
        .select('meet_id, Meet')
        .ilike('Meet', `%${meetName}%`)
        .limit(5);

    if (error) {
        log(`⚠️ Error searching for meet "${meetName}": ${error.message}`);
        return null;
    }

    // Look for exact match first
    let matchedMeet = existingMeets?.find(m => m.Meet === meetName);

    // If no exact match, try partial match
    if (!matchedMeet && existingMeets?.length > 0) {
        matchedMeet = existingMeets[0]; // Take the first partial match
        log(`🔗 Partial match for "${meetName}" -> "${matchedMeet.Meet}" (meet_id: ${matchedMeet.meet_id})`);
    }

    if (matchedMeet) {
        log(`🔗 Linked "${meetName}" to meet_id: ${matchedMeet.meet_id}`);
        return matchedMeet.meet_id;
    }

    log(`⚠️ No database match found for meet: "${meetName}"`);
    return null;
}

// Import entries for a single meet
async function importMeetEntries(meetData) {
    const meetName = meetData.meet_name;
    const entryUrl = meetData.entry_url;
    const entries = meetData.entries || [];

    if (!entries.length) {
        log(`⏭️ Skipping "${meetName}" - no entries found`);
        return { imported: 0, skipped: 0, errors: 0 };
    }

    log(`📥 Processing "${meetName}" with ${entries.length} entries`);

    // Extract entry meet ID from URL
    const entryMeetId = extractEntryMeetId(entryUrl);
    log(`   Entry meet ID: ${entryMeetId || 'unknown'}`);

    // Try to link to existing meet in database
    const linkedMeetId = await linkMeetToDatabase(meetName, entryMeetId);

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    // Process entries in batches
    const batchSize = 50;
    for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);

        const importRecords = batch.map(entry => ({
            meet_id: linkedMeetId,
            meet_name: meetName,
            entry_url: entryUrl,
            entry_meet_id: entryMeetId,
            member_id: entry.member_id,
            first_name: entry.first_name,
            last_name: entry.last_name,
            full_name: [entry.first_name, entry.last_name].filter(Boolean).join(' ') || null,
            state: entry.state,
            birth_year: entry.birth_year,
            weightlifting_age: entry.weightlifting_age,
            club: entry.club,
            gender: entry.gender,
            division_declaration: entry.division_declaration,
            weight_class_declaration: entry.weight_class_declaration,
            entry_total_declaration: entry.entry_total_declaration,
            date_range: meetData.date_range,
            location: meetData.location,
            scraped_at: new Date().toISOString()
        }));

        // Import batch with upsert (handle duplicates)
        const { data, error } = await supabase
            .from('meet_entries')
            .upsert(importRecords, {
                onConflict: 'entry_meet_id,member_id,meet_name',
                ignoreDuplicates: false
            });

        if (error) {
            log(`❌ Batch import error: ${error.message}`);
            errors += batch.length;
        } else {
            imported += batch.length;
            log(`   ✅ Imported batch: ${batch.length} entries`);
        }
    }

    return { imported, skipped, errors };
}

// Main import function
async function importMeetEntries() {
    const startTime = Date.now();

    try {
        log('📥 Starting meet entry import...');
        log('='.repeat(60));

        // Check if input file exists
        if (!fs.existsSync(INPUT_FILE)) {
            throw new Error(`Input file not found: ${INPUT_FILE}`);
        }

        // Read input data
        const inputData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
        const meets = inputData.meets || [];
        const meetsWithEntries = meets.filter(m => m.entries && m.entries.length > 0);

        log(`📊 Input data summary:`);
        log(`   Total meets: ${meets.length}`);
        log(`   Meets with entries: ${meetsWithEntries.length}`);
        log(`   Total entries: ${meets.reduce((sum, m) => sum + (m.entries?.length || 0), 0)}`);

        if (meetsWithEntries.length === 0) {
            log('⚠️ No meets with entries found in input file');
            return;
        }

        // Create table if needed
        await createMeetEntriesTable();

        // Import all meets with entries
        let totalImported = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        for (let i = 0; i < meetsWithEntries.length; i++) {
            const meet = meetsWithEntries[i];
            const progress = `${i + 1}/${meetsWithEntries.length}`;

            log(`\n[${progress}] Processing: ${meet.meet_name}`);

            const result = await importMeetEntries(meet);
            totalImported += result.imported;
            totalSkipped += result.skipped;
            totalErrors += result.errors;

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Summary
        log('\n' + '='.repeat(60));
        log('✅ MEET ENTRY IMPORT COMPLETE');
        log(`   Processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);
        log(`   Meets processed: ${meetsWithEntries.length}`);
        log(`   Entries imported: ${totalImported}`);
        log(`   Entries skipped: ${totalSkipped}`);
        log(`   Errors: ${totalErrors}`);

        if (totalImported > 0) {
            log('\n🎉 Entry data successfully imported to meet_entries table');
            log('   You can now query entries by meet, athlete, or competition details');
        }

        return {
            meets_processed: meetsWithEntries.length,
            entries_imported: totalImported,
            entries_skipped: totalSkipped,
            errors: totalErrors
        };

    } catch (error) {
        log(`\n❌ Import failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    importMeetEntries();
}

module.exports = { importMeetEntries };