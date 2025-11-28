/**
 * FIX ADDRESS PARSING
 * 
 * Repairs corrupted address data in the meets table where fields were misaligned
 * due to flawed parsing logic. Uses intelligent parsing strategies to correctly
 * extract street address, city, state, ZIP code, and country components.
 * 
 * Usage:
 *   node fix-address-parsing.js --preview    # Show what would be changed
 *   node fix-address-parsing.js --execute    # Apply fixes to database
 *   node fix-address-parsing.js --limit 100  # Process only first 100 records
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
const LOG_FILE = path.join(LOGS_DIR, 'fix-address-parsing.log');

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

// Comprehensive US States, Territories, and Military Regions
const US_STATES = {
    // States (full names and abbreviations)
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
    'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
    'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
    'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
    'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
    'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
    'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',

    // US Territories and Military
    'district of columbia': 'DC', 'american samoa': 'AS', 'guam': 'GU', 'northern mariana islands': 'MP',
    'puerto rico': 'PR', 'us virgin islands': 'VI', 'virgin islands': 'VI',
    'armed forces americas': 'AA', 'armed forces europe': 'AE', 'armed forces pacific': 'AP',

    // Common abbreviations
    'al': 'AL', 'ak': 'AK', 'az': 'AZ', 'ar': 'AR', 'ca': 'CA', 'co': 'CO', 'ct': 'CT', 'de': 'DE',
    'fl': 'FL', 'ga': 'GA', 'hi': 'HI', 'id': 'ID', 'il': 'IL', 'in': 'IN', 'ia': 'IA', 'ks': 'KS',
    'ky': 'KY', 'la': 'LA', 'me': 'ME', 'md': 'MD', 'ma': 'MA', 'mi': 'MI', 'mn': 'MN', 'ms': 'MS',
    'mo': 'MO', 'mt': 'MT', 'ne': 'NE', 'nv': 'NV', 'nh': 'NH', 'nj': 'NJ', 'nm': 'NM', 'ny': 'NY',
    'nc': 'NC', 'nd': 'ND', 'oh': 'OH', 'ok': 'OK', 'or': 'OR', 'pa': 'PA', 'ri': 'RI', 'sc': 'SC',
    'sd': 'SD', 'tn': 'TN', 'tx': 'TX', 'ut': 'UT', 'vt': 'VT', 'va': 'VA', 'wa': 'WA', 'wv': 'WV',
    'wi': 'WI', 'wy': 'WY', 'dc': 'DC', 'as': 'AS', 'gu': 'GU', 'mp': 'MP', 'pr': 'PR', 'vi': 'VI',
    'aa': 'AA', 'ae': 'AE', 'ap': 'AP'
};

// Country variations to identify and normalize
const COUNTRY_VARIATIONS = [
    'united states of america', 'united states', 'usa', 'us', 'america',
    'u.s.a.', 'u.s.', 'united states of america.', 'usa.', 'us.'
];

/**
 * Intelligent address parsing using multiple strategies
 */
