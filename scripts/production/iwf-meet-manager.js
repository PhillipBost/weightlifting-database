/**
 * IWF Meet Manager Module
 *
 * Manages International Weightlifting Federation (IWF) competition and location records.
 * Handles upserting meet metadata and venue information.
 *
 * Key Features:
 * - Meet record upsert (insert or update based on event_id)
 * - Location record upsert (1:1 relationship with meets)
 * - Meet metadata extraction from event discovery data
 * - Existence checking and conflict resolution
 *
 * @module iwf-meet-manager
 */

const config = require('./iwf-config');
const fs = require('fs');
const path = require('path');

// ============================================================================
// MEET FUNCTIONS
// ============================================================================

/**
 * Find existing meet by event ID
 *
 * @param {string} eventId - IWF event ID
 * @returns {Object|null} - Meet record or null if not found
 */
async function findExistingMeet(eventId) {
    if (!eventId) {
        return null;
    }

    try {
        // Query by iwf_meet_id (which stores the IWF event ID)
        let { data, error } = await config.supabaseIWF
            .from('iwf_meets')
            .select('*')
            .eq('iwf_meet_id', eventId.toString())
            .maybeSingle();

        if (error) {
            console.warn(`Warning querying iwf_meets: ${error.message}`);
            return null;
        }

        return data;

    } catch (error) {
        console.warn(`Error in findExistingMeet: ${error.message}`);
        return null;
    }
}

/**
 * Check if meet has existing results
 *
 * @param {number} meetId - IWF meet ID
 * @returns {Object} - { hasResults: boolean, count: number }
 */
async function checkMeetHasResults(meetId) {
    if (!meetId) {
        return { hasResults: false, count: 0 };
    }

    try {
        const { count, error } = await config.supabaseIWF
            .from('iwf_meet_results')
            .select('*', { count: 'exact', head: true })
            .eq('iwf_meet_id', meetId);

        if (error) {
            console.error(`Error checking meet results: ${error.message}`);
            return { hasResults: false, count: 0 };
        }

        return {
            hasResults: count > 0,
            count: count || 0
        };

    } catch (error) {
        console.error(`Error in checkMeetHasResults: ${error.message}`);
        return { hasResults: false, count: 0 };
    }
}

/**
 * Upsert meet record (insert or update based on event_id unique constraint)
 *
 * @param {Object} meetData - Meet metadata
 * @param {string} meetData.event_id - IWF event ID (required, unique)
 * @param {string} meetData.Meet - Meet name
 * @param {string} meetData.Level - Competition level
 * @param {string} meetData.Date - Competition date or date range
 * @param {string} [meetData.Results] - Results availability status
 * @param {string} [meetData.URL] - Event URL
 * @param {string} [meetData.location_city] - Host city
 * @param {string} [meetData.location_country] - Host country
 * @param {string} [meetData.batch_id] - Processing batch identifier
 * @returns {Object} - { db_meet_id, event_id, isNew }
 */
