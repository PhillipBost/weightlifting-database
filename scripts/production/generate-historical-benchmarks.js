const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const clientConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
};

const OUTPUT_DIR = process.env.OUTPUT_DIR || '/var/www/athlete-data';
const START_YEAR = 1990;
const END_YEAR = 2026;

const parseAttempt = (s) => {
    if (s === null || s === undefined || s === '' || s === '0' || s === '---') return null;
    if (typeof s === 'number') return s;
    const n = parseInt(s);
    return isNaN(n) ? null : n;
};
const isSuccess = (v) => { const n = parseAttempt(v); return n !== null && n > 0; };
const isMiss = (v) => { const n = parseAttempt(v); return n !== null && n < 0; };

function calculateLifterMetrics(results) {
    const metrics = {
        successRate: null, snatchSuccessRate: null, cleanJerkSuccessRate: null,
        clutchPerformance: null, bounceBackRate: null,
        snatchBounceBackRate: null, cleanJerkBounceBackRate: null,
        competitionFrequency: null, qScorePerformance: null
    };
    if (!results || results.length === 0) return metrics;

    let totalAtt = 0, totalSucc = 0, snAtt = 0, snSucc = 0, cjAtt = 0, cjSucc = 0;
    let clutchSit = 0, clutchSucc = 0, sbbSit = 0, sbbSucc = 0, cbbSit = 0, cbbSucc = 0;
    const qScores = [];

    results.forEach(r => {
        const sn = [r.snatch_lift_1, r.snatch_lift_2, r.snatch_lift_3];
        const cj = [r.cj_lift_1, r.cj_lift_2, r.cj_lift_3];
        sn.forEach(v => { const n = parseAttempt(v); if (n !== null) { totalAtt++; snAtt++; if (n > 0) { totalSucc++; snSucc++; } } });
        cj.forEach(v => { const n = parseAttempt(v); if (n !== null) { totalAtt++; cjAtt++; if (n > 0) { totalSucc++; cjSucc++; } } });
        if (isMiss(sn[0]) && isMiss(sn[1]) && parseAttempt(sn[2]) !== null) { clutchSit++; if (isSuccess(sn[2])) clutchSucc++; }
        if (isMiss(cj[0]) && isMiss(cj[1]) && parseAttempt(cj[2]) !== null) { clutchSit++; if (isSuccess(cj[2])) clutchSucc++; }
        if (isMiss(sn[0]) && parseAttempt(sn[1]) !== null) { sbbSit++; if (isSuccess(sn[1])) sbbSucc++; }
        if (isMiss(cj[0]) && parseAttempt(cj[1]) !== null) { cbbSit++; if (isSuccess(cj[1])) cbbSucc++; }
        const qs = [parseAttempt(r.qpoints), parseAttempt(r.q_youth), parseAttempt(r.q_masters)].filter(v => v !== null);
        if (qs.length > 0) qScores.push(Math.max(...qs));
    });

    if (totalAtt >= 12) {
        metrics.successRate = (totalSucc / totalAtt) * 100;
        metrics.snatchSuccessRate = snAtt > 0 ? (snSucc / snAtt) * 100 : null;
        metrics.cleanJerkSuccessRate = cjAtt > 0 ? (cjSucc / cjAtt) * 100 : null;
    }
    if (clutchSit > 0) metrics.clutchPerformance = (clutchSucc / clutchSit) * 100;
    if (sbbSit > 0) metrics.snatchBounceBackRate = (sbbSucc / sbbSit) * 100;
    if (cbbSit > 0) metrics.cleanJerkBounceBackRate = (cbbSucc / cbbSit) * 100;
    if (sbbSit + cbbSit > 0) metrics.bounceBackRate = ((sbbSucc + cbbSucc) / (sbbSit + cbbSit)) * 100;
    
    if (results.length >= 2) {
        const sortedDates = results
            .map(r => r.date ? new Date(r.date) : null)
            .filter(d => d && !isNaN(d.getTime()))
            .sort((a, b) => a - b);
        if (sortedDates.length >= 2) {
            const diffDays = Math.max(90, (sortedDates[sortedDates.length - 1] - sortedDates[0]) / (1000 * 60 * 60 * 24));
            metrics.competitionFrequency = ((results.length - 1) / diffDays) * 365.25;
        }
    }
    if (qScores.length > 0) metrics.qScorePerformance = Math.max(...qScores);
    return metrics;
}

