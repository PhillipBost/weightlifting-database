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

        // Special/Neutral codes
        'VAN': 'Vanuatu',
        'AIN': 'Individual Neutral Athletes',
        'WRT': 'Weightlifting Refugee Team',
        'ISR': 'Israel',
        'KUW': 'Kuwait',
        'MLT': 'Malta',
        'INA': 'Indonesia',
        'BRN': 'Bahrain',
        'UAE': 'United Arab Emirates',
        'TGA': 'Tonga',
        'PRK': 'North Korea',
        'PLE': 'Palestine',
        'NMI': 'Northern Mariana Islands',
        'NGR': 'Nigeria',
        'KSA': 'Saudi Arabia',
        'IRI': 'Iran',
        'ARU': 'Aruba',
        'ASA': 'American Samoa',
        'BDI': 'Burundi',
        'BLR': 'Belarus',
        'BOL': 'Bolivia',
        'BRU': 'Brunei',
        'CGO': 'Republic of the Congo',
        'COD': 'Democratic Republic of the Congo',
        'COK': 'Cook Islands',
        'COM': 'Comoros',
        'CPV': 'Cape Verde',
        'CUR': 'Curaçao',
        'ENG': 'England',
        'ESA': 'El Salvador',
        'FSM': 'Federated States of Micronesia',
        'GAM': 'The Gambia',
        'GEQ': 'Equatorial Guinea',
        'GIB': 'Gibraltar',
        'GUI': 'Guinea',
        'GUM': 'Guam',
        'GUY': 'Guyana',
        'HON': 'Honduras',
        'IOA': 'Independent Olympic Athletes',
        'IRQ': 'Iraq',
        'KIR': 'Kiribati',
        'KRI': 'Kiribati',
        'LBA': 'Libya',
        'LBR': 'Liberia',
        'LES': 'Lesotho',
        'MAC': 'Macao',
        'MAD': 'Madagascar',
        'MAW': 'Malawi',
        'MHL': 'Marshall Islands',
        'MTN': 'Mauritania',
        'NCA': 'Nicaragua',
        'NCL': 'New Caledonia',
        'NIC': 'Nicaragua',
        'NIR': 'Northern Ireland',
        'NIU': 'Niue',
        'NRU': 'Nauru',
        'NT': 'Northern Territory Australia',
        'OMA': 'Oman',
        'PLW': 'Palau',
        'ROC': 'Republic of China',
        'RWF': 'Russian Weightlifting Federation',
        'SCO': 'Scotland',
        'SEN': 'Senegal',
        'SEY': 'Seychelles',
        'SLE': 'Sierra Leone',
        'SLO': 'Slovenia',
        'SOL': 'Solomon Islands',
        'SRI': 'Sri Lanka',
        'SWZ': 'Eswatini',
        'SYR': 'Syria',
        'TAH': 'Tahiti',
        'TCA': 'Turks and Caicos Islands',
        'TLS': 'Timor-Leste',
        'TTO': 'Trinidad and Tobago',
        'TUV': 'Tuvalu',
        'VIN': 'Saint Vincent and the Grenadines',
        'WAL': 'Wales',
        'WLF': 'Wallis and Futuna',
        'YEM': 'Yemen',
        'ZAM': 'Zambia',
        'ZAN': 'Zanzibar',
    };
    return countryMap[code] || null;
}

/**
 * Normalize athlete name for storage
 * Converts "LASTNAME Firstname" → "Firstname LASTNAME" format
 * Handles compound last names (e.g., "FELIX DA SILVA Thiago" → "Thiago FELIX DA SILVA")
 * Handles suffixes (Jr, Sr, II, III, IV, etc.)
 * Removes country codes that leaked from extraction
 *
 * Detection logic:
 * - Extract and preserve suffixes (Jr, Sr, II, III, etc.)
 * - Remove any 3-letter all-caps country codes
 * - Find first mixed-case word (that's the first name)
 * - Everything else is last name
 * - Append suffix at end
 *
 * @param {string} name - Athlete name from IWF results (e.g., "WANG Hao", "AGAD Fernando Jr", "FELIX DA SILVA Thiago")
 * @returns {string} - Formatted name as "Firstname LASTNAME" or "Firstname LASTNAME Jr"
 */
