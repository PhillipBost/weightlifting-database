/**
 * IWF Lifter Manager Module
 *
 * Manages International Weightlifting Federation (IWF) athlete records in the database.
 * Handles finding existing lifters and creating new ones based on name + country matching.
 *
 * Key Features:
 * - Name normalization (uppercase, trim whitespace)
 * - Country matching for unique identification
 * - New lifter creation with biographical data
 * - Prevents duplicate lifters
 *
 * @module iwf-lifter-manager
 */

const config = require('./iwf-config');

// ============================================================================
// NORMALIZATION FUNCTIONS
// ============================================================================

/**
 * Map country codes to full country names
 * Covers most common IWF competing nations
 *
 * @param {string} code - 3-letter country code (USA, CHN, GBR, etc.)
 * @returns {string|null} - Full country name or null if not found
 */
function mapCountryCodeToName(code) {
    const countryMap = {
        // European countries
        'ALB': 'Albania',
        'AND': 'Andorra',
        'ARM': 'Armenia',
        'AUT': 'Austria',
        'AZE': 'Azerbaijan',
        'BEL': 'Belgium',
        'BIH': 'Bosnia and Herzegovina',
        'BUL': 'Bulgaria',
        'CRO': 'Croatia',
        'CYP': 'Cyprus',
        'CZE': 'Czech Republic',
        'DEN': 'Denmark',
        'EST': 'Estonia',
        'FIN': 'Finland',
        'FRA': 'France',
        'GEO': 'Georgia',
        'GER': 'Germany',
        'GRE': 'Greece',
        'GBR': 'United Kingdom',
        'HUN': 'Hungary',
        'ISL': 'Iceland',
        'IRL': 'Ireland',
        'ITA': 'Italy',
        'KOS': 'Kosovo',
        'LAT': 'Latvia',
        'LIE': 'Liechtenstein',
        'LTU': 'Lithuania',
        'LUX': 'Luxembourg',
        'MDA': 'Moldova',
        'MON': 'Monaco',
        'MNE': 'Montenegro',
        'NED': 'Netherlands',
        'NOR': 'Norway',
        'POL': 'Poland',
        'POR': 'Portugal',
        'ROU': 'Romania',
        'RUS': 'Russia',
        'SMR': 'San Marino',
        'SRB': 'Serbia',
        'SVK': 'Slovakia',
        'SVN': 'Slovenia',
        'ESP': 'Spain',
        'SWE': 'Sweden',
        'SUI': 'Switzerland',
        'TUR': 'Turkey',
        'UKR': 'Ukraine',

        // Asian countries
        'AFG': 'Afghanistan',
        'BAN': 'Bangladesh',
        'CAM': 'Cambodia',
        'CHN': 'China',
        'HKG': 'Hong Kong',
        'IND': 'India',
        'IDN': 'Indonesia',
        'IRN': 'Iran',
        'JPN': 'Japan',
        'JOR': 'Jordan',
        'KAZ': 'Kazakhstan',
        'KOR': 'South Korea',
        'KWT': 'Kuwait',
        'KGZ': 'Kyrgyzstan',
        'LAO': 'Laos',
        'LBN': 'Lebanon',
        'MAS': 'Malaysia',
        'MGL': 'Mongolia',
        'MYA': 'Myanmar',
        'NEP': 'Nepal',
        'PAK': 'Pakistan',
        'PHI': 'Philippines',
        'QAT': 'Qatar',
        'SGP': 'Singapore',
        'THA': 'Thailand',
        'TJK': 'Tajikistan',
        'TPE': 'Taiwan',
        'TKM': 'Turkmenistan',
        'UZB': 'Uzbekistan',
        'VIE': 'Vietnam',

        // Americas
        'ARG': 'Argentina',
        'BAR': 'Barbados',
        'BRA': 'Brazil',
        'CAN': 'Canada',
        'CHI': 'Chile',
        'COL': 'Colombia',
        'CRC': 'Costa Rica',
        'CUB': 'Cuba',
        'DOM': 'Dominican Republic',
        'ECU': 'Ecuador',
        'SLV': 'El Salvador',
        'GUA': 'Guatemala',
        'HAI': 'Haiti',
        'HND': 'Honduras',
        'JAM': 'Jamaica',
        'MEX': 'Mexico',
        'PAN': 'Panama',
        'PAR': 'Paraguay',
        'PER': 'Peru',
        'PUR': 'Puerto Rico',
        'URU': 'Uruguay',
        'USA': 'United States',
        'VEN': 'Venezuela',

        // Oceania
        'AUS': 'Australia',
        'FIJ': 'Fiji',
        'NZL': 'New Zealand',
        'PNG': 'Papua New Guinea',
        'SAM': 'Samoa',
        'TON': 'Tonga',

        // Africa
        'ALG': 'Algeria',
        'ANG': 'Angola',
        'BOT': 'Botswana',
        'BWA': 'Botswana',
        'CMR': 'Cameroon',
        'EGY': 'Egypt',
        'ETH': 'Ethiopia',
        'GHA': 'Ghana',
        'KEN': 'Kenya',
        'LIB': 'Libya',
        'MAR': 'Morocco',
        'MRI': 'Mauritius',
        'MOZ': 'Mozambique',
        'NAM': 'Namibia',
        'NGA': 'Nigeria',
        'RWA': 'Rwanda',
        'RSA': 'South Africa',
        'SUD': 'Sudan',
        'TAN': 'Tanzania',
        'TUN': 'Tunisia',
        'UGA': 'Uganda',
        'ZIM': 'Zimbabwe',
    };

    return countryMap[code] || null;
}