async function upsertIWFMeet(meetData) {
    if (!meetData || !meetData.event_id) {
        throw new Error('Meet data with event_id is required');
    }

    const insertData = {
        iwf_meet_id: meetData.event_id.toString(),
        meet: meetData.Meet || meetData.meet || null,
        level: meetData.Level || meetData.level || null,
        date: meetData.Date || meetData.date || null,
        results: null,
        url: meetData.URL || meetData.url || null,
        batch_id: meetData.batch_id || null,
        scraped_date: meetData.scraped_date || new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    try {
        // Check if meet exists first
        const existingMeet = await findExistingMeet(meetData.event_id);
        const isNew = !existingMeet;

        // Upsert: insert new or update existing based on event_id unique constraint
        const { error } = await config.supabaseIWF
            .from('iwf_meets')
            .upsert(insertData, {
                onConflict: 'iwf_meet_id',
                ignoreDuplicates: false
            });

        // Fetch back the created/updated record
        const { data: upsertedMeet } = await config.supabaseIWF
            .from('iwf_meets')
            .select('*')
            .eq('iwf_meet_id', meetData.event_id.toString())
            .maybeSingle();

        if (error) {
            throw new Error(`Error upserting meet: ${error.message}`);
        }

        const meetId = upsertedMeet.iwf_meet_id;

        if (!meetId) {
            throw new Error(`Database returned meet but no iwf_meet_id: ${JSON.stringify(upsertedMeet)}`);
        }

        if (isNew) {
            console.log(`  ➕ Created new meet: ${upsertedMeet.meet} (ID: ${meetId})`);
        } else {
            console.log(`  🔄 Updated existing meet: ${upsertedMeet.meet} (ID: ${meetId})`);
        }

        return {
            db_meet_id: meetId,                     // Database PK (iwf_meet_id in current schema)
            iwf_meet_id: upsertedMeet.iwf_meet_id,  // Event ID (stored in iwf_meet_id column)
            Meet: upsertedMeet.meet,
            Date: upsertedMeet.date,
            Level: upsertedMeet.level,
            isNew: isNew
        };

    } catch (error) {
        console.error(`Error in upsertIWFMeet: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// LOCATION FUNCTIONS
// ============================================================================

/**
 * Find existing location for meet
 *
 * @param {number} meetId - IWF meet ID
 * @returns {Object|null} - Location record or null if not found
 */
async function findExistingLocation(meetId) {
    if (!meetId) {
        return null;
    }

    try {
        const { data, error } = await config.supabaseIWF
            .from('iwf_meet_locations')
            .select('*')
            .eq('iwf_meet_id', meetId.toString())
            .maybeSingle();

        if (error) {
            console.error(`Error finding location: ${error.message}`);
            return null;
        }

        return data;

    } catch (error) {
        console.error(`Error in findExistingLocation: ${error.message}`);
        return null;
    }
}

/**
 * Upsert meet location record (1:1 relationship with meet)
 *
 * @param {number} meetId - IWF meet ID (foreign key)
 * @param {Object} locationData - Location metadata
 * @param {string} [locationData.address] - Full venue address
 * @param {string} [locationData.location_text] - Formatted location string
 * @param {string} [locationData.date_range] - Date range formatted
 * @param {number} [locationData.latitude] - Geographic latitude
 * @param {number} [locationData.longitude] - Geographic longitude
 * @param {string} [locationData.country] - Country name
 * @param {string} [locationData.city] - City name
 * @param {string} [locationData.venue_name] - Venue/facility name
 * @returns {Object} - { iwf_location_id, db_meet_id, isNew }
 */
async function upsertIWFMeetLocation(meetId, locationData = {}, shouldGeocode = true) {
    if (!meetId) {
        throw new Error('Meet ID is required to upsert location');
    }

    // Geocode if we have city/country and coordinates not provided
    if (shouldGeocode && locationData.city && locationData.country && !locationData.latitude) {
        const coords = await geocodeLocation(locationData.city, locationData.country);
        locationData.latitude = coords.latitude;
        locationData.longitude = coords.longitude;
    }

    // Check if location already exists
    const existingLocation = await findExistingLocation(meetId);
    const isNew = !existingLocation;

    const insertData = {
        iwf_meet_id: meetId.toString(),
        address: locationData.address || null,
        location_text: locationData.location_text || null,
        date_range: locationData.date_range || null,
        latitude: locationData.latitude || null,
        longitude: locationData.longitude || null,
        country: locationData.country || null,
        city: locationData.city || null,
        venue_name: locationData.venue_name || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    try {
        // Upsert: insert new or update existing based on iwf_meet_id unique constraint
        const { data: upsertedLocation, error } = await config.supabaseIWF
            .from('iwf_meet_locations')
            .upsert(insertData, {
                onConflict: 'iwf_meet_id',
                ignoreDuplicates: false
            })
            .select('db_location_id, iwf_meet_id, city, country, venue_name')
            .single();

        if (error) {
            throw new Error(`Error upserting location: ${error.message}`);
        }

        if (isNew) {
            console.log(`  ➕ Created location for meet ${meetId}: ${upsertedLocation.city || 'Unknown'}, ${upsertedLocation.country || 'Unknown'}`);
        } else {
            console.log(`  🔄 Updated location for meet ${meetId}`);
        }

        return {
            db_location_id: upsertedLocation.db_location_id,
            iwf_meet_id: upsertedLocation.iwf_meet_id,
            isNew: isNew
        };

    } catch (error) {
        console.error(`Error in upsertIWFMeetLocation: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// METADATA EXTRACTION
// ============================================================================

/**
 * Extract meet metadata from event discovery JSON data
 * Reads from output/iwf_events_YYYY.json files
 *
 * @param {string} eventId - IWF event ID
 * @param {number} year - Event year
 * @returns {Object|null} - Meet metadata or null if not found
 */
function extractMeetMetadata(eventId, year) {
    if (!eventId || !year) {
        return null;
    }

    try {
        const eventsFilePath = path.join(config.LOGGING.OUTPUT_DIR, `iwf_events_${year}.json`);

        if (!fs.existsSync(eventsFilePath)) {
            console.warn(`  ⚠️ Events file not found: ${eventsFilePath}`);
            return null;
        }

        const fileContent = fs.readFileSync(eventsFilePath, 'utf8');
        const eventsData = JSON.parse(fileContent);

        // Ensure events data has valid structure
        if (!eventsData.events || !Array.isArray(eventsData.events)) {
            console.warn(`  ⚠️ Events file contains invalid data (missing or invalid events array)`);
            return null;
        }

        // Find event in the events data
        const event = eventsData.events.find(e => e.event_id === eventId.toString());

        if (!event) {
            console.warn(`  ⚠️ Event ${eventId} not found in ${eventsFilePath}`);
            return null;
        }

        // Map event discovery data to meet schema
        return {
            event_id: event.event_id,
            Meet: event.event_name,
            Level: event.Level || 'International',
            Date: event.date,
            URL: event.url,
            endpoint: event.endpoint || null,
            location_city: event.location_city || null,
            location_country: event.location_country || null,
            batch_id: `event_discovery_${year}`,
            scraped_date: new Date().toISOString()
        };

    } catch (error) {
        console.error(`Error extracting meet metadata: ${error.message}`);
        return null;
    }
}

/**
 * Parse location data from meet metadata
 * Extracts city, country, and other location fields
 *
 * @param {Object} meetData - Meet metadata
 * @returns {Object} - Location data
 */
function parseLocationData(meetData) {
    if (!meetData) {
        return {};
    }

    // Import country mapping from iwf-lifter-manager
    const { mapCountryCodeToName } = require('./iwf-lifter-manager');
    
    // Convert country code to full name
    const countryName = meetData.location_country 
        ? mapCountryCodeToName(meetData.location_country) || meetData.location_country
        : null;

    return {
        city: meetData.location_city || null,
        country: countryName,
        location_text: meetData.location_city && countryName
            ? `${meetData.location_city}, ${countryName}`
            : null,
        date_range: meetData.Date || null,
        latitude: null,
        longitude: null,
        venue_name: null
    };
}

// ============================================================================
// GEOCODING FUNCTIONS
// ============================================================================

/**
 * Geocode location using Nominatim API
 * Respects 1-second rate limit per Nominatim usage policy
 * 
 * @param {string} city - City name
 * @param {string} country - Full country name
 * @returns {Promise<Object>} - { latitude, longitude } or { latitude: null, longitude: null }
 */
async function geocodeLocation(city, country) {
    if (!city || !country) {
        return { latitude: null, longitude: null };
    }

    const query = `${city}, ${country}`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;

    try {
        // Rate limiting: 1 request per second per Nominatim usage policy
        await new Promise(resolve => setTimeout(resolve, 1000));

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'IWF-Database-Geocoder/1.0'
            }
        });

        if (!response.ok) {
            console.warn(`  ⚠️  Geocoding failed for "${query}": HTTP ${response.status}`);
            return { latitude: null, longitude: null };
        }

        const results = await response.json();

        if (results && results.length > 0) {
            const lat = parseFloat(results[0].lat);
            const lon = parseFloat(results[0].lon);
            console.log(`  ✓ Geocoded "${query}": ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
            return { latitude: lat, longitude: lon };
        } else {
            console.warn(`  ⚠️  No geocoding results for "${query}"`);
            return { latitude: null, longitude: null };
        }
    } catch (error) {
        console.warn(`  ⚠️  Geocoding error for "${query}": ${error.message}`);
        return { latitude: null, longitude: null };
    }
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

/**
 * Batch upsert multiple meets
 * Optimized for processing large datasets
 *
 * @param {Array<Object>} meetsData - Array of meet metadata objects
 * @returns {Object} - { results, errors, totalNew, totalUpdated }
 */
async function batchUpsertMeets(meetsData) {
    const results = [];
    const errors = [];

    for (let i = 0; i < meetsData.length; i++) {
        const meetData = meetsData[i];

        try {
            const meet = await upsertIWFMeet(meetData);

            // Also upsert location if we have location data
            if (meetData.location_city || meetData.location_country) {
                const locationData = parseLocationData(meetData);
                await upsertIWFMeetLocation(meet.iwf_meet_id, locationData);
            }

            results.push({
                meetData: meetData,
                meet: meet,
                success: true
            });

        } catch (error) {
            console.error(`  ❌ Error processing meet ${meetData.event_id}: ${error.message}`);
            errors.push({
                meetData: meetData,
                error: error.message
            });

            results.push({
                meetData: meetData,
                meet: null,
                success: false,
                error: error.message
            });
        }

        // Small delay to avoid overwhelming database
        if (i < meetsData.length - 1 && i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return {
        results: results,
        errors: errors,
        totalProcessed: results.length,
        totalErrors: errors.length,
        totalNew: results.filter(r => r.meet?.isNew).length,
        totalUpdated: results.filter(r => r.meet && !r.meet.isNew).length
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Main functions
    upsertIWFMeet,
    upsertIWFMeetLocation,
    findExistingMeet,
    checkMeetHasResults,

    // Metadata functions
    extractMeetMetadata,
    parseLocationData,

    // Geocoding functions
    geocodeLocation,

    // Batch functions
    batchUpsertMeets,

    // Utility functions (exported for testing)
    findExistingLocation
};