function parseAddressIntelligently(rawAddress) {
    if (!rawAddress || typeof rawAddress !== 'string') {
        return {
            street_address: '',
            city: '',
            state: '',
            zip_code: '',
            country: 'United States',
            parsing_method: 'empty_input'
        };
    }

    const originalAddress = rawAddress.trim();
    let parts = originalAddress.split(',').map(p => p.trim()).filter(p => p.length > 0);

    if (parts.length === 0) {
        return {
            street_address: '',
            city: '',
            state: '',
            zip_code: '',
            country: 'United States',
            parsing_method: 'no_parts'
        };
    }

    let street_address = '';
    let city = '';
    let state = '';
    let zip_code = '';
    let country = 'United States';
    let parsing_method = '';

    // Strategy 1: ZIP Code Detection
    let zipIndex = -1;
    let zipPart = '';
    const zipRegex = /\b\d{5}(-\d{4})?\b/;

    for (let i = parts.length - 1; i >= 0; i--) {
        const match = parts[i].match(zipRegex);
        if (match) {
            zipIndex = i;
            zip_code = match[0];
            // Remove ZIP from the part (might have other text)
            zipPart = parts[i].replace(match[0], '').trim();
            parsing_method += 'zip_detected,';
            break;
        }
    }

    // Strategy 2: Country Detection and Removal
    let countryIndex = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
        const partLower = parts[i].toLowerCase();
        if (COUNTRY_VARIATIONS.some(country => partLower.includes(country))) {
            countryIndex = i;
            country = 'United States';
            parsing_method += 'country_detected,';
            break;
        }
    }

    // Strategy 3: State Detection
    let stateIndex = -1;
    let detectedState = '';

    // Check parts from right to left, but skip country and ZIP parts
    for (let i = parts.length - 1; i >= 0; i--) {
        if (i === countryIndex) continue; // Skip country part

        const partLower = parts[i].toLowerCase().trim();

        // Check if this part (or zipPart if this is zip index) contains a state
        const textToCheck = (i === zipIndex && zipPart) ? zipPart.toLowerCase() : partLower;

        if (US_STATES[textToCheck]) {
            stateIndex = i;
            detectedState = US_STATES[textToCheck];
            state = detectedState;
            parsing_method += 'state_detected,';
            break;
        }

        // Check if part contains state as substring (for cases like "CA 90210")
        for (const [stateName, stateAbbr] of Object.entries(US_STATES)) {
            if (textToCheck.includes(stateName) && stateName.length > 2) {
                stateIndex = i;
                detectedState = stateAbbr;
                state = detectedState;
                parsing_method += 'state_substring,';
                break;
            }
        }

        if (detectedState) break;
    }

    // Strategy 4: City Detection
    // City is typically the part before the state (if state found) or before ZIP
    let cityIndex = -1;

    if (stateIndex > 0) {
        // City is likely the part before state
        cityIndex = stateIndex - 1;
        city = parts[cityIndex];
        parsing_method += 'city_before_state,';
    } else if (zipIndex > 0) {
        // No state found, city is likely before ZIP
        cityIndex = zipIndex - 1;
        city = parts[cityIndex];
        parsing_method += 'city_before_zip,';
    } else if (parts.length >= 2) {
        // Fallback: second-to-last non-country part
        for (let i = parts.length - 1; i >= 0; i--) {
            if (i !== countryIndex && i !== zipIndex) {
                cityIndex = i;
                city = parts[i];
                parsing_method += 'city_fallback,';
                break;
            }
        }
    }

    // Strategy 5: Street Address
    // Everything before the city (or remaining parts if no clear city)
    const usedIndices = new Set([countryIndex, zipIndex, stateIndex, cityIndex].filter(i => i >= 0));
    const streetParts = [];

    for (let i = 0; i < parts.length; i++) {
        if (!usedIndices.has(i)) {
            streetParts.push(parts[i]);
        } else if (i === cityIndex) {
            // Include everything before city index as street address
            break;
        }
    }

    // If we have a clear city, only take parts before it
    if (cityIndex >= 0) {
        street_address = parts.slice(0, cityIndex).join(', ');
        parsing_method += 'street_before_city,';
    } else if (streetParts.length > 0) {
        street_address = streetParts.join(', ');
        parsing_method += 'street_remaining,';
    }

    // Strategy 6: Fallback parsing for simple cases
    if (!parsing_method || parsing_method === '') {
        if (parts.length === 1) {
            // Single part - likely just a city or venue name
            city = parts[0];
            parsing_method = 'single_part_city,';
        } else if (parts.length === 2) {
            // Two parts - likely "city, state" or "street, city"
            if (US_STATES[parts[1].toLowerCase()]) {
                city = parts[0];
                state = US_STATES[parts[1].toLowerCase()];
                parsing_method = 'two_part_city_state,';
            } else {
                street_address = parts[0];
                city = parts[1];
                parsing_method = 'two_part_street_city,';
            }
        } else {
            // Multiple parts - best guess
            street_address = parts.slice(0, -2).join(', ');
            city = parts[parts.length - 2];
            state = parts[parts.length - 1];
            parsing_method = 'multi_part_guess,';
        }
    }

    // Clean up extracted values
    street_address = street_address.trim();
    city = city.trim();
    state = state.trim();
    zip_code = zip_code.trim();

    // Remove country information from other fields if it leaked in
    const countryPattern = new RegExp(COUNTRY_VARIATIONS.join('|'), 'gi');
    street_address = street_address.replace(countryPattern, '').replace(/,?\s*,?$/, '').trim();
    city = city.replace(countryPattern, '').replace(/,?\s*,?$/, '').trim();
    state = state.replace(countryPattern, '').replace(/,?\s*,?$/, '').trim();

    // Normalize state to abbreviation if it's a full name
    if (state && US_STATES[state.toLowerCase()]) {
        state = US_STATES[state.toLowerCase()];
    }

    return {
        street_address,
        city,
        state,
        zip_code,
        country,
        parsing_method: parsing_method.replace(/,$/, '') // Remove trailing comma
    };
}