/**
 * Normalize athlete name for storage
 * Converts "LASTNAME Firstname" → "Firstname LASTNAME" format
 * Preserves mixed case (e.g., "Hao WANG", "Lasha TALAKHADZE")
 *
 * Detection logic:
 * - If first word is all caps: "LASTNAME Firstname" → reorder to "Firstname LASTNAME"
 * - If only 2 words and second is all caps: "Firstname LASTNAME" → keep as-is
 * - If entire name is all caps: likely "LASTNAME FIRSTNAME" in caps → keep as-is
 * - Otherwise: keep as provided
 *
 * @param {string} name - Athlete name from IWF results (e.g., "WANG Hao", "Hao WANG", "wang hao")
 * @returns {string} - Formatted name as "Firstname LASTNAME"
 */
function normalizeName(name) {
    if (!name || typeof name !== 'string') {
        return '';
    }

    const trimmed = name.trim();
    if (!trimmed) {
        return '';
    }

    // Split name into parts
    const parts = trimmed.split(/\s+/);
    if (parts.length === 0) {
        return '';
    }

    // If only one word, return as-is
    if (parts.length === 1) {
        return parts[0];
    }

    // Check capitalization patterns
    const firstWord = parts[0];
    const secondWord = parts[1];
    const lastWord = parts[parts.length - 1];

    const isFirstWordAllCaps = firstWord.toUpperCase() === firstWord && firstWord.length > 1;
    const isSecondWordAllCaps = secondWord && secondWord.toUpperCase() === secondWord && secondWord.length > 1;
    const isLastWordAllCaps = lastWord && lastWord.toUpperCase() === lastWord && lastWord.length > 1;
    const isEntireNameAllCaps = trimmed.toUpperCase() === trimmed;

    // If entire name is all caps, it's probably "LASTNAME FIRSTNAME" - keep as-is
    if (isEntireNameAllCaps) {
        return trimmed;
    }

    // If first word is all caps (but not the whole name), it's "LASTNAME Firstname" format
    if (isFirstWordAllCaps && !isEntireNameAllCaps) {
        // Move first word to end
        const given = parts.slice(1).join(' ');
        return `${given} ${firstWord}`;
    }

    // If we have 2 words and the second is all caps, it's "Firstname LASTNAME" - keep as-is
    if (parts.length === 2 && isSecondWordAllCaps && !isFirstWordAllCaps) {
        return trimmed;
    }

    // If last word is all caps (and first isn't), it's "Firstname LASTNAME" - keep as-is
    if (isLastWordAllCaps && !isFirstWordAllCaps) {
        return trimmed;
    }

    // Default: keep as provided
    return trimmed;
}

