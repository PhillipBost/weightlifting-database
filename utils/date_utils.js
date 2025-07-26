//probably can delete
function getDateMMDDYYYY(){
    let d = new Date()
    return `${d.getMonth()+1}-${d.getDate()}-${d.getFullYear()}`
}


//probably can delete
function getWeekandYear(){
    const today = new Date();
    const currentWeek = Math.ceil(
      (today - new Date(today.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000)
    );
    return {
        year: today.getFullYear(),
        currentWeek: currentWeek,
    }
}

// Function to calculate ISO week number
Date.prototype.getISOWeek = function () {
    const date = new Date(this.getFullYear(), this.getMonth(), this.getDate());
    const dayNumber = (date.getDay() + 6) % 7;
    const nearestThursday = new Date(date.valueOf() + ((3 - dayNumber) * 86400000));
    const jan1 = new Date(this.getFullYear(), 0, 1);
    const daysOffset = Math.floor((nearestThursday - jan1) / 86400000);
    return 1 + Math.floor(daysOffset / 7);
};
  
function getWeeksAndYears() {
// Get current date
const today = new Date();


// Get current year and week number
const currentYear = today.getFullYear();
const currentWeek = today.getISOWeek() + 1;


// Handle the first week of the year
let previousWeek = currentWeek - 1;
let previousYear = currentYear;

if (currentWeek === 1) {
    previousWeek = 52; // Last week of the previous year
    previousYear = currentYear - 1;
}

return {
    currentYear,
    currentWeek,
    previousYear,
    previousWeek
}
}
  
  // Call the function and use the results
//   const newEntries = getWeeksAndYears();

module.exports = {
    getDateMMDDYYYY,
    getWeekandYear,
    getWeeksAndYears
}