/**
 * Calculate confidence score for parsed address
 */
function calculateParsingConfidence(parsed, original) {
    let score = 0;
    let maxScore = 0;

    // Street address present and reasonable
    maxScore += 2;
    if (parsed.street_address && parsed.street_address.length > 0) {
        score += 1;
        if (parsed.street_address.length > 10) score += 1; // Bonus for substantial street address
    }

    // City present
    maxScore += 2;
    if (parsed.city && parsed.city.length > 0) {
        score += 1;
        if (parsed.city.length > 2) score += 1; // Bonus for reasonable city name
    }

    // State present and valid
    maxScore += 2;
    if (parsed.state && US_STATES[parsed.state.toLowerCase()]) {
        score += 2; // Full points for valid state
    }

    // ZIP code present and valid format
    maxScore += 2;
    if (parsed.zip_code && /^\d{5}(-\d{4})?$/.test(parsed.zip_code)) {
        score += 2; // Full points for valid ZIP
    }

    // Penalty for suspicious patterns
    if (parsed.city.toLowerCase().includes('united states')) score -= 2;
    if (parsed.state.toLowerCase().includes('united states')) score -= 2;
    if (parsed.zip_code.toLowerCase().includes('united states')) score -= 2;

    return Math.round((score / maxScore) * 100);
}

/**
 * Get meets with problematic address data
 */
async function getProblematicMeets(limit = null) {
    try {
        log('🔍 Querying for meets with problematic address data...');

        let allMeets = [];
        let from = 0;
        const pageSize = 100;

        while (true) {
            let query = supabase
                .from('usaw_meets')
                .select('meet_id, Meet, address, street_address, city, state, zip_code, country')
                .not('address', 'is', null)
                .neq('address', '');

            // Add problematic data filters
            query = query.or('zip_code.ilike.%united states%,state.ilike.%county%,city.is.null,street_address.is.null');

            const { data, error } = await query.range(from, from + pageSize - 1);

            if (error) {
                throw new Error(`Failed to fetch meets: ${error.message}`);
            }

            if (!data || data.length === 0) {
                break;
            }

            allMeets.push(...data);
            from += pageSize;

            log(`📄 Loaded ${allMeets.length} problematic meets so far...`);

            if (data.length < pageSize) {
                break; // Last page
            }

            if (limit && allMeets.length >= limit) {
                allMeets = allMeets.slice(0, limit);
                break;
            }
        }

        log(`📋 Found ${allMeets.length} meets with problematic address data`);
        return allMeets;

    } catch (error) {
        log(`❌ Database query failed: ${error.message}`);
        throw error;
    }
}

/**
 * Preview changes without applying them
 */
async function previewChanges(meets) {
    log('\n📊 PREVIEW: Address parsing changes that would be applied\n');
    log('='.repeat(100));

    let improvements = 0;
    let degradations = 0;
    let noChange = 0;

    for (let i = 0; i < Math.min(meets.length, 20); i++) { // Show first 20 examples
        const meet = meets[i];
        const parsed = parseAddressIntelligently(meet.address);
        const confidence = calculateParsingConfidence(parsed, meet.address);

        log(`\n🏟️  Meet: ${meet.Meet} (ID: ${meet.meet_id})`);
        log(`📍 Original Address: ${meet.address}`);
        log(`\n   CURRENT → PROPOSED`);
        log(`   Street  : "${meet.street_address || ''}" → "${parsed.street_address}"`);
        log(`   City    : "${meet.city || ''}" → "${parsed.city}"`);
        log(`   State   : "${meet.state || ''}" → "${parsed.state}"`);
        log(`   ZIP     : "${meet.zip_code || ''}" → "${parsed.zip_code}"`);
        log(`   Country : "${meet.country || ''}" → "${parsed.country}"`);
        log(`   📊 Confidence: ${confidence}% | Method: ${parsed.parsing_method}`);

        // Determine if this is an improvement
        const currentValid = !!(meet.city && meet.state && !meet.zip_code?.includes('United States'));
        const newValid = !!(parsed.city && parsed.state && parsed.zip_code && confidence > 50);

        if (newValid && !currentValid) {
            improvements++;
            log(`   ✅ IMPROVEMENT`);
        } else if (currentValid && !newValid) {
            degradations++;
            log(`   ⚠️  POTENTIAL DEGRADATION`);
        } else {
            noChange++;
            log(`   ➡️  SIMILAR QUALITY`);
        }
    }

    if (meets.length > 20) {
        log(`\n... and ${meets.length - 20} more records`);
    }

    log(`\n📈 PREVIEW SUMMARY:`);
    log(`   Total records: ${meets.length}`);
    log(`   Likely improvements: ${improvements}/20`);
    log(`   Potential degradations: ${degradations}/20`);
    log(`   Similar quality: ${noChange}/20`);

    return { improvements, degradations, noChange };
}

