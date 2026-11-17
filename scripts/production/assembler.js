const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
require('dotenv').config();

const clientConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
};

const OUTPUT_DIR = process.env.OUTPUT_DIR || '/var/www/athlete-data';
const SHARDS_DIR = path.join(OUTPUT_DIR, 'shards');
const COUNTRY_MAP = {
    'ALB': 'Albania', 'AND': 'Andorra', 'ARM': 'Armenia', 'AUT': 'Austria', 'AZE': 'Azerbaijan',
    'BEL': 'Belgium', 'BIH': 'Bosnia and Herzegovina', 'BUL': 'Bulgaria', 'CRO': 'Croatia',
    'CYP': 'Cyprus', 'CZE': 'Czech Republic', 'DEN': 'Denmark', 'EST': 'Estonia', 'FIN': 'Finland',
    'FRA': 'France', 'GEO': 'Georgia', 'GER': 'Germany', 'GRE': 'Greece', 'GBR': 'United Kingdom',
    'HUN': 'Hungary', 'ISL': 'Iceland', 'IRL': 'Ireland', 'ITA': 'Italy', 'KOS': 'Kosovo',
    'LAT': 'Latvia', 'LIE': 'Liechtenstein', 'LTU': 'Lithuania', 'LUX': 'Luxembourg', 'MDA': 'Moldova',
    'MON': 'Monaco', 'MNE': 'Montenegro', 'NED': 'Netherlands', 'NOR': 'Norway', 'POL': 'Poland',
    'POR': 'Portugal', 'ROU': 'Romania', 'RUS': 'Russia', 'SMR': 'San Marino', 'SRB': 'Serbia',
    'SVK': 'Slovakia', 'SVN': 'Slovenia', 'ESP': 'Spain', 'SWE': 'Sweden', 'SUI': 'Switzerland',
    'TUR': 'Turkey', 'UKR': 'Ukraine', 'AFG': 'Afghanistan', 'BAN': 'Bangladesh', 'CAM': 'Cambodia',
    'CHN': 'China', 'HKG': 'Hong Kong', 'IND': 'India', 'IDN': 'Indonesia', 'IRN': 'Iran',
    'JPN': 'Japan', 'JOR': 'Jordan', 'KAZ': 'Kazakhstan', 'KOR': 'South Korea', 'KWT': 'Kuwait',
    'KGZ': 'Kyrgyzstan', 'LAO': 'Laos', 'LBN': 'Lebanon', 'MAS': 'Malaysia', 'MGL': 'Mongolia',
    'MYA': 'Myanmar', 'NEP': 'Nepal', 'PAK': 'Pakistan', 'PHI': 'Philippines', 'QAT': 'Qatar',
    'SGP': 'Singapore', 'THA': 'Thailand', 'TJK': 'Tajikistan', 'TPE': 'Taiwan', 'TKM': 'Turkmenistan',
    'UZB': 'Uzbekistan', 'VIE': 'Vietnam', 'ARG': 'Argentina', 'BAR': 'Barbados', 'BRA': 'Brazil',
    'CAN': 'Canada', 'CHI': 'Chile', 'COL': 'Colombia', 'CRC': 'Costa Rica', 'CUB': 'Cuba',
    'DOM': 'Dominican Republic', 'ECU': 'Ecuador', 'SLV': 'El Salvador', 'GUA': 'Guatemala',
    'HAI': 'Haiti', 'HND': 'Honduras', 'JAM': 'Jamaica', 'MEX': 'Mexico', 'PAN': 'Panama',
    'PAR': 'Paraguay', 'PER': 'Peru', 'PUR': 'Puerto Rico', 'URU': 'Uruguay', 'USA': 'United States',
    'VEN': 'Venezuela', 'AUS': 'Australia', 'FIJ': 'Fiji', 'NZL': 'New Zealand', 'PNG': 'Papua New Guinea',
    'SAM': 'Samoa', 'TON': 'Tonga', 'ALG': 'Algeria', 'ANG': 'Angola', 'BOT': 'Botswana',
    'BWA': 'Botswana', 'CMR': 'Cameroon', 'EGY': 'Egypt', 'ETH': 'Ethiopia', 'GHA': 'Ghana',
    'KEN': 'Kenya', 'LIB': 'Libya', 'MAR': 'Morocco', 'MRI': 'Mauritius', 'MOZ': 'Mozambique',
    'NAM': 'Namibia', 'NGA': 'Nigeria', 'RWA': 'Rwanda', 'RSA': 'South Africa', 'SUD': 'Sudan',
    'TAN': 'Tanzania', 'TUN': 'Tunisia', 'UGA': 'Uganda', 'ZIM': 'Zimbabwe', 'VAN': 'Vanuatu',
    'AIN': 'Individual Neutral Athletes', 'WRT': 'Weightlifting Refugee Team', 'ISR': 'Israel',
    'ARU': 'Aruba', 'ASA': 'American Samoa', 'BOL': 'Bolivia', 'HON': 'Honduras', 'NIC': 'Nicaragua',
    'PUR': 'Puerto Rico', 'NRU': 'Nauru', 'KIR': 'Kiribati', 'TTO': 'Trinidad and Tobago'
};

function mapCountryCodeToName(code) {
    if (!code) return null;
    return COUNTRY_MAP[code] || null;
}

