const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Default to the server path, but allow local override
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/var/www/athlete-data';
const statsFile = path.join(OUTPUT_DIR, 'population_stats.json');

if (!fs.existsSync(statsFile)) {
    console.error('Stats file not found at:', statsFile);
    process.exit(1);
}

const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));

function summarize(bucketName) {
    const bucket = stats[bucketName];
    if (!bucket) return;

    console.log(`\n=== ${bucketName.toUpperCase()} ===`);
    
    // Key Metrics to show
    const metrics = [
        'successRate', 
        'snatchSuccessRate', 
        'cleanJerkSuccessRate', 
        'competitionFrequency', 
        'consistencyScore', 
        'qScorePerformance'
    ];
    
    metrics.forEach(metric => {
        const data = bucket[metric];
        if (!data || !data.distribution || data.distribution.length === 0) return;

        const dist = data.distribution;
        const getP = (p) => dist[Math.floor((p / 100) * (dist.length - 1))];

        console.log(`\n  [${metric}] (n=${dist.length})`);
        console.log(`    25th: ${getP(25).toFixed(2)}`);
        console.log(`    50th (Median): ${getP(50).toFixed(2)}`);
        console.log(`    75th: ${getP(75).toFixed(2)}`);
        console.log(`    90th (Elite):  ${getP(90).toFixed(2)}`);
        console.log(`    99th (Legend): ${getP(99).toFixed(2)}`);
        console.log(`    MAX: ${dist[dist.length - 1].toFixed(2)}`);
    });
}

// Major USAW Divisions
const majorDivisions = [
    'usaw_all',
    'usaw_M_Senior', 'usaw_F_Senior',
    'usaw_M_Junior', 'usaw_F_Junior',
    'usaw_M_Youth',  'usaw_F_Youth',
    'usaw_M_Masters', 'usaw_F_Masters'
];

majorDivisions.forEach(summarize);
