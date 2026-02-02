const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../../temp/sanctions_dump.html');
const content = fs.readFileSync(filePath, 'utf8');

const target = "Nicolae ONICA";
const index = content.indexOf(target);

if (index === -1) {
    console.log("Target not found");
} else {
    // Print 1000 characters before and after
    const start = Math.max(0, index - 1000);
    const end = Math.min(content.length, index + 2000); // 2000 after to see surrounding table structure
    const snippet = content.substring(start, end);
    const outPath = path.resolve(__dirname, '../../temp/snippet.html');
    fs.writeFileSync(outPath, snippet);
    console.log(`Snippet written to ${outPath}`);
}
