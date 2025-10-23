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
        const { data, error} = await config.supabaseIWF
            .from('iwf_meets')
            .select('db_meet_id, event_id, meet, date, level, url')
            .eq('event_id', eventId.toString())
            .maybeSingle();

        if (error) {
            console.error(`Error finding meet: ${error.message}`);
            return null;
        }

        return data;

    } catch (error) {
        console.error(`Error in findExistingMeet: ${error.message}`);
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
            .eq('db_meet_id', meetId);

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
        event_id: meetData.event_id.toString(),
        meet: meetData.Meet || meetData.meet || null,
        level: meetData.Level || meetData.level || null,
        date: meetData.Date || meetData.date || null,
        results: meetData.Results || meetData.results || 'Available',
        url: meetData.URL || meetData.url || null,
        location_city: meetData.location_city || null,
        location_country: meetData.location_country || null,
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
        const { data: upsertedMeet, error } = await config.supabaseIWF
            .from('iwf_meets')
            .upsert(insertData, {
                onConflict: 'event_id',
                ignoreDuplicates: false
            })
            .select('db_meet_id, event_id, meet, date, level')
            .single();

        if (error) {
            throw new Error(`Error upserting meet: ${error.message}`);
        }

        if (isNew) {
            console.log(`  ➕ Created new meet: ${upsertedMeet.meet} (ID: ${upsertedMeet.db_meet_id})`);
        } else {
            console.log(`  🔄 Updated existing meet: ${upsertedMeet.meet} (ID: ${upsertedMeet.db_meet_id})`);
        }

        return {
            db_meet_id: upsertedMeet.db_meet_id,
            event_id: upsertedMeet.event_id,
            Meet: upsertedMeet.meet,  // Return as Meet for backward compatibility
            Date: upsertedMeet.date,  // Return as Date for backward compatibility
            Level: upsertedMeet.level, // Return as Level for backward compatibility
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
            .eq('iwf_meet_id', meetId)
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
async function upsertIWFMeetLocation(meetId, locationData = {}) {
    if (!meetId) {
        throw new Error('Meet ID is required to upsert location');
    }

    // Check if location already exists
    const existingLocation = await findExistingLocation(meetId);
    const isNew = !existingLocation;

    const insertData = {
        iwf_meet_id: meetId,
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
            .select('iwf_location_id, iwf_meet_id, city, country, venue_name')
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
            iwf_location_id: upsertedLocation.iwf_location_id,
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

        // Ensure events data is an array
        if (!Array.isArray(eventsData)) {
            console.warn(`  ⚠️ Events file contains invalid data (not an array)`);
            return null;
        }

        // Find event in the events data
        const event = eventsData.find(e => e.event_id === eventId.toString());

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
            Results: 'Available',
            URL: event.url,
            location_city: event.city,
            location_country: event.country,
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

    return {
        city: meetData.location_city || null,
        country: meetData.location_country || null,
        location_text: meetData.location_city && meetData.location_country
            ? `${meetData.location_city}, ${meetData.location_country}`
            : null,
        date_range: meetData.Date || null,
        // Coordinates and venue_name typically not available from event discovery
        // Can be added later via geocoding or manual enrichment
        latitude: null,
        longitude: null,
        venue_name: null
    };
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
                await upsertIWFMeetLocation(meet.db_meet_id, locationData);
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

    // Batch functions
    batchUpsertMeets,

    // Utility functions (exported for testing)
    findExistingLocation
};
