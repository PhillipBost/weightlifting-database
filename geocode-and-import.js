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
async function geocodeAddress(rawAddress) {
    // Try different address formats
    const addressVariants = [
        rawAddress, // Original full address
        rawAddress.replace(', United States of America', ''), // Remove country
        rawAddress.split(',').slice(-3).join(',').trim(), // Just city, state, zip
        rawAddress.split(',').slice(-2).join(',').trim()  // Just state, zip
    ];
    
    for (let i = 0; i < addressVariants.length; i++) {
        const address = addressVariants[i];
        if (!address) continue;
        
        try {
            const encodedAddress = encodeURIComponent(address);
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`;
            
            log(`  🌐 Attempt ${i + 1}: ${address.substring(0, 60)}...`);
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'WeightliftingMeetGeocoder/1.0'
                }
            });
            
            if (!response.ok) {
                if (response.status === 403 || response.status === 429) {
                    log(`  ⚠️ Rate limited (${response.status}), waiting longer...`);
                    await sleep(5000); // Wait 5 seconds for rate limits
                    continue;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.length > 0) {
                const result = data[0];
                log(`  ✅ Success with variant ${i + 1}: ${result.display_name.substring(0, 60)}...`);
                return {
                    latitude: parseFloat(result.lat),
                    longitude: parseFloat(result.lon),
                    display_name: result.display_name,
                    success: true,
                    attempt: i + 1
                };
            }
            
            log(`  📨 No results for variant ${i + 1}`);
            
        } catch (error) {
            log(`  ❌ Error with variant ${i + 1}: ${error.message}`);
            continue;
        }
        
        // Wait between attempts to avoid rate limiting
        await sleep(500);
    }
    
    return { success: false, error: 'No results found for any address variant' };
}

// Sleep function for rate limiting
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate address precision score (higher = more precise)
function calculateAddressPrecision(address) {
    if (!address) return 0;
    
    let score = 0;
    const parts = address.split(',').map(p => p.trim());
    
    // Street address present = +3
    if (parts.length > 0 && parts[0] && /\d+/.test(parts[0])) {
        score += 3;
    }
    
    // City present = +2  
    if (parts.length > 1 && parts[1]) {
        score += 2;
    }
    
    // State present = +1
    if (parts.length > 2 && parts[2]) {
        score += 1;
    }
    
    return score;
}

// Import a batch of records with upsert logic
async function importBatch(records) {
    for (const record of records) {
        if (!record.meet_id) {
            // No meet_id link, just insert
            const { error } = await supabase
                .from('meet_locations')
                .insert(record);
            
            if (error) {
                throw new Error(`Insert failed for ${record.meet_name}: ${error.message}`);
            }
            continue;
        }
        
        // Check if record exists for this meet_id
        const { data: existing, error: fetchError } = await supabase
            .from('meet_locations')
            .select('*')
            .eq('meet_id', record.meet_id)
            .single();
        
        if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows
            throw new Error(`Fetch failed for meet_id ${record.meet_id}: ${fetchError.message}`);
        }
        
        if (!existing) {
            // No existing record, insert new
            const { error } = await supabase
                .from('meet_locations')
                .insert(record);
            
            if (error) {
                throw new Error(`Insert failed for ${record.meet_name}: ${error.message}`);
            }
            log(`  ➕ Inserted new record for meet_id ${record.meet_id}`);
        } else {
            // Record exists, check if we should update
            const existingPrecision = calculateAddressPrecision(existing.raw_address);
            const newPrecision = calculateAddressPrecision(record.raw_address);
            
            if (newPrecision > existingPrecision && record.geocode_success) {
                // New address is more precise and geocoded successfully
                const { error } = await supabase
                    .from('meet_locations')
                    .update(record)
                    .eq('meet_id', record.meet_id);
                
                if (error) {
                    throw new Error(`Update failed for meet_id ${record.meet_id}: ${error.message}`);
                }
                log(`  🔄 Updated with better precision (${newPrecision} > ${existingPrecision}) for meet_id ${record.meet_id}`);
            } else {
                log(`  ⏭️ Skipped update (precision ${newPrecision} <= ${existingPrecision}) for meet_id ${record.meet_id}`);
            }
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
            
            log(`🔄 [${progress}] Processing: ${meet.meet_name}`);
            
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
            
            if (geocodeResult.success) {
                successCount++;
                log(`  ✅ Geocoded: ${geocodeResult.latitude}, ${geocodeResult.longitude}`);
            } else {
                failureCount++;
                log(`  ❌ Geocoding failed: ${geocodeResult.error}`);
            }
            
            // Prepare data for import
            const importRecord = {
                meet_id: meetId, // Foreign key link
                meet_name: meet.meet_name,
                ...addressComponents,
                latitude: geocodeResult.success ? geocodeResult.latitude : null,
                longitude: geocodeResult.success ? geocodeResult.longitude : null,
                geocode_display_name: geocodeResult.success ? geocodeResult.display_name : null,
                date_range: meet.date_range,
                location_text: meet.location,
                geocode_success: geocodeResult.success,
                geocode_error: geocodeResult.success ? null : geocodeResult.error
            };
            
            importData.push(importRecord);
            
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