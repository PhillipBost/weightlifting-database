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
        // Handle comma-separated suite info: ", Suite 123"
        .replace(/,\s*(suite|ste|apt|apartment|unit|building|bldg|floor|fl|room|rm|#)\s*[a-z0-9\-\s]+/gi, '')
        // Handle space-separated suite info: " Suite 123" 
        .replace(/\s+(suite|ste|apt|apartment|unit|building|bldg|floor|fl|room|rm|#)\s+[a-z0-9\-\s]+/gi, '')
        // Handle dash-separated suite info: " - Ste F"
        .replace(/\s*-\s*(suite|ste|apt|apartment|unit|building|bldg|floor|fl|room|rm|#)\s*[a-z0-9\-\s]+/gi, '')
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
    addressVariants.push(
        fallbackBase.split(',').slice(-3).join(',').trim(), // City, state, zip from clean address
        fallbackBase.split(',').slice(-2).join(',').trim()  // State, zip from clean address
    );
    
    // Filter out empty/too short addresses and remove duplicates
    addressVariants = [...new Set(addressVariants.filter(addr => addr && addr.length > 2))];

    for (let i = 0; i < addressVariants.length; i++) {
        const addressToTry = addressVariants[i];
        
        try {
            // Show if this is a suite-removed variant
            const isSuiteRemoved = useSuiteVariants && addressToTry === addressWithoutSuite;
            const isStreetNameOnly = addressToTry === streetNameOnly;
            let variantLabel = `Attempt ${i + 1}`;
            if (isSuiteRemoved) variantLabel = `Attempt ${i + 1} (suite removed)`;
            if (isStreetNameOnly) variantLabel = `Attempt ${i + 1} (street name only)`;
            
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
            .from('meets')
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
        
        let allMeets = [];
        let from = 0;
        const pageSize = 100;
        
        while (true) {
            const { data, error } = await supabase
                .from('meets')
                .select('meet_id, Meet, address, latitude, longitude, geocode_success, geocode_precision_score, geocode_display_name')
                .not('address', 'is', null)
                .neq('address', '')
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
                    const updateData = {
                        latitude: geocodeResult.latitude,
                        longitude: geocodeResult.longitude,
                        state: geocodeResult.state_extracted || null,
                        geocode_display_name: geocodeResult.display_name,
                        geocode_precision_score: geocodeResult.precision_score,
                        geocode_success: true,
                        wso_geography: null, // Explicitly null for international events
                        is_international_event: true
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
                is_placeholder_coordinate: geocodeResult.success ? geocodeResult.is_placeholder : false,
                placeholder_coordinate_type: geocodeResult.success ? geocodeResult.placeholder_type : null,
                // Add elevation fields (will be populated by elevation-fetcher later)
                elevation_meters: null,
                elevation_source: null,
                elevation_fetched_at: null
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
        
        
        
        // Summary
        log('\n' + '='.repeat(60));
        log('✅ GEOCODING AND IMPORT COMPLETE');
        log(`   Total meets processed: ${meetsNeedingGeocode.length}`);
        log(`   High precision (skipped): ${skipCount}`);
        log(`   Database updates: ${updatedCount}`);
        log(`   Successful geocodes: ${successCount}`);
        log(`   Failed geocodes: ${failureCount}`);
        log(`   Geocoding success rate: ${((successCount / meetsNeedingGeocode.length) * 100).toFixed(1)}%`);
        log(`   Processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);
        
        return {
            total: meetsNeedingGeocode.length,
            success: successCount,
            failures: failureCount,
            updated: updatedCount
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