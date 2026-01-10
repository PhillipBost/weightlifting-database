const dateStr = "-0001-11-30";
const d = new Date(dateStr);
console.log(`Input: "${dateStr}"`);
console.log(`Parsed: ${d}`);
console.log(`Year: ${d.getFullYear()}`);
console.log(`ISO: ${d.toISOString()}`);

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

const dMinus3 = addDays(d, -3);
console.log(`Minus 3 days: ${dMinus3}`);
console.log(`Minus 3 Year: ${dMinus3.getFullYear()}`);
