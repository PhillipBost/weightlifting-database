// Function to split age category and weight class
function parseAgeAndWeightCategory(combinedCategory) {
    // Examples: 
    // "Men's Masters (35-39) 110+kg" -> age: "Men's Masters (35-39)", weight: "110+kg"
    // "Open Men's 110kg" -> age: "Open Men's", weight: "110kg"
    // "Open Men's 105 kg" -> age: "Open Men's", weight: "105 kg"
    // "Women's Youth (17) 49kg" -> age: "Women's Youth (17)", weight: "49kg"
    
    // Find the last space followed by weight class pattern (numbers + optional space + kg)
    const weightClassMatch = combinedCategory.match(/(\+?\d+\+?\s?kg)$/i);
    
    if (weightClassMatch) {
        const weightClass = weightClassMatch[1];
        const ageCategory = combinedCategory.replace(/\+?\d+\+?\s?kg$/i, '').trim();
        return {
            ageCategory: ageCategory,
            weightClass: weightClass
        };
    }
    
    // Fallback if pattern doesn't match
    return {
        ageCategory: combinedCategory,
        weightClass: ''
    };
}

module.exports = {
    parseAgeAndWeightCategory
};