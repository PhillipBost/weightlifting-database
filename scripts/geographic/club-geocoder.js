/**
 * CLUB GEOCODER
 * 
 * Reads clubs from database, geocodes addresses using Nominatim API,
 * and updates records with latitude/longitude coordinates
 * 
 * Usage: node club-geocoder.js
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
const LOGS_DIR = './logs';
const LOG_FILE = path.join(LOGS_DIR, 'club-geocoder.log');
const NOMINATIM_DELAY = 1100; // 1.1 seconds between requests (Nominatim rate limit)

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

// Geocode address using Nominatim API


// Main address validation function with fallbacks


// Geocode address using Nominatim API with proven fallback strategies
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

// Remove suite/apartment information from address
function removeSuiteInfo(address) {
    if (!address || typeof address !== 'string') return address;
    
    return address
        .replace(/,\s*(suite|ste|apt|apartment|unit|building|bldg|floor|fl|room|rm|#)\s*[a-z0-9\-\s]+/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/,\s*,/g, ',')
        .replace(/^,\s*|,\s*$/g, '')
        .trim();
}

// Geocode address using Nominatim API with proven fallback strategies + suite removal
async function geocodeAddress(address) {
    if (!address || typeof address !== 'string') {
        return {
            success: false,
            error: 'Invalid or empty address'
        };
    }

    const cleanAddress = address.trim();
    if (!cleanAddress) {
        return {
            success: false,
            error: 'Empty address after cleaning'
        };
    }

    // Try geocoding with all variants including suite removal
    let result = await tryGeocodeVariants(cleanAddress, 'original');
    if (result.success) {
        return result;
    }

    return {
        success: false,
        error: 'No geocoding results found after trying all strategies'
    };
}

// Helper function to try geocoding with address variants
async function tryGeocodeVariants(baseAddress, strategy) {
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
    const cleanBaseAddress = removeCountry(baseAddress);
    const addressWithoutSuite = removeSuiteInfo(cleanBaseAddress);
    const useSuiteVariants = addressWithoutSuite !== cleanBaseAddress;
    
    let addressVariants = [
        baseAddress, // Original full address
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
            let variantLabel = `${strategy} variant ${i + 1}`;
            if (isSuiteRemoved) variantLabel = `${strategy} (suite removed) variant ${i + 1}`;
            if (isStreetNameOnly) variantLabel = `${strategy} (street name only) variant ${i + 1}`;
            
            log(`    🔍 Trying ${variantLabel}: ${addressToTry}`);
            
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
                    'User-Agent': 'WeightliftingDatabase/1.0'
                }
            });

            if (!response.ok) {
                if (response.status === 403 || response.status === 429) {
                    log(`    ⚠️ Rate limited (${response.status}), waiting...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const results = await response.json();

            if (results && results.length > 0) {
                const result = results[0];
                
                if (result.lat && result.lon) {
                    const precision = calculateAddressPrecision(addressToTry, result.display_name);
                    log(`    ✅ Success with ${variantLabel} (precision: ${precision})`);
                    return {
                        success: true,
                        latitude: parseFloat(result.lat),
                        longitude: parseFloat(result.lon),
                        display_name: result.display_name || null,
                        boundingbox: result.boundingbox || null,
                        address_components: result.address || {},
                        precision_score: precision,
                        strategy_used: strategy,
                        variant_used: i + 1
                    };
                }
            }

            log(`    📨 No results for ${variantLabel}`);

            // Small delay between attempts to be respectful to the API
            if (i < addressVariants.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }

        } catch (error) {
            log(`    ⚠️ ${strategy} variant ${i + 1} failed: ${error.message}`);
            continue; // Try next variant
        }
    }

    return {
        success: false,
        error: `No results found for ${strategy} strategy`
    };
}









// Get clubs that need geocoding
// Determine if a club's geocoding should be updated based on accuracy
// Determine if a club's geocoding should be updated based on accuracy
function shouldUpdateGeocode(club) {
    // No existing geocoding data - always update
    if (!club.latitude || !club.longitude || club.geocode_success === null) {
        return { update: true, reason: 'No existing geocoding data' };
    }
    
    // Previous geocoding failed - always retry
    if (!club.geocode_success) {
        return { update: true, reason: 'Previous geocoding failed, retrying' };
    }
    
    // Use stored precision score if available (from previous runs with this improved script)
    let existingPrecision = club.geocode_precision_score;
    
    // If no stored precision score, calculate it from existing display_name and address
    if (existingPrecision === null || existingPrecision === undefined) {
        existingPrecision = calculateAddressPrecision(club.address, club.geocode_display_name);
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

async function getClubsNeedingGeocoding() {
    log('🔍 Getting clubs that need geocoding...');
    
    let allClubs = [];
    let from = 0;
    const pageSize = 100;
    
    while (true) {
        const { data: clubs, error } = await supabase
            .from('clubs')
            .select('club_name, address, latitude, longitude, geocode_success, geocode_display_name, geocode_precision_score')
            .not('address', 'is', null)
            .neq('address', '')
            .range(from, from + pageSize - 1);
        
        if (error) {
            throw new Error(`Failed to get clubs: ${error.message}`);
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
    
    log(`📊 Found ${allClubs.length} clubs needing geocoding`);
    return allClubs;
}

// Update club with geocoding results
// Update club with geocoding results
async function updateClubGeocoding(clubName, geocodeResult) {
    const updateData = {
        latitude: geocodeResult.success ? geocodeResult.latitude : null,
        longitude: geocodeResult.success ? geocodeResult.longitude : null,
        geocode_display_name: geocodeResult.success ? geocodeResult.display_name : null,
        geocode_success: geocodeResult.success,
        geocode_error: geocodeResult.success ? null : geocodeResult.error,
        geocode_precision_score: geocodeResult.success ? geocodeResult.precision_score : null,
        geocode_strategy_used: geocodeResult.success ? geocodeResult.strategy_used : null,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('clubs')
        .update(updateData)
        .eq('club_name', clubName);

    if (error) {
        throw new Error(`Failed to update club ${clubName}: ${error.message}`);
    }
}

// Test function for address standardization
function testAddressStandardization() {
    console.log('🧪 Testing address standardization...');
    console.log('='.repeat(50));
    
    const testAddresses = [
        '123 Main St, Suite 456, Springfield, IL 62701, United States of America',
        '789 Oak Ave, Apt 12B, Chicago, Illinois 60601',
        '456 Elm Rd, Building C, Floor 3, Houston, TX 77001',
        'PO Box 123, Denver, CO 80202',
        '321 Park Blvd, Unit #5, Los Angeles, California 90210, USA'
    ];
    
    testAddresses.forEach((address, index) => {
        console.log(`\nTest ${index + 1}: ${address}`);
        const variations = standardizeAddress(address);
        console.log(`Generated ${variations.length} variations:`);
        variations.forEach((variation, idx) => {
            console.log(`  ${idx + 1}: ${variation}`);
        });
    });
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Address standardization test complete');
}

// Main geocoding function
async function geocodeClubs() {
    const startTime = Date.now();
    
    try {
        ensureDirectories();
        log('🏋️ Starting club geocoding process...');
        log('='.repeat(60));

        // Get clubs that need geocoding
        const clubs = await getClubsNeedingGeocoding();
        
        if (clubs.length === 0) {
            log('✅ No clubs found that need geocoding');
            return;
        }

        let successCount = 0;
        let failureCount = 0;
        let skipCount = 0;

        // Process each club
        for (let i = 0; i < clubs.length; i++) {
            const club = clubs[i];
            
            log(`\n📍 Processing club ${i + 1}/${clubs.length}: ${club.club_name}`);
            log(`   Original Address: ${club.address}`);

            try {
                // Smart update logic: check if we should update based on accuracy
                const shouldUpdate = shouldUpdateGeocode(club);
                if (!shouldUpdate.update) {
                    log(`   ⏭️ ${shouldUpdate.reason}`);
                    skipCount++;
                    continue;
                }

                // Geocode the address using proven approach
                const geocodeResult = await geocodeAddress(club.address);
                
                if (geocodeResult.success) {
                    successCount++;
                    log(`   ✅ Geocoded: ${geocodeResult.latitude}, ${geocodeResult.longitude}`);
                    log(`   📊 Strategy: ${geocodeResult.strategy_used}, Variant: ${geocodeResult.variant_used}, Precision: ${geocodeResult.precision_score}`);
                    if (geocodeResult.display_name) {
                        log(`   📍 Resolved to: ${geocodeResult.display_name}`);
                    }
                } else {
                    failureCount++;
                    log(`   ❌ Geocoding failed: ${geocodeResult.error}`);
                }

                // Update the database
                await updateClubGeocoding(club.club_name, geocodeResult);
                log(`   💾 Database updated`);

            } catch (error) {
                failureCount++;
                log(`   ❌ Processing error: ${error.message}`);
                
                // Try to update with error info
                try {
                    await updateClubGeocoding(club.club_name, {
                        success: false,
                        error: error.message
                    });
                } catch (updateError) {
                    log(`   ❌ Failed to update error status: ${updateError.message}`);
                }
            }

            // Rate limiting for Nominatim
            if (i < clubs.length - 1) {
                log(`   ⏱️ Waiting ${NOMINATIM_DELAY}ms for rate limiting...`);
                await new Promise(resolve => setTimeout(resolve, NOMINATIM_DELAY));
            }
        }

        // Final summary
        log('\n' + '='.repeat(60));
        log('✅ CLUB GEOCODING COMPLETE');
        log(`   Total clubs processed: ${clubs.length}`);
        log(`   Successful geocodes: ${successCount}`);
        log(`   Failed geocodes: ${failureCount}`);
        log(`   Already geocoded (skipped): ${skipCount}`);
        log(`   Processing time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

    } catch (error) {
        log(`❌ Fatal error in geocoding process: ${error.message}`);
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run the geocoding process
if (require.main === module) {
    geocodeClubs();
}

module.exports = { geocodeClubs };