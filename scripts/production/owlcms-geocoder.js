/**
 * OWLCMS Meet Geocoding & Country Normalization Service
 * 
 * Geocodes Open Weightlifting Competition Management System (OWLCMS) host venues,
 * cities, and countries using a high-accuracy, cascading pipeline:
 *   1. Primary Engine: Photon Geocoder (https://photon.komoot.io) powered by
 *      OpenStreetMap (OSM) data with GeoJSON geometry and Point of Interest (POI) resolution.
 *   2. Fallback Engine: OpenStreetMap (OSM) Nominatim API with 1.1s rate limiting.
 * 
 * Implements cascading address resolution:
 *   - Query 1 (Composite): "{venue}, {city}"
 *   - Query 2 (Primary Address): Street address extracted from compound venue + city
 *   - Query 3 (City + Country fallback): "{city}, {country_name}"
 * 
 * Provides canonical International Olympic Committee (IOC) and International
 * Organization for Standardization (ISO) 3166-1 alpha-2 country validation.
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

// Rate limiting: 1.1s minimum delay between external Nominatim API calls
let lastNominatimTimestamp = 0;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const USER_AGENT = 'WeightliftingDB-OWLCMS-Geocoder/2.0 (https://weightliftingdb.com)';

// Canonical IOC 3-letter member codes
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

// Common IOC to ISO 3166-1 alpha-2 mapping overrides (where IOC differs from ISO-2 or requires standard mapping)
const IOC_TO_ISO2_MAP = {
    'AFG': 'AF', 'ALB': 'AL', 'ALG': 'DZ', 'AND': 'AD', 'ANG': 'AO', 'ANT': 'AN', 'ARG': 'AR',
    'ARM': 'AM', 'ARU': 'AW', 'ASA': 'AS', 'AUS': 'AU', 'AUT': 'AT', 'AZE': 'AZ', 'BAH': 'BS',
    'BAN': 'BD', 'BAR': 'BB', 'BDI': 'BI', 'BEL': 'BE', 'BEN': 'BJ', 'BER': 'BM', 'BHU': 'BT',
    'BIH': 'BA', 'BIZ': 'BZ', 'BLR': 'BY', 'BOL': 'BO', 'BOT': 'BW', 'BRA': 'BR', 'BRN': 'BH',
    'BRU': 'BN', 'BUL': 'BG', 'BUR': 'BF', 'CAF': 'CF', 'CAM': 'KH', 'CAN': 'CA', 'CAY': 'KY',
    'CGO': 'CG', 'CHA': 'TD', 'CHI': 'CL', 'CHN': 'CN', 'CIV': 'CI', 'CMR': 'CM', 'COD': 'CD',
    'COK': 'CK', 'COL': 'CO', 'COM': 'KM', 'CPV': 'CV', 'CRC': 'CR', 'CRO': 'HR', 'CUB': 'CU',
    'CYP': 'CY', 'CZE': 'CZ', 'DEN': 'DK', 'DJI': 'DJ', 'DMA': 'DM', 'DOM': 'DO', 'ECU': 'EC',
    'EGY': 'EG', 'ERI': 'ER', 'ESA': 'SV', 'ESP': 'ES', 'EST': 'EE', 'ETH': 'ET', 'FIJ': 'FJ',
    'FIN': 'FI', 'FRA': 'FR', 'FSM': 'FM', 'GAB': 'GA', 'GAM': 'GM', 'GBR': 'GB', 'GBS': 'GW',
    'GEO': 'GE', 'GEQ': 'GQ', 'GER': 'DE', 'GHA': 'GH', 'GRE': 'GR', 'GRN': 'GD', 'GUA': 'GT',
    'GUI': 'GN', 'GUM': 'GU', 'GUY': 'GY', 'HAI': 'HT', 'HKG': 'HK', 'HON': 'HN', 'HUN': 'HU',
    'INA': 'ID', 'IND': 'IN', 'IRI': 'IR', 'IRL': 'IE', 'IRQ': 'IQ', 'ISL': 'IS', 'ISR': 'IL',
    'ISV': 'VI', 'ITA': 'IT', 'IVB': 'VG', 'JAM': 'JM', 'JOR': 'JO', 'JPN': 'JP', 'KAZ': 'KZ',
    'KEN': 'KE', 'KGZ': 'KG', 'KIR': 'KI', 'KOR': 'KR', 'KSA': 'SA', 'KUW': 'KW', 'LAO': 'LA',
    'LAT': 'LV', 'LBA': 'LY', 'LBN': 'LB', 'LBR': 'LR', 'LCA': 'LC', 'LES': 'LS', 'LIE': 'LI',
    'LTU': 'LT', 'LUX': 'LU', 'MAD': 'MG', 'MAR': 'MA', 'MAS': 'MY', 'MAW': 'MW', 'MDA': 'MD',
    'MDV': 'MV', 'MEX': 'MX', 'MGL': 'MN', 'MHL': 'MH', 'MKD': 'MK', 'MLI': 'ML', 'MLT': 'MT',
    'MNE': 'ME', 'MON': 'MC', 'MOZ': 'MZ', 'MRI': 'MU', 'MTN': 'MR', 'MYA': 'MM', 'NAM': 'NA',
    'NCA': 'NI', 'NED': 'NL', 'NEP': 'NP', 'NGR': 'NG', 'NIG': 'NE', 'NOR': 'NO', 'NRU': 'NR',
    'NZL': 'NZ', 'OMA': 'OM', 'PAK': 'PK', 'PAN': 'PA', 'PAR': 'PY', 'PER': 'PE', 'PHI': 'PH',
    'PLE': 'PS', 'PLW': 'PW', 'PNG': 'PG', 'POL': 'PL', 'POR': 'PT', 'PRK': 'KP', 'PUR': 'PR',
    'QAT': 'QA', 'ROU': 'RO', 'RSA': 'ZA', 'RUS': 'RU', 'RWA': 'RW', 'SAM': 'WS', 'SEN': 'SN',
    'SEY': 'SC', 'SGP': 'SG', 'SKN': 'KN', 'SLE': 'SL', 'SLO': 'SI', 'SMR': 'SM', 'SOL': 'SB',
    'SOM': 'SO', 'SRB': 'RS', 'SRI': 'LK', 'SSD': 'SS', 'STP': 'ST', 'SUD': 'SD', 'SUI': 'CH',
    'SUR': 'SR', 'SVK': 'SK', 'SWE': 'SE', 'SWZ': 'SZ', 'SYR': 'SY', 'TAN': 'TZ', 'TGA': 'TO',
    'THA': 'TH', 'TJK': 'TJ', 'TKM': 'TM', 'TLS': 'TL', 'TOG': 'TG', 'TPE': 'TW', 'TTO': 'TT',
    'TUN': 'TN', 'TUR': 'TR', 'TUV': 'TV', 'UAE': 'AE', 'UGA': 'UG', 'UKR': 'UA', 'URU': 'UY',
    'USA': 'US', 'UZB': 'UZ', 'VAN': 'VU', 'VEN': 'VE', 'VIE': 'VN', 'VIN': 'VC', 'YEM': 'YE',
    'ZAM': 'ZM', 'ZIM': 'ZW'
};

// Build inverted ISO-2 to IOC mapping
const ISO2_TO_IOC_MAP = {};
for (const [ioc, iso2] of Object.entries(IOC_TO_ISO2_MAP)) {
    ISO2_TO_IOC_MAP[iso2] = ioc;
}

// Country name to IOC mapping dictionary
const COUNTRY_NAME_TO_IOC = {
    'argentina': 'ARG', 'aruba': 'ARU', 'australia': 'AUS', 'austria': 'AUT',
    'bahrain': 'BRN', 'belarus': 'BLR', 'belgium': 'BEL', 'bolivia': 'BOL',
    'brazil': 'BRA', 'brasil': 'BRA', 'bulgaria': 'BUL', 'canada': 'CAN',
    'chile': 'CHI', 'china': 'CHN', 'colombia': 'COL', 'costa rica': 'CRC',
    'croatia': 'CRO', 'cuba': 'CUB', 'czech republic': 'CZE', 'czechia': 'CZE',
    'denmark': 'DEN', 'dominican republic': 'DOM', 'republica dominicana': 'DOM',
    'ecuador': 'ECU', 'egypt': 'EGY', 'el salvador': 'ESA', 'estonia': 'EST',
    'fiji': 'FIJ', 'finland': 'FIN', 'france': 'FRA', 'georgia': 'GEO',
    'germany': 'GER', 'great britain': 'GBR', 'greece': 'GRE', 'guatemala': 'GUA',
    'honduras': 'HON', 'hungary': 'HUN', 'iceland': 'ISL', 'india': 'IND',
    'indonesia': 'INA', 'iran': 'IRI', 'iraq': 'IRQ', 'ireland': 'IRL',
    'israel': 'ISR', 'italy': 'ITA', 'jamaica': 'JAM', 'japan': 'JPN',
    'kazakhstan': 'KAZ', 'kenya': 'KEN', 'kuwait': 'KUW', 'latvia': 'LAT',
    'lithuania': 'LTU', 'malaysia': 'MAS', 'mexico': 'MEX', 'méxico': 'MEX',
    'moldova': 'MDA', 'mongolia': 'MGL', 'nauru': 'NRU', 'netherlands': 'NED',
    'new zealand': 'NZL', 'nicaragua': 'NCA', 'nigeria': 'NGR', 'norway': 'NOR',
    'panama': 'PAN', 'panamá': 'PAN', 'papua new guinea': 'PNG', 'paraguay': 'PAR',
    'peru': 'PER', 'perú': 'PER', 'philippines': 'PHI', 'poland': 'POL',
    'portugal': 'POR', 'puerto rico': 'PUR', 'qatar': 'QAT', 'romania': 'ROU',
    'russia': 'RUS', 'saudi arabia': 'KSA', 'serbia': 'SRB', 'singapore': 'SGP',
    'slovakia': 'SVK', 'south africa': 'RSA', 'south korea': 'KOR', 'korea': 'KOR',
    'spain': 'ESP', 'sweden': 'SWE', 'switzerland': 'SUI', 'taiwan': 'TPE',
    'chinese taipei': 'TPE', 'thailand': 'THA', 'tunisia': 'TUN', 'turkey': 'TUR',
    'türkiye': 'TUR', 'ukraine': 'UKR', 'united arab emirates': 'UAE',
    'united kingdom': 'GBR', 'united states': 'USA', 'united states of america': 'USA',
    'uruguay': 'URU', 'uzbekistan': 'UZB', 'venezuela': 'VEN', 'vietnam': 'VIE'
};

// IOC to Canonical Country Name mapping
const IOC_TO_COUNTRY_NAME = {};
for (const [name, ioc] of Object.entries(COUNTRY_NAME_TO_IOC)) {
    if (!IOC_TO_COUNTRY_NAME[ioc]) {
        IOC_TO_COUNTRY_NAME[ioc] = name.charAt(0).toUpperCase() + name.slice(1);
    }
}

// Ingest member roster from iwf-2026-members.json if available
try {
    const rosterPath = path.join(__dirname, 'iwf-2026-members.json');
    if (fs.existsSync(rosterPath)) {
        const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
        if (Array.isArray(roster)) {
            for (const item of roster) {
                if (item.code && item.country) {
                    IOC_TO_COUNTRY_NAME[item.code] = item.country;
                    COUNTRY_NAME_TO_IOC[item.country.toLowerCase()] = item.code;
                }
            }
        }
    }
} catch (loadErr) {
    console.warn('[OWLCMS_GEOCODER] Non-fatal notice loading iwf-2026-members.json:', loadErr.message);
}

/**
 * Enforce minimum interval between Nominatim requests
 */
