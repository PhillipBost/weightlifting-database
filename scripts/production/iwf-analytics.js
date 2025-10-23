/**
 * IWF Analytics Module
 *
 * Calculates performance analytics for International Weightlifting Federation competition results
 * Includes: successful attempts, bounce-back analysis, Q-scores (Huebner formula)
 *
 * @module iwf-analytics
 */

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parses an attempt value and returns the numeric weight
 * Handles: positive numbers (successful), negative numbers (failed), "---" (no attempt), null
 *
 * @param {string|number|null} attempt - The attempt value
 * @returns {number|null} - Numeric weight or null if invalid
 */
function parseAttemptValue(attempt) {
    if (attempt === null || attempt === undefined || attempt === '' || attempt === '---') {
        return null;
    }

    const num = parseFloat(attempt);
    return isNaN(num) ? null : num;
}

/**
 * Checks if an attempt was successful (positive value)
 *
 * @param {string|number|null} attempt - The attempt value
 * @returns {boolean|null} - True if successful, false if failed, null if no attempt
 */
function isAttemptSuccessful(attempt) {
    const value = parseAttemptValue(attempt);
    if (value === null) return null;
    return value > 0;
}

/**
 * Parses birth date from IWF format and returns birth year
 * Handles multiple formats:
 * - "DD.MM.YYYY" (e.g., "16.08.1998")
 * - "Month DD, YYYY" (e.g., "Aug 16, 1998")
 *
 * @param {string} birthDate - Birth date string
 * @returns {number|null} - Birth year or null if invalid
 */
function parseBirthYear(birthDate) {
    if (!birthDate || typeof birthDate !== 'string') {
        return null;
    }

    const cleaned = birthDate.trim();

    // Try format: DD.MM.YYYY
    if (cleaned.includes('.')) {
        const parts = cleaned.split('.');
        if (parts.length === 3) {
            const year = parseInt(parts[2]);
            if (!isNaN(year) && year > 1900 && year < 2100) {
                return year;
            }
        }
    }

    // Try format: "Month DD, YYYY" (e.g., "Aug 16, 1998")
    if (cleaned.includes(',')) {
        const parts = cleaned.split(',');
        if (parts.length >= 2) {
            const yearStr = parts[parts.length - 1].trim();
            const year = parseInt(yearStr);
            if (!isNaN(year) && year > 1900 && year < 2100) {
                return year;
            }
        }
    }

    // Try extracting any 4-digit year from the string
    const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
        const year = parseInt(yearMatch[0]);
        if (!isNaN(year) && year > 1900 && year < 2100) {
            return year;
        }
    }

    return null;
}

/**
 * Extracts gender from weight class text
 *
 * @param {string} weightClass - Weight class string (e.g., "60 kg Men", "48 kg Women")
 * @returns {string|null} - 'M' for men, 'F' for women, null if unknown
 */
function extractGenderFromWeightClass(weightClass) {
    if (!weightClass || typeof weightClass !== 'string') {
        return null;
    }

    const lower = weightClass.toLowerCase();
    if (lower.includes('men') && !lower.includes('women')) {
        return 'M';
    } else if (lower.includes('women')) {
        return 'F';
    }

    return null;
}

/**
 * Calculates competition age from birth year and competition date
 *
 * @param {number} birthYear - Birth year
 * @param {string} competitionDate - Competition date (YYYY-MM-DD or similar)
 * @returns {number|null} - Age at competition or null if invalid
 */
function calculateCompetitionAge(birthYear, competitionDate) {
    if (!birthYear || !competitionDate) {
        return null;
    }

    const competitionYear = parseInt(competitionDate.substring(0, 4));
    if (isNaN(competitionYear)) {
        return null;
    }

    return competitionYear - birthYear;
}

// ============================================================================
// ANALYTICS CALCULATORS
// ============================================================================

/**
 * Calculates successful attempts for snatch and clean & jerk
 * Counts how many attempts were successful (positive values)
 *
 * @param {Object} athlete - Athlete data with attempt fields
 * @returns {Object} - { snatch_successful_attempts, cj_successful_attempts, total_successful_attempts }
 */