function getDemographicBucketKeys(source, gender, age) {
    if (age === null || age === undefined || !gender) return [];
    const g = gender.toString().toLowerCase().startsWith('f') ? 'F' : 'M';
    const buckets = [];
    if (age < 13) buckets.push(`${source}_${g}_U13`);
    if (age >= 13 && age <= 17) buckets.push(`${source}_${g}_Youth`);
    if (age >= 15 && age <= 20) buckets.push(`${source}_${g}_Junior`);
    if (age >= 15) buckets.push(`${source}_${g}_Senior`);
    if (age >= 35) buckets.push(`${source}_${g}_Masters`);
    return buckets;
}

function getBucketLabel(key) {
    const parts = key.split('_');
    const source = parts[0].toUpperCase();
    const gender = parts[1] === 'F' ? 'Female' : 'Male';
    const category = parts[2];
    return `${source} ${gender} ${category}`;
}

async function run() {
    const client = new Client(clientConfig);
    await client.connect();
    console.log('[HISTORICAL BENCHMARKS] Generating inclusive age-group maps with FULL METRICS (1990-2026)...');

    const sources = [
        { name: 'usaw', table: 'usaw_meet_results' },
        { name: 'iwf', table: 'iwf_meet_results' }
    ];

    const historicalMaps = {};
    const athleteStates = { usaw: {}, iwf: {} };

    for (const source of sources) {
        console.log(`[HISTORICAL BENCHMARKS] Processing ${source.name.toUpperCase()}...`);
        const query = `SELECT *, (CASE WHEN birth_year > 0 THEN birth_year ELSE NULL END) as b_year FROM ${source.table} ORDER BY date ASC`;
        const res = await client.query(query);

        let currentYear = START_YEAR;
        
        for (const r of res.rows) {
            const rowYear = new Date(r.date).getFullYear();
            while (currentYear < rowYear && currentYear <= END_YEAR) {
                if (currentYear >= START_YEAR) captureYearlyMap(historicalMaps, currentYear, athleteStates, source.name);
                currentYear++;
            }

            const id = r.lifter_id || r.db_lifter_id;
            if (!id) continue;
            if (!athleteStates[source.name][id]) {
                athleteStates[source.name][id] = { results: [], birthYear: r.b_year, gender: r.gender };
            }
            const s = athleteStates[source.name][id];
            if (!s.birthYear && r.b_year) s.birthYear = r.b_year;
            if (!s.gender && r.gender) s.gender = r.gender;
            s.results.push(r);
        }

        while (currentYear <= END_YEAR) {
            captureYearlyMap(historicalMaps, currentYear, athleteStates, source.name);
            currentYear++;
        }
    }

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'historical_benchmarks.json'), JSON.stringify(historicalMaps));
    console.log('[HISTORICAL BENCHMARKS] SUCCESS. Saved with all metrics.');
    await client.end();
}

function captureYearlyMap(historicalMaps, year, athleteStates, sourceName) {
    if (!historicalMaps[year]) historicalMaps[year] = {};
    const buckets = {};

    Object.values(athleteStates[sourceName]).forEach(s => {
        // Inclusion: Check total attempts at this point in time
        let totalAtt = 0;
        s.results.forEach(r => {
            [r.snatch_lift_1, r.snatch_lift_2, r.snatch_lift_3, r.cj_lift_1, r.cj_lift_2, r.cj_lift_3].forEach(v => {
                if (parseAttempt(v) !== null) totalAtt++;
            });
        });

        if (totalAtt >= 12 && s.birthYear && s.gender) {
            const age = year - s.birthYear;
            const metrics = calculateLifterMetrics(s.results);
            const keys = getDemographicBucketKeys(sourceName, s.gender, age);
            keys.forEach(k => {
                if (!buckets[k]) buckets[k] = { label: getBucketLabel(k), values: {} };
                Object.entries(metrics).forEach(([m, val]) => {
                    if (val !== null) {
                        if (!buckets[k].values[m]) buckets[k].values[m] = [];
                        buckets[k].values[m].push(val);
                    }
                });
            });
        }
    });

    Object.entries(buckets).forEach(([bKey, bData]) => {
        historicalMaps[year][bKey] = { bucket: bData.label };
        Object.entries(bData.values).forEach(([mKey, values]) => {
            values.sort((a, b) => a - b);
            const map = [];
            for (let i = 0; i <= 100; i++) {
                const idx = Math.min(values.length - 1, Math.floor((i / 100) * values.length));
                map.push(values[idx]);
            }
            historicalMaps[year][bKey][mKey] = { map, sampleSize: values.length };
        });
    });
}

run();
