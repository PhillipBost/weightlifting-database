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

// --- Metric Helpers ---
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
        consistencyScore: null, clutchPerformance: null, bounceBackRate: null,
        snatchBounceBackRate: null, cleanJerkBounceBackRate: null,
        competitionFrequency: null, qScorePerformance: null
    };
    if (!results || results.length === 0) return metrics;

    let totalAtt = 0, totalSucc = 0, snAtt = 0, snSucc = 0, cjAtt = 0, cjSucc = 0;
    let clutchSit = 0, clutchSucc = 0, sbbSit = 0, sbbSucc = 0, cbbSit = 0, cbbSucc = 0;
    const totals = [], years = new Set(), qScores = [];

    results.forEach(r => {
        const d = r.date ? new Date(r.date) : null; 
        if (d && !isNaN(d.getTime())) {
            const year = d.getFullYear();
            if (year >= 1980 && year <= 2030) years.add(year);
        }

        const sn = [r.snatch_lift_1, r.snatch_lift_2, r.snatch_lift_3];
        const cj = [r.cj_lift_1, r.cj_lift_2, r.cj_lift_3];
        sn.forEach(v => { const n = parseAttempt(v); if (n !== null) { totalAtt++; snAtt++; if (n > 0) { totalSucc++; snSucc++; } } });
        cj.forEach(v => { const n = parseAttempt(v); if (n !== null) { totalAtt++; cjAtt++; if (n > 0) { totalSucc++; cjSucc++; } } });
        if (isMiss(sn[0]) && isMiss(sn[1]) && parseAttempt(sn[2]) !== null) { clutchSit++; if (isSuccess(sn[2])) clutchSucc++; }
        if (isMiss(cj[0]) && isMiss(cj[1]) && parseAttempt(cj[2]) !== null) { clutchSit++; if (isSuccess(cj[2])) clutchSucc++; }
        if (isMiss(sn[0]) && parseAttempt(sn[1]) !== null) { sbbSit++; if (isSuccess(sn[1])) sbbSucc++; }
        if (isMiss(cj[0]) && parseAttempt(cj[1]) !== null) { cbbSit++; if (isSuccess(cj[1])) cbbSucc++; }
        const t = parseAttempt(r.total); if (t && t > 0) totals.push(t);
        const qs = [parseAttempt(r.qpoints), parseAttempt(r.q_youth), parseAttempt(r.q_masters)].filter(v => v !== null);
        if (qs.length > 0) qScores.push(Math.max(...qs));
    });

    if (totalAtt >= 12) {
        metrics.successRate = (totalSucc / totalAtt) * 100;
        metrics.snatchSuccessRate = snAtt > 0 ? (snSucc / snAtt) * 100 : null;
        metrics.cleanJerkSuccessRate = cjAtt > 0 ? (cjSucc / cjAtt) * 100 : null;

        const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
        const variance = totals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / totals.length;
        metrics.consistencyScore = Math.max(0, 100 - (Math.sqrt(variance) / mean) * 100);
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
            const first = sortedDates[0];
            const last = sortedDates[sortedDates.length - 1];
            // Interval-based frequency: (Meets - 1) / Span. Floor span at 90 days to prevent spikes.
            const diffDays = Math.max(90, (last - first) / (1000 * 60 * 60 * 24));
            metrics.competitionFrequency = ((results.length - 1) / diffDays) * 365.25;
        } else {
            metrics.competitionFrequency = 0;
        }
    } else {
        metrics.competitionFrequency = 0;
    }
    if (qScores.length > 0) metrics.qScorePerformance = Math.max(...qScores);
    return metrics;
}

function normalizeAgeCategory(rawCategory, meetName) {
    let category = null;
    const catStr = (rawCategory || '').toLowerCase();
    const meetStr = (meetName || '').toLowerCase();
    if (catStr.includes('youth') || catStr.includes('age group')) category = 'Youth';
    else if (catStr.includes('junior')) category = 'Junior';
    else if (catStr.includes('masters') || catStr.includes('master')) category = 'Masters';
    else if (catStr.includes('senior') || catStr.includes('open')) category = 'Senior';
    if (!category || (category === 'Senior' && (meetStr.includes('junior') || meetStr.includes('youth') || meetStr.includes('master')))) {
        if (meetStr.includes('youth')) return 'Youth';
        if (meetStr.includes('junior')) return 'Junior';
        if (meetStr.includes('master')) return 'Masters';
    }
    return category || (catStr ? 'Senior' : null);
}

function getDemographicBucketKeys(dataSource, gender, ageCategory, meetName) {
    const keys = [`${dataSource}_all`];
    const g = (gender || '').toString().toLowerCase().startsWith('f') ? 'F' : ((gender || '').toString().toLowerCase().startsWith('m') ? 'M' : null);
    const a = normalizeAgeCategory(ageCategory, meetName);
    if (g) keys.push(`${dataSource}_${g}`);
    if (a) {
        keys.push(`${dataSource}_${a}`);
        if (g) keys.push(`${dataSource}_${g}_${a}`);
    }
    return keys;
}

const createEmptyBucket = () => {
    const b = {};
    ['successRate', 'snatchSuccessRate', 'cleanJerkSuccessRate', 'consistencyScore', 'clutchPerformance', 'bounceBackRate', 'snatchBounceBackRate', 'cleanJerkBounceBackRate', 'competitionFrequency', 'qScorePerformance'].forEach(m => {
        b[m] = { distribution: [], sampleSize: 0 };
    });
    return b;
};

async function run() {
    const client = new Client(clientConfig);
    try {
        await client.connect();
        console.log('[POPULATION STATS] Building universal benchmarks (Everyone included)...');

        const sources = [
            { name: 'usaw', table: 'usaw_meet_results', idCol: 'lifter_id' },
            { name: 'iwf', table: 'iwf_meet_results', idCol: 'db_lifter_id' }
        ];

        const buckets = {};

        for (const source of sources) {
            console.log(`[POPULATION STATS] Processing ${source.name}...`);
            const res = await client.query(`SELECT * FROM ${source.table} ORDER BY date DESC`);
            const athletes = {};

            res.rows.forEach(r => {
                const id = r[source.idCol];
                if (!athletes[id]) athletes[id] = [];
                athletes[id].push(r);
            });

            Object.values(athletes).forEach(results => {
                // Inclusion: EVERYONE is included once via their career metrics
                const metrics = calculateLifterMetrics(results);
                const latest = results[0];
                const bucketKeys = getDemographicBucketKeys(source.name, latest.gender, latest.age_category, latest.meet_name);

                bucketKeys.forEach(k => {
                    if (!buckets[k]) buckets[k] = createEmptyBucket();
                    Object.keys(metrics).forEach(m => {
                        if (metrics[m] !== null) {
                            buckets[k][m].distribution.push(metrics[m]);
                            buckets[k][m].sampleSize++;
                        }
                    });
                });
            });
        }

        console.log('[POPULATION STATS] Finalizing distributions...');
        Object.values(buckets).forEach(b => {
            Object.keys(b).forEach(m => b[m].distribution.sort((a, b) => a - b));
        });

        if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUTPUT_DIR, 'population_stats.json'), JSON.stringify(buckets));
        console.log('[POPULATION STATS] SUCCESS. Universal benchmarks built.');

    } catch (err) {
        console.error('[POPULATION STATS] ERROR:', err);
    } finally {
        await client.end();
    }
}

run();
