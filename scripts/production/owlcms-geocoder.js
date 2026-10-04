/**
 * OWLCMS Meet Geocoding & Country Normalization Service
 * 
 * Geocodes owlcms competition host venues, cities, and countries using
 * OpenStreetMap (OSM) Nominatim Application Programming Interface (API).
 * Enforces a 1.1-second rate-limiting delay and provides canonical
 * International Olympic Committee (IOC) country code resolution.
 */

const https = require('https');
const path = require('path');

// Rate limiting: 1.1s minimum delay between external Nominatim API calls
let lastGeocodeTimestamp = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const USER_AGENT = 'WeightliftingDB-OWLCMS-Geocoder/1.0 (https://weightliftingdb.com)';

// Canonical IOC 3-letter country codes
const IOC_MEMBER_CODES = new Set([
    'AFG', 'ALB', 'ALG', 'AND', 'ANG', 'ANT', 'ARG', 'ARM', 'ARU', 'ASA',
    'AUS', 'AUT', 'AZE', 'BAH', 'BAN', 'BAR', 'BDI', 'BEL', 'BEN', 'BER',
    'BHU', 'BIH', 'BIZ', 'BLR', 'BOL', 'BOT', 'BRA', 'BRN', 'BRU', 'BUL',
    'BUR', 'CAF', 'CAM', 'CAN', 'CAY', 'CGO', 'CHA', 'CHI', 'CHN', 'CIV',
    'CMR', 'COD', 'COK', 'COL', 'COM', 'CPV', 'CRC', 'CRO', 'CUB', 'CYP',
    'CZE', 'DEN', 'DJI', 'DMA', 'DOM', 'ECU', 'EGY', 'ERI', 'ESA', 'ESP',
    'EST', 'ETH', 'FIJ', 'FIN', 'FRA', 'FSM', 'GAB', 'GAM', 'GBR', 'GBS',
    'GEO', 'GEQ', 'GER', 'GHA', 'GRE', 'GRN', 'GUA', 'GUI', 'GUM', 'GUY',
    'HAI', 'HKG', 'HON', 'HUN', 'INA', 'IND', 'IRI', 'IRL', 'IRQ', 'ISL',
    'ISR', 'ISV', 'ITA', 'IVB', 'JAM', 'JOR', 'JPN', 'KAZ', 'KEN', 'KGZ',
    'KIR', 'KOR', 'KSA', 'KUW', 'LAO', 'LAT', 'LBA', 'LBN', 'LBR', 'LCA',
    'LES', 'LIE', 'LTU', 'LUX', 'MAD', 'MAR', 'MAS', 'MAW', 'MDA', 'MDV',
    'MEX', 'MGL', 'MHL', 'MKD', 'MLI', 'MLT', 'MNE', 'MON', 'MOZ', 'MRI',
    'MTN', 'MYA', 'NAM', 'NCA', 'NED', 'NEP', 'NGR', 'NIG', 'NOR', 'NRU',
    'NZL', 'OMA', 'PAK', 'PAN', 'PAR', 'PER', 'PHI', 'PLE', 'PLW', 'PNG',
    'POL', 'POR', 'PRK', 'PUR', 'QAT', 'ROU', 'RSA', 'RUS', 'RWA', 'SAM',
    'SEN', 'SEY', 'SGP', 'SKN', 'SLE', 'SLO', 'SMR', 'SOL', 'SOM', 'SRB',
    'SRI', 'SSD', 'STP', 'SUD', 'SUI', 'SUR', 'SVK', 'SWE', 'SWZ', 'SYR',
    'TAN', 'TGA', 'THA', 'TJK', 'TKM', 'TLS', 'TOG', 'TPE', 'TTO', 'TUN',
    'TUR', 'TUV', 'UAE', 'UGA', 'UKR', 'URU', 'USA', 'UZB', 'VAN', 'VEN',
    'VIE', 'VIN', 'YEM', 'ZAM', 'ZIM'
]);

// Map of common ISO-3/IOC variations, country names, and aliases to canonical IOC codes
const COUNTRY_NAME_TO_IOC = {
    'argentina': 'ARG',
    'aruba': 'ARU',
    'bolivia': 'BOL',
    'brazil': 'BRA',
    'brasil': 'BRA',
    'canada': 'CAN',
    'chile': 'CHI',
    'colombia': 'COL',
    'costa rica': 'CRC',
    'cuba': 'CUB',
    'dominican republic': 'DOM',
    'republica dominicana': 'DOM',
    'ecuador': 'ECU',
    'el salvador': 'ESA',
    'guatemala': 'GUA',
    'honduras': 'HON',
    'mexico': 'MEX',
    'méxico': 'MEX',
    'nicaragua': 'NCA',
    'panama': 'PAN',
    'panamá': 'PAN',
    'paraguay': 'PAR',
    'peru': 'PER',
    'perú': 'PER',
    'puerto rico': 'PUR',
    'united states': 'USA',
    'united states of america': 'USA',
    'uruguay': 'URU',
    'venezuela': 'VEN'
};

/**
 * Enforce minimum interval between Nominatim requests
 */
async function throttleNominatim() {
    const now = Date.now();
    const elapsed = now - lastGeocodeTimestamp;
    if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed));
    }
    lastGeocodeTimestamp = Date.now();
}

/**
 * Query OpenStreetMap (OSM) Nominatim Search API
 * 
 * @param {string} query - Free text search query
 * @returns {Promise<Object|null>} - Geocoded point { latitude, longitude, display_name } or null
 */