function calculateSuccessfulAttempts(athlete) {
    let snatchSuccess = 0;
    let cjSuccess = 0;

    // Count successful snatch attempts
    if (isAttemptSuccessful(athlete.snatch_1)) snatchSuccess++;
    if (isAttemptSuccessful(athlete.snatch_2)) snatchSuccess++;
    if (isAttemptSuccessful(athlete.snatch_3)) snatchSuccess++;

    // Count successful C&J attempts
    if (isAttemptSuccessful(athlete.cj_1)) cjSuccess++;
    if (isAttemptSuccessful(athlete.cj_2)) cjSuccess++;
    if (isAttemptSuccessful(athlete.cj_3)) cjSuccess++;

    return {
        snatch_successful_attempts: snatchSuccess,
        cj_successful_attempts: cjSuccess,
        total_successful_attempts: snatchSuccess + cjSuccess
    };
}

/**
 * Calculates bounce-back metrics (recovery after missed attempts)
 * Determines if athlete successfully made next attempt after missing previous one
 *
 * @param {Object} athlete - Athlete data with attempt fields
 * @returns {Object} - { bounce_back_snatch_2, bounce_back_snatch_3, bounce_back_cj_2, bounce_back_cj_3 }
 */
function calculateBounceBack(athlete) {
    // Snatch bounce-back
    // bounce_back_snatch_2: Made 2nd attempt after missing 1st
    const snatch1Success = isAttemptSuccessful(athlete.snatch_1);
    const snatch2Success = isAttemptSuccessful(athlete.snatch_2);
    const snatch3Success = isAttemptSuccessful(athlete.snatch_3);

    let bounceBackSnatch2 = null;
    let bounceBackSnatch3 = null;

    // Only calculate if we have data for both attempts
    if (snatch1Success === false && snatch2Success !== null) {
        bounceBackSnatch2 = snatch2Success === true;
    }

    if (snatch2Success === false && snatch3Success !== null) {
        bounceBackSnatch3 = snatch3Success === true;
    }

    // Clean & Jerk bounce-back
    const cj1Success = isAttemptSuccessful(athlete.cj_1);
    const cj2Success = isAttemptSuccessful(athlete.cj_2);
    const cj3Success = isAttemptSuccessful(athlete.cj_3);

    let bounceBackCj2 = null;
    let bounceBackCj3 = null;

    if (cj1Success === false && cj2Success !== null) {
        bounceBackCj2 = cj2Success === true;
    }

    if (cj2Success === false && cj3Success !== null) {
        bounceBackCj3 = cj3Success === true;
    }

    return {
        bounce_back_snatch_2: bounceBackSnatch2,
        bounce_back_snatch_3: bounceBackSnatch3,
        bounce_back_cj_2: bounceBackCj2,
        bounce_back_cj_3: bounceBackCj3
    };
}

/**
 * Calculates Q-score using Huebner formula
 * Used to normalize lifter performance across different bodyweights
 *
 * @param {number} totalNum - Competition total (kg)
 * @param {number} B - Bodyweight factor (bodyweight / 100)
 * @param {string} gender - 'M' for men, 'F' for women
 * @returns {number|null} - Q-score (rounded to 3 decimal places) or null if invalid
 */
function calculateQScore(totalNum, B, gender) {
    if (gender === 'M') {
        const denominator = 416.7 - 47.87 * Math.pow(B, -2) + 18.93 * Math.pow(B, 2);
        return Math.round((totalNum * 463.26 / denominator) * 1000) / 1000;
    } else if (gender === 'F') {
        const denominator = 266.5 - 19.44 * Math.pow(B, -2) + 18.61 * Math.pow(B, 2);
        return Math.round((totalNum * 306.54 / denominator) * 1000) / 1000;
    }

    return null;
}

/**
 * Calculates age-appropriate Q-scores based on athlete's competition age
 * Uses Huebner's age brackets:
 * - Ages ≤9: No scoring
 * - Ages 10-20: Q-youth only
 * - Ages 21-30: Q-points only
 * - Ages 31+: Q-masters only
 *
 * ⚠️ INCOMPLETE: Youth Q-scores (ages 10-20) currently use base Huebner formula
 * TODO: Implement age-specific multipliers from youth_factors table (must be copied from USAW Supabase)
 * See: .iwf/IWF-schema.md for requirements
 *
 * @param {string|number} total - Competition total (kg)
 * @param {string|number} bodyWeight - Competition bodyweight (kg)
 * @param {string} gender - 'M' for men, 'F' for women
 * @param {number} age - Competition age
 * @returns {Object} - { qpoints, q_youth, q_masters }
 */
