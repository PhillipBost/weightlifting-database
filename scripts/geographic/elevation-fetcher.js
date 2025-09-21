/**
 * ELEVATION FETCHER FOR MEET LOCATIONS
 * 
 * Reads meet_locations table, fetches elevation data for coordinates using Open-Meteo API,
 * and updates records with elevation information
 * 
 * Usage: node elevation-fetcher.js
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
const LOG_FILE = './logs/elevation-fetch.log';
const OPEN_METEO_DELAY = 1100; // 1.1 seconds between requests to be respectful
const OPEN_ELEVATION_DELAY = 1500; // 1.5 seconds for fallback API
const BATCH_SIZE = 100; // Open-Meteo supports up to 100 coordinates per request
const MAX_RETRIES = 3;

// Logging utility
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    console.log(message);
    
    // Ensure logs directory exists
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Sleep function for rate limiting
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch elevation using Open-Meteo API (primary)
async function fetchElevationOpenMeteo(coordinates) {
    const lats = coordinates.map(coord => coord.latitude).join(',');
    const lons = coordinates.map(coord => coord.longitude).join(',');
    
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
    
    try {
        log(`  🌐 Fetching elevation for ${coordinates.length} coordinates from Open-Meteo...`);
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'WeightliftingElevationFetcher/1.0'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.elevation || !Array.isArray(data.elevation)) {
            throw new Error('Invalid response format from Open-Meteo API');
        }
        
        if (data.elevation.length !== coordinates.length) {
            throw new Error(`Expected ${coordinates.length} elevations, got ${data.elevation.length}`);
        }
        
        const results = coordinates.map((coord, index) => ({
            ...coord,
            elevation: data.elevation[index],
            source: 'open-meteo',
            success: data.elevation[index] !== null
        }));
        
        const successCount = results.filter(r => r.success).length;
        log(`  ✅ Open-Meteo returned ${successCount}/${coordinates.length} successful elevations`);
        
        return results;
        
    } catch (error) {
        log(`  ❌ Open-Meteo API error: ${error.message}`);
        throw error;
    }
}

// Fetch elevation using Open-Elevation API (fallback)
async function fetchElevationOpenElevation(coordinates) {
    // Open-Elevation accepts POST requests with locations array
    const locations = coordinates.map(coord => ({
        latitude: coord.latitude,
        longitude: coord.longitude
    }));
    
    const url = 'https://api.open-elevation.com/api/v1/lookup';
    
    try {
        log(`  🌐 Fetching elevation for ${coordinates.length} coordinates from Open-Elevation (fallback)...`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'WeightliftingElevationFetcher/1.0'
            },
            body: JSON.stringify({ locations })
        });
        
        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('Rate limited by Open-Elevation API');
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.results || !Array.isArray(data.results)) {
            throw new Error('Invalid response format from Open-Elevation API');
        }
        
        if (data.results.length !== coordinates.length) {
            throw new Error(`Expected ${coordinates.length} elevations, got ${data.results.length}`);
        }
        
        const results = coordinates.map((coord, index) => ({
            ...coord,
            elevation: data.results[index].elevation,
            source: 'open-elevation',
            success: data.results[index].elevation !== null
        }));
        
        const successCount = results.filter(r => r.success).length;
        log(`  ✅ Open-Elevation returned ${successCount}/${coordinates.length} successful elevations`);
        
        return results;
        
    } catch (error) {
        log(`  ❌ Open-Elevation API error: ${error.message}`);
        throw error;
    }
}

// Fetch elevation with retry logic and fallback
async function fetchElevationWithRetry(coordinates) {
    let lastError = null;
    
    // Try Open-Meteo first (primary API)
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            log(`  🔄 Attempt ${attempt}/${MAX_RETRIES} with Open-Meteo...`);
            const results = await fetchElevationOpenMeteo(coordinates);
            return results;
        } catch (error) {
            lastError = error;
            log(`  ⚠️ Open-Meteo attempt ${attempt} failed: ${error.message}`);
            
            if (attempt < MAX_RETRIES) {
                const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                log(`  ⏳ Waiting ${delay}ms before retry...`);
                await sleep(delay);
            }
        }
    }
    
    log(`  🔄 All Open-Meteo attempts failed, trying Open-Elevation fallback...`);
    
    // Try Open-Elevation as fallback
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            log(`  🔄 Fallback attempt ${attempt}/${MAX_RETRIES} with Open-Elevation...`);
            const results = await fetchElevationOpenElevation(coordinates);
            return results;
        } catch (error) {
            lastError = error;
            log(`  ⚠️ Open-Elevation attempt ${attempt} failed: ${error.message}`);
            
            if (attempt < MAX_RETRIES) {
                const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                log(`  ⏳ Waiting ${delay}ms before retry...`);
                await sleep(delay);
            }
        }
    }
    
    log(`  ❌ All elevation fetch attempts failed`);
    
    // Return failed results
    return coordinates.map(coord => ({
        ...coord,
        elevation: null,
        source: 'failed',
        success: false,
        error: lastError?.message || 'All APIs failed'
    }));
}

// Update meet_locations table with elevation data (legacy)
async function updateElevationData(results) {
    const updates = [];
    const failures = [];
    
    for (const result of results) {
        if (result.success) {
            updates.push({
                id: result.id,
                elevation_meters: result.elevation,
                elevation_source: result.source,
                elevation_fetched_at: new Date().toISOString()
            });
        } else {
            failures.push({
                id: result.id,
                error: result.error || 'Failed to fetch elevation'
            });
        }
    }
    
    log(`  📤 Updating ${updates.length} meet_locations records with elevation data...`);
    
    // Update successful records
    for (const update of updates) {
        try {
            const { error } = await supabase
                .from('meet_locations')
                .update({
                    elevation_meters: update.elevation_meters,
                    elevation_source: update.elevation_source,
                    elevation_fetched_at: update.elevation_fetched_at
                })
                .eq('id', update.id);
            
            if (error) {
                log(`  ❌ Failed to update meet_locations record ${update.id}: ${error.message}`);
                failures.push({ id: update.id, error: error.message });
            }
        } catch (error) {
            log(`  ❌ Database error for meet_locations record ${update.id}: ${error.message}`);
            failures.push({ id: update.id, error: error.message });
        }
    }
    
    return {
        updated: updates.length,
        failed: failures.length,
        failures
    };
}

// Update meets table with elevation data
async function updateMeetElevationData(results) {
    log(`  📤 Updating ${results.length} meets records with elevation data...`);
    
    const updates = results.map(result => ({
        meet_id: result.id, // For meets, id is the meet_id
        elevation_meters: result.elevation,
        elevation_source: result.source,
        elevation_fetched_at: new Date().toISOString(),
        error: result.error || null
    }));
    
    let updated = 0;
    let failed = 0;
    
    // Update records individually to handle errors gracefully
    for (const update of updates) {
        try {
            if (update.elevation_meters !== null) {
                // Successful elevation fetch
                const { error } = await supabase
                    .from('meets')
                    .update({
                        elevation_meters: update.elevation_meters,
                        elevation_source: update.elevation_source,
                        elevation_fetched_at: update.elevation_fetched_at
                    })
                    .eq('meet_id', update.meet_id);
                
                if (error) {
                    throw new Error(error.message);
                }
                updated++;
            } else {
                // Failed elevation fetch - still update the timestamp to avoid retrying immediately
                const { error } = await supabase
                    .from('meets')
                    .update({
                        elevation_fetched_at: update.elevation_fetched_at
                    })
                    .eq('meet_id', update.meet_id);
                
                if (error) {
                    throw new Error(error.message);
                }
                failed++;
            }
        } catch (error) {
            log(`    ❌ Failed to update meet ${update.meet_id}: ${error.message}`);
            failed++;
        }
    }
    
    return { updated, failed };
}

// Fetch elevation data for meets table
async function fetchAndUpdateMeetElevations() {
    const startTime = Date.now();
    
    try {
        log('🏟️ Starting meet elevation data fetch process...');
        log('='.repeat(60));
        
        // Fetch meets that need elevation data with pagination
        log('🔍 Fetching meets that need elevation data...');
        let meets = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const { data, error: fetchError } = await supabase
                .from('meets')
                .select('meet_id, Meet, latitude, longitude, elevation_meters')
                .not('latitude', 'is', null)
                .not('longitude', 'is', null)
                .is('elevation_meters', null)
                .range(page * pageSize, (page + 1) * pageSize - 1);
            
            if (fetchError) {
                throw new Error(`Failed to fetch meets: ${fetchError.message}`);
            }
            
            if (data && data.length > 0) {
                meets = meets.concat(data);
                hasMore = data.length === pageSize;
                page++;
                log(`📄 Fetched page ${page}, total meets so far: ${meets.length}`);
            } else {
                hasMore = false;
            }
        }
        
        if (!meets || meets.length === 0) {
            log('✅ No meets found that need elevation data');
            return { total: 0, processed: 0, updated: 0, failed: 0 };
        }
        
        log(`📊 Found ${meets.length} meets needing elevation data`);
        
        let totalProcessed = 0;
        let totalUpdated = 0;
        let totalFailed = 0;
        
        // Process meets in batches
        for (let i = 0; i < meets.length; i += BATCH_SIZE) {
            const batch = meets.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(meets.length / BATCH_SIZE);
            
            log(`\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} meets)`);
            
            // Prepare coordinates for API call
            const coordinates = batch.map(meet => ({
                id: meet.meet_id, // Use meet_id as identifier for meets
                latitude: parseFloat(meet.latitude),
                longitude: parseFloat(meet.longitude),
                meet_name: meet.Meet
            }));
            
            // Validate coordinates
            const validCoordinates = coordinates.filter(coord => 
                !isNaN(coord.latitude) && !isNaN(coord.longitude) &&
                coord.latitude >= -90 && coord.latitude <= 90 &&
                coord.longitude >= -180 && coord.longitude <= 180
            );
            
            if (validCoordinates.length !== coordinates.length) {
                log(`  ⚠️ Filtered out ${coordinates.length - validCoordinates.length} invalid coordinates`);
            }
            
            if (validCoordinates.length === 0) {
                log(`  ⏭️ Skipping batch - no valid coordinates`);
                continue;
            }
            
            // Fetch elevation data
            const results = await fetchElevationWithRetry(validCoordinates);
            
            // Update database with meet-specific logic
            const updateResults = await updateMeetElevationData(results);
            
            totalProcessed += validCoordinates.length;
            totalUpdated += updateResults.updated;
            totalFailed += updateResults.failed;
            
            log(`  📊 Batch complete: ${updateResults.updated} updated, ${updateResults.failed} failed`);
            
            // Rate limiting between batches
            if (i + BATCH_SIZE < meets.length) {
                log(`  ⏳ Waiting ${OPEN_METEO_DELAY}ms before next batch...`);
                await sleep(OPEN_METEO_DELAY);
            }
        }
        
        // Summary
        log('\n' + '='.repeat(60));
        log('✅ MEET ELEVATION FETCH COMPLETE');
        log(`   Total meets found: ${meets.length}`);
        log(`   Total processed: ${totalProcessed}`);
        log(`   Successfully updated: ${totalUpdated}`);
        log(`   Failed: ${totalFailed}`);
        log(`   Success rate: ${totalProcessed > 0 ? ((totalUpdated / totalProcessed) * 100).toFixed(1) : 0}%`);
        log(`   Processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);
        
        return {
            total: meets.length,
            processed: totalProcessed,
            updated: totalUpdated,
            failed: totalFailed
        };
        
    } catch (error) {
        log(`\n❌ Meet elevation fetch failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        throw error;
    }
}

// Fetch elevation data for clubs table
async function fetchAndUpdateClubElevations() {
    const startTime = Date.now();
    
    try {
        log('🏋️ Starting club elevation data fetch process...');
        log('='.repeat(60));
        
        // Fetch clubs that need elevation data with pagination
        log('🔍 Fetching clubs that need elevation data...');
        let clubs = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const { data, error: fetchError } = await supabase
                .from('clubs')
                .select('club_name, latitude, longitude, elevation_meters')
                .not('latitude', 'is', null)
                .not('longitude', 'is', null)
                .is('elevation_meters', null)
                .range(page * pageSize, (page + 1) * pageSize - 1);
            
            if (fetchError) {
                throw new Error(`Failed to fetch clubs: ${fetchError.message}`);
            }
            
            if (data && data.length > 0) {
                clubs = clubs.concat(data);
                hasMore = data.length === pageSize;
                page++;
                log(`📄 Fetched page ${page}, total clubs so far: ${clubs.length}`);
            } else {
                hasMore = false;
            }
        }
        
        if (!clubs || clubs.length === 0) {
            log('✅ No clubs found that need elevation data');
            return { total: 0, processed: 0, updated: 0, failed: 0 };
        }
        
        log(`📊 Found ${clubs.length} clubs needing elevation data`);
        
        let totalProcessed = 0;
        let totalUpdated = 0;
        let totalFailed = 0;
        
        // Process clubs in batches
        for (let i = 0; i < clubs.length; i += BATCH_SIZE) {
            const batch = clubs.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(clubs.length / BATCH_SIZE);
            
            log(`\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} clubs)`);
            
            // Prepare coordinates for API call
            const coordinates = batch.map(club => ({
                id: club.club_name, // Use club_name as identifier for clubs
                latitude: parseFloat(club.latitude),
                longitude: parseFloat(club.longitude),
                club_name: club.club_name
            }));
            
            // Validate coordinates
            const validCoordinates = coordinates.filter(coord => 
                !isNaN(coord.latitude) && !isNaN(coord.longitude) &&
                coord.latitude >= -90 && coord.latitude <= 90 &&
                coord.longitude >= -180 && coord.longitude <= 180
            );
            
            if (validCoordinates.length !== coordinates.length) {
                log(`  ⚠️ Filtered out ${coordinates.length - validCoordinates.length} invalid coordinates`);
            }
            
            if (validCoordinates.length === 0) {
                log(`  ⏭️ Skipping batch - no valid coordinates`);
                continue;
            }
            
            // Fetch elevation data
            const results = await fetchElevationWithRetry(validCoordinates);
            
            // Update database with club-specific logic
            const updateResults = await updateClubElevationData(results);
            
            totalProcessed += validCoordinates.length;
            totalUpdated += updateResults.updated;
            totalFailed += updateResults.failed;
            
            log(`  📊 Batch complete: ${updateResults.updated} updated, ${updateResults.failed} failed`);
            
            // Rate limiting between batches
            if (i + BATCH_SIZE < clubs.length) {
                log(`  ⏳ Waiting ${OPEN_METEO_DELAY}ms before next batch...`);
                await sleep(OPEN_METEO_DELAY);
            }
        }
        
        // Summary
        log('\n' + '='.repeat(60));
        log('✅ CLUB ELEVATION FETCH COMPLETE');
        log(`   Total clubs found: ${clubs.length}`);
        log(`   Total processed: ${totalProcessed}`);
        log(`   Successfully updated: ${totalUpdated}`);
        log(`   Failed: ${totalFailed}`);
        log(`   Success rate: ${totalProcessed > 0 ? ((totalUpdated / totalProcessed) * 100).toFixed(1) : 0}%`);
        log(`   Processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);
        
        return {
            total: clubs.length,
            processed: totalProcessed,
            updated: totalUpdated,
            failed: totalFailed
        };
        
    } catch (error) {
        log(`\n❌ Club elevation fetch failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        throw error;
    }
}

// Update clubs table with elevation data
async function updateClubElevationData(results) {
    log(`  📤 Updating ${results.length} club records with elevation data...`);
    
    const updates = results.map(result => ({
        club_name: result.id, // For clubs, id is the club_name
        elevation_meters: result.elevation,
        elevation_source: result.source,
        elevation_fetched_at: new Date().toISOString(),
        error: result.error || null
    }));
    
    let updated = 0;
    let failed = 0;
    
    // Update records individually to handle errors gracefully
    for (const update of updates) {
        try {
            if (update.elevation_meters !== null) {
                // Successful elevation fetch
                const { error } = await supabase
                    .from('clubs')
                    .update({
                        elevation_meters: update.elevation_meters,
                        elevation_source: update.elevation_source,
                        elevation_fetched_at: update.elevation_fetched_at
                    })
                    .eq('club_name', update.club_name);
                
                if (error) {
                    throw new Error(error.message);
                }
                updated++;
            } else {
                // Failed elevation fetch - still update the timestamp to avoid retrying immediately
                const { error } = await supabase
                    .from('clubs')
                    .update({
                        elevation_fetched_at: update.elevation_fetched_at
                    })
                    .eq('club_name', update.club_name);
                
                if (error) {
                    throw new Error(error.message);
                }
                failed++;
            }
        } catch (error) {
            log(`    ❌ Failed to update club ${update.club_name}: ${error.message}`);
            failed++;
        }
    }
    
    return { updated, failed };
}

// Main elevation fetching function
async function fetchAndUpdateElevations() {
    const startTime = Date.now();
    
    try {
        log('🗻 Starting elevation data fetch process...');
        log('='.repeat(60));
        
        // Check if elevation columns exist, add them if they don't
        log('🔧 Checking database schema...');
        
        // Fetch records that need elevation data with pagination
        log('🔍 Fetching records that need elevation data...');
        let records = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const { data, error: fetchError, count } = await supabase
                .from('meet_locations')
                .select('id, meet_name, latitude, longitude, elevation_meters', { count: 'exact' })
                .not('latitude', 'is', null)
                .not('longitude', 'is', null)
                .is('elevation_meters', null)
                .range(page * pageSize, (page + 1) * pageSize - 1);
            
            if (fetchError) {
                throw new Error(`Failed to fetch records: ${fetchError.message}`);
            }
            
            if (data && data.length > 0) {
                records = records.concat(data);
                hasMore = data.length === pageSize;
                page++;
                log(`📄 Fetched page ${page}, total so far: ${records.length}`);
            } else {
                hasMore = false;
            }
        }
        
        if (!records || records.length === 0) {
            log('✅ No records found that need elevation data');
            return { total: 0, processed: 0, updated: 0, failed: 0 };
        }
        
        log(`📊 Found ${records.length} records needing elevation data`);
        
        let totalProcessed = 0;
        let totalUpdated = 0;
        let totalFailed = 0;
        
        // Process records in batches
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
            const batch = records.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(records.length / BATCH_SIZE);
            
            log(`\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)`);
            
            // Prepare coordinates for API call
            const coordinates = batch.map(record => ({
                id: record.id,
                latitude: parseFloat(record.latitude),
                longitude: parseFloat(record.longitude),
                meet_name: record.meet_name
            }));
            
            // Validate coordinates
            const validCoordinates = coordinates.filter(coord => 
                !isNaN(coord.latitude) && !isNaN(coord.longitude) &&
                coord.latitude >= -90 && coord.latitude <= 90 &&
                coord.longitude >= -180 && coord.longitude <= 180
            );
            
            if (validCoordinates.length !== coordinates.length) {
                log(`  ⚠️ Filtered out ${coordinates.length - validCoordinates.length} invalid coordinates`);
            }
            
            if (validCoordinates.length === 0) {
                log(`  ⏭️ Skipping batch - no valid coordinates`);
                continue;
            }
            
            // Fetch elevation data
            const results = await fetchElevationWithRetry(validCoordinates);
            
            // Update database
            const updateResults = await updateElevationData(results);
            
            totalProcessed += validCoordinates.length;
            totalUpdated += updateResults.updated;
            totalFailed += updateResults.failed;
            
            log(`  📊 Batch complete: ${updateResults.updated} updated, ${updateResults.failed} failed`);
            
            // Rate limiting between batches
            if (i + BATCH_SIZE < records.length) {
                log(`  ⏳ Waiting ${OPEN_METEO_DELAY}ms before next batch...`);
                await sleep(OPEN_METEO_DELAY);
            }
        }
        
        // Summary
        log('\n' + '='.repeat(60));
        log('✅ ELEVATION FETCH COMPLETE');
        log(`   Total records found: ${records.length}`);
        log(`   Total processed: ${totalProcessed}`);
        log(`   Successfully updated: ${totalUpdated}`);
        log(`   Failed: ${totalFailed}`);
        log(`   Success rate: ${totalProcessed > 0 ? ((totalUpdated / totalProcessed) * 100).toFixed(1) : 0}%`);
        log(`   Processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);
        
        return {
            total: records.length,
            processed: totalProcessed,
            updated: totalUpdated,
            failed: totalFailed
        };
        
    } catch (error) {
        log(`\n❌ Process failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        throw error;
    }
}

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        target: 'all' // Default to processing all tables
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--meets':
                options.target = 'meets';
                break;
            case '--clubs':
                options.target = 'clubs';
                break;
            case '--meet-locations':
                options.target = 'meet-locations';
                break;
            case '--all':
                options.target = 'all';
                break;
            case '--help':
                console.log(`
Usage: node elevation-fetcher.js [options]

Options:
  --meets           Process only meets table elevation data
  --clubs           Process only clubs table elevation data  
  --meet-locations  Process only meet_locations table elevation data (legacy)
  --all             Process all tables (default)
  --help            Show this help message

Examples:
  node elevation-fetcher.js                # Process all tables
  node elevation-fetcher.js --meets        # Process only meets table
  node elevation-fetcher.js --clubs        # Process only clubs table
`);
                process.exit(0);
                break;
        }
    }
    
    return options;
}

// Run if called directly
if (require.main === module) {
    async function runElevationFetch() {
        try {
            const options = parseArguments();
            
            log('🏔️ Starting elevation data fetch process...');
            log(`Target: ${options.target}`);
            log('='.repeat(60));
            
            const results = {};
            
            if (options.target === 'all' || options.target === 'clubs') {
                log('\n📍 PROCESSING: Barbell clubs...');
                results.clubs = await fetchAndUpdateClubElevations();
            }
            
            if (options.target === 'all' || options.target === 'meets') {
                log('\n📍 PROCESSING: Meet locations (meets table)...');
                results.meets = await fetchAndUpdateMeetElevations();
            }
            
            if (options.target === 'all' || options.target === 'meet-locations') {
                log('\n📍 PROCESSING: Meet locations (legacy meet_locations table)...');
                results.meetLocations = await fetchAndUpdateElevations();
            }
            
            // Summary
            log('\n' + '='.repeat(60));
            log('🎉 ELEVATION FETCH COMPLETE');
            
            if (results.clubs) {
                log('\n📊 CLUBS SUMMARY:');
                log(`   Total clubs: ${results.clubs.total}`);
                log(`   Successfully updated: ${results.clubs.updated}`);
                log(`   Failed: ${results.clubs.failed}`);
                log(`   Success rate: ${results.clubs.total > 0 ? ((results.clubs.updated / results.clubs.total) * 100).toFixed(1) : 0}%`);
            }
            
            if (results.meets) {
                log('\n📊 MEETS SUMMARY:');
                log(`   Total meets: ${results.meets.total}`);
                log(`   Successfully updated: ${results.meets.updated}`);
                log(`   Failed: ${results.meets.failed}`);
                log(`   Success rate: ${results.meets.total > 0 ? ((results.meets.updated / results.meets.total) * 100).toFixed(1) : 0}%`);
            }
            
            if (results.meetLocations) {
                log('\n📊 MEET LOCATIONS (LEGACY) SUMMARY:');
                log(`   Total locations: ${results.meetLocations.total}`);
                log(`   Successfully updated: ${results.meetLocations.updated}`);
                log(`   Failed: ${results.meetLocations.failed}`);
                log(`   Success rate: ${results.meetLocations.total > 0 ? ((results.meetLocations.updated / results.meetLocations.total) * 100).toFixed(1) : 0}%`);
            }
            
            log('\n🎉 All elevation data processing completed successfully!');
            process.exit(0);
            
        } catch (error) {
            log(`\n💥 Elevation fetch process failed: ${error.message}`);
            log(`🔍 Stack trace: ${error.stack}`);
            process.exit(1);
        }
    }
    
    runElevationFetch();
}

module.exports = { 
    fetchAndUpdateElevations, 
    fetchAndUpdateClubElevations, 
    fetchAndUpdateMeetElevations 
};