/**
 * Apply fixes to database
 */
async function applyFixes(meets) {
    log('\n🔧 Applying address parsing fixes to database...\n');

    let successCount = 0;
    let failureCount = 0;
    let skipCount = 0;

    for (let i = 0; i < meets.length; i++) {
        const meet = meets[i];
        const progress = `${i + 1}/${meets.length}`;

        log(`🔄 [${progress}] Processing: ${meet.Meet} (ID: ${meet.meet_id})`);

        try {
            const parsed = parseAddressIntelligently(meet.address);
            const confidence = calculateParsingConfidence(parsed, meet.address);

            // Only apply if confidence is reasonable
            if (confidence < 30) {
                log(`   ⏭️  Skipping: Low confidence (${confidence}%)`);
                skipCount++;
                continue;
            }

            // Update database (only existing columns)
            const { error } = await supabase
                .from('usaw_meets')
                .update({
                    street_address: parsed.street_address,
                    city: parsed.city,
                    state: parsed.state,
                    zip_code: parsed.zip_code,
                    country: parsed.country
                })
                .eq('meet_id', meet.meet_id);

            if (error) {
                throw new Error(`Update failed: ${error.message}`);
            }

            successCount++;
            log(`   ✅ Updated (confidence: ${confidence}%)`);

        } catch (error) {
            failureCount++;
            log(`   ❌ Failed: ${error.message}`);
        }
    }

    log(`\n📊 EXECUTION SUMMARY:`);
    log(`   Total processed: ${meets.length}`);
    log(`   Successful updates: ${successCount}`);
    log(`   Skipped (low confidence): ${skipCount}`);
    log(`   Failed: ${failureCount}`);
    log(`   Success rate: ${((successCount / meets.length) * 100).toFixed(1)}%`);

    return { successCount, failureCount, skipCount };
}

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        preview: false,
        execute: false,
        limit: null
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--preview':
                options.preview = true;
                break;
            case '--execute':
                options.execute = true;
                break;
            case '--limit':
                options.limit = parseInt(args[i + 1], 10);
                i++;
                break;
        }
    }

    // Default to preview if no mode specified
    if (!options.preview && !options.execute) {
        options.preview = true;
    }

    return options;
}

/**
 * Main function
 */
async function main() {
    const startTime = Date.now();

    try {
        ensureDirectories();

        log('🔧 Starting address parsing fix process...');
        log('='.repeat(60));

        const options = parseArguments();

        if (options.preview) {
            log('🔍 PREVIEW MODE: Will show proposed changes without applying them');
        } else if (options.execute) {
            log('⚡ EXECUTION MODE: Will apply changes to database');
        }

        if (options.limit) {
            log(`📊 Processing limit: ${options.limit} records`);
        }

        // Get problematic meets
        const meets = await getProblematicMeets(options.limit);

        if (meets.length === 0) {
            log('✅ No problematic address data found - nothing to fix');
            return;
        }

        if (options.preview) {
            await previewChanges(meets);
            log('\n💡 To apply these changes, run: node fix-address-parsing.js --execute');
        } else if (options.execute) {
            await applyFixes(meets);
        }

        log(`\n⏱️  Total processing time: ${Math.round((Date.now() - startTime) / 1000)}s`);

    } catch (error) {
        log(`\n❌ Process failed: ${error.message}`);
        log(`🔍 Stack trace: ${error.stack}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = {
    parseAddressIntelligently,
    calculateParsingConfidence,
    US_STATES,
    COUNTRY_VARIATIONS
};