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
const { getWSOGeographyFromCoordinates } = require('../../utils/wso-geography-lookup');

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

// Parse address into components
function parseAddress(rawAddress) {
    if (!rawAddress) return {};
    
    const parts = rawAddress.split(', ');
    const country = parts[parts.length - 2] || '';
    const zipCode = parts[parts.length - 1] || '';
    const state = parts[parts.length - 3] || '';
    const city = parts[parts.length - 4] || '';
    const streetAddress = parts.slice(0, -3).join(', ') || '';
    
    return {
        address: rawAddress,
        street_address: streetAddress,
        city,
        state,
        zip_code: zipCode,
        country
    };
}

// Geocode address using Nominatim with fallback strategies
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
                    log(`  ✅ Success with ${variantLabel} (precision: ${precision})`);
                    return {
                        latitude: parseFloat(result.lat),
                        longitude: parseFloat(result.lon),
                        display_name: result.display_name,
                        precision_score: precision,
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

// Get meets from database that need geocoding
async function getMeetsNeedingGeocode() {
    try {
        log('📊 Querying database for meets that need geocoding...');
        
        const { data, error, count } = await supabase
            .from('meets')
            .select('meet_id, Meet, address, latitude, longitude, geocode_success', { count: 'exact' })
            .not('address', 'is', null)
            .or('latitude.is.null,geocode_success.eq.false');
            
        if (error) {
            throw new Error(`Failed to fetch meets: ${error.message}`);
        }
        
        log(`📋 Found ${data?.length || 0} meets that need geocoding`);
        return data || [];
        
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
        
        // Process each meet that needs geocoding
        for (let i = 0; i < meetsNeedingGeocode.length; i++) {
            const meet = meetsNeedingGeocode[i];
            const progress = `${i + 1}/${meetsNeedingGeocode.length}`;
            
            log(`
🔄 [${progress}] Processing: ${meet.Meet} (meet_id: ${meet.meet_id})`);
            
            // Parse address components
            const addressComponents = parseAddress(meet.address);
            
            // Geocode address
            const geocodeResult = await geocodeAddress(meet.address);
            
            let wsoGeography = null;
            if (geocodeResult.success) {
                successCount++;
                log(`  ✅ Geocoded: ${geocodeResult.latitude}, ${geocodeResult.longitude}`);
                log(`  📊 Precision score: ${geocodeResult.precision_score}`);
                
                // Determine WSO geography from coordinates
                try {
                    wsoGeography = await getWSOGeographyFromCoordinates(
                        geocodeResult.latitude, 
                        geocodeResult.longitude, 
                        supabase
                    );
                    if (wsoGeography) {
                        log(`  🗺️ WSO Geography: ${wsoGeography}`);
                    } else {
                        log(`  ⚠️ No WSO geography found for coordinates`);
                    }
                } catch (error) {
                    log(`  ⚠️ WSO geography lookup failed: ${error.message}`);
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
                geocode_display_name: geocodeResult.success ? geocodeResult.display_name : null,
                geocode_precision_score: geocodeResult.success ? geocodeResult.precision_score : null,
                geocode_strategy_used: geocodeResult.success ? `attempt_${geocodeResult.attempt}` : null,
                geocode_success: geocodeResult.success,
                geocode_error: geocodeResult.success ? null : geocodeResult.error,
                wso_geography: wsoGeography,
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