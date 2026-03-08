require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { assignWSOGeography } = require('./wso-assignment-engine');
const { validateWSOAssignment, preventContamination } = require('./wso-validation-engine');
const { parseAddressIntelligently } = require('./fix-address-parsing');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const LOG_FILE = './logs/geocode-meet-listings.log';
const NOMINATIM_DELAY = 1100;

function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(message);
    if (!fs.existsSync('./logs')) {
        fs.mkdirSync('./logs', { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, logMessage);
}

function parseAddress(rawAddress) {
    const parsed = parseAddressIntelligently(rawAddress);
    return {
        address: rawAddress,
        street_address: parsed.street_address,
        city: parsed.city,
        state: parsed.state,
        zip_code: parsed.zip_code,
        country: parsed.country
    };
}

function removeSuiteInfo(address) {
    if (!address || typeof address !== 'string') return address;
    return address
        .replace(/ (suite|ste|apt|apartment|unit|building|bldg|floor|fl|room|rm|#) [a-z0-9\-]+/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/,\s*,/g, ',')
        .replace(/^,\s*|,\s*$/g, '')
        .trim();
}

const INTERNATIONAL_KEYWORDS = [
    'world', 'olympic', 'pan am', 'panamerican', 'international',
    'commonwealth', 'asian games', 'european', 'continental',
    'ihf', 'iwf', 'rio', 'tokyo', 'beijing', 'athens', 'sydney'
];

function isInternationalEvent(meetName) {
    if (!meetName) return false;
    const meetNameLower = meetName.toLowerCase();
    return INTERNATIONAL_KEYWORDS.some(keyword => meetNameLower.includes(keyword));
}

function extractStateFromGeocode(result) {
    if (!result || !result.address) return null;
    const addr = result.address;
    if (addr.state) return addr.state;
    if (addr.state_district) return addr.state_district;
    if (result.display_name) {
        const parts = result.display_name.split(',').map(p => p.trim());
        if (parts.length >= 3) {
            const statePart = parts[parts.length - 3];
            const stateMatch = statePart.match(/^([A-Za-z ]+)/);
            if (stateMatch) return stateMatch[1].trim();
        }
    }
    return null;
}

async function geocodeAddress(rawAddress) {
    function removeCountry(addr) {
        return addr
            .replace(/,\s*\b(United States of America|United States|USA|US)\b\s*,/gi, ',')
            .replace(/,\s*\b(United States of America|United States|USA|US)\b\s*$/gi, '')
            .replace(/,\s*,/g, ',')
            .replace(/^,\s*|,\s*$/g, '')
            .trim();
    }
    function removeStreetNumber(addr) {
        return addr.replace(/^\d+\s+/, '').trim();
    }

    const cleanBaseAddress = removeCountry(rawAddress);
    const addressWithoutSuite = removeSuiteInfo(cleanBaseAddress);
    const useSuiteVariants = addressWithoutSuite !== cleanBaseAddress;

    let addressVariants = [rawAddress, cleanBaseAddress];

    if (useSuiteVariants) {
        addressVariants.push(addressWithoutSuite);
    }

    const fallbackBase = useSuiteVariants ? addressWithoutSuite : cleanBaseAddress;
    const streetNameOnly = removeStreetNumber(fallbackBase);
    if (streetNameOnly !== fallbackBase && streetNameOnly.length > 10) {
        addressVariants.push(streetNameOnly);
    }

    const cityStateFallback = fallbackBase.split(',').slice(-3).join(',').trim();
    const stateZipFallback = fallbackBase.split(',').slice(-2).join(',').trim();

    const parts = fallbackBase.split(',').map(p => p.trim());
    let cityStatOnly = '';
    let zipOnly = '';
    let stateOnly = '';

    if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];
        const zipMatch = lastPart.match(/\b(\d{5,}(?:-\d{4})?)\b/);
        if (zipMatch) zipOnly = zipMatch[1];
        let state = lastPart;
        if (zipMatch) state = lastPart.replace(zipMatch[0], '').trim();
        if (!state || state.length <= 1 || /^\d+$/.test(state)) {
            if (parts.length >= 2) state = parts[parts.length - 2];
        }
        if (state && state.length > 1) {
            stateOnly = state;
            const cityIndex = (state === parts[parts.length - 2]) ? parts.length - 3 : parts.length - 2;
            if (cityIndex >= 0 && parts[cityIndex] && parts[cityIndex].length > 0) {
                const city = parts[cityIndex];
                if (city) cityStatOnly = `${city}, ${state}`;
            }
        }
    }

    addressVariants.push(cityStateFallback);
    addressVariants.push(stateZipFallback);
    if (cityStatOnly) addressVariants.push(cityStatOnly);
    if (zipOnly) addressVariants.push(zipOnly);
    if (stateOnly) addressVariants.push(stateOnly);

    addressVariants = [...new Set(addressVariants.filter(addr => addr && addr.length > 2))];

    for (let i = 0; i < addressVariants.length; i++) {
        const addressToTry = addressVariants[i];
        let variantLabel = `Attempt ${i + 1}`;
        try {
            log(`  🌐 ${variantLabel}: ${addressToTry.substring(0, 60)}...`);
            const params = new URLSearchParams({
                q: addressToTry,
                format: 'json',
                limit: 1,
                countrycodes: 'us',
                addressdetails: 1
            });
            const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
            const response = await fetch(url, { headers: { 'User-Agent': 'WeightliftingMeetGeocodeListings/1.0' } });
            if (!response.ok) {
                if (response.status === 403 || response.status === 429) {
                    await sleep(5000);
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }
            const results = await response.json();
            if (results && results.length > 0) {
                const result = results[0];
                if (result.lat && result.lon) {
                    const precision = calculateAddressPrecision(addressToTry, result.display_name);
                    const lat = parseFloat(result.lat);
                    const lng = parseFloat(result.lon);
                    const extractedState = extractStateFromGeocode(result);
                    log(`  ✅ Success with ${variantLabel} (precision: ${precision})`);
                    return {
                        latitude: lat,
                        longitude: lng,
                        display_name: result.display_name,
                        precision_score: precision,
                        state_extracted: extractedState,
                        state_from_address: stateOnly,
                        success: true,
                        attempt: i + 1
                    };
                }
            }
            if (i < addressVariants.length - 1) await sleep(500);
        } catch (error) {
            continue;
        }
    }
    return { success: false, error: 'No results' };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchElevation(latitude, longitude) {
    try {
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${latitude}&longitude=${longitude}`;
        const response = await fetch(url, { headers: { 'User-Agent': 'WeightliftingMeetGeocodeListings/1.0' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data && data.elevation && data.elevation.length > 0) {
            return { success: true, elevation: data.elevation[0], source: 'open-meteo' };
        }
        return { success: false, error: 'No elevation data' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function calculateAddressPrecision(address, displayName) {
    if (!address && !displayName) return 0;
    let score = 0;
    const addressToScore = address || displayName || '';
    const parts = addressToScore.split(',').map(p => p.trim());
    if (parts.length > 0 && parts[0] && /\d+.*\w+/.test(parts[0])) score += 4;
    if (parts.length > 1 && parts[1] && parts[1].length > 2) score += 2;
    if (parts.length > 2 && parts[2] && parts[2].length >= 2) score += 1;
    if (addressToScore.match(/\b\d{5}(-\d{4})?\b/)) score += 1;
    if (displayName && displayName.toLowerCase().includes('united states')) score -= 2;
    return Math.max(0, score);
}

async function updateMeetListingWithGeocode(listingId, geocodeData) {
    try {
        const { error } = await supabase.from('usaw_meet_listings').update(geocodeData).eq('listing_id', listingId);
        if (error) throw new Error(error.message);
        return true;
    } catch (error) {
        log(`  ❌ Database update failed for listing_id ${listingId}: ${error.message}`);
        return false;
    }
}

function shouldUpdateGeocode(listing) {
    if (!listing.latitude || !listing.longitude || listing.geocode_success === null) {
        return { update: true, reason: 'No existing geocoding data' };
    }
    if (!listing.geocode_success) {
        return { update: true, reason: 'Previous geocoding failed' };
    }
    let existingPrecision = listing.geocode_precision_score;
    if (existingPrecision === null || existingPrecision === undefined) {
        existingPrecision = calculateAddressPrecision(listing.address, listing.geocode_display_name);
    }
    if (existingPrecision >= 6) return { update: false, reason: `High precision (${existingPrecision})` };
    return { update: true, reason: `Low precision (${existingPrecision})` };
}

async function getListingsNeedingGeocode() {
    try {
        log('📊 Querying database for listings that need geocoding...');
        let allListings = [];
        let from = 0;
        const pageSize = 100;
        while (true) {
            const { data, error } = await supabase
                .from('usaw_meet_listings')
                .select('listing_id, meet_name, address, latitude, longitude, geocode_success, geocode_precision_score, geocode_display_name, event_date')
                .not('address', 'is', null)
                .neq('address', '')
                .or(process.argv.includes('--retry-low-precision')
                    ? 'geocode_precision_score.is.null,geocode_precision_score.lte.3,geocode_success.is.false'
                    : 'geocode_precision_score.is.null,geocode_success.is.false')
                .range(from, from + pageSize - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            allListings.push(...data);
            from += pageSize;
            if (data.length < pageSize) break;
        }
        log(`📋 Found ${allListings.length} listings that need geocoding`);
        return allListings;
    } catch (error) {
        throw error;
    }
}

async function geocodeAndImport() {
    try {
        log('🌍 Starting geocoding and import process for meet listings...');
        const listingsNeedingGeocode = await getListingsNeedingGeocode();
        if (listingsNeedingGeocode.length === 0) return;

        for (let i = 0; i < listingsNeedingGeocode.length; i++) {
            const listing = listingsNeedingGeocode[i];
            log(`\n🔄 Processing: ${listing.meet_name} (listing_id: ${listing.listing_id})`);

            if (isInternationalEvent(listing.meet_name)) {
                log(`  🌍 International event detected - skipping WSO assignment`);
                const geocodeResult = await geocodeAddress(listing.address);
                if (geocodeResult.success) {
                    const elevationResult = await fetchElevation(geocodeResult.latitude, geocodeResult.longitude);
                    await updateMeetListingWithGeocode(listing.listing_id, {
                        latitude: geocodeResult.latitude,
                        longitude: geocodeResult.longitude,
                        state: geocodeResult.state_extracted || null,
                        geocode_display_name: geocodeResult.display_name,
                        geocode_precision_score: geocodeResult.precision_score,
                        geocode_success: true,
                        wso_geography: null,
                        elevation_meters: elevationResult.success ? elevationResult.elevation : null,
                        elevation_source: elevationResult.success ? elevationResult.source : null,
                        elevation_fetched_at: elevationResult.success ? new Date().toISOString() : null
                    });
                }
                await sleep(NOMINATIM_DELAY);
                continue;
            }

            const shouldUpdate = shouldUpdateGeocode(listing);
            if (!shouldUpdate.update) continue;

            const addressComponents = parseAddress(listing.address);
            const geocodeResult = await geocodeAddress(listing.address);

            let wsoGeography = null;
            if (geocodeResult.success) {
                try {
                    // map columns for wso assignment logic
                    const meetData = {
                        ...listing,
                        ...addressComponents,
                        Meet: listing.meet_name,
                        Date: listing.event_date,
                        latitude: geocodeResult.latitude,
                        longitude: geocodeResult.longitude
                    };

                    const assignment = await assignWSOGeography(meetData, supabase, { includeHistoricalData: true, logDetails: false });
                    if (assignment.assigned_wso) {
                        wsoGeography = assignment.assigned_wso;
                        const validation = validateWSOAssignment(wsoGeography, geocodeResult.latitude, geocodeResult.longitude);
                        if (!validation.isValid) wsoGeography = validation.correctWSO;

                        const addressState = geocodeResult.state_from_address || addressComponents.state;
                        if (addressState) {
                            const { assignCorrectWSO } = require('./wso-validation-engine');
                            const addressBasedWSO = assignCorrectWSO(addressState, geocodeResult.latitude, geocodeResult.longitude);
                            if (addressBasedWSO && addressBasedWSO !== wsoGeography) {
                                wsoGeography = addressBasedWSO;
                            }
                        }
                    }
                } catch (error) { log(`  ⚠️ WSO failure: ${error.message}`); }
            }

            let elevationMeters = null, elevationSource = null, elevationFetchedAt = null;
            if (geocodeResult.success) {
                const elevationResult = await fetchElevation(geocodeResult.latitude, geocodeResult.longitude);
                if (elevationResult.success) {
                    elevationMeters = elevationResult.elevation;
                    elevationSource = elevationResult.source;
                    elevationFetchedAt = new Date().toISOString();
                }
            }

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
            };

            await updateMeetListingWithGeocode(listing.listing_id, updateData);
            if (i < listingsNeedingGeocode.length - 1) await sleep(NOMINATIM_DELAY);
        }
        log('✅ Done');
    } catch (err) {
        log(`❌ Error: ${err.message}`);
    }
}

if (require.main === module) {
    geocodeAndImport();
}
