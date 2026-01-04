const fs = require('fs');
const path = require('path');

const codesPath = path.join(__dirname, '../../division_base64_codes.json');
const raw = fs.readFileSync(codesPath, 'utf8');
const data = JSON.parse(raw);
const codes = data.division_codes;

// Invert to get ID -> Name
const idToName = {};
Object.entries(codes).forEach(([name, id]) => {
    idToName[id] = name;
});

const ids = Object.values(codes).sort((a, b) => a - b);
const min = ids[0];
const max = ids[ids.length - 1];

console.log(`Checking gaps for ${ids.length} codes (Range: ${min} to ${max})...\n`);

let prev = ids[0];
for (let i = 1; i < ids.length; i++) {
    const curr = ids[i];
    if (curr > prev + 1) {
        // Found a gap
        console.log(`Gap between ${prev} and ${curr} (Missing ${curr - prev - 1} codes)`);
        console.log(`  Start: [${prev}] ${idToName[prev]}`);
        console.log(`  End:   [${curr}] ${idToName[curr]}`);

        // List specific missing numbers if small gap
        if (curr - prev < 20) {
            const missing = [];
            for (let j = prev + 1; j < curr; j++) missing.push(j);
            console.log(`  Missing IDs: ${missing.join(', ')}`);
        }
        console.log('');
    }
    prev = curr;
}
console.log('Done.');