function normalizeName(name) {
    if (!name || typeof name !== 'string') {
        return '';
    }

    let trimmed = name.trim();
    if (!trimmed) {
        return '';
    }

    // Step 1: Extract and remove suffixes (Jr, Sr, II, III, IV, V, VI, VII, VIII, IX, X, etc.)
    let suffix = null;
    const suffixPattern = /\s+(Jr\.?|Sr\.?|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)(?:\s|$)/i;
    const suffixMatch = trimmed.match(suffixPattern);
    if (suffixMatch) {
        suffix = suffixMatch[1].replace(/\.$/, '');  // Remove trailing dot if present
        trimmed = trimmed.replace(suffixPattern, ' ').trim();
    }

    // Step 2: Remove any 3-letter country codes (leaked from extraction)
    trimmed = trimmed.replace(/\s+([A-Z]{3})\s*(?:\([A-Z]{3}\))?(?=\s|$)/g, ' ').trim();

    // Step 3: Split into parts
    const parts = trimmed.split(/\s+/).filter(p => p.length > 0);
    if (parts.length === 0) {
        return '';
    }

    // If only one word, return as-is (plus suffix if present)
    if (parts.length === 1) {
        return suffix ? `${parts[0]} ${suffix}` : parts[0];
    }

    // Step 4: Detect LASTNAME position using IWF naming pattern
    // IWF format: LASTNAME FirstNames/Initials
    // LASTNAME = first word if mixed-case, OR consecutive all-caps words >1 char until hitting initial or mixed-case
    let lastNameEndIndex = 0;
    const firstWord = parts[0];
    const hasUpper = /[A-Z]/.test(firstWord);
    const hasLower = /[a-z]/.test(firstWord);
    
    if (hasUpper && hasLower) {
        // First word is mixed-case (e.g., AlQAHTANI) → it's the LASTNAME
        lastNameEndIndex = 1;
    } else {
        // Collect consecutive all-caps multi-character words
        for (let i = 0; i < parts.length; i++) {
            const word = parts[i];
            const isAllCaps = word.toUpperCase() === word;
            const isMultiChar = word.length > 1;
            
            if (isAllCaps && isMultiChar) {
                // This is part of LASTNAME
                lastNameEndIndex = i + 1;
            } else {
                // Stop at first single-letter word (initial) or mixed-case word
                break;
            }
        }
    }
    
    let finalName = trimmed;  // Default: keep as-is

    // Step 5: Rearrange: move LASTNAME to end
    if (lastNameEndIndex > 0 && lastNameEndIndex < parts.length) {
        const lastName = parts.slice(0, lastNameEndIndex).join(' ');
        const givenName = parts.slice(lastNameEndIndex).join(' ');
        finalName = `${givenName} ${lastName}`;
    }

    // Step 6: Add suffix back at the end
    if (suffix) {
        finalName = `${finalName} ${suffix}`;
    }

    return finalName;
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
 * Find existing lifter or create new one using IWF ID, with fallback to name+country matching
 *
 * Matching priority:
 * 1. IWF Lifter ID (iwf_lifter_id) - globally unique, primary key
 * 2. Athlete name + country code combination - fallback for athletes without IWF profile
 *
 * Names are stored in "Firstname LASTNAME" format and matched case-insensitively.
 * Same name in different countries = different lifters (correct behavior).
 *
 * Example:
 *   - "WANG Hao" (CHN) from IWF profile ID 14318 → matched by ID, stored as "Hao WANG"
 *   - "WANG Hao" (USA) with no IWF ID → matched by name+country, different lifter
 *
 * @param {string} name - Athlete name as appears in IWF results
 * @param {string} country - 3-letter country code (USA, CHN, GBR, etc.)
 * @param {number} birthYear - Year of birth (integer, optional)
 * @param {string} gender - 'M' or 'F' (optional)
 * @param {number} iWFLifterId - IWF official athlete ID from profile URL (optional, primary key)
 * @param {string} iWFAthleteUrl - Full URL to IWF athlete profile (optional)
 * @returns {Object|null} - Lifter object with db_lifter_id or null on error
 */
async function findOrCreateLifter(name, country, birthYear, gender, iWFLifterId, iWFAthleteUrl) {
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
        // Step 1: If we have an IWF lifter ID, use that as primary key (globally unique)
        if (iWFLifterId) {
            const { data: lifterByIWFId, error: iwfSearchError } = await config.supabaseIWF
                .from('iwf_lifters')
                .select('*')
                .eq('iwf_lifter_id', iWFLifterId)
                .single();

            if (!iwfSearchError && lifterByIWFId) {
                console.log(`[Lifter Manager] Found existing by IWF ID: ${normalizedName} (${country})`);
                return lifterByIWFId;
            }
        }

        // Step 2: Fallback to name + country matching with birth_year consideration
        // Matching hierarchy: name+country+birth_year → name+country (with warning)
        const { data: liftersInCountry, error: searchError } = await config.supabaseIWF
            .from('iwf_lifters')
            .select('*')
            .eq('country_code', country);

        if (searchError) {
            console.error(`[Lifter Manager] Database error searching for lifter: ${searchError.message}`);
            return null;
        }

        let existingLifter = null;

        if (liftersInCountry && liftersInCountry.length > 0) {
            // First priority: match by name + country + birth_year (if birth_year available)
            if (birthYear) {
                existingLifter = liftersInCountry.find(
                    lifter => getMatchKey(lifter.athlete_name) === matchKey && lifter.birth_year === birthYear
                );

                if (existingLifter) {
                    console.log(`[Lifter Manager] Found existing by name+country+birth_year: ${normalizedName} (${country}, born ${birthYear})`);
                }
            }

            // Fallback: match by name + country only (if no birth_year match found)
            if (!existingLifter) {
                const nameMatches = liftersInCountry.filter(
                    lifter => getMatchKey(lifter.athlete_name) === matchKey
                );

                if (nameMatches.length > 0) {
                    existingLifter = nameMatches[0];

                    // Warn if multiple athletes with same name in same country (potential collision)
                    if (nameMatches.length > 1) {
                        const otherBirthYears = nameMatches
                            .map(l => l.birth_year || 'unknown')
                            .join(', ');
                        console.warn(`[Lifter Manager] WARNING: ${nameMatches.length} athletes named "${normalizedName}" in ${country}. ` +
                            `Matched by name only. Birth years: ${otherBirthYears}. ` +
                            `Current athlete birth year: ${birthYear || 'unknown'}. ` +
                            `Consider providing more distinguishing data.`);
                    } else if (birthYear && existingLifter.birth_year && existingLifter.birth_year !== birthYear) {
                        // Single match but birth year differs - potential mismatch
                        console.warn(`[Lifter Manager] WARNING: Name match but birth year differs. ` +
                            `Expected ${birthYear}, found ${existingLifter.birth_year} for ${normalizedName} (${country}). ` +
                            `Matched by name only due to missing IWF ID.`);
                    }

                    console.log(`[Lifter Manager] Found existing by name+country: ${normalizedName} (${country})`);
                }
            }

            if (existingLifter) {
                // Update with IWF ID and URL if we have them and they're not already set
                if ((iWFLifterId || iWFAthleteUrl) && (!existingLifter.iwf_lifter_id || !existingLifter.iwf_athlete_url)) {
                    const updateData = {};
                    if (iWFLifterId && !existingLifter.iwf_lifter_id) {
                        updateData.iwf_lifter_id = iWFLifterId;
                        console.log(`[Lifter Manager] Updating lifter ${existingLifter.db_lifter_id} with IWF ID: ${iWFLifterId}`);
                    }
                    if (iWFAthleteUrl && !existingLifter.iwf_athlete_url) {
                        updateData.iwf_athlete_url = iWFAthleteUrl;
                    }

                    if (Object.keys(updateData).length > 0) {
                        await config.supabaseIWF
                            .from('iwf_lifters')
                            .update(updateData)
                            .eq('db_lifter_id', existingLifter.db_lifter_id);
                    }
                }
                return existingLifter;
            }
        }

        // Step 3: If not found by IWF ID or name+country, create new lifter
        const newLifterData = {
            athlete_name: normalizedName,      // Store as "Firstname LASTNAME" format
            gender: gender || null,
            birth_year: birthYear || null,
            country_code: country,              // 3-letter code (USA, CHN, etc.)
            country_name: countryName,          // Full country name (United States, China, etc.)
            iwf_lifter_id: iWFLifterId || null,      // IWF official athlete ID from profile URL
            iwf_athlete_url: iWFAthleteUrl || null   // Full URL to IWF athlete profile
        };

        const { data: newLifter, error: insertError } = await config.supabaseIWF
            .from('iwf_lifters')
            .insert([newLifterData])
            .select('*')
            .single();

        if (insertError) {
            console.error(`[Lifter Manager] Error creating lifter: ${insertError.message}`);
            return null;
        }

        if (!newLifter) {
            console.error(`[Lifter Manager] Insert succeeded but no data returned for: ${normalizedName}`);
            return null;
        }

        if (!newLifter.db_lifter_id) {
            console.warn(`[Lifter Manager] Warning: db_lifter_id is null for ${normalizedName}. Full lifter object:`, JSON.stringify(newLifter));
        }

        console.log(`[Lifter Manager] Created new: ${normalizedName} (${country}${countryName ? ' - ' + countryName : ''}) - ID: ${newLifter.db_lifter_id}`);
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