function calculateAgeAppropriateQScore(total, bodyWeight, gender, age) {
    // Initialize all scores as null
    const qScores = {
        qpoints: null,
        q_youth: null,
        q_masters: null
    };

    // Validate input data
    if (!total || !bodyWeight || !gender || !age) {
        return qScores;
    }

    const totalNum = parseFloat(total);
    const bwNum = parseFloat(bodyWeight);

    if (isNaN(totalNum) || isNaN(bwNum) || totalNum <= 0 || bwNum <= 0) {
        return qScores;
    }

    const B = bwNum / 100;

    // Age-based scoring according to Huebner's brackets
    // Ages ≤9: No Q-scoring
    if (age <= 9) {
        return qScores;
    }

    // Ages 10-20: Q-youth only
    if (age >= 10 && age <= 20) {
        qScores.q_youth = calculateQScore(totalNum, B, gender);
        return qScores;
    }

    // Ages 21-30: Q-points only
    if (age >= 21 && age <= 30) {
        qScores.qpoints = calculateQScore(totalNum, B, gender);
        return qScores;
    }

    // Ages 31+: Q-masters only
    if (age >= 31) {
        qScores.q_masters = calculateQScore(totalNum, B, gender);
        return qScores;
    }

    return qScores;
}

// ============================================================================
// MAIN ENRICHMENT FUNCTION
// ============================================================================

/**
 * Enriches athlete data with all analytics calculations
 * This is the main function that combines all analytics modules
 *
 * @param {Object} athlete - Raw athlete data from scraper
 * @param {Object} meetInfo - Meet context (date, meet_name, event_id)
 * @returns {Object} - Enhanced athlete object with all analytics fields
 */
function enrichAthleteWithAnalytics(athlete, meetInfo = {}) {
    try {
        // Parse birth year from birth_date field (DD.MM.YYYY format)
        const birthYear = parseBirthYear(athlete.birth_date);

        // Extract gender from weight_class field
        const gender = extractGenderFromWeightClass(athlete.weight_class);

        // Calculate competition age
        const competitionAge = calculateCompetitionAge(birthYear, meetInfo.date);

        // Calculate successful attempts
        const successfulAttempts = calculateSuccessfulAttempts(athlete);

        // Calculate bounce-back metrics
        const bounceBack = calculateBounceBack(athlete);

        // Calculate Q-scores
        const qScores = calculateAgeAppropriateQScore(
            athlete.total,
            athlete.body_weight,
            gender,
            competitionAge
        );

        // Return enhanced athlete object with all analytics
        return {
            ...athlete,
            // Parsed data
            birth_year: birthYear,
            gender: gender,
            competition_age: competitionAge,
            // Successful attempts
            snatch_successful_attempts: successfulAttempts.snatch_successful_attempts,
            cj_successful_attempts: successfulAttempts.cj_successful_attempts,
            total_successful_attempts: successfulAttempts.total_successful_attempts,
            // Bounce-back analysis
            bounce_back_snatch_2: bounceBack.bounce_back_snatch_2,
            bounce_back_snatch_3: bounceBack.bounce_back_snatch_3,
            bounce_back_cj_2: bounceBack.bounce_back_cj_2,
            bounce_back_cj_3: bounceBack.bounce_back_cj_3,
            // Q-scores
            qpoints: qScores.qpoints,
            q_youth: qScores.q_youth,
            q_masters: qScores.q_masters,
            // YTD bests (to be calculated during database import)
            best_snatch_ytd: null,
            best_cj_ytd: null,
            best_total_ytd: null
        };

    } catch (error) {
        console.error('Error enriching athlete with analytics:', error.message);
        // Return original athlete data if enrichment fails
        return athlete;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Main enrichment function
    enrichAthleteWithAnalytics,

    // Individual calculators (exported for testing)
    calculateSuccessfulAttempts,
    calculateBounceBack,
    calculateAgeAppropriateQScore,
    calculateQScore,

    // Helper functions (exported for testing)
    parseAttemptValue,
    isAttemptSuccessful,
    parseBirthYear,
    extractGenderFromWeightClass,
    calculateCompetitionAge
};