async function queryNominatim(query) {
    if (!query || typeof query !== 'string' || !query.trim()) {
        return null;
    }

    const cleanQuery = query.trim();
    await throttleNominatim();

    return new Promise((resolve) => {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanQuery)}&format=json&limit=1`;

        const req = https.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            },
            timeout: 8000
        }, (res) => {
            if (res.statusCode !== 200) {
                console.warn(`[OWLCMS_GEOCODER] Nominatim HTTP ${res.statusCode} for "${cleanQuery}"`);
                res.resume();
                return resolve(null);
            }

            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const results = JSON.parse(body);
                    if (Array.isArray(results) && results.length > 0) {
                        const lat = parseFloat(results[0].lat);
                        const lon = parseFloat(results[0].lon);
                        if (!isNaN(lat) && !isNaN(lon)) {
                            return resolve({
                                latitude: lat,
                                longitude: lon,
                                display_name: results[0].display_name
                            });
                        }
                    }
                    resolve(null);
                } catch (parseErr) {
                    console.warn(`[OWLCMS_GEOCODER] JSON parse error for "${cleanQuery}": ${parseErr.message}`);
                    resolve(null);
                }
            });
        });

        req.on('error', (err) => {
            console.warn(`[OWLCMS_GEOCODER] Network error for "${cleanQuery}": ${err.message}`);
            resolve(null);
        });

        req.on('timeout', () => {
            req.destroy();
            console.warn(`[OWLCMS_GEOCODER] Request timeout for "${cleanQuery}"`);
            resolve(null);
        });
    });
}

/**
 * Geocode an owlcms meet location using tiered cascading strategies
 * 
 * @param {Object} location - Location components
 * @param {string} [location.venue] - Venue / competitionSite free text
 * @param {string} [location.city] - City / competitionCity
 * @param {string} [location.country] - Country name or code
 * @param {Object} [location.rawComp] - Raw competition object
 * @returns {Promise<Object|null>} - Geocoded point or null
 */
async function geocodeOwlcmsMeet(location = {}) {
    const venue = (location.venue || '').trim();
    const city = (location.city || '').trim();
    const country = (location.country || '').trim();
    const rawComp = location.rawComp || {};

    const compCity = (rawComp.competitionCity || '').trim();
    const compSite = (rawComp.competitionSite || '').trim();

    const candidateQueries = [];

    // Strategy 1: Inverted city/country detection
    // Many international owlcms exports record the country in competitionCity (e.g. "Ecuador")
    // and the host city in competitionSite (e.g. "Guayaquil").
    if (compSite && compCity && compSite.toLowerCase() !== compCity.toLowerCase()) {
        candidateQueries.push({
            query: `${compSite}, ${compCity}`,
            strategy: 'site_city_pair'
        });
    }

    // Strategy 2: Specific Venue + City + Country
    if (venue && city && country && venue.toLowerCase() !== city.toLowerCase()) {
        candidateQueries.push({
            query: `${venue}, ${city}, ${country}`,
            strategy: 'venue_city_country'
        });
    }

    // Strategy 3: Venue + City
    if (venue && city && venue.toLowerCase() !== city.toLowerCase()) {
        candidateQueries.push({
            query: `${venue}, ${city}`,
            strategy: 'venue_city'
        });
    }

    // Strategy 4: City + Country
    if (city && country && city.toLowerCase() !== country.toLowerCase()) {
        candidateQueries.push({
            query: `${city}, ${country}`,
            strategy: 'city_country'
        });
    }

    // Strategy 5: City alone (e.g. "Chambly, Québec" or "Saint-Hyacinthe")
    if (city) {
        candidateQueries.push({
            query: city,
            strategy: 'city_only'
        });
    }

    // Strategy 6: Venue alone (if it contains city/address elements)
    if (venue && venue.length > 5) {
        candidateQueries.push({
            query: venue,
            strategy: 'venue_only'
        });
    }

    // Deduplicate candidate queries
    const seenQueries = new Set();
    const uniqueCandidates = [];
    for (const item of candidateQueries) {
        const norm = item.query.toLowerCase();
        if (!seenQueries.has(norm)) {
            seenQueries.add(norm);
            uniqueCandidates.push(item);
        }
    }

    // Execute candidates in priority order
    for (const cand of uniqueCandidates) {
        try {
            const result = await queryNominatim(cand.query);
            if (result) {
                console.log(`[OWLCMS_GEOCODER] Geocoded "${cand.query}" (${cand.strategy}): ${result.latitude.toFixed(4)}, ${result.longitude.toFixed(4)}`);
                return {
                    latitude: result.latitude,
                    longitude: result.longitude,
                    display_name: result.display_name,
                    strategy_used: cand.strategy,
                    query_used: cand.query
                };
            }
        } catch (err) {
            console.warn(`[OWLCMS_GEOCODER] Candidate error "${cand.query}": ${err.message}`);
        }
    }

    return null;
}

/**
 * Normalize country input into canonical 3-letter IOC code
 * 
 * @param {string} input - Country code, country name, or delegation string
 * @returns {string|null} - 3-letter IOC code or null
 */
function normalizeToIocCountryCode(input) {
    if (!input || typeof input !== 'string') {
        return null;
    }

    const trimmed = input.trim().toUpperCase();

    // Direct IOC member match
    if (trimmed.length === 3 && IOC_MEMBER_CODES.has(trimmed)) {
        return trimmed;
    }

    // Name or alias lookup
    const lower = input.trim().toLowerCase();
    if (COUNTRY_NAME_TO_IOC[lower]) {
        return COUNTRY_NAME_TO_IOC[lower];
    }

    return null;
}

module.exports = {
    geocodeOwlcmsMeet,
    queryNominatim,
    normalizeToIocCountryCode,
    IOC_MEMBER_CODES
};