/**
 * Get uppercase version of name for case-insensitive matching
 * Used only for database queries
 *
 * @param {string} name - Formatted name
 * @returns {string} - Uppercase version for matching
 */
function getMatchKey(name) {
    if (!name || typeof name !== 'string') {
        return '';
    }
    return name.toUpperCase().trim();
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Find existing lifter or create new one based on name + country matching
 *
 * IWF has no membership numbers, so we match on athlete_name + country_code combination.
 * Names are stored in "Firstname LASTNAME" format and matched case-insensitively.
 * Same name in different countries = different lifters (correct behavior).
 *
 * Example:
 *   - "WANG Hao" (CHN) stored as "Hao WANG"
 *   - "WANG Hao" (USA) stored as "Hao WANG" - same formatted name, different country = different lifter
 *
 * @param {string} name - Athlete name as appears in IWF results (e.g., "WANG Hao", "Hao WANG")
 * @param {string} country - 3-letter country code (USA, CHN, GBR, etc.)
 * @param {number} birthYear - Year of birth (integer, optional)
 * @param {string} gender - 'M' or 'F' (optional)
 * @returns {Object|null} - Lifter object with db_lifter_id or null on error
 */
async function findOrCreateLifter(name, country, birthYear, gender) {
    // Validate required parameters
    if (!name || !country) {
        console.error('[Lifter Manager] Error: Missing required parameters (name, country)');
        return null;
    }

    // Normalize name format (converts "LASTNAME Firstname" → "Firstname LASTNAME" with mixed case preserved)
    const normalizedName = normalizeName(name);

    if (!normalizedName) {
        console.error('[Lifter Manager] Error: Invalid name after normalization');
        return null;
    }

    // Get uppercase version for case-insensitive matching
    const matchKey = getMatchKey(normalizedName);

    // Get country name from code
    const countryName = mapCountryCodeToName(country);

    try {
        // Step 1: Query all lifters with same country, then match by name (case-insensitive)
        const { data: liftersInCountry, error: searchError } = await config.supabaseIWF
            .from('iwf_lifters')
            .select('*')
            .eq('country_code', country);

        if (searchError) {
            console.error(`[Lifter Manager] Database error searching for lifter: ${searchError.message}`);
            return null;
        }

        // Find lifter with matching name (case-insensitive)
        if (liftersInCountry && liftersInCountry.length > 0) {
            const existingLifter = liftersInCountry.find(
                lifter => getMatchKey(lifter.athlete_name) === matchKey
            );

            if (existingLifter) {
                console.log(`[Lifter Manager] Found existing: ${normalizedName} (${country})`);
                return existingLifter;
            }
        }

        // Step 2: If not found, create new lifter
        const newLifterData = {
            athlete_name: normalizedName,      // Store as "Firstname LASTNAME" format
            gender: gender || null,
            birth_year: birthYear || null,
            country_code: country,              // 3-letter code (USA, CHN, etc.)
            country_name: countryName          // Full country name (United States, China, etc.)
        };

        const { data: newLifter, error: insertError } = await config.supabaseIWF
            .from('iwf_lifters')
            .insert([newLifterData])
            .select()
            .single();

        if (insertError) {
            console.error(`[Lifter Manager] Error creating lifter: ${insertError.message}`);
            return null;
        }

        console.log(`[Lifter Manager] Created new: ${normalizedName} (${country}${countryName ? ' - ' + countryName : ''})`);
        return newLifter;

    } catch (error) {
        console.error(`[Lifter Manager] Error in findOrCreateLifter: ${error.message}`);
        return null;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    findOrCreateLifter,
    normalizeName,
    getMatchKey,
    mapCountryCodeToName
};