async function throttleNominatim() {
    const now = Date.now();
    const elapsed = now - lastNominatimTimestamp;
    if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed));
    }
    lastNominatimTimestamp = Date.now();
}

/**
 * Query Photon Geocoder API (komoot.io)
 * Returns array of GeoJSON features with [lng, lat] geometry
 * 
 * @param {string} query - Free text search query
 * @returns {Promise<Array<Object>|null>} - Array of GeoJSON features or null
 */
async function queryPhoton(query) {
    if (!query || typeof query !== 'string' || !query.trim()) {
        return null;
    }

    const cleanQuery = query.trim();

    return new Promise((resolve) => {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(cleanQuery)}&limit=3`;

        const req = https.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            },
            timeout: 6000
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(null);
            }

            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data && Array.isArray(data.features) && data.features.length > 0) {
                        return resolve(data.features);
                    }
                    resolve(null);
                } catch {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
}

/**
 * Query OpenStreetMap (OSM) Nominatim Search API
 * 
 * @param {string} query - Free text search query
 * @returns {Promise<Object|null>} - Geocoded point { latitude, longitude, display_name, country_code } or null
 */
async function queryNominatim(query) {
    if (!query || typeof query !== 'string' || !query.trim()) {
        return null;
    }

    const cleanQuery = query.trim();
    await throttleNominatim();

    return new Promise((resolve) => {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanQuery)}&format=json&addressdetails=1&limit=1`;

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
                            const addr = results[0].address || {};
                            return resolve({
                                latitude: lat,
                                longitude: lon,
                                display_name: results[0].display_name,
                                country_code: (addr.country_code || '').toUpperCase(),
                                country_name: addr.country || ''
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
 * Extract primary street address portion from compound venue name
 * (e.g. "Eastlake Football Club, 51 Hinder St" -> "51 Hinder St")
 * 
 * @param {string} venue - Raw venue string
 * @returns {string|null} - Extracted street address or null
 */
function extractStreetAddress(venue) {
    if (!venue || typeof venue !== 'string' || !venue.includes(',')) {
        return null;
    }

    const parts = venue.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;

    // Identify part containing digits or road suffix keywords
    const streetRegex = /\b(street|st|road|rd|avenue|ave|boulevard|blvd|way|drive|dr|court|ct|lane|ln|highway|hwy|place|pl|route|rte)\b/i;
    const match = parts.find(p => /\d+/.test(p) || streetRegex.test(p));
    return match || parts[parts.length - 1];
}

/**
 * Geocode an owlcms meet location using cascading multi-engine strategy
 * 
 * Cascading Resolution Strategy:
 *   - Query 1 (Composite): "{venue}, {city}"
 *   - Query 2 (Primary Address): If venue contains commas, split to extract street address + city
 *   - Query 3 (City + Country fallback): "{city}, {country_name}"
 *   - Inverted Site/City fallback: for international meets where country was parsed into city
 * 
 * Validation:
 *   - Verifies resolved country matches host_country_code (e.g. AU / AUS).
 *   - Extracts latitude and longitude from feature geometry ([lng, lat]).
 * 
 * @param {Object} location - Location components
 * @param {string} [location.venue] - Venue / competitionSite free text
 * @param {string} [location.city] - City / competitionCity
 * @param {string} [location.country] - Country name or IOC country code
 * @param {Object} [location.rawComp] - Raw competition object
 * @returns {Promise<Object|null>} - Geocoded point or null
 */
async function geocodeOwlcmsMeet(location = {}) {
    const venue = (location.venue || '').trim();
    const city = (location.city || '').trim();
    const rawCountry = (location.country || '').trim();
    const rawComp = location.rawComp || {};

    const compCity = (rawComp.competitionCity || '').trim();
    const compSite = (rawComp.competitionSite || '').trim();

    // Canonicalize host country parameters
    const hostIoc = normalizeToIocCountryCode(rawCountry);
    const expectedIso2 = hostIoc ? IOC_TO_ISO2_MAP[hostIoc] : null;
    const countryName = (hostIoc && IOC_TO_COUNTRY_NAME[hostIoc])
        ? IOC_TO_COUNTRY_NAME[hostIoc]
        : (rawCountry.length > 3 ? rawCountry : '');

    const candidateQueries = [];

    // Query 1 (Composite): "{venue}, {city}"
    if (venue && city && venue.toLowerCase() !== city.toLowerCase()) {
        candidateQueries.push({
            query: `${venue}, ${city}`,
            strategy: 'composite_venue_city'
        });
    }

    // Query 2 (Primary Address): If venue contains commas, split to extract street address + city
    const streetAddress = extractStreetAddress(venue);
    if (streetAddress && city && streetAddress.toLowerCase() !== venue.toLowerCase()) {
        candidateQueries.push({
            query: `${streetAddress}, ${city}`,
            strategy: 'primary_street_address_city'
        });
    }

    // Inverted city/country detection for international meets
    if (compSite && compCity && compSite.toLowerCase() !== compCity.toLowerCase()) {
        candidateQueries.push({
            query: `${compSite}, ${compCity}`,
            strategy: 'site_city_pair'
        });
    }

    // Query 3 (City + Country fallback): "{city}, {country_name}"
    if (city && countryName && city.toLowerCase() !== countryName.toLowerCase()) {
        candidateQueries.push({
            query: `${city}, ${countryName}`,
            strategy: 'city_country'
        });
    }

    // Secondary Fallbacks:
    if (venue && countryName && venue.toLowerCase() !== countryName.toLowerCase()) {
        candidateQueries.push({
            query: `${venue}, ${countryName}`,
            strategy: 'venue_country'
        });
    }

    if (city) {
        candidateQueries.push({
            query: city,
            strategy: 'city_only'
        });
    }

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
            // 1. Try Primary Engine: Photon (komoot.io)
            const photonFeatures = await queryPhoton(cand.query);
            if (photonFeatures && photonFeatures.length > 0) {
                for (const f of photonFeatures) {
                    if (!f.geometry || !Array.isArray(f.geometry.coordinates)) continue;
                    const [lng, lat] = f.geometry.coordinates;
                    if (isNaN(lat) || isNaN(lng)) continue;

                    const fIso2 = (f.properties.countrycode || '').toUpperCase();
                    const fCountry = f.properties.country || '';

                    // Validate country against expectedIso2 if available
                    if (expectedIso2 && fIso2 && fIso2 !== expectedIso2) {
                        continue;
                    }

                    const displayName = [f.properties.name, f.properties.street, f.properties.city, fCountry]
                        .filter(Boolean)
                        .join(', ');

                    console.log(`[OWLCMS_GEOCODER] Photon geocoded "${cand.query}" (${cand.strategy}): [${lat.toFixed(6)}, ${lng.toFixed(6)}]`);
                    return {
                        latitude: lat,
                        longitude: lng,
                        display_name: displayName || cand.query,
                        strategy_used: cand.strategy,
                        query_used: cand.query,
                        provider: 'photon',
                        country_code: fIso2,
                        country_name: fCountry,
                        ioc_country_code: hostIoc || (fIso2 ? ISO2_TO_IOC_MAP[fIso2] : null)
                    };
                }
            }

            // 2. Try Fallback Engine: OpenStreetMap Nominatim
            const nomResult = await queryNominatim(cand.query);
            if (nomResult) {
                // Validate country against expectedIso2 if available
                if (expectedIso2 && nomResult.country_code && nomResult.country_code !== expectedIso2) {
                    continue;
                }

                console.log(`[OWLCMS_GEOCODER] Nominatim geocoded "${cand.query}" (${cand.strategy}): [${nomResult.latitude.toFixed(6)}, ${nomResult.longitude.toFixed(6)}]`);
                return {
                    latitude: nomResult.latitude,
                    longitude: nomResult.longitude,
                    display_name: nomResult.display_name,
                    strategy_used: cand.strategy,
                    query_used: cand.query,
                    provider: 'nominatim',
                    country_code: nomResult.country_code,
                    country_name: nomResult.country_name,
                    ioc_country_code: hostIoc || (nomResult.country_code ? ISO2_TO_IOC_MAP[nomResult.country_code] : null)
                };
            }
        } catch (err) {
            console.warn(`[OWLCMS_GEOCODER] Candidate error for "${cand.query}": ${err.message}`);
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

    // ISO-2 to IOC match
    if (trimmed.length === 2 && ISO2_TO_IOC_MAP[trimmed]) {
        return ISO2_TO_IOC_MAP[trimmed];
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
    queryPhoton,
    queryNominatim,
    extractStreetAddress,
    normalizeToIocCountryCode,
    IOC_MEMBER_CODES,
    IOC_TO_ISO2_MAP,
    ISO2_TO_IOC_MAP,
    COUNTRY_NAME_TO_IOC,
    IOC_TO_COUNTRY_NAME
};
