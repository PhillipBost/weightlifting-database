const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'temp_functions.json');
if (!fs.existsSync(inputPath)) {
    console.error(`Error: Could not find ${inputPath}`);
    process.exit(1);
}

let rawData = fs.readFileSync(inputPath, 'utf8');

console.log("Raw data length:", rawData.length);
console.log("Starts with quote:", rawData.trim().startsWith('"'));
console.log("First 100 chars:", rawData.substring(0, 100));

// The file might be a JSON string (starting with ") containing the output
// If so, we need to parse it once to get the actual text content
if (rawData.trim().startsWith('"')) {
    try {
        rawData = JSON.parse(rawData);
        console.log("Successfully parsed outer JSON string.");
    } catch (e) {
        console.warn("File starts with quote but failed to parse as JSON string:", e.message);
    }
}

// Extract the actual JSON array from the text
let jsonContent = rawData;
if (rawData.includes('[')) {
    const startIndex = rawData.indexOf('[');
    const endIndex = rawData.lastIndexOf(']');
    if (startIndex !== -1 && endIndex !== -1) {
        jsonContent = rawData.substring(startIndex, endIndex + 1);
        console.log(`Extracted JSON substring from index ${startIndex} to ${endIndex}`);
    }
}

let functions;
try {
    functions = JSON.parse(jsonContent);
    console.log("Successfully parsed functions JSON directly.");
} catch (e) {
    console.log("Failed to parse directly. Attempting manual unescape...");
    // Fallback: If we didn't parse the outer string successfully, maybe we have escaped chars
    // Replace \" with " and \\ with \ (basic)
    try {
        // Only unescape if it looks like it needs it (e.g. has \" )
        if (jsonContent.includes('\\"')) {
            const unescaped = jsonContent
                .replace(/\\"/g, '"')
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\\\/g, '\\');
            functions = JSON.parse(unescaped);
            console.log("Successfully parsed after manual unescape.");
        } else {
            throw e;
        }
    } catch (e2) {
        console.error("Failed to parse JSON content:", e.message);
        console.error("Content snippet (first 100):", jsonContent.substring(0, 100));
        process.exit(1);
    }
}

// Lists of objects to fully qualify
const publicTables = [
    'lifters', 'meet_results', 'profiles', 'usaw_meet_entries', 'usaw_meet_listings',
    'iwf_meet_results', 'iwf_sanctions', 'youth_factors',
    'gamx_u_factors', 'gamx_a_factors', 'gamx_masters_factors', 'gamx_points_factors', 'gamx_s_factors', 'gamx_j_factors'
];

// Add the function names themselves to the list of things to qualify
const publicFunctions = functions.map(f => f.proname);
// Add other known public functions if any
publicFunctions.push('text_to_numeric_safe', 'get_gamx_score');

const extensionFunctions = {
    'similarity': 'extensions.similarity'
};

let migrationSQL = '-- Migration: Secure Function Search Paths (v2)\n';
migrationSQL += '-- Purpose: Fully qualify all object references and set search_path = \'\'\n\n';
migrationSQL += 'BEGIN;\n\n';

functions.forEach(func => {
    let def = func.definition;
    const proname = func.proname;

    // 1. Add SET search_path = '' before AS
    // first remove any existing search_path
    def = def.replace(/SET search_path TO ['"]?[\w, ]+['"]?/gi, '');
    def = def.replace(/SET search_path = ['"]?[\w, ]+['"]?/gi, '');

    const asMatch = def.match(/\s+AS\s+[\$']/i);
    if (asMatch) {
        const insertPos = asMatch.index;
        def = def.slice(0, insertPos) + "\n SET search_path = ''" + def.slice(insertPos);
    } else {
        console.warn(`Could not find AS clause in ${proname}`);
    }

    // 2. Qualify public tables
    publicTables.forEach(table => {
        const regex = new RegExp(`(?<!\\.)\\b${table}\\b`, 'gi');
        def = def.replace(regex, `public.${table}`);
    });

    // 3. Qualify public functions
    publicFunctions.forEach(f => {
        if (f === proname) return;
        const regex = new RegExp(`(?<!\\.)\\b${f}\\b\\(`, 'gi');
        def = def.replace(regex, `public.${f}(`);
    });

    // 4. Qualify extension functions
    Object.keys(extensionFunctions).forEach(extFunc => {
        const replacement = extensionFunctions[extFunc];
        const regex = new RegExp(`(?<!\\.)\\b${extFunc}\\b\\(`, 'gi');
        def = def.replace(regex, `${replacement}(`);
    });

    // 5. Fix double qualification
    def = def.replace(/public\.public\./g, 'public.');
    def = def.replace(/extensions\.extensions\./g, 'extensions.');

    // Append to migration file
    migrationSQL += def + ';\n\n';
});

migrationSQL += 'COMMIT;\n';

const outputPath = path.join(__dirname, '../migrations/secure_functions_v2.sql');
fs.writeFileSync(outputPath, migrationSQL);
console.log(`Migration generated at ${outputPath}`);
