/**
 * CLUB IMPORTER
 * 
 * Imports barbell club data from club-scraper.js output into Supabase database
 * Creates clubs table if it doesn't exist and upserts club data
 * 
 * Usage:
 *   node club-importer.js
 *   node club-importer.js --file ./output/club_data.json
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
const DEFAULT_INPUT_FILE = './output/club_data.json';
const LOGS_DIR = './logs';
const LOG_FILE = path.join(LOGS_DIR, 'club-importer.log');

// Ensure directories exist
function ensureDirectories() {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
}

// Logging utility
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    console.log(message);
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        inputFile: DEFAULT_INPUT_FILE
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--file':
                options.inputFile = args[i + 1];
                i++;
                break;
        }
    }

    return options;
}

// Create clubs table if it doesn't exist
async function ensureClubsTable() {
    log('🔍 Checking if clubs table exists...');

    try {
        // Try to query the table to see if it exists
        const { error } = await supabase
            .from('usaw_clubs')
            .select('club_name')
            .limit(1);

        if (error && error.code === 'PGRST116') {
            // Table doesn't exist, create it
            log('📋 Creating clubs table...');

            const createTableSQL = `
                CREATE TABLE IF NOT EXISTS clubs (
                    club_name TEXT PRIMARY KEY,
                    address TEXT,
                    phone TEXT,
                    email TEXT,
                    latitude NUMERIC,
                    longitude NUMERIC,
                    elevation_meters NUMERIC,
                    geocode_display_name TEXT,
                    geocode_success BOOLEAN DEFAULT FALSE,
                    geocode_error TEXT,
                    elevation_source TEXT,
                    elevation_fetched_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
                
                -- Create trigger function for updated_at
                CREATE OR REPLACE FUNCTION update_updated_at_column()
                RETURNS TRIGGER AS $$
                BEGIN
                    NEW.updated_at = NOW();
                    RETURN NEW;
                END;
                $$ language 'plpgsql';
                
                DROP TRIGGER IF EXISTS update_clubs_updated_at ON clubs;
                CREATE TRIGGER update_clubs_updated_at
                    BEFORE UPDATE ON clubs
                    FOR EACH ROW
                    EXECUTE FUNCTION update_updated_at_column();
            `;

            // Execute the SQL using the RPC function or direct SQL execution
            const { error: createError } = await supabase.rpc('exec_sql', { sql: createTableSQL });

            if (createError) {
                // If RPC doesn't work, we need to handle this differently
                log(`⚠️ Could not create table via RPC: ${createError.message}`);
                log('📝 Please create the clubs table manually with this SQL:');
                log(createTableSQL);
                throw new Error('Clubs table creation failed - please create manually');
            }

            log('✅ Clubs table created successfully');
        } else if (error) {
            throw new Error(`Error checking clubs table: ${error.message}`);
        } else {
            log('✅ Clubs table already exists');
        }
    } catch (error) {
        log(`❌ Error ensuring clubs table: ${error.message}`);
        throw error;
    }
}

// Read club data from JSON file
async function readClubData(filePath) {
    log(`📖 Reading club data from: ${filePath}`);

    if (!fs.existsSync(filePath)) {
        throw new Error(`Club data file not found: ${filePath}`);
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(fileContent);

    if (!data.clubs || !Array.isArray(data.clubs)) {
        throw new Error('Invalid club data format - expected clubs array');
    }

    log(`📊 Found ${data.clubs.length} clubs in file`);
    return data.clubs;
}

// Normalize club data for database insertion
function normalizeClubData(clubs) {
    log('🔧 Normalizing club data...');

    const normalized = clubs.map(club => {
        // Clean and validate club data
        const cleanClub = {
            club_name: club.club_name?.trim() || null,
            address: club.address?.trim() || null,
            phone: club.phone?.trim() || null,
            email: club.email?.trim() || null
        };

        // Validate required fields
        if (!cleanClub.club_name) {
            log(`⚠️ Skipping club with missing name: ${JSON.stringify(club)}`);
            return null;
        }

        // Clean phone number format
        if (cleanClub.phone) {
            // Remove common formatting and keep only digits and basic punctuation
            cleanClub.phone = cleanClub.phone.replace(/[^\d\s\-\(\)\+\.]/g, '').trim();
        }

        // Validate email format
        if (cleanClub.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(cleanClub.email)) {
                log(`⚠️ Invalid email format for ${cleanClub.club_name}: ${cleanClub.email}`);
                cleanClub.email = null;
            }
        }

        return cleanClub;
    }).filter(club => club !== null);

    log(`✅ Normalized ${normalized.length} valid clubs`);
    return normalized;
}

// Get existing clubs from database
async function getExistingClubs() {
    log('🔍 Getting existing clubs from database...');

    let allClubs = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
        const { data: clubs, error } = await supabase
            .from('usaw_clubs')
            .select('club_name, address, phone, email, latitude, longitude, elevation_meters, geocode_success')
            .range(from, from + pageSize - 1);

        if (error) {
            throw new Error(`Failed to get existing clubs: ${error.message}`);
        }

        if (!clubs || clubs.length === 0) {
            break;
        }

        allClubs.push(...clubs);
        from += pageSize;

        log(`📄 Loaded ${allClubs.length} clubs so far...`);

        if (clubs.length < pageSize) {
            break; // Last page
        }
    }

    log(`📊 Found ${allClubs.length} existing clubs in database`);
    return allClubs;
}

// Upsert clubs to database
async function upsertClubsToDatabase(clubs) {
    log(`🔄 Upserting ${clubs.length} clubs to database...`);

    // Remove duplicates within the data first
    const uniqueClubs = [];
    const seenNames = new Set();

    for (const club of clubs) {
        if (!seenNames.has(club.club_name)) {
            uniqueClubs.push(club);
            seenNames.add(club.club_name);
        } else {
            log(`⚠️ Skipping duplicate club name: ${club.club_name}`);
        }
    }

    log(`📊 After deduplication: ${uniqueClubs.length} unique clubs (removed ${clubs.length - uniqueClubs.length} duplicates)`);

    let insertCount = 0;
    let updateCount = 0;
    let errorCount = 0;

    // Process one at a time to handle conflicts properly
    for (let i = 0; i < uniqueClubs.length; i++) {
        const club = uniqueClubs[i];

        if (i % 50 === 0) {
            log(`📦 Processing club ${i + 1}/${uniqueClubs.length}...`);
        }

        try {
            // Use upsert with conflict resolution on club_name
            const { data, error } = await supabase
                .from('usaw_clubs')
                .upsert([club], {
                    onConflict: 'club_name',
                    ignoreDuplicates: false
                })
                .select('club_name');

            if (error) {
                log(`❌ Error with club ${club.club_name}: ${error.message}`);
                errorCount++;
                continue;
            }

            if (data && data.length > 0) {
                insertCount++;
            }

        } catch (error) {
            log(`❌ Processing error for club ${club.club_name}: ${error.message}`);
            errorCount++;
        }

        // Small delay to be nice to the database
        if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    log(`📈 Import summary:`);
    log(`   Total clubs processed: ${uniqueClubs.length}`);
    log(`   Successfully upserted: ${insertCount}`);
    log(`   Errors: ${errorCount}`);

    return { insertCount, updateCount, errorCount };
}

// Validate club references in meet_results
async function validateClubReferences() {
    log('🔍 Validating club references in meet_results...');

    try {
        // Get a sample of club names from meet_results to check
        const { data: meetResultsClubs, error: mrError } = await supabase
            .from('usaw_meet_results')
            .select('club_name')
            .not('club_name', 'is', null)
            .limit(100);

        if (mrError) {
            log(`⚠️ Could not get club names from meet_results: ${mrError.message}`);
            return;
        }

        if (!meetResultsClubs || meetResultsClubs.length === 0) {
            log('📊 No club names found in meet_results to validate');
            return;
        }

        // Get all club names from clubs table
        const { data: existingClubs, error: clubsError } = await supabase
            .from('usaw_clubs')
            .select('club_name');

        if (clubsError) {
            log(`⚠️ Could not get club names from clubs table: ${clubsError.message}`);
            return;
        }

        const existingClubNames = new Set(existingClubs?.map(c => c.club_name) || []);
        const uniqueMeetResultsClubs = [...new Set(meetResultsClubs.map(mr => mr.club_name))];

        const orphaned = uniqueMeetResultsClubs.filter(clubName => !existingClubNames.has(clubName));

        if (orphaned.length > 0) {
            log(`⚠️ Found ${orphaned.length} club names in meet_results sample without corresponding clubs table entries`);
            log(`   Examples: ${orphaned.slice(0, 5).join(', ')}`);
        } else {
            log('✅ All sampled club references in meet_results are valid');
        }

    } catch (error) {
        log(`❌ Error validating club references: ${error.message}`);
    }
}

// Main import function
async function importClubData() {
    const startTime = Date.now();

    try {
        const options = parseArguments();
        log(`🏋️ Starting club data import from ${options.inputFile}`);
        log('='.repeat(60));

        // Ensure clubs table exists
        await ensureClubsTable();

        // Read club data from file
        const clubData = await readClubData(options.inputFile);

        // Normalize and validate data
        const normalizedClubs = normalizeClubData(clubData);

        if (normalizedClubs.length === 0) {
            log('⚠️ No valid clubs to import');
            return;
        }

        // Get existing clubs for reporting
        const existingClubs = await getExistingClubs();

        // Upsert clubs to database
        const results = await upsertClubsToDatabase(normalizedClubs);

        // Validate club references in meet_results
        await validateClubReferences();

        // Final summary
        log('\n' + '='.repeat(60));
        log('✅ CLUB DATA IMPORT COMPLETE');
        log(`   Input file: ${options.inputFile}`);
        log(`   Clubs in file: ${clubData.length}`);
        log(`   Valid clubs processed: ${normalizedClubs.length}`);
        log(`   Successfully upserted: ${results.insertCount}`);
        log(`   Errors: ${results.errorCount}`);
        log(`   Processing time: ${Date.now() - startTime}ms`);

        // Data quality summary
        const clubsWithPhone = normalizedClubs.filter(c => c.phone).length;
        const clubsWithEmail = normalizedClubs.filter(c => c.email).length;
        const clubsWithAddress = normalizedClubs.filter(c => c.address).length;

        log('\n📊 Data Quality Summary:');
        log(`   Clubs with phone: ${clubsWithPhone} (${(clubsWithPhone / normalizedClubs.length * 100).toFixed(1)}%)`);
        log(`   Clubs with email: ${clubsWithEmail} (${(clubsWithEmail / normalizedClubs.length * 100).toFixed(1)}%)`);
        log(`   Clubs with address: ${clubsWithAddress} (${(clubsWithAddress / normalizedClubs.length * 100).toFixed(1)}%)`);

        // Get geographic data coverage from database
        try {
            const { data: geoStats } = await supabase
                .from('usaw_clubs')
                .select('latitude, longitude, elevation_meters, geocode_success')
                .not('latitude', 'is', null);

            const clubsWithCoordinates = geoStats ? geoStats.length : 0;
            const clubsWithElevation = geoStats ? geoStats.filter(c => c.elevation_meters !== null).length : 0;
            const successfulGeocodes = geoStats ? geoStats.filter(c => c.geocode_success === true).length : 0;

            // Get total club count for percentages
            const { count: totalClubCount } = await supabase
                .from('usaw_clubs')
                .select('*', { count: 'exact', head: true });

            if (totalClubCount > 0) {
                log('
🗺️ Geographic Data Coverage: ');
                log(`   Clubs with coordinates: ${clubsWithCoordinates} (${(clubsWithCoordinates / totalClubCount * 100).toFixed(1)}%)`);
                log(`   Successful geocodes: ${successfulGeocodes} (${(successfulGeocodes / totalClubCount * 100).toFixed(1)}%)`);
                log(`   Clubs with elevation: ${clubsWithElevation} (${(clubsWithElevation / totalClubCount * 100).toFixed(1)}%)`);
            }
        } catch (geoError) {
            log(`⚠️ Could not fetch geographic data summary: ${geoError.message}`);
        }

        return results;

    } catch (error) {
        log(`\n❌ Import failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    ensureDirectories();
    importClubData();
}

module.exports = {
    importClubData,
    normalizeClubData,
    ensureClubsTable
};