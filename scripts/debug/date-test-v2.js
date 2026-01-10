const dateStr = "-0001-11-30";

function parseDateRobust(str) {
    // Handle negative years explicitly
    const parts = str.split('-');
    // If starts with -, the first part is empty string
    let year, month, day;

    if (str.startsWith('-')) {
        // e.g. -0001-11-30 -> ["", "0001", "11", "30"]
        // Wait, split behavior checks...
        year = -parseInt(parts[1]);
        month = parseInt(parts[2]) - 1; // Month is 0-indexed
        day = parseInt(parts[3]);
    } else {
        year = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1;
        day = parseInt(parts[2]);
    }

    const d = new Date();
    d.setFullYear(year, month, day);
    d.setHours(0, 0, 0, 0);
    return d;
}

const d = parseDateRobust(dateStr);
console.log(`Manual Parsed: ${d}`);
console.log(`Year: ${d.getFullYear()}`);
console.log(`ISO: ${d.toISOString()}`);

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

const dMinus3 = addDays(d, -3);
console.log(`Minus 3: ${dMinus3.getFullYear()}-${dMinus3.getMonth() + 1}-${dMinus3.getDate()}`);
