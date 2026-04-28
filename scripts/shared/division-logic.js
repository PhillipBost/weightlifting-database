/**
 * DIVISION LOGIC
 * 
 * Centralized logic for competition age calculation and division eligibility.
 */

/**
 * Calculates competition age based on meet year and birth year.
 * Rule: Competition Age = Year of Meet - Year of Birth.
 * @param {string|Date} meetDate - Date of the meet
 * @param {number} birthYear - Athlete's birth year
 * @returns {number|null} Competition age
 */
function calculateCompetitionAge(meetDate, birthYear) {
    if (!meetDate || !birthYear) return null;
    const date = new Date(meetDate);
    if (isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    return year - parseInt(birthYear);
}

/**
 * Returns a list of all divisions a lifter is eligible for based on USAW and IWF rules.
 * @param {string} gender - 'Male' or 'Female' (or variants)
 * @param {number} age - Competition age
 * @param {string} weightClass - e.g., '81kg'
 * @returns {string[]} List of full three-element division names
 */
function getEligibleDivisions(gender, age, weightClass) {
    if (age === null || age === undefined || !gender) return [];
    
    const g = gender.toString().toLowerCase();
    const isFemale = g.startsWith('f') || g.includes('women');
    const genderPrefix = isFemale ? "Women's" : "Men's";
    const wc = weightClass || 'Unknown';
    
    const ageGroups = [];

    // --- USAW Specific Age Groups ---
    if (age <= 11) ageGroups.push("11 Under Age Group");
    if (age <= 13) ageGroups.push("13 Under Age Group");
    if (age >= 14 && age <= 15) ageGroups.push("14-15 Age Group");
    if (age >= 16 && age <= 17) ageGroups.push("16-17 Age Group");

    // --- IWF Age Groups ---
    if (age >= 13 && age <= 17) ageGroups.push("Youth");
    if (age >= 15 && age <= 20) ageGroups.push("Junior");
    
    // --- Open / Senior ---
    if (age >= 15) ageGroups.push("Open");

    // --- Masters Brackets ---
    if (age >= 35) {
        if (isFemale) {
            if (age >= 75) {
                ageGroups.push("Masters (75+)");
            } else {
                const bracketStart = Math.floor(age / 5) * 5;
                ageGroups.push(`Masters (${bracketStart}-${bracketStart + 4})`);
            }
        } else {
            if (age >= 80) {
                ageGroups.push("Masters (80+)");
            } else if (age >= 75) {
                ageGroups.push("Masters (75-79)");
            } else {
                const bracketStart = Math.floor(age / 5) * 5;
                ageGroups.push(`Masters (${bracketStart}-${bracketStart + 4})`);
            }
        }
    }

    // Compose the full three-element name: [Gender] [Age Range] [Weight Class]
    return ageGroups.map(ageGroup => `${genderPrefix} ${ageGroup} ${wc}`);
}

module.exports = {
    calculateCompetitionAge,
    getEligibleDivisions
};