function normalizeName(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isDataDefectString(name) {
    const s = (name || '').trim();
    return s.includes('@') || /\d/.test(s);
}

function levenshteinDistance(s1, s2) {
    const m = s1.length, n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}

function isAdjacentTransposition(s1, s2) {
    if (s1.length !== s2.length) return false;
    const diffs = [];
    for (let i = 0; i < s1.length; i++) {
        if (s1[i] !== s2[i]) diffs.push(i);
    }
    return (
        diffs.length === 2 &&
        diffs[1] === diffs[0] + 1 &&
        s1[diffs[0]] === s2[diffs[1]] &&
        s1[diffs[1]] === s2[diffs[0]]
    );
}

function isMinorClericalTypo(nameA, nameB) {
    const cleanA = (nameA || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    const cleanB = (nameB || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!cleanA || !cleanB) return false;
    if (cleanA === cleanB) return true; // Punctuation/spacing difference only (e.g. O'Brien vs Obrien)

    const tokensA = normalizeName(nameA).split(' ');
    const tokensB = normalizeName(nameB).split(' ');
    if (tokensA.length >= 2 && tokensB.length >= 2) {
        const firstA = tokensA[0].replace(/[^a-z]/g, '');
        const firstB = tokensB[0].replace(/[^a-z]/g, '');
        const lastA = tokensA[tokensA.length - 1].replace(/[^a-z]/g, '');
        const lastB = tokensB[tokensB.length - 1].replace(/[^a-z]/g, '');

        if (
            firstA === firstB &&
            lastA.length > 0 &&
            lastB.length > 0 &&
            lastA[0] === lastB[0] &&
            Math.max(lastA.length, lastB.length) >= 6 &&
            (levenshteinDistance(lastA, lastB) === 1 || isAdjacentTransposition(lastA, lastB))
        ) {
            return true;
        }
    }
    return false;
}

// ── Achievement Aggregator ──────────────────────────────────────────────────
function aggregateAchievements(rankings) {
    const achievements = {
        medal_counts: {
            gold: { total_lift: 0, snatch: 0, cj: 0, combined_total: 0 },
            silver: { total_lift: 0, snatch: 0, cj: 0, combined_total: 0 },
            bronze: { total_lift: 0, snatch: 0, cj: 0, combined_total: 0 }
        },
        levels: {
            local: { gold: 0, silver: 0, bronze: 0 },
            national: { gold: 0, silver: 0, bronze: 0 },
            international: { gold: 0, silver: 0, bronze: 0 }
        },
        medals: []
    };

    if (!rankings || !Array.isArray(rankings)) return achievements;

    rankings.forEach(r => {
        const ranks = {
            total_lift: r.total_rank,
            snatch: r.snatch_rank,
            cj: r.cj_rank
        };

        const level = r.level === 'International' ? 'international' :
                      (r.level === 'National' || r.level === 'North American Open Series') ? 'national' :
                      'local';

        let hasMedal = false;
        Object.entries(ranks).forEach(([type, rank]) => {
            if (rank >= 1 && rank <= 3) {
                const medal = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
                achievements.medal_counts[medal][type]++;
                achievements.medal_counts[medal].combined_total++;
                achievements.levels[level][medal]++;
                hasMedal = true;
            }
        });

        if (hasMedal) {
            achievements.medals.push({
                result_id: r.result_id,
                meet_name: r.meet_name,
                date: r.date,
                level: r.level,
                division: r.division,
                ranks: ranks
            });
        }
    });

    // Sort medals by date descending
    achievements.medals.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Summary of combined medal counts (Snatch + CJ + Total)
    achievements.summary = {
        gold: achievements.medal_counts.gold.combined_total,
        silver: achievements.medal_counts.silver.combined_total,
        bronze: achievements.medal_counts.bronze.combined_total
    };

    return achievements;
}

// ── Population Stats Loader ──────────────────────────────────────────────────
let _populationStats = null;
function getPopulationStats() {
    if (_populationStats) return _populationStats;
    const p = path.join(OUTPUT_DIR, 'population_stats.json');
    if (fs.existsSync(p)) {
        try { 
            _populationStats = JSON.parse(fs.readFileSync(p, 'utf8')); 
            console.log(`[ASSEMBLER] Population stats loaded successfully from ${p}`);
        } catch (e) { 
            console.error(`[ASSEMBLER] Failed to parse population stats at ${p}:`, e);
            _populationStats = {}; 
        }
    } else {
        console.warn(`[ASSEMBLER] WARNING: population_stats.json missing at ${p}. Analytics will be empty.`);
        _populationStats = {};
    }
    return _populationStats;
}

let _historicalBenchmarks = null;
function getHistoricalBenchmarks() {
    if (_historicalBenchmarks) return _historicalBenchmarks;
    const p = path.join(OUTPUT_DIR, 'historical_benchmarks.json');
    if (fs.existsSync(p)) {
        try { 
            _historicalBenchmarks = JSON.parse(fs.readFileSync(p, 'utf8')); 
            console.log(`[ASSEMBLER] Historical benchmarks loaded successfully from ${p}`);
        } catch (e) { 
            console.error(`[ASSEMBLER] Failed to parse historical benchmarks at ${p}:`, e);
            _historicalBenchmarks = {}; 
        }
    } else {
        console.warn(`[ASSEMBLER] WARNING: historical_benchmarks.json missing at ${p}. Historical stats will be empty.`);
        _historicalBenchmarks = {};
    }
    return _historicalBenchmarks;
}

// ── Metric Calculation Logic ──────────────────────────────────────────────────
const parseAttempt = (s) => {
    if (s === null || s === undefined || s === '' || s === '0' || s === '---') return null;
    if (typeof s === 'number') return s;
    const n = parseInt(s);
    return isNaN(n) ? null : n;
};
const isSuccess = (v) => { const n = parseAttempt(v); return n !== null && n > 0; };
const isMiss = (v) => { const n = parseAttempt(v); return n !== null && n < 0; };

function calculateLifterMetrics(results, windowYears = null) {
    const metrics = {
        successRate: null, snatchSuccessRate: null, cleanJerkSuccessRate: null,
        consistencyScore: null, clutchPerformance: null, bounceBackRate: null,
        snatchBounceBackRate: null, cleanJerkBounceBackRate: null,
        competitionFrequency: null, qScorePerformance: null,
        openingStrategy: null, jumpPercentage: null
    };
    if (!results || results.length === 0) return metrics;

    const now = new Date();
    const rollingCutoff = new Date();
    rollingCutoff.setFullYear(now.getFullYear() - 3); // Standard 3-year rolling window

    const filtered = windowYears ? results.filter(r => {
        const d = r.date ? new Date(r.date) : null;
        return d && !isNaN(d.getTime()) && d >= rollingCutoff;
    }) : results;

    if (filtered.length === 0) return metrics;

    let totalAtt = 0, totalSucc = 0, snAtt = 0, snSucc = 0, cjAtt = 0, cjSucc = 0;
    let clutchSit = 0, clutchSucc = 0, sbbSit = 0, sbbSucc = 0, cbbSit = 0, cbbSucc = 0;
    const totals = [], years = new Set(), qScores = [];
    const openPercs = [], jumpPercs = [];

    filtered.forEach((r, idx) => {
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
        const s1 = parseAttempt(sn[0]), s2 = parseAttempt(sn[1]), s3 = parseAttempt(sn[2]);
        const c1 = parseAttempt(cj[0]), c2 = parseAttempt(cj[1]), c3 = parseAttempt(cj[2]);

        // Opening Strategy: (Opening Snatch + Opening CJ) / Previous Best Total
        const prev = results[idx + 1];
        if (prev) {
            const prevBest = parseAttempt(prev.total);
            const openingTotal = (s1 ? Math.abs(s1) : 0) + (c1 ? Math.abs(c1) : 0);
            if (prevBest && openingTotal > 0) openPercs.push((openingTotal / prevBest) * 100);
        }

        // Jumps: Percent increase between attempts (regardless of make/miss)
        if (s1 && s2) jumpPercs.push(((Math.abs(s2) - Math.abs(s1)) / Math.abs(s1)) * 100);
        if (s2 && s3) jumpPercs.push(((Math.abs(s3) - Math.abs(s2)) / Math.abs(s2)) * 100);
        if (c1 && c2) jumpPercs.push(((Math.abs(c2) - Math.abs(c1)) / Math.abs(c1)) * 100);
        if (c2 && c3) jumpPercs.push(((Math.abs(c3) - Math.abs(c2)) / Math.abs(c2)) * 100);
    });

    if (totalAtt > 0) metrics.successRate = (totalSucc / totalAtt) * 100;
    if (snAtt > 0) metrics.snatchSuccessRate = (snSucc / snAtt) * 100;
    if (cjAtt > 0) metrics.cleanJerkSuccessRate = (cjSucc / cjAtt) * 100;
    if (clutchSit > 0) metrics.clutchPerformance = (clutchSucc / clutchSit) * 100;
    if (sbbSit > 0) metrics.snatchBounceBackRate = (sbbSucc / sbbSit) * 100;
    if (cbbSit > 0) metrics.cleanJerkBounceBackRate = (cbbSucc / cbbSit) * 100;
    if (sbbSit + cbbSit > 0) metrics.bounceBackRate = ((sbbSucc + cbbSucc) / (sbbSit + cbbSit)) * 100;
    if (totals.length >= 2) {
        const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
        const variance = totals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / totals.length;
        metrics.consistencyScore = Math.max(0, 100 - (Math.sqrt(variance) / mean) * 100);
    }
    if (filtered.length >= 2) {
        const sortedDates = filtered
            .map(r => r.date ? new Date(r.date) : null)
            .filter(d => d && !isNaN(d.getTime()))
            .sort((a, b) => a - b);

        if (sortedDates.length >= 2) {
            const first = sortedDates[0];
            const last = sortedDates[sortedDates.length - 1];
            // Interval-based frequency: (Meets - 1) / Span. Floor span at 90 days to prevent spikes.
            const diffDays = Math.max(90, (last - first) / (1000 * 60 * 60 * 24));
            metrics.competitionFrequency = ((filtered.length - 1) / diffDays) * 365.25;
        } else {
            metrics.competitionFrequency = 0;
        }
    } else {
        metrics.competitionFrequency = 0;
    }
    if (qScores.length > 0) metrics.qScorePerformance = Math.max(...qScores);
    if (openPercs.length > 0) metrics.openingStrategy = openPercs.reduce((a, b) => a + b, 0) / openPercs.length;
    if (jumpPercs.length > 0) metrics.jumpPercentage = jumpPercs.reduce((a, b) => a + b, 0) / jumpPercs.length;

    return metrics;
}

function computePercentile(val, dist) {
    if (!dist || dist.length === 0 || val === null) return null;

    // Find the first index >= val (start of the tie)
    let low = 0, high = dist.length;
    while (low < high) {
        let mid = (low + high) >> 1;
        if (dist[mid] < val) low = mid + 1;
        else high = mid;
    }
    const start = low;

    // Find the first index > val (end of the tie)
    low = 0; high = dist.length;
    while (low < high) {
        let mid = (low + high) >> 1;
        if (dist[mid] <= val) low = mid + 1;
        else high = mid;
    }
    const end = low;

    // Standard statistical percentile: (Below + 0.5 * At) / Total
    const midPoint = start + (0.5 * (end - start));
    return Math.round((midPoint / dist.length) * 100);
}

function getQualifyingBuckets(source, gender, age) {
    if (age === null || age === undefined || !gender) return [];
    const g = gender.toString().toLowerCase().startsWith('f') ? 'F' : 'M';
    const buckets = [`${source}_${g}_all` || `${source}_${g}_all` ]; // Added synchronized _all bucket

    // IWF Age Group Rules
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

function getAthletePercentiles(results, gender, source, birthYear) {
    if (!results || results.length === 0) return null;
    const stats = getPopulationStats();

    const careerMetrics = calculateLifterMetrics(results, null);
    const recentMetrics = calculateLifterMetrics(results, 36);

    const latestRes = results.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const compYear = new Date(latestRes.date).getFullYear();
    const age = birthYear ? compYear - birthYear : null;

    const buckets = getQualifyingBuckets(source, gender, age);
    const out = {};

    buckets.forEach(bKey => {
        const bStats = stats[bKey];
        if (bStats) {
            out[bKey] = {
                bucket: getBucketLabel(bKey),
                sampleSize: bStats.successRate?.sampleSize || 0,
                career: {},
                recent: {}
            };
            const keys = ['successRate', 'snatchSuccessRate', 'cleanJerkSuccessRate', 'consistencyScore', 'clutchPerformance', 'bounceBackRate', 'snatchBounceBackRate', 'cleanJerkBounceBackRate', 'competitionFrequency', 'qScorePerformance'];
            keys.forEach(k => {
                out[bKey].career[k] = computePercentile(careerMetrics[k], bStats[k]?.distribution);
                out[bKey].recent[k] = computePercentile(recentMetrics[k], bStats[k]?.distribution);
            });
            if (recentMetrics.openingStrategy !== null) out[bKey].recent.openingStrategyRaw = recentMetrics.openingStrategy;
            if (recentMetrics.jumpPercentage !== null) out[bKey].recent.jumpPercentageRaw = recentMetrics.jumpPercentage;
        }
    });

    return Object.keys(out).length > 0 ? out : null;
}

function computeHistoricalPercentile(val, metricMap) {
    if (!metricMap || !metricMap.map || val === null) return null;
    const map = metricMap.map;

    // Find the first index where map[i] >= val (start of tie)
    let low = 0, high = 100;
    while (low < high) {
        let mid = (low + high) >> 1;
        if (map[mid] < val) low = mid + 1;
        else high = mid;
    }
    const start = low;

    // Find the first index where map[i] > val (end of tie)
    low = 0; high = 100;
    while (low < high) {
        let mid = (low + high) >> 1;
        if (map[mid] <= val) low = mid + 1;
        else high = mid;
    }
    const end = low;

    const midPoint = start + (0.5 * (end - start));
    return Math.round(midPoint);
}

function getYearlySnapshots(results, gender, source, birthYear) {
    if (!results || results.length === 0) return null;
    const hist = getHistoricalBenchmarks();
    const snapshots = {};

    const years = [...new Set(results.map(r => r.date ? new Date(r.date).getFullYear() : null).filter(y => y !== null))].sort();

    years.forEach(year => {
        const yearResults = results.filter(r => r.date && new Date(r.date).getFullYear() <= year);
        const metrics = calculateLifterMetrics(yearResults, null);

        if (!hist[year]) return;

        const age = birthYear ? year - birthYear : null;
        const buckets = getQualifyingBuckets(source, gender, age);
        const snapshot = {};

        buckets.forEach(bKey => {
            if (hist[year][bKey]) {
                const bStats = hist[year][bKey];
                snapshot[bKey] = {
                    bucket: getBucketLabel(bKey),
                    sampleSize: bStats.successRate?.sampleSize || 0,
                    metrics: {}
                };
                const metricKeys = ['successRate', 'snatchSuccessRate', 'cleanJerkSuccessRate', 'qScorePerformance', 'competitionFrequency', 'clutchPerformance', 'bounceBackRate', 'snatchBounceBackRate', 'cleanJerkBounceBackRate'];
                metricKeys.forEach(k => {
                    snapshot[bKey].metrics[k] = { value: metrics[k], percentile: computeHistoricalPercentile(metrics[k], bStats[k]) };
                });
            }
        });

        if (Object.keys(snapshot).length > 0) snapshots[year] = snapshot;
    });

    return Object.keys(snapshots).length > 0 ? snapshots : null;
}

/**
 * THE ASSEMBLER - Phase 4.5 (UNIFIED SINGLE-QUERY)
 * Finalized logic to solve the 'relation not found' issue.
 */
async function generateAthlete(params, externalClient = null) {
    const { usaw_id, usaw_lifter_id, iwf_id, owlcms_id } = typeof params === 'object' ? params : { usaw_id: params };

    const client = externalClient || new Client(clientConfig);
    if (!externalClient) await client.connect();

    try {
        // Phase 1: Identity Resolution (Public Identifier -> Internal Join Key)
        let resolvedUsawId = usaw_lifter_id || null;
        if (usaw_id && !resolvedUsawId) {
            const idStr = usaw_id.toString();
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);
            const isNumeric = /^\d+$/.test(idStr);

            let filter;
            if (isUuid) {
                filter = 'lifter_id = $1::uuid';
            } else if (isNumeric) {
                // Check both membership and numeric lifter_id using text casting for safety
                filter = 'membership_number::text = $1 OR lifter_id::text = $1';
            } else {
                filter = 'membership_number::text = $1';
            }

            const lookup = await client.query(`SELECT lifter_id FROM usaw_lifters WHERE ${filter} LIMIT 1`, [idStr]);
            resolvedUsawId = lookup.rows[0]?.lifter_id || null;
            
            if (usaw_id && !resolvedUsawId) {
                console.warn(`[ASSEMBLER] Warning: Failed to resolve USAW ID ${usaw_id} to an internal lifter_id`);
            }
        }

        let resolvedIwfId = null;
        if (iwf_id) {
            const idStr = iwf_id.toString();
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idStr);
            const isNumeric = /^\d+$/.test(idStr);

            let filter;
            if (isUuid) {
                filter = 'db_lifter_id = $1::uuid';
            } else if (isNumeric) {
                filter = 'iwf_lifter_id::text = $1 OR db_lifter_id::text = $1';
            } else {
                filter = 'iwf_lifter_id::text = $1';
            }

            const lookup = await client.query(`SELECT db_lifter_id FROM iwf_lifters WHERE ${filter} LIMIT 1`, [idStr]);
            resolvedIwfId = lookup.rows[0]?.db_lifter_id || null;

            if (iwf_id && !resolvedIwfId) {
                console.warn(`[ASSEMBLER] Warning: Failed to resolve IWF ID ${iwf_id} to an internal db_lifter_id`);
            }
        }

        let resolvedOwlcmsId = null;
        if (owlcms_id) {
            const idStr = owlcms_id.toString();
            const lookup = await client.query(`SELECT lifter_id FROM owlcms_lifters WHERE lifter_id::text = $1 LIMIT 1`, [idStr]);
            resolvedOwlcmsId = lookup.rows[0]?.lifter_id || null;

            if (owlcms_id && !resolvedOwlcmsId) {
                console.warn(`[ASSEMBLER] Warning: Failed to resolve OWLCMS ID ${owlcms_id} to an internal lifter_id`);
            }
        }

        const query = `
            WITH RECURSIVE athlete_identity AS (
                -- Anchor row
                SELECT usaw_lifter_id, iwf_db_lifter_id, iwf_db_lifter_id_2, owlcms_lifter_id, owlcms_lifter_id_2
                FROM athlete_aliases
                WHERE (usaw_lifter_id = $1 AND $1 IS NOT NULL)
                   OR (iwf_db_lifter_id = $2 AND $2 IS NOT NULL)
                   OR (iwf_db_lifter_id_2 = $2 AND $2 IS NOT NULL)
                   OR (owlcms_lifter_id = $3 AND $3 IS NOT NULL)
                   OR (owlcms_lifter_id_2 = $3 AND $3 IS NOT NULL)
                
                UNION
                
                -- Follow the alias chains across USAW, IWF, and OWLCMS
                SELECT aa.usaw_lifter_id, aa.iwf_db_lifter_id, aa.iwf_db_lifter_id_2, aa.owlcms_lifter_id, aa.owlcms_lifter_id_2
                FROM athlete_aliases aa
                JOIN athlete_identity ai ON (
                    (aa.iwf_db_lifter_id = ai.iwf_db_lifter_id AND aa.iwf_db_lifter_id IS NOT NULL) OR
                    (aa.iwf_db_lifter_id = ai.iwf_db_lifter_id_2 AND aa.iwf_db_lifter_id IS NOT NULL) OR
                    (aa.iwf_db_lifter_id_2 = ai.iwf_db_lifter_id AND aa.iwf_db_lifter_id_2 IS NOT NULL) OR
                    (aa.iwf_db_lifter_id_2 = ai.iwf_db_lifter_id_2 AND aa.iwf_db_lifter_id_2 IS NOT NULL) OR
                    (aa.usaw_lifter_id = ai.usaw_lifter_id AND aa.usaw_lifter_id IS NOT NULL) OR
                    (aa.owlcms_lifter_id = ai.owlcms_lifter_id AND aa.owlcms_lifter_id IS NOT NULL) OR
                    (aa.owlcms_lifter_id = ai.owlcms_lifter_id_2 AND aa.owlcms_lifter_id IS NOT NULL) OR
                    (aa.owlcms_lifter_id_2 = ai.owlcms_lifter_id AND aa.owlcms_lifter_id_2 IS NOT NULL) OR
                    (aa.owlcms_lifter_id_2 = ai.owlcms_lifter_id_2 AND aa.owlcms_lifter_id_2 IS NOT NULL)
                )
            ),
            all_iwf_db_ids AS (
                SELECT DISTINCT id FROM (
                    SELECT iwf_db_lifter_id as id FROM athlete_identity WHERE iwf_db_lifter_id IS NOT NULL
                    UNION
                    SELECT iwf_db_lifter_id_2 as id FROM athlete_identity WHERE iwf_db_lifter_id_2 IS NOT NULL
                    UNION
                    SELECT $2 as id WHERE $2 IS NOT NULL
                ) ids
            ),
            all_usaw_internal_ids AS (
                SELECT DISTINCT id FROM (
                    SELECT usaw_lifter_id as id FROM athlete_identity WHERE usaw_lifter_id IS NOT NULL
                    UNION
                    SELECT $1 as id WHERE $1 IS NOT NULL
                ) ids
            ),
            all_owlcms_internal_ids AS (
                SELECT DISTINCT id FROM (
                    SELECT owlcms_lifter_id as id FROM athlete_identity WHERE owlcms_lifter_id IS NOT NULL
                    UNION
                    SELECT owlcms_lifter_id_2 as id FROM athlete_identity WHERE owlcms_lifter_id_2 IS NOT NULL
                    UNION
                    SELECT $3::bigint as id WHERE $3 IS NOT NULL
                ) ids
            ),
            usaw_results_agg AS (
                SELECT 
                    jsonb_agg(
                        jsonb_build_object(
                            'id', r.result_id,
                            'meet_id', r.meet_id,
                            'lifter_name', r.lifter_name,
                            'date', r.date,
                            'meet_name', r.meet_name,
                            'meets', jsonb_build_object('Level', m."Level"), -- FIXED: Quotes for USAW table
                            'age_category', r.age_category,
                            'weight_class', r.weight_class,
                            'body_weight_kg', r.body_weight_kg,
                            'competition_age', r.competition_age,
                            'snatch_lift_1', r.snatch_lift_1,
                            'snatch_lift_2', r.snatch_lift_2,
                            'snatch_lift_3', r.snatch_lift_3,
                            'best_snatch', r.best_snatch,
                            'cj_lift_1', r.cj_lift_1,
                            'cj_lift_2', r.cj_lift_2,
                            'cj_lift_3', r.cj_lift_3,
                            'best_cj', r.best_cj,
                            'total', r.total,
                            'q_youth', r.q_youth,
                            'qpoints', r.qpoints,
                            'q_masters', r.q_masters,
                            'gamx_total', r.gamx_total,
                            'gamx_s', r.gamx_s,
                            'gamx_j', r.gamx_j,
                            'gamx_u', r.gamx_u,
                            'gamx_a', r.gamx_a,
                            'gamx_masters', r.gamx_masters,
                            'gamx_sm', r.gamx_sm,
                            'gamx_jm', r.gamx_jm,
                            'wso', r.wso,
                            'club_name', r.club_name,
                            'gender', r.gender,
                            'birth_year', r.birth_year
                        ) ORDER BY r.date::DATE DESC
                    ) as results
                FROM usaw_meet_results r
                LEFT JOIN usaw_meets m ON r.meet_id = m.meet_id
                WHERE r.lifter_id IN (SELECT id FROM all_usaw_internal_ids)
            ),
            iwf_results_agg AS (
                SELECT 
                    jsonb_agg(
                       jsonb_build_object(
                            'id', r.db_result_id,
                            'db_lifter_id', r.db_lifter_id,
                            'iwf_lifter_id', il.iwf_lifter_id,
                            'lifter_name', r.lifter_name,
                            'meet_id', r.db_meet_id,
                            'iwf_meet_id', m.iwf_meet_id,
                            'date', r.date,
                            'meet_name', r.meet_name,
                            'meets', jsonb_build_object('Level', m.level), -- FIXED: Lowercase for IWF table
                            'age_category', r.age_category,
                            'weight_class', r.weight_class,
                            'body_weight_kg', r.body_weight_kg,
                            'competition_age', r.competition_age,
                            'snatch_lift_1', r.snatch_lift_1,
                            'snatch_lift_2', r.snatch_lift_2,
                            'snatch_lift_3', r.snatch_lift_3,
                            'best_snatch', r.best_snatch,
                            'cj_lift_1', r.cj_lift_1,
                            'cj_lift_2', r.cj_lift_2,
                            'cj_lift_3', r.cj_lift_3,
                            'best_cj', r.best_cj,
                            'total', r.total,
                            'qpoints', r.qpoints,
                            'q_youth', r.q_youth,
                            'q_masters', r.q_masters,
                            'gamx_total', r.gamx_total,
                            'gamx_s', r.gamx_s,
                            'gamx_j', r.gamx_j,
                            'gamx_u', r.gamx_u,
                            'gamx_a', r.gamx_a,
                            'gamx_masters', r.gamx_masters,
                            'gamx_sm', r.gamx_sm,
                            'gamx_jm', r.gamx_jm,
                            'gender', r.gender,
                            'birth_year', r.birth_year
                        ) ORDER BY r.date::DATE DESC
                    ) as results
                FROM iwf_meet_results r
                LEFT JOIN iwf_meets m ON r.db_meet_id = m.db_meet_id
                LEFT JOIN iwf_lifters il ON r.db_lifter_id = il.db_lifter_id
                WHERE r.db_lifter_id IN (SELECT id FROM all_iwf_db_ids)
            ),
            owlcms_results_agg AS (
                SELECT 
                    jsonb_agg(
                        jsonb_build_object(
                            'id', r.result_id,
                            'result_id', r.result_id,
                            'meet_id', r.meet_id,
                            'meet_name', m.meet_name,
                            'date', m.start_date,
                            'end_date', m.end_date,
                            'city', m.city,
                            'venue', m.country,
                            'country_code', r.country_code,
                            'organizer', m.organizer,
                            'category', r.category,
                            'weight_class', r.category,
                            'body_weight_kg', r.body_weight_kg,
                            'scale_weight_kg', r.scale_weight_kg,
                            'gender', r.gender,
                            'birth_year', r.birth_year,
                            'competition_age', r.competition_age,
                            'session_name', r.session_name,
                            'lot_number', r.lot_number,
                            'start_number', r.start_number,
                            'snatch_lift_1', r.snatch_1,
                            'snatch_lift_2', r.snatch_2,
                            'snatch_lift_3', r.snatch_3,
                            'best_snatch', r.best_snatch,
                            'snatch_timestamps', jsonb_build_object('t1', r.snatch_1_time, 't2', r.snatch_2_time, 't3', r.snatch_3_time),
                            'cj_lift_1', r.cj_1,
                            'cj_lift_2', r.cj_2,
                            'cj_lift_3', r.cj_3,
                            'best_cj', r.best_cj,
                            'cj_timestamps', jsonb_build_object('t1', r.cj_1_time, 't2', r.cj_2_time, 't3', r.cj_3_time),
                            'total', r.total,
                            'sinclair', r.sinclair,
                            'robi', r.robi,
                            'gamx', r.gamx,
                            'gamx_total', r.gamx_total,
                            'gamx_u', r.gamx_u,
                            'gamx_a', r.gamx_a,
                            'gamx_s', r.gamx_s,
                            'gamx_j', r.gamx_j,
                            'gamx_masters', r.gamx_masters,
                            'gamx_sm', r.gamx_sm,
                            'gamx_jm', r.gamx_jm,
                            'qpoints', r.qpoints,
                            'q_youth', r.q_youth,
                            'q_masters', r.q_masters,
                            'attempts_summary', jsonb_build_object(
                                'snatch_made', r.snatch_successful_attempts,
                                'cj_made', r.cj_successful_attempts,
                                'total_made', r.total_successful_attempts
                            ),
                            'bounce_back', jsonb_build_object(
                                'snatch_2', r.bounce_back_snatch_2,
                                'snatch_3', r.bounce_back_snatch_3,
                                'cj_2', r.bounce_back_cj_2,
                                'cj_3', r.bounce_back_cj_3
                            ),
                            'ytd_bests', jsonb_build_object(
                                'snatch', r.best_snatch_ytd,
                                'cj', r.best_cj_ytd,
                                'total', r.best_total_ytd
                            ),
                            'eligible_for_ranking', r.eligible_for_individual_ranking,
                            'participations', r.participations
                        ) ORDER BY m.start_date DESC
                    ) as results
                FROM owlcms_meet_results r
                JOIN owlcms_meets m ON r.meet_id = m.meet_id
                WHERE r.lifter_id IN (SELECT id FROM all_owlcms_internal_ids)
            ),
            iwf_profiles_agg AS (
                SELECT 
                    jsonb_agg(
                        jsonb_build_object(
                            'id', il.iwf_lifter_id,
                            'url', il.iwf_athlete_url
                        )
                    ) as profiles
                FROM iwf_lifters il
                WHERE il.db_lifter_id IN (SELECT id FROM all_iwf_db_ids)
            ),
            usaw_rankings_agg AS (
                SELECT 
                    jsonb_agg(
                        jsonb_build_object(
                            'result_id', dr.result_id,
                            'division', dr.division_name,
                            'snatch_rank', dr.snatch_rank,
                            'cj_rank', dr.cj_rank,
                            'total_rank', dr.total_rank,
                            'meet_name', m."Meet",
                            'date', m."Date",
                            'level', m."Level"
                        )
                    ) as rankings
                FROM usaw_division_rankings dr
                JOIN usaw_meet_results r ON dr.result_id = r.result_id
                JOIN usaw_meets m ON r.meet_id = m.meet_id
                WHERE dr.athlete_id IN (SELECT id FROM all_usaw_internal_ids)
            ),
            id_collector AS (
                -- Final collection of every ID type for shard generation
                SELECT jsonb_build_object(
                    'usaw_ids', (SELECT jsonb_agg(DISTINCT membership_number) FROM usaw_lifters WHERE lifter_id IN (SELECT id FROM all_usaw_internal_ids) AND membership_number IS NOT NULL),
                    'iwf_ids', (SELECT jsonb_agg(DISTINCT iwf_lifter_id) FROM iwf_lifters WHERE db_lifter_id IN (SELECT id FROM all_iwf_db_ids) AND iwf_lifter_id IS NOT NULL),
                    'internal_ids', (SELECT jsonb_agg(DISTINCT id) FROM all_usaw_internal_ids),
                    'owlcms_ids', (SELECT jsonb_agg(DISTINCT id) FROM all_owlcms_internal_ids)
                ) as ids
            )
            SELECT 
                ul.lifter_id as usaw_internal_id,
                ul.athlete_name as usaw_athlete_name,
                ul.membership_number,
                ul.internal_id, ul.internal_id_2, ul.internal_id_3, ul.internal_id_4,
                ul.internal_id_5, ul.internal_id_6, ul.internal_id_7, ul.internal_id_8,
                il.db_lifter_id as prime_iwf_db_id,
                il.iwf_lifter_id as prime_iwf_official_id,
                il.athlete_name as iwf_athlete_name,
                il.country_code as iwf_country_code,
                il.country_name as iwf_country_name,
                ol.lifter_id as prime_owlcms_id,
                ol.athlete_name as owlcms_athlete_name,
                ol.country_code as owlcms_country_code,
                COALESCE(ura.results, '[]'::jsonb) as usaw_results,
                COALESCE(ira.results, '[]'::jsonb) as iwf_results,
                COALESCE(ora.results, '[]'::jsonb) as owlcms_results,
                COALESCE(ipa.profiles, '[]'::jsonb) as iwf_profiles,
                COALESCE(urn.rankings, '[]'::jsonb) as usaw_rankings,
                idc.ids as shard_ids
            FROM (SELECT 1) dummy
            LEFT JOIN usaw_lifters ul ON ul.lifter_id = (SELECT id FROM all_usaw_internal_ids LIMIT 1)
            LEFT JOIN iwf_lifters il ON il.db_lifter_id = (SELECT id FROM all_iwf_db_ids LIMIT 1)
            LEFT JOIN owlcms_lifters ol ON ol.lifter_id = (SELECT id FROM all_owlcms_internal_ids ORDER BY id ASC LIMIT 1)
            LEFT JOIN usaw_results_agg ura ON true
            LEFT JOIN iwf_results_agg ira ON true
            LEFT JOIN owlcms_results_agg ora ON true
            LEFT JOIN iwf_profiles_agg ipa ON true
            LEFT JOIN usaw_rankings_agg urn ON true
            LEFT JOIN id_collector idc ON true;
        `;

        const res = await client.query(query, [resolvedUsawId || null, resolvedIwfId || null, resolvedOwlcmsId || null]);
        if (res.rows.length === 0) return { success: false, message: 'Lifter not found' };

        const row = res.rows[0];
        const usawRes = row.usaw_results || [];
        const iwfRes = row.iwf_results || [];
        const owlcmsRes = row.owlcms_results || [];

        // Greedy detection: Find most recent non-null birth year and gender across history
        const birthYear = usawRes.find(r => r.birth_year)?.birth_year 
            || iwfRes.find(r => r.birth_year)?.birth_year
            || owlcmsRes.find(r => r.birth_year)?.birth_year;
            
        const gender = usawRes.find(r => r.gender)?.gender 
            || iwfRes.find(r => r.gender)?.gender
            || owlcmsRes.find(r => r.gender)?.gender;

        const latestUsaw = usawRes.find(r => r.date);
        const latestIwf = iwfRes.find(r => r.date);

        const externalLinks = [
            ...(row.iwf_profiles || []).map(p => ({ type: 'iwf', url: p.url })),
            row.internal_id ? { type: 'usaw', url: `https://usaweightlifting.sport80.com/public/rankings/member/${row.internal_id}` } : null
        ].filter(Boolean);

        const latestIwfLifterName = iwfRes.find(r => r.lifter_name && r.lifter_name.trim())?.lifter_name?.trim() || null;
        const canonicalIwfName = latestIwfLifterName || row.iwf_athlete_name;
        const athleteName = row.usaw_athlete_name || canonicalIwfName || row.owlcms_athlete_name;

        // Aggregate distinct historical names that diverge from the canonical athleteName
        const canonicalNorm = normalizeName(athleteName);
        const nameMap = new Map();
        for (const r of [...usawRes, ...iwfRes]) {
            const rawName = (r.lifter_name || '').trim();
            if (!rawName) continue;
            const norm = normalizeName(rawName);
            if (norm === canonicalNorm) continue;
            if (isDataDefectString(rawName) || isMinorClericalTypo(rawName, athleteName)) continue;

            const d = r.date ? new Date(r.date) : null;
            const year = (d && !isNaN(d.getTime())) ? d.getFullYear() : null;

            if (!nameMap.has(norm)) {
                nameMap.set(norm, {
                    name: rawName,
                    start_year: year,
                    end_year: year,
                    first_seen: r.date || null,
                    last_seen: r.date || null,
                    meet_count: 0
                });
            }
            const entry = nameMap.get(norm);
            entry.meet_count++;
            if (r.date) {
                if (!entry.first_seen || r.date < entry.first_seen) {
                    entry.first_seen = r.date;
                    entry.start_year = year;
                }
                if (!entry.last_seen || r.date > entry.last_seen) {
                    entry.last_seen = r.date;
                    entry.end_year = year;
                }
            }
        }
        const historicalNames = Array.from(nameMap.values());

        const countryCode = row.iwf_country_code || row.owlcms_country_code || 'USA';
        const countryName = row.iwf_country_name || mapCountryCodeToName(countryCode) || (countryCode === 'CAN' ? 'Canada' : 'United States');

        const data = {
            id: usaw_id || row.prime_iwf_official_id || owlcms_id || usaw_lifter_id,
            internal_id: row.internal_id,
            linked_usaw_id: row.membership_number,
            linked_iwf_id: row.prime_iwf_official_id,
            iwf_lifter_id: row.prime_iwf_official_id,
            db_lifter_id: row.prime_iwf_db_id,
            linked_owlcms_id: row.prime_owlcms_id,
            usaw_athlete_name: row.usaw_athlete_name,
            iwf_athlete_name: canonicalIwfName,
            owlcms_athlete_name: row.owlcms_athlete_name,
            athlete_name: athleteName,
            birthYear,
            country_code: countryCode,
            country_name: countryName,
            gender: gender,
            historical_names: historicalNames,
            external_links: externalLinks,
            usaw_results: row.usaw_results,
            iwf_results: row.iwf_results,
            owlcms_results: row.owlcms_results,
            achievements: aggregateAchievements(row.usaw_rankings),
            population_percentiles: {
                usaw: getAthletePercentiles(row.usaw_results, gender, 'usaw', birthYear),
                iwf: getAthletePercentiles(row.iwf_results, gender, 'iwf', birthYear)
            },
            historical_stats: {
                usaw: getYearlySnapshots(row.usaw_results, gender, 'usaw', birthYear),
                iwf: getYearlySnapshots(row.iwf_results, gender, 'iwf', birthYear)
            }
        };

        const writeFile = (type, id) => {
            if (!id) return;
            const idStr = id.toString();
            const shard = idStr.slice(-2).padStart(2, '0');
            const dir = path.join(OUTPUT_DIR, type, shard);
            const file = path.join(dir, `${idStr}.json.gz`);
            try {
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const shardData = { ...data, id: id };
                const compressed = zlib.gzipSync(JSON.stringify(shardData));
                fs.writeFileSync(file, compressed);
                try { fs.chmodSync(file, 0o644); } catch {}
            } catch (writeErr) {
                console.warn(`[ASSEMBLER] Could not write shard to ${file}: ${writeErr.message}`);
            }
        };

        // Quad-Writer Shard generation using IDs collected in the query
        const shardIds = row.shard_ids || {};
        if (shardIds.usaw_ids) shardIds.usaw_ids.forEach(id => writeFile('usaw', id));
        if (shardIds.iwf_ids) shardIds.iwf_ids.forEach(id => writeFile('iwf', id));
        if (shardIds.internal_ids) shardIds.internal_ids.forEach(id => writeFile('internal', id));
        if (shardIds.owlcms_ids) shardIds.owlcms_ids.forEach(id => writeFile('owlcms', id));

        return { 
            success: true, 
            shards_written: (shardIds.usaw_ids?.length || 0) + 
                            (shardIds.iwf_ids?.length || 0) + 
                            (shardIds.internal_ids?.length || 0) +
                            (shardIds.owlcms_ids?.length || 0)
        };

    } catch (err) {
        console.error(`[ASSEMBLER] Universal Fatal Error for USAW:${usaw_id || usaw_lifter_id}, IWF:${iwf_id}, OWLCMS:${owlcms_id}:`, err);
        return { success: false, error: err.message };
    } finally {
        if (!externalClient) await client.end();
    }
}

// ── Meet Shard Assembler ─────────────────────────────────────────────────────

const MEET_SHARD_SCHEMA_VERSION = '1.0';
const MAX_RAW_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB uncompressed guard for OWLCMS raw_payload

/**
 * Compute 2-digit shard directory from a meet identifier.
 * Numeric IDs: zero-padded to at least 2 chars, last 2 digits. Non-numeric: '00'.
 */
function getMeetShardId(meetId) {
    const s = String(meetId ?? '').trim();
    if (!/^\d+$/.test(s)) return '00';
    return s.padStart(2, '0').slice(-2);
}

/**
 * Write a gzip-compressed UTF-8 JSON meet shard to OUTPUT_DIR/meets/{federation}/{shardId}/{meetId}.json.gz.
 */
function writeMeetShardFile(federation, meetId, payload) {
    const idStr = String(meetId).trim();
    const shardId = getMeetShardId(idStr);
    const dir = path.join(OUTPUT_DIR, 'meets', federation, shardId);
    const file = path.join(dir, `${idStr}.json.gz`);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const compressed = zlib.gzipSync(JSON.stringify(payload));
    fs.writeFileSync(file, compressed);
    try { fs.chmodSync(file, 0o644); } catch {}
    return file;
}

/**
 * Assemble USAW meet shard payload.
 */
async function assembleUsawMeetPayload(meetId, client) {
    const meetQuery = `
        SELECT
            m.meet_id,
            m."Meet",
            m."Date",
            m."Level",
            m.city,
            m.state,
            m.address,
            m.street_address,
            m.zip_code,
            m.elevation_meters,
            m.latitude,
            m.longitude,
            m."URL",
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'street_address', l.street_address,
                            'city', l.city,
                            'state', l.state,
                            'zip_code', l.zip_code,
                            'address', l.address,
                            'location_text', l.location_text
                        )
                        ORDER BY l.listing_id ASC
                    )
                    FROM public.usaw_meet_listings l
                    WHERE l.meet_id = m.meet_id
                ),
                '[]'::jsonb
            ) AS listings
        FROM public.usaw_meets m
        WHERE m.meet_id = $1
        LIMIT 1;
    `;
    const meetRes = await client.query(meetQuery, [meetId]);
    if (meetRes.rows.length === 0) return null;

    const resultsQuery = `
        SELECT
            r.result_id,
            r.meet_id,
            r.lifter_name,
            r.lifter_id,
            r.weight_class,
            r.best_snatch,
            r.best_cj,
            r.total,
            r.snatch_lift_1,
            r.snatch_lift_2,
            r.snatch_lift_3,
            r.cj_lift_1,
            r.cj_lift_2,
            r.cj_lift_3,
            r.body_weight_kg,
            r.gender,
            r.birth_year,
            r.age_category,
            r.competition_age,
            r.wso,
            r.club_name,
            r.qpoints,
            r.q_youth,
            r.q_masters,
            r.gamx_total,
            r.gamx_s,
            r.gamx_j,
            r.gamx_u,
            r.gamx_a,
            r.gamx_masters,
            r.gamx_sm,
            r.gamx_jm,
            jsonb_build_object('membership_number', ul.membership_number) AS lifters
        FROM public.usaw_meet_results r
        LEFT JOIN public.usaw_lifters ul ON r.lifter_id = ul.lifter_id
        WHERE r.meet_id = $1
        ORDER BY r.weight_class ASC NULLS LAST, r.result_id ASC;
    `;
    const resultsRes = await client.query(resultsQuery, [meetId]);

    return {
        schema_version: MEET_SHARD_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        meet: meetRes.rows[0],
        results: resultsRes.rows || []
    };
}

/**
 * Assemble IWF meet shard payload. Accepts either iwf_meet_id (preferred) or db_meet_id.
 */
async function assembleIwfMeetPayload(meetIdentifier, client, isDbMeetId = false) {
    const meetQuery = isDbMeetId
        ? `SELECT iwf_meet_id, db_meet_id, meet, date, level, url, results FROM public.iwf_meets WHERE db_meet_id = $1 LIMIT 1`
        : `SELECT iwf_meet_id, db_meet_id, meet, date, level, url, results FROM public.iwf_meets WHERE iwf_meet_id = $1 LIMIT 1`;

    const meetRes = await client.query(meetQuery, [isDbMeetId ? parseInt(meetIdentifier, 10) : String(meetIdentifier)]);
    if (meetRes.rows.length === 0) return null;

    const meetRow = meetRes.rows[0];
    const [locRes, resultsRes] = await Promise.all([
        client.query(
            `SELECT * FROM public.iwf_meet_locations WHERE iwf_meet_id = $1 ORDER BY db_location_id ASC`,
            [meetRow.iwf_meet_id]
        ),
        client.query(
            `SELECT
                r.db_result_id,
                r.db_lifter_id,
                r.db_meet_id,
                r.meet_name,
                r.date,
                r.lifter_name,
                r.weight_class,
                r.best_snatch,
                r.best_cj,
                r.total,
                r.snatch_lift_1,
                r.snatch_lift_2,
                r.snatch_lift_3,
                r.cj_lift_1,
                r.cj_lift_2,
                r.cj_lift_3,
                r.body_weight_kg,
                r.gender,
                r.age_category,
                r.competition_age,
                r.birth_year,
                r.country_code,
                r.country_name,
                r.competition_group,
                r.rank,
                r.qpoints,
                r.q_youth,
                r.q_masters,
                r.gamx_total,
                r.gamx_s,
                r.gamx_j,
                r.gamx_u,
                r.gamx_a,
                r.gamx_masters,
                r.gamx_sm,
                r.gamx_jm,
                r.best_snatch_ytd,
                r.best_cj_ytd,
                r.best_total_ytd,
                r.snatch_successful_attempts,
                r.cj_successful_attempts,
                r.total_successful_attempts,
                r.bounce_back_snatch_2,
                r.bounce_back_snatch_3,
                r.bounce_back_cj_2,
                r.bounce_back_cj_3,
                r.manual_override,
                r.created_at,
                r.updated_at,
                jsonb_build_object('iwf_lifter_id', il.iwf_lifter_id) AS iwf_lifters
             FROM public.iwf_meet_results r
             LEFT JOIN public.iwf_lifters il ON r.db_lifter_id = il.db_lifter_id
             WHERE r.db_meet_id = $1
             ORDER BY r.weight_class ASC NULLS LAST, r.rank ASC NULLS LAST, r.db_result_id ASC`,
            [meetRow.db_meet_id]
        )
    ]);

    return {
        canonicalMeetId: meetRow.iwf_meet_id,
        payload: {
            schema_version: MEET_SHARD_SCHEMA_VERSION,
            generated_at: new Date().toISOString(),
            meet: meetRow,
            locations: locRes.rows || [],
            results: resultsRes.rows || []
        }
    };
}

/**
 * Resolve Point-in-Time federation_details (canonical name, short code, country code,
 * level, historical_sanction, and governance apex/continental/parent) for an OWLCMS meet.
 */
async function resolveOwlcmsFederationDetails(federationId, startDate, client) {
    if (!federationId) return null;

    const fedRes = await client.query(
        `SELECT id, canonical_name, short_code, country_code, level, parent_federation_id, is_verified
         FROM public.federation_registry
         WHERE id = $1
         LIMIT 1`,
        [federationId]
    );
    if (fedRes.rows.length === 0) return null;
    const fed = fedRes.rows[0];
    const asOfDate = startDate ? new Date(startDate).toISOString().slice(0, 10) : null;

    const [locRes, hqRes, lineageRes] = await Promise.all([
        client.query(
            `SELECT language_code, full_name, acronym, name_type, valid_from, valid_until
             FROM public.federation_localizations
             WHERE federation_id = $1
               AND ($2::date IS NULL OR ((valid_from IS NULL OR valid_from <= $2::date) AND (valid_until IS NULL OR valid_until >= $2::date)))
             ORDER BY CASE name_type WHEN 'primary' THEN 0 WHEN 'official_translation' THEN 1 WHEN 'historical' THEN 2 ELSE 3 END, full_name ASC`,
            [federationId, asOfDate]
        ),
        client.query(
            `SELECT city, country_code, valid_from, valid_until, is_current
             FROM public.federation_headquarters
             WHERE federation_id = $1
               AND ($2::date IS NULL OR ((valid_from IS NULL OR valid_from <= $2::date) AND (valid_until IS NULL OR valid_until >= $2::date)))
             ORDER BY is_current DESC, valid_from DESC NULLS LAST`,
            [federationId, asOfDate]
        ),
        client.query(
            `WITH RECURSIVE walk AS (
                SELECT 1 AS depth, fa.parent_id, fa.relationship_type, fa.is_verified,
                       ARRAY[fa.child_id, fa.parent_id] AS visited
                FROM public.federation_affiliations fa
                WHERE fa.child_id = $1
                  AND fa.is_active = true
                  AND ($2::date IS NULL OR ((fa.effective_start IS NULL OR fa.effective_start <= $2::date) AND (fa.effective_end IS NULL OR fa.effective_end >= $2::date)))
                UNION ALL
                SELECT w.depth + 1, fa.parent_id, fa.relationship_type, fa.is_verified,
                       w.visited || fa.parent_id
                FROM walk w
                JOIN public.federation_affiliations fa ON fa.child_id = w.parent_id
                WHERE w.depth < 6
                  AND NOT fa.parent_id = ANY(w.visited)
                  AND fa.is_active = true
                  AND ($2::date IS NULL OR ((fa.effective_start IS NULL OR fa.effective_start <= $2::date) AND (fa.effective_end IS NULL OR fa.effective_end >= $2::date)))
            )
            SELECT w.depth, w.relationship_type, w.is_verified,
                   f.id, f.canonical_name, f.short_code, f.country_code, f.level
            FROM walk w
            JOIN public.federation_registry f ON f.id = w.parent_id
            ORDER BY w.depth ASC, f.canonical_name ASC`,
            [federationId, asOfDate]
        )
    ]);

    const hops = lineageRes.rows || [];
    const primaryLoc = locRes.rows.find(l => l.name_type === 'primary') || locRes.rows[0] || null;
    const apex = hops.find(h => h.level === 'global_international' || h.level === 'international') || null;
    const continental = hops.find(h => h.level === 'continental') || null;
    const parent = hops.find(h => h.depth === 1 && h.relationship_type === 'regional_subdivision')
        || hops.find(h => h.depth === 1)
        || null;

    return {
        id: fed.id,
        canonical_name: fed.canonical_name,
        short_code: fed.short_code,
        country_code: fed.country_code,
        level: fed.level,
        is_verified: fed.is_verified,
        historical_sanction: {
            as_of_date: asOfDate,
            name: primaryLoc ? primaryLoc.full_name : fed.canonical_name,
            short_code: (primaryLoc && primaryLoc.acronym) ? primaryLoc.acronym : fed.short_code,
            localizations: locRes.rows,
            headquarters: hqRes.rows[0] || null
        },
        governance: {
            apex: apex ? { id: apex.id, canonical_name: apex.canonical_name, short_code: apex.short_code, level: apex.level } : null,
            continental: continental ? { id: continental.id, canonical_name: continental.canonical_name, short_code: continental.short_code, level: continental.level } : null,
            parent: parent ? { id: parent.id, canonical_name: parent.canonical_name, short_code: parent.short_code, level: parent.level, relationship_type: parent.relationship_type } : null,
            hops
        }
    };
}

/**
 * Assemble OWLCMS meet shard payload.
 */
async function assembleOwlcmsMeetPayload(meetId, client) {
    const meetRes = await client.query(
        `SELECT
            m.meet_id,
            m.meet_name,
            m.start_date,
            m.end_date,
            m.city,
            m.country,
            m.organizer,
            m.federation_id,
            m.organizer_federation_id,
            m.competition_scope,
            m.venue,
            m.latitude,
            m.longitude,
            m.host_country_code,
            m.format_version,
            m.raw_payload,
            fr.canonical_name AS federation_name,
            fr.short_code AS federation_short_code
         FROM public.owlcms_meets m
         LEFT JOIN public.federation_registry fr ON m.federation_id = fr.id
         WHERE m.meet_id = $1
         LIMIT 1`,
        [meetId]
    );
    if (meetRes.rows.length === 0) return null;

    const m = meetRes.rows[0];
    const [federationDetails, resultsRes] = await Promise.all([
        resolveOwlcmsFederationDetails(m.federation_id, m.start_date, client),
        client.query(
            `SELECT
                r.*,
                jsonb_build_object(
                    'lifter_id', ol.lifter_id,
                    'athlete_name', ol.athlete_name,
                    'first_name', ol.first_name,
                    'last_name', ol.last_name,
                    'gender', ol.gender,
                    'birth_year', ol.birth_year,
                    'exact_birth_date', ol.exact_birth_date,
                    'country_code', ol.country_code,
                    'club_name', ol.club_name,
                    'membership_number', ol.membership_number
                ) AS lifter,
                EXISTS (
                    SELECT 1 FROM public.athlete_aliases aa
                    WHERE (aa.owlcms_lifter_id = r.lifter_id OR aa.owlcms_lifter_id_2 = r.lifter_id)
                      AND aa.usaw_lifter_id IS NOT NULL
                ) AS has_usaw_alias,
                EXISTS (
                    SELECT 1 FROM public.athlete_aliases aa
                    WHERE (aa.owlcms_lifter_id = r.lifter_id OR aa.owlcms_lifter_id_2 = r.lifter_id)
                      AND (aa.iwf_db_lifter_id IS NOT NULL OR aa.iwf_db_lifter_id_2 IS NOT NULL)
                ) AS has_iwf_alias
             FROM public.owlcms_meet_results r
             JOIN public.owlcms_lifters ol ON r.lifter_id = ol.lifter_id
             WHERE r.meet_id = $1
             ORDER BY r.category ASC NULLS LAST, r.total DESC NULLS LAST, r.result_id ASC`,
            [meetId]
        )
    ]);

    const rawResults = resultsRes.rows || [];
    const clubs = new Set();
    const sessions = new Set();
    const categories = new Set();
    let totalAttempts = 0;
    let successfulAttempts = 0;

    const enrichedResults = rawResults.map(row => {
        const { has_usaw_alias, has_iwf_alias, lifter, ...resultFields } = row;
        const l = lifter || {};
        if (l.club_name) clubs.add(l.club_name);
        if (row.session_name) sessions.add(row.session_name);
        if (row.category) categories.add(row.category);

        const attempts = [row.snatch_1, row.snatch_2, row.snatch_3, row.cj_1, row.cj_2, row.cj_3];
        for (const a of attempts) {
            if (a !== null && a !== undefined && Number(a) !== 0) {
                totalAttempts++;
                if (Number(a) > 0) successfulAttempts++;
            }
        }

        const linkedFederation = has_usaw_alias ? 'USAW' : (has_iwf_alias ? 'IWF' : null);

        return {
            ...resultFields,
            lifter: l,
            athlete_name: l.athlete_name || null,
            first_name: l.first_name || null,
            last_name: l.last_name || null,
            gender: row.gender || l.gender || null,
            birth_year: row.birth_year || l.birth_year || null,
            club_name: l.club_name || null,
            country_code: row.country_code || l.country_code || null,
            membership_number: l.membership_number || null,
            profile_url: `/athlete/owlcms/${row.lifter_id}`,
            linked_federation: linkedFederation
        };
    });

    // Guard against oversized raw_payload (> 5 MB uncompressed)
    let rawPayload = m.raw_payload || null;
    if (rawPayload) {
        const rawSize = Buffer.byteLength(JSON.stringify(rawPayload), 'utf8');
        if (rawSize > MAX_RAW_PAYLOAD_BYTES && typeof rawPayload === 'object') {
            const { athletes, competitors, ...metaOnly } = rawPayload;
            rawPayload = metaOnly;
        }
    }

    const summary = {
        total_athletes: enrichedResults.length,
        total_clubs: clubs.size,
        total_attempts: totalAttempts,
        successful_attempts: successfulAttempts,
        success_rate: totalAttempts > 0 ? Math.round((successfulAttempts / totalAttempts) * 1000) / 10 : 0,
        sessions: Array.from(sessions),
        categories: Array.from(categories)
    };

    return {
        schema_version: MEET_SHARD_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        success: true,
        meet: {
            meet_id: m.meet_id,
            meet_name: m.meet_name,
            start_date: m.start_date,
            end_date: m.end_date,
            city: m.city,
            country: m.country,
            organizer: m.organizer,
            federation: (federationDetails && federationDetails.short_code) || m.federation_short_code || m.federation_name || null,
            federation_id: m.federation_id,
            organizer_federation_id: m.organizer_federation_id,
            competition_scope: m.competition_scope,
            federation_details: federationDetails,
            venue: m.venue,
            latitude: m.latitude,
            longitude: m.longitude,
            host_country_code: m.host_country_code,
            format_version: m.format_version,
            raw_payload: rawPayload,
            summary
        },
        results: enrichedResults
    };
}

/**
 * Generate and write a static .json.gz meet shard for USAW, IWF, or OWLCMS.
 *
 * @param {Object} params
 * @param {'usaw'|'iwf'|'owlcms'} params.federation
 * @param {string|number} params.meet_id - Canonical meet ID (iwf_meet_id for IWF unless is_db_meet_id=true)
 * @param {boolean} [params.is_db_meet_id=false] - When true for IWF, resolves iwf_meet_id from db_meet_id
 * @param {Object|null} [externalClient=null] - Optional pg Client/PoolClient
 */
async function generateMeet(params, externalClient = null) {
    const federation = String(params?.federation || '').trim().toLowerCase();
    const meetId = params?.meet_id ?? params?.meetId;
    const isDbMeetId = Boolean(params?.is_db_meet_id);

    if (!['usaw', 'iwf', 'owlcms'].includes(federation)) {
        return { success: false, error: `Unsupported federation "${federation}". Expected usaw, iwf, or owlcms.` };
    }
    if (meetId === null || meetId === undefined || String(meetId).trim() === '') {
        return { success: false, error: 'meet_id is required.' };
    }

    const client = externalClient || new Client(clientConfig);
    if (!externalClient) await client.connect();

    try {
        let canonicalMeetId = String(meetId).trim();
        let payload = null;

        if (federation === 'usaw') {
            payload = await assembleUsawMeetPayload(parseInt(canonicalMeetId, 10), client);
        } else if (federation === 'iwf') {
            const assembled = await assembleIwfMeetPayload(canonicalMeetId, client, isDbMeetId);
            if (assembled) {
                canonicalMeetId = String(assembled.canonicalMeetId);
                payload = assembled.payload;
            }
        } else if (federation === 'owlcms') {
            payload = await assembleOwlcmsMeetPayload(parseInt(canonicalMeetId, 10), client);
        }

        if (!payload) {
            return { success: false, error: `Meet not found (${federation}:${meetId})` };
        }

        const filePath = writeMeetShardFile(federation, canonicalMeetId, payload);
        return {
            success: true,
            federation,
            meet_id: canonicalMeetId,
            shard_id: getMeetShardId(canonicalMeetId),
            file_path: filePath,
            result_count: payload.results?.length || 0
        };
    } catch (err) {
        console.error(`[ASSEMBLER] Meet Shard Error (${federation}:${meetId}):`, err);
        return { success: false, error: err.message };
    } finally {
        if (!externalClient) await client.end();
    }
}

module.exports = { generateAthlete, generateMeet, getMeetShardId };
