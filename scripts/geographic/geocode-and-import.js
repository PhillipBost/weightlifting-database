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
const INPUT_FILE = './output/meet_addresses.json';
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
        raw_address: rawAddress,
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

// Import a batch of records with upsert logic - targeting meets table
async function importBatch(records) {
    for (const record of records) {
        if (!record.meet_id) {
            // No meet_id link - skip this record as we need meet_id for meets table
            log(`  ⚠️ Skipping record without meet_id: ${record.meet_name}`);
            continue;
        }
        
        // Check if meet exists and get current location data
        const { data: existing, error: fetchError } = await supabase
            .from('meets')
            .select('meet_id, Meet, latitude, longitude, geocode_precision_score, geocode_success')
            .eq('meet_id', record.meet_id)
            .single();
        
        if (fetchError) {
            throw new Error(`Fetch failed for meet_id ${record.meet_id}: ${fetchError.message}`);
        }
        
        if (!existing) {
            log(`  ⚠️ Meet not found for meet_id ${record.meet_id}`);
            continue;
        }
        
        // Check if we should update - only update if new data is more precise or no existing location data
        const existingPrecision = existing.geocode_precision_score || 0;
        const newPrecision = record.geocode_precision_score || 0;
        const hasExistingLocation = existing.latitude && existing.longitude;
        
        if (!hasExistingLocation || (newPrecision > existingPrecision && record.geocode_success)) {
            // Update the meets table with location data
            const { error } = await supabase
                .from('meets')
                .update(record)
                .eq('meet_id', record.meet_id);
            
            if (error) {
                throw new Error(`Update failed for meet_id ${record.meet_id}: ${error.message}`);
            }
            
            if (!hasExistingLocation) {
                log(`  ➕ Added location data to meet_id ${record.meet_id}`);
            } else {
                log(`  🔄 Updated with better precision (${newPrecision} > ${existingPrecision}) for meet_id ${record.meet_id}`);
            }
        } else {
            log(`  ⏭️ Skipped update (precision ${newPrecision} <= ${existingPrecision}) for meet_id ${record.meet_id}`);
        }
    }
}

// Main import function
async function geocodeAndImport() {
    const startTime = Date.now();
    
    try {
        log('🌍 Starting geocoding and import process...');
        log('='.repeat(60));
        
        // Read input file
        if (!fs.existsSync(INPUT_FILE)) {
            throw new Error(`Input file not found: ${INPUT_FILE}`);
        }
        
        const inputData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
        const meets = inputData.meets || [];
        
        log(`📂 Loaded ${meets.length} meets from ${INPUT_FILE}`);
        
        // Filter meets that have addresses
        const meetsWithAddresses = meets.filter(meet => meet.address);
        log(`📍 Found ${meetsWithAddresses.length} meets with addresses`);
        
        // Get existing meets from database for linking (with pagination)
        log('🔗 Fetching existing meets from database for linking...');
        let existingMeets = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;
        
        while (hasMore) {
            const { data, error, count } = await supabase
                .from('meets')
                .select('meet_id, Meet', { count: 'exact' })
                .range(page * pageSize, (page + 1) * pageSize - 1);
            
            if (error) {
                throw new Error(`Failed to fetch existing meets: ${error.message}`);
            }
            
            if (data && data.length > 0) {
                existingMeets = existingMeets.concat(data);
                hasMore = data.length === pageSize;
                page++;
                log(`📄 Fetched page ${page}, total so far: ${existingMeets.length}`);
            } else {
                hasMore = false;
            }
        }
        
        log(`📊 Found ${existingMeets.length} total existing meets in database`);
        
        let successCount = 0;
        let failureCount = 0;
        let linkedCount = 0;
        let unlinkedCount = 0;
        let totalImported = 0;
        const importData = [];
        const BATCH_SIZE = 10;
        
        // Process each meet
        for (let i = 0; i < meetsWithAddresses.length; i++) {
            const meet = meetsWithAddresses[i];
            const progress = `${i + 1}/${meetsWithAddresses.length}`;
            
            log(`
🔄 [${progress}] Processing: ${meet.meet_name}`);
            
            // Try to link to existing meet
            const existingMeet = existingMeets.find(em => em.Meet === meet.meet_name);
            const meetId = existingMeet ? existingMeet.meet_id : null;
            
            if (meetId) {
                linkedCount++;
                log(`  🔗 Linked to meet_id: ${meetId}`);
            } else {
                unlinkedCount++;
                log(`  ⚠️ No match found in database`);
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
            
            // Prepare data for import
            const importRecord = {
                // Remove meet_name as it's not a field in meets table (it's called 'Meet')
                ...addressComponents,
                latitude: geocodeResult.success ? geocodeResult.latitude : null,
                longitude: geocodeResult.success ? geocodeResult.longitude : null,
                geocode_display_name: geocodeResult.success ? geocodeResult.display_name : null,
                geocode_precision_score: geocodeResult.success ? geocodeResult.precision_score : null,
                geocode_strategy_used: geocodeResult.success ? `attempt_${geocodeResult.attempt}` : null,
                date_range: meet.date_range,
                location_text: meet.location,
                geocode_success: geocodeResult.success,
                geocode_error: geocodeResult.success ? null : geocodeResult.error,
                wso_geography: wsoGeography,
                // Add elevation fields (will be populated by elevation-fetcher later)
                elevation_meters: null,
                elevation_source: null,
                elevation_fetched_at: null
            };
            
            importData.push(importRecord);
            
            // Debug: Show what we're about to import
            if (geocodeResult.success) {
                log(`  💾 Will import with precision_score: ${importRecord.geocode_precision_score}`);
            }
            
            // Import batch when we have BATCH_SIZE records or at the end
            if (importData.length >= BATCH_SIZE || i === meetsWithAddresses.length - 1) {
                log(`\n📤 Importing batch of ${importData.length} records to Supabase...`);
                
                try {
                    await importBatch(importData);
                    totalImported += importData.length;
                    log(`✅ Successfully imported batch. Total imported: ${totalImported}`);
                    
                    // Clear the batch
                    importData.length = 0;
                } catch (error) {
                    log(`❌ Batch import failed: ${error.message}`);
                    throw error;
                }
            }
            
            // Rate limit: wait between requests
            if (i < meetsWithAddresses.length - 1) {
                await sleep(NOMINATIM_DELAY);
            }
        }
        
        log(`\n✅ All batches imported successfully!`);
        
        // Summary
        log('\n' + '='.repeat(60));
        log('✅ GEOCODING AND IMPORT COMPLETE');
        log(`   Total meets processed: ${meetsWithAddresses.length}`);
        log(`   Successfully linked to database: ${linkedCount}`);
        log(`   Unlinked (no match found): ${unlinkedCount}`);
        log(`   Successful geocodes: ${successCount}`);
        log(`   Failed geocodes: ${failureCount}`);
        log(`   Geocoding success rate: ${((successCount / meetsWithAddresses.length) * 100).toFixed(1)}%`);
        log(`   Linking success rate: ${((linkedCount / meetsWithAddresses.length) * 100).toFixed(1)}%`);
        log(`   Processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);
        
        return {
            total: meetsWithAddresses.length,
            success: successCount,
            failures: failureCount,
            imported: totalImported
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