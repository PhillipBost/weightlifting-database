/**
 * GEOCODE AND IMPORT MEET ADDRESSES
 * 
 * Reads meet_addresses.json, geocodes addresses using Nominatim, 
 * and imports to Supabase with coordinates
 * 
 * Usage: node geocode-and-import.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { assignWSOGeography } = require('./wso-assignment-engine');
const { validateWSOAssignment, preventContamination } = require('./wso-validation-engine');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

// Configuration
const LOG_FILE = './logs/geocode-import.log';
const NOMINATIM_DELAY = 1100; // 1.1 seconds between requests (Nominatim rate limit)

// Logging utility
function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    console.log(message);
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Parse address into components (improved intelligent parsing)
function parseAddress(rawAddress) {
    // Import the intelligent parsing function
    const { parseAddressIntelligently } = require('./fix-address-parsing');

    // Use the new intelligent parsing algorithm
    const parsed = parseAddressIntelligently(rawAddress);

    // Return in the expected format for compatibility
    return {
        address: rawAddress,
        street_address: parsed.street_address,
        city: parsed.city,
        state: parsed.state,
        zip_code: parsed.zip_code,
        country: parsed.country
    };
}

// Remove suite/apartment information from address (improved to handle more patterns)
function removeSuiteInfo(address) {
    if (!address || typeof address !== 'string') return address;

    return address
        // Handle suite/unit info - match until comma or end, not including commas in the match
        .replace(/ (suite|ste|apt|apartment|unit|building|bldg|floor|fl|room|rm|#) [a-z0-9\-]+/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/,\s*,/g, ',')
        .replace(/^,\s*|,\s*$/g, '')
        .trim();
}

// International event keywords for early detection
const INTERNATIONAL_KEYWORDS = [
    'world', 'olympic', 'pan am', 'panamerican', 'international',
    'commonwealth', 'asian games', 'european', 'continental',
    'ihf', 'iwf', 'rio', 'tokyo', 'beijing', 'athens', 'sydney'
];

// Known placeholder/default coordinates to flag
const PLACEHOLDER_COORDINATES = [
    { lat: 39.78, lng: -100.45, name: 'US Geographic Center (Kansas)' },
    { lat: 39.83, lng: -98.58, name: 'US Geographic Center (alternate)' },
    { lat: 33.66, lng: -117.87, name: 'Orange County CA Default' },
    { lat: 37.09, lng: -95.71, name: 'US Center Point' },
    { lat: 39.50, lng: -98.35, name: 'Lebanon KS (Geographic Center)' },
];

// Check if coordinates are placeholder/default values
function isPlaceholderCoordinate(lat, lng) {
    const tolerance = 0.05;
    for (const placeholder of PLACEHOLDER_COORDINATES) {
        if (Math.abs(lat - placeholder.lat) < tolerance &&
            Math.abs(lng - placeholder.lng) < tolerance) {
            return { isPlaceholder: true, name: placeholder.name };
        }
    }
    return { isPlaceholder: false, name: null };
}

// Check if meet is likely an international event
function isInternationalEvent(meetName) {
    if (!meetName) return false;
    const meetNameLower = meetName.toLowerCase();
    return INTERNATIONAL_KEYWORDS.some(keyword => meetNameLower.includes(keyword));
}

// Extract state from geocoding result
function extractStateFromGeocode(result) {
    if (!result || !result.address) return null;

    // Try to extract state from address details
    const addr = result.address;

    // Check various fields where state might appear
    if (addr.state) return addr.state;
    if (addr.state_district) return addr.state_district;

    // Parse from display_name as fallback
    if (result.display_name) {
        const parts = result.display_name.split(',').map(p => p.trim());
        // State is typically the 3rd from last
        if (parts.length >= 3) {
            const statePart = parts[parts.length - 3];
            // Remove ZIP if present
            const stateMatch = statePart.match(/^([A-Za-z ]+)/);
            if (stateMatch) return stateMatch[1].trim();
        }
    }

    return null;
}

// Geocode address using Nominatim with fallback strategies
async function geocodeAddress(rawAddress) {
    // Helper function to remove country variations
    function removeCountry(addr) {
        return addr
            .replace(/,?\s*(United States of America|United States|USA|US)\s*,?/gi, '')
            .replace(/,\s*,/g, ',')  // Fix double commas
            .replace(/^,\s*|,\s*$/g, '')  // Remove leading/trailing commas
            .trim();
    }

    // Helper function to remove street number (keep street name)
    function removeStreetNumber(addr) {
        return addr.replace(/^\d+\s+/, '').trim();
    }

    // Clean base address first
    const cleanBaseAddress = removeCountry(rawAddress);
    const addressWithoutSuite = removeSuiteInfo(cleanBaseAddress);
    const useSuiteVariants = addressWithoutSuite !== cleanBaseAddress;

    let addressVariants = [
        rawAddress, // Original full address
        cleanBaseAddress, // Remove country variations
    ];

    // Add suite-removed variants early in the process if suite info was detected
    if (useSuiteVariants) {
        addressVariants.push(
            addressWithoutSuite, // Suite removed from clean address
        );
    }

    // Add street name without number variant
    const fallbackBase = useSuiteVariants ? addressWithoutSuite : cleanBaseAddress;
    const streetNameOnly = removeStreetNumber(fallbackBase);
    if (streetNameOnly !== fallbackBase && streetNameOnly.length > 10) {
        addressVariants.push(streetNameOnly);
    }

    // Add broader fallbacks at the end - use the CLEANEST address for fallbacks
    const cityStateFallback = fallbackBase.split(',').slice(-3).join(',').trim();
    const stateZipFallback = fallbackBase.split(',').slice(-2).join(',').trim();

    // Also add city, state (without ZIP) as a very reliable fallback
    const parts = fallbackBase.split(',').map(p => p.trim());
    let cityStatOnly = '';
    let zipOnly = '';
    let stateOnly = '';

    if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];

        // Extract ZIP code from last part (5+ digits to handle malformed ZIPs like 352332519)
        const zipMatch = lastPart.match(/\b(\d{5,}(?:-\d{4})?)\b/);
        if (zipMatch) {
            zipOnly = zipMatch[1];
        }

        // Extract state from last part (everything before ZIP if present)
        let state = lastPart;
        if (zipMatch) {
            state = lastPart.replace(zipMatch[0], '').trim();
        }

        // If state is empty/invalid after ZIP removal, use second-to-last part as state
        if (!state || state.length <= 1 || /^\d+$/.test(state)) {
            if (parts.length >= 2) {
                state = parts[parts.length - 2];
            }
        }

        if (state && state.length > 1) {
            stateOnly = state;

            // Get city: if we used second-to-last as state, city is third-to-last
            // Otherwise city is second-to-last
            const cityIndex = (state === parts[parts.length - 2]) ? parts.length - 3 : parts.length - 2;

            if (cityIndex >= 0 && parts[cityIndex]) {
                const city = parts[cityIndex];
                if (city) {
                    cityStatOnly = `${city}, ${state}`;
                }
            }
        }
    }

    addressVariants.push(cityStateFallback);
    addressVariants.push(stateZipFallback);
    if (cityStatOnly) {
        addressVariants.push(cityStatOnly);
    }

    // Debug: Show what we extracted
    console.log(`  🔍 DEBUG: Extracted from address - City: "${parts[parts.length - 3]}", State: "${parts[parts.length - 2]}", Last: "${parts[parts.length - 1]}"`);
    console.log(`  🔍 DEBUG: cityStatOnly="${cityStatOnly}", zipOnly="${zipOnly}", stateOnly="${stateOnly}"`);

    // Add ZIP-only as fallback
    if (zipOnly) {
        addressVariants.push(zipOnly);
    }
    // Add state-only as final fallback (handles misspelled cities)
    if (stateOnly) {
        addressVariants.push(stateOnly);
    }

    // Filter out empty/too short addresses and remove duplicates
    addressVariants = [...new Set(addressVariants.filter(addr => addr && addr.length > 2))];

    // DEBUG: Log all variants being tried
    if (addressVariants.length > 0) {
        log(`  📋 Will try ${addressVariants.length} address variants:`);
        addressVariants.forEach((v, idx) => log(`     ${idx + 1}. "${v}"`));
    }

    for (let i = 0; i < addressVariants.length; i++) {
        const addressToTry = addressVariants[i];

        // Show if this is a suite-removed variant
        const isSuiteRemoved = useSuiteVariants && addressToTry === addressWithoutSuite;
        const isStreetNameOnly = addressToTry === streetNameOnly;
        let variantLabel = `Attempt ${i + 1}`;
        if (isSuiteRemoved) variantLabel = `Attempt ${i + 1} (suite removed)`;
        if (isStreetNameOnly) variantLabel = `Attempt ${i + 1} (street name only)`;

        try {
            log(`  🌐 ${variantLabel}: ${addressToTry.substring(0, 60)}...`);

            // Debug: show full address for first few
            if (i === 0) {
                log(`  🔍 DEBUG Full address: "${addressToTry}"`);
            }

            const params = new URLSearchParams({
                q: addressToTry,
                format: 'json',
                limit: 1,
                countrycodes: 'us',
                addressdetails: 1
            });

            const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'WeightliftingMeetGeocoder/1.0'
                }
            });

            if (!response.ok) {
                if (response.status === 403 || response.status === 429) {
                    log(`  ⚠️ Rate limited (${response.status}), waiting longer...`);
                    await sleep(5000);
                    continue;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const results = await response.json();

            if (results && results.length > 0) {
                const result = results[0];

                if (result.lat && result.lon) {
                    const precision = calculateAddressPrecision(addressToTry, result.display_name);
                    const lat = parseFloat(result.lat);
                    const lng = parseFloat(result.lon);

                    // Extract state from geocoding result
                    const extractedState = extractStateFromGeocode(result);

                    // Check for placeholder coordinates
                    const placeholderCheck = isPlaceholderCoordinate(lat, lng);
                    if (placeholderCheck.isPlaceholder) {
                        log(`  ⚠️ WARNING: Placeholder coordinates detected (${placeholderCheck.name})`);
                    }

                    log(`  ✅ Success with ${variantLabel} (precision: ${precision})`);
                    if (extractedState) {
                        log(`  📍 State extracted: ${extractedState}`);
                    }

                    return {
                        latitude: lat,
                        longitude: lng,
                        display_name: result.display_name,
                        precision_score: precision,
                        state_extracted: extractedState,
                        state_from_address: stateOnly,
                        is_placeholder: placeholderCheck.isPlaceholder,
                        placeholder_type: placeholderCheck.name,
                        success: true,
                        attempt: i + 1
                    };
                }
            }

            log(`  📨 No results for ${variantLabel}`);

            // Small delay between attempts to be respectful to the API
            if (i < addressVariants.length - 1) {
                await sleep(500);
            }

        } catch (error) {
            log(`  ❌ Error with ${variantLabel}: ${error.message}`);
            continue; // Try next variant
        }
    }

    return { success: false, error: 'No results found for any address variant' };
}

// Sleep function for rate limiting
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch elevation data using open-meteo API
async function fetchElevation(latitude, longitude) {
    try {
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'WeightliftingMeetGeocoder/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data && data.elevation && data.elevation.length > 0) {
            const elevation = data.elevation[0];
            log(`  📏 Elevation: ${elevation}m (source: open-meteo)`);
            return {
                success: true,
                elevation: elevation,
                source: 'open-meteo'
            };
        }

        return { success: false, error: 'No elevation data returned' };

    } catch (error) {
        log(`  ⚠️ Elevation fetch failed: ${error.message}`);
        return { success: false, error: error.message, elevation: null };
    }
}

// Calculate address precision score (higher = more precise)
function calculateAddressPrecision(address, displayName) {
    if (!address && !displayName) return 0;

    let score = 0;
    const addressToScore = address || displayName || '';
    const parts = addressToScore.split(',').map(p => p.trim());

    // Street number and name present = +4
    if (parts.length > 0 && parts[0] && /\d+.*\w+/.test(parts[0])) {
        score += 4;
    }

    // City present = +2  
    if (parts.length > 1 && parts[1] && parts[1].length > 2) {
        score += 2;
    }

    // State present = +1
    if (parts.length > 2 && parts[2] && parts[2].length >= 2) {
        score += 1;
    }

    // ZIP code present = +1
    if (addressToScore.match(/\b\d{5}(-\d{4})?\b/)) {
        score += 1;
    }

    // Penalty for vague results
    if (displayName && displayName.toLowerCase().includes('united states')) {
        score -= 2;
    }

    return Math.max(0, score);
}

// Update a single meet record with geocoded data
async function updateMeetWithGeocode(meetId, geocodeData) {
    try {
        const { error } = await supabase
            .from('usaw_meets')
            .update(geocodeData)
            .eq('meet_id', meetId);

        if (error) {
            throw new Error(`Update failed for meet_id ${meetId}: ${error.message}`);
        }

        return true;
    } catch (error) {
        log(`  ❌ Database update failed for meet_id ${meetId}: ${error.message}`);
        return false;
    }
}

// Determine if a meet's geocoding should be updated based on accuracy (from club-geocoder.js)
function shouldUpdateGeocode(meet) {
    // No existing geocoding data - always update
    if (!meet.latitude || !meet.longitude || meet.geocode_success === null) {
        return { update: true, reason: 'No existing geocoding data' };
    }

    // Previous geocoding failed - always retry
    if (!meet.geocode_success) {
        return { update: true, reason: 'Previous geocoding failed, retrying' };
    }

    // Use stored precision score if available
    let existingPrecision = meet.geocode_precision_score;

    // If no stored precision score, calculate it from existing display_name and address
    if (existingPrecision === null || existingPrecision === undefined) {
        existingPrecision = calculateAddressPrecision(meet.address, meet.geocode_display_name);
        log(`   📊 Calculated existing precision: ${existingPrecision} (no stored score)`);
    } else {
        log(`   📊 Existing precision score: ${existingPrecision} (from database)`);
    }

    // High precision results (6+) - skip
    if (existingPrecision >= 6) {
        return { update: false, reason: `High precision result (${existingPrecision}), skipping` };
    }

    // Lower precision results should be re-attempted
    return { update: true, reason: `Low precision score (${existingPrecision}), attempting to improve` };
}

// Get meets from database that need geocoding (using proven pagination pattern)
async function getMeetsNeedingGeocode() {
    try {
        log('📊 Querying database for meets that need geocoding...');
        log('   Filtering: geocode_precision_score ≤ 3 or NULL');

        let allMeets = [];
        let from = 0;
        const pageSize = 100;

        while (true) {
            const { data, error } = await supabase
                .from('usaw_meets')
                .select('meet_id, Meet, address, latitude, longitude, geocode_success, geocode_precision_score, geocode_display_name, Date')
                .not('address', 'is', null)
                .neq('address', '')
                .or('geocode_precision_score.is.null,geocode_precision_score.lte.3')
                .range(from, from + pageSize - 1);

            if (error) {
                throw new Error(`Failed to fetch meets: ${error.message}`);
            }

            if (!data || data.length === 0) {
                break;
            }

            allMeets.push(...data);
            from += pageSize;

            log(`📄 Loaded ${allMeets.length} meets so far...`);

            if (data.length < pageSize) {
                break; // Last page
            }
        }

        log(`📋 Found ${allMeets.length} meets that need geocoding`);
        return allMeets;

    } catch (error) {
        log(`❌ Database query failed: ${error.message}`);
        throw error;
    }
}

// Get meets that have coordinates but missing elevation data
async function getMeetsMissingElevation() {
    try {
        log('📊 Querying database for meets missing elevation data...');
        log('   Filtering: has lat/long but elevation_meters is NULL');

        let allMeets = [];
        let from = 0;
        const pageSize = 100;

        while (true) {
            const { data, error } = await supabase
                .from('usaw_meets')
                .select('meet_id, Meet, latitude, longitude, elevation_meters')
                .not('latitude', 'is', null)
                .not('longitude', 'is', null)
                .is('elevation_meters', null)
                .range(from, from + pageSize - 1);

            if (error) {
                throw new Error(`Failed to fetch meets: ${error.message}`);
            }

            if (!data || data.length === 0) {
                break;
            }

            allMeets.push(...data);
            from += pageSize;

            log(`📄 Loaded ${allMeets.length} meets so far...`);

            if (data.length < pageSize) {
                break; // Last page
            }
        }

        log(`📋 Found ${allMeets.length} meets missing elevation`);
        return allMeets;

    } catch (error) {
        log(`❌ Database query failed: ${error.message}`);
        throw error;
    }
}

// Main import function
async function geocodeAndImport() {
    const startTime = Date.now();

    try {
        log('🌍 Starting geocoding and import process...');
        log('='.repeat(60));

        // Get meets from database that need geocoding
        const meetsNeedingGeocode = await getMeetsNeedingGeocode();

        if (meetsNeedingGeocode.length === 0) {
            log('✅ All meets with addresses already have geocoding - nothing to process');
            return { total: 0, processed: 0, success: 0, failures: 0 };
        }

        let successCount = 0;
        let failureCount = 0;
        let updatedCount = 0;
        let skipCount = 0;

        // Process each meet that needs geocoding
        for (let i = 0; i < meetsNeedingGeocode.length; i++) {
            const meet = meetsNeedingGeocode[i];
            const progress = `${i + 1}/${meetsNeedingGeocode.length}`;

            log(`
🔄 [${progress}] Processing: ${meet.Meet} (meet_id: ${meet.meet_id})`);
            log(`   Original Address: ${meet.address}`);

            // Check for international events early
            if (isInternationalEvent(meet.Meet)) {
                log(`  🌍 International event detected - skipping WSO assignment`);
                skipCount++;

                // Still geocode but don't assign WSO
                const geocodeResult = await geocodeAddress(meet.address);

                if (geocodeResult.success) {
                    // Fetch elevation
                    const elevationResult = await fetchElevation(geocodeResult.latitude, geocodeResult.longitude);

                    const updateData = {
                        latitude: geocodeResult.latitude,
                        longitude: geocodeResult.longitude,
                        state: geocodeResult.state_extracted || null,
                        geocode_display_name: geocodeResult.display_name,
                        geocode_precision_score: geocodeResult.precision_score,
                        geocode_success: true,
                        wso_geography: null, // Explicitly null for international events
                        elevation_meters: elevationResult.success ? elevationResult.elevation : null,
                        elevation_source: elevationResult.success ? elevationResult.source : null,
                        elevation_fetched_at: elevationResult.success ? new Date().toISOString() : null
                        // Note: is_international_event column not in schema yet
                    };

                    await updateMeetWithGeocode(meet.meet_id, updateData);
                    log(`  ✅ Geocoded international event (no WSO assigned)`);
                }

                await sleep(NOMINATIM_DELAY);
                continue;
            }

            // Smart update logic: check if we should update based on accuracy
            const shouldUpdate = shouldUpdateGeocode(meet);
            if (!shouldUpdate.update) {
                log(`   ⏭️ ${shouldUpdate.reason}`);
                skipCount++;
                continue;
            }

            // Parse address components
            const addressComponents = parseAddress(meet.address);

            // Geocode address
            const geocodeResult = await geocodeAddress(meet.address);

            let wsoGeography = null;
            if (geocodeResult.success) {
                successCount++;
                log(`  ✅ Geocoded: ${geocodeResult.latitude}, ${geocodeResult.longitude}`);
                log(`  📊 Precision score: ${geocodeResult.precision_score}`);

                // Determine WSO geography using sophisticated assignment logic
                try {
                    const meetData = {
                        ...meet,
                        ...addressComponents,
                        latitude: geocodeResult.latitude,
                        longitude: geocodeResult.longitude
                    };

                    const assignment = await assignWSOGeography(meetData, supabase, {
                        includeHistoricalData: true,
                        logDetails: false
                    });

                    if (assignment.assigned_wso) {
                        wsoGeography = assignment.assigned_wso;
                        log(`  🗺️ WSO Geography: ${wsoGeography} (method: ${assignment.assignment_method}, confidence: ${assignment.confidence.toFixed(2)})`);

                        // CONTAMINATION PREVENTION: Validate the WSO assignment
                        const validation = validateWSOAssignment(
                            wsoGeography,
                            geocodeResult.latitude,
                            geocodeResult.longitude
                        );

                        if (!validation.isValid) {
                            log(`  🚨 CONTAMINATION PREVENTED: ${validation.reason}`);
                            log(`  🔧 Correcting: ${wsoGeography} → ${validation.correctWSO}`);
                            wsoGeography = validation.correctWSO;
                            log(`  ✅ Using corrected WSO: ${wsoGeography}`);
                        } else {
                            log(`  ✅ WSO assignment validated: ${wsoGeography} is correct`);
                        }

                        // ADDRESS-BASED VALIDATION: Check if address state matches assigned WSO
                        // This catches cases where coordinates fall in overlapping bounding boxes
                        // but the address clearly states a different state (e.g., "Milton, Florida" vs Alabama)
                        const addressState = geocodeResult.state_from_address || addressComponents.state;
                        if (addressState && wsoGeography) {
                            const { WSO_MAPPINGS, assignCorrectWSO } = require('./wso-validation-engine');

                            // Get the correct WSO for the address state
                            const addressBasedWSO = assignCorrectWSO(addressState, geocodeResult.latitude, geocodeResult.longitude);

                            // Check if address-based WSO matches coordinate-based WSO
                            if (addressBasedWSO && addressBasedWSO !== wsoGeography) {
                                log(`  📍 Address-based validation: Address says "${addressState}" → ${addressBasedWSO}`);
                                log(`  🔧 Overriding coordinate-based WSO: ${wsoGeography} → ${addressBasedWSO}`);
                                wsoGeography = addressBasedWSO;
                                log(`  ✅ Using address-based WSO: ${wsoGeography}`);
                            } else if (addressBasedWSO === wsoGeography) {
                                log(`  ✅ Address state "${addressState}" confirms WSO: ${wsoGeography}`);
                            }
                        }
                    } else {
                        log(`  ⚠️ No WSO geography assigned - insufficient location data`);
                    }
                } catch (error) {
                    log(`  ⚠️ WSO geography assignment failed: ${error.message}`);
                }
            } else {
                failureCount++;
                log(`  ❌ Geocoding failed: ${geocodeResult.error}`);
            }

            // Fetch elevation if geocoding was successful
            let elevationMeters = null;
            let elevationSource = null;
            let elevationFetchedAt = null;
            if (geocodeResult.success) {
                const elevationResult = await fetchElevation(geocodeResult.latitude, geocodeResult.longitude);
                if (elevationResult.success) {
                    elevationMeters = elevationResult.elevation;
                    elevationSource = elevationResult.source;
                    elevationFetchedAt = new Date().toISOString();
                }
            }

            // Prepare data for database update
            const updateData = {
                ...addressComponents,
                latitude: geocodeResult.success ? geocodeResult.latitude : null,
                longitude: geocodeResult.success ? geocodeResult.longitude : null,
                state: geocodeResult.success && geocodeResult.state_extracted ? geocodeResult.state_extracted : addressComponents.state,
                geocode_display_name: geocodeResult.success ? geocodeResult.display_name : null,
                geocode_precision_score: geocodeResult.success ? geocodeResult.precision_score : null,
                geocode_strategy_used: geocodeResult.success ? `attempt_${geocodeResult.attempt}` : null,
                geocode_success: geocodeResult.success,
                geocode_error: geocodeResult.success ? null : geocodeResult.error,
                wso_geography: wsoGeography,
                elevation_meters: elevationMeters,
                elevation_source: elevationSource,
                elevation_fetched_at: elevationFetchedAt
                // Note: is_placeholder_coordinate field not in schema yet
            };

            // Update database immediately
            const success = await updateMeetWithGeocode(meet.meet_id, updateData);
            if (success) {
                updatedCount++;
                log(`  ✅ Updated database for meet_id ${meet.meet_id}`);
            }

            // Rate limit: wait between requests
            if (i < meetsNeedingGeocode.length - 1) {
                await sleep(NOMINATIM_DELAY);
            }
        }

        // PHASE 2: Fetch elevation for meets that have coordinates but missing elevation
        log('\n' + '='.repeat(60));
        log('📏 PHASE 2: FETCHING MISSING ELEVATION DATA');
        log('='.repeat(60));

        const meetsMissingElevation = await getMeetsMissingElevation();
        let elevationSuccessCount = 0;
        let elevationFailureCount = 0;

        if (meetsMissingElevation.length > 0) {
            for (let i = 0; i < meetsMissingElevation.length; i++) {
                const meet = meetsMissingElevation[i];
                const progress = `${i + 1}/${meetsMissingElevation.length}`;

                log(`\n🔄 [${progress}] Fetching elevation: ${meet.Meet} (meet_id: ${meet.meet_id})`);
                log(`   Coordinates: ${meet.latitude}, ${meet.longitude}`);

                // Fetch elevation
                const elevationResult = await fetchElevation(meet.latitude, meet.longitude);

                if (elevationResult.success) {
                    elevationSuccessCount++;

                    // Update only elevation fields
                    const updateData = {
                        elevation_meters: elevationResult.elevation,
                        elevation_source: elevationResult.source,
                        elevation_fetched_at: new Date().toISOString()
                    };

                    const success = await updateMeetWithGeocode(meet.meet_id, updateData);
                    if (success) {
                        log(`  ✅ Updated elevation for meet_id ${meet.meet_id}`);
                    }
                } else {
                    elevationFailureCount++;
                    log(`  ❌ Elevation fetch failed: ${elevationResult.error}`);
                }

                // Small delay between requests
                if (i < meetsMissingElevation.length - 1) {
                    await sleep(500);
                }
            }
        } else {
            log('✅ All meets with coordinates already have elevation data');
        }

        // Summary
        log('\n' + '='.repeat(60));
        log('✅ GEOCODING AND IMPORT COMPLETE');
        log('');
        log('📍 GEOCODING PHASE:');
        log(`   Total meets processed: ${meetsNeedingGeocode.length}`);
        log(`   High precision (skipped): ${skipCount}`);
        log(`   Database updates: ${updatedCount}`);
        log(`   Successful geocodes: ${successCount}`);
        log(`   Failed geocodes: ${failureCount}`);
        if (meetsNeedingGeocode.length > 0) {
            log(`   Geocoding success rate: ${((successCount / meetsNeedingGeocode.length) * 100).toFixed(1)}%`);
        }
        log('');
        log('📏 ELEVATION PHASE:');
        log(`   Total meets processed: ${meetsMissingElevation.length}`);
        log(`   Successful elevation fetches: ${elevationSuccessCount}`);
        log(`   Failed elevation fetches: ${elevationFailureCount}`);
        if (meetsMissingElevation.length > 0) {
            log(`   Elevation success rate: ${((elevationSuccessCount / meetsMissingElevation.length) * 100).toFixed(1)}%`);
        }
        log('');
        log(`   Total processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);

        return {
            geocoding: {
                total: meetsNeedingGeocode.length,
                success: successCount,
                failures: failureCount,
                updated: updatedCount
            },
            elevation: {
                total: meetsMissingElevation.length,
                success: elevationSuccessCount,
                failures: elevationFailureCount
            }
        };

    } catch (error) {
        log(`\n❌ Process failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    geocodeAndImport();
}

module.exports = { geocodeAndImport };