const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, '../../division_base64_codes.json');
const rawData = fs.readFileSync(jsonPath, 'utf8');
const data = JSON.parse(rawData);
const codes = data.division_codes;

const groups = {
    '11U': { M: new Set(), F: new Set() },
    '13U': { M: new Set(), F: new Set() },
    '14-15': { M: new Set(), F: new Set() },
    '16-17': { M: new Set(), F: new Set() },
    'Junior': { M: new Set(), F: new Set() },
    'Open': { M: new Set(), F: new Set() },
    'Masters (35-39)': { M: new Set(), F: new Set() } // Sample Masters
};

const eraMap = {
    'Active': {},
    'Inactive': {}, // We'll try to guess sub-eras based on ranges if needed, but splitting by Active/Inactive comes first
    'Inactive (1998)': {},
    'Inactive (2018)': {}
};

Object.keys(codes).forEach(key => {
    let type = 'Active';
    let cleanKey = key;
    if (key.startsWith('(Inactive) ')) {
        cleanKey = key.replace('(Inactive) ', '');
        // Check for Kg vs kg
        if (cleanKey.includes(' Kg') || cleanKey.includes(' Kb')) { // Kb seen in some old data?
            type = 'Inactive (1998)';
        } else {
            type = 'Inactive (2018)';
        }
    }

    if (!eraMap[type]) eraMap[type] = {};

    let gender = cleanKey.includes("Women's") ? 'F' : 'M';

    let group = 'Unknown';
    if (cleanKey.includes('11 Under')) group = '11U';
    else if (cleanKey.includes('13 Under')) group = '13U';
    else if (cleanKey.includes('14-15')) group = '14-15';
    else if (cleanKey.includes('16-17')) group = '16-17';
    else if (cleanKey.includes('Junior')) group = 'Junior';
    else if (cleanKey.includes('Open')) group = 'Open';
    else if (cleanKey.includes('Masters')) group = 'Masters';

    if (!eraMap[type][group]) eraMap[type][group] = { M: [], F: [] };

    // Extract weight
    const weightMatch = cleanKey.match(/(\+)?(\d+)(\+)?\s?(kg|Kg|kb)/i);
    if (weightMatch) {
        let val = parseInt(weightMatch[2]);
        // Detect if its a plus category
        // Prefix + OR Suffix +
        let isPlus = (weightMatch[1] === '+' || weightMatch[3] === '+');

        // Store as string to preserve identity (we sort by value later)
        // But for the final report we want to see the formatting?
        // The user complained about implicit + handling.
        // Let's store the raw text representation of the weight for verification?
        // No, simpler: store "val+" or "val" then in output formatting, handle it.
        // Actually, let's just store "val+" if it's a plus.

        if (isPlus) {
            eraMap[type][group][gender].push(val + '+');
        } else {
            eraMap[type][group][gender].push(val);
        }
    }
});

function sortWeights(arr) {
    return arr.sort((a, b) => {
        const valA = parseInt(a.toString().replace('+', ''));
        const valB = parseInt(b.toString().replace('+', ''));
        return valA - valB;
    });
}

const outputFile = path.join(__dirname, 'divisions_report.txt');
let output = '--- WEIGHT CLASS ANALYSIS ---\n';

for (const type of ['Active', 'Inactive (2018)', 'Inactive (1998)']) {
    output += `\n=== ${type} ===\n`;
    for (const group of ['11U', '13U', '14-15', '16-17', 'Junior', 'Open', 'Masters']) {
        if (!eraMap[type][group]) continue;

        const m = sortWeights([...new Set(eraMap[type][group].M)]);
        const f = sortWeights([...new Set(eraMap[type][group].F)]);

        if (m.length) output += `  ${group} Men: [${m.join(', ')}]\n`;
        if (f.length) output += `  ${group} Women: [${f.join(', ')}]\n`;
    }
}

fs.writeFileSync(outputFile, output);
console.log('Report written to ' + outputFile);

