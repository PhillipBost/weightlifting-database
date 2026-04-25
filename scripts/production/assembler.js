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

// ── Population Stats Loader ──────────────────────────────────────────────────
let _populationStats = null;
function getPopulationStats() {
    if (_populationStats) return _populationStats;
    const p = path.join(OUTPUT_DIR, 'population_stats.json');
    if (fs.existsSync(p)) {
        try {
            _populationStats = JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) {
            _populationStats = {};
        }
    }
    return _populationStats || {};
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
    rollingCutoff.setMonth(now.getMonth() - 36);

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

function getAthletePercentiles(results, gender, source) {
    const stats = getPopulationStats();
    const recentRes = (results || []).find(r => r.date);
    if (!recentRes || !stats) return null;
    
    const bucket = getDemographicBucketKeys(source, gender, recentRes.age_category, recentRes.meet_name).reverse().find(k => stats[k]);
    if (!bucket) return null;

    const bStats = stats[bucket];
    const careerMetrics = calculateLifterMetrics(results, null);
    const recentMetrics = calculateLifterMetrics(results, 3);

    const out = {
        bucket,
        sampleSize: bStats.successRate?.sampleSize,
        career: {},
        recent: {}
    };

    const keys = ['successRate', 'snatchSuccessRate', 'cleanJerkSuccessRate', 'consistencyScore', 'clutchPerformance', 'bounceBackRate', 'snatchBounceBackRate', 'cleanJerkBounceBackRate', 'competitionFrequency', 'qScorePerformance'];

    keys.forEach(k => {
        out.career[k] = computePercentile(careerMetrics[k], bStats[k]?.distribution);
        out.recent[k] = computePercentile(recentMetrics[k], bStats[k]?.distribution);
    });

    if (recentMetrics.openingStrategy !== null) out.recent.openingStrategyRaw = recentMetrics.openingStrategy;
    if (recentMetrics.jumpPercentage !== null) out.recent.jumpPercentageRaw = recentMetrics.jumpPercentage;

    return out;
}

/**
 * THE ASSEMBLER - Phase 4.5 (UNIFIED SINGLE-QUERY)
 * Finalized logic to solve the 'relation not found' issue.
 */
async function generateAthlete(params, externalClient = null) {
    const { usaw_id, iwf_id } = typeof params === 'object' ? params : { usaw_id: params };

    const client = externalClient || new Client(clientConfig);
    if (!externalClient) await client.connect();

    try {
        const query = `
            WITH RECURSIVE athlete_identity AS (
                -- Anchor row
                SELECT usaw_lifter_id, iwf_db_lifter_id, iwf_db_lifter_id_2
                FROM athlete_aliases
                WHERE (usaw_lifter_id = $1 AND $1 IS NOT NULL)
                   OR (iwf_db_lifter_id = $2 AND $2 IS NOT NULL)
                   OR (iwf_db_lifter_id_2 = $2 AND $2 IS NOT NULL)
                
                UNION
                
                -- Follow the alias chains
                SELECT aa.usaw_lifter_id, aa.iwf_db_lifter_id, aa.iwf_db_lifter_id_2
                FROM athlete_aliases aa
                JOIN athlete_identity ai ON (
                    aa.iwf_db_lifter_id = ai.iwf_db_lifter_id OR
                    aa.iwf_db_lifter_id = ai.iwf_db_lifter_id_2 OR
                    aa.iwf_db_lifter_id_2 = ai.iwf_db_lifter_id OR
                    aa.iwf_db_lifter_id_2 = ai.iwf_db_lifter_id_2 OR
                    (aa.usaw_lifter_id = ai.usaw_lifter_id AND aa.usaw_lifter_id IS NOT NULL)
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
            usaw_results_agg AS (
                SELECT 
                    jsonb_agg(
                        jsonb_build_object(
                            'id', r.result_id,
                            'meet_id', r.meet_id,
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
                            'wso', r.wso,
                            'club_name', r.club_name,
                            'gender', r.gender
                        ) ORDER BY r.date DESC
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
                            'meet_id', r.db_meet_id,
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
                            'gender', r.gender
                        ) ORDER BY r.date DESC
                    ) as results
                FROM iwf_meet_results r
                LEFT JOIN iwf_meets m ON r.db_meet_id = m.db_meet_id
                WHERE r.db_lifter_id IN (SELECT id FROM all_iwf_db_ids)
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
            id_collector AS (
                -- Final collection of every ID type for the Triple-Writer shard generation
                SELECT jsonb_build_object(
                    'usaw_ids', (SELECT jsonb_agg(DISTINCT membership_number) FROM usaw_lifters WHERE lifter_id IN (SELECT id FROM all_usaw_internal_ids) AND membership_number IS NOT NULL),
                    'iwf_ids', (SELECT jsonb_agg(DISTINCT iwf_lifter_id) FROM iwf_lifters WHERE db_lifter_id IN (SELECT id FROM all_iwf_db_ids) AND iwf_lifter_id IS NOT NULL),
                    'internal_ids', (SELECT jsonb_agg(DISTINCT id) FROM all_usaw_internal_ids)
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
                il.country_code,
                il.country_name,
                COALESCE(ura.results, '[]'::jsonb) as usaw_results,
                COALESCE(ira.results, '[]'::jsonb) as iwf_results,
                COALESCE(ipa.profiles, '[]'::jsonb) as iwf_profiles,
                idc.ids as shard_ids
            FROM (SELECT 1) dummy
            LEFT JOIN usaw_lifters ul ON ul.lifter_id = (SELECT id FROM all_usaw_internal_ids LIMIT 1)
            LEFT JOIN iwf_lifters il ON il.db_lifter_id = (SELECT id FROM all_iwf_db_ids LIMIT 1)
            LEFT JOIN usaw_results_agg ura ON true
            LEFT JOIN iwf_results_agg ira ON true
            LEFT JOIN iwf_profiles_agg ipa ON true
            LEFT JOIN id_collector idc ON true;
        `;

        const res = await client.query(query, [usaw_id || null, iwf_id || null]);
        if (res.rows.length === 0) return { success: false, message: 'Lifter not found' };

        const row = res.rows[0];
        const latestUsaw = (row.usaw_results || []).find(r => r.date);
        const latestIwf = (row.iwf_results || []).find(r => r.date);

        const externalLinks = [
            row.internal_id, row.internal_id_2, row.internal_id_3, row.internal_id_4,
            row.internal_id_5, row.internal_id_6, row.internal_id_7, row.internal_id_8
        ].filter(id => id !== null && id !== '');

        const countryCode = row.country_code || 'USA';
        const countryName = row.country_name || 'United States';
        const gender = latestUsaw?.gender || latestIwf?.gender || null;

        const data = {
            athlete_name: row.usaw_athlete_name || row.iwf_athlete_name,
            iwf_athlete_name: row.iwf_athlete_name,
            membership_number: row.membership_number,
            internal_id: row.internal_id,
            country_code: countryCode,
            country_name: countryName,
            gender: gender,
            wso: (row.usaw_results || []).find(r => r.wso && r.wso.trim() !== '')?.wso || null,
            club_name: (row.usaw_results || []).find(r => r.club_name && r.club_name.trim() !== '')?.club_name || null,
            iwf_profiles: row.iwf_profiles,
            external_links: externalLinks,
            usaw_results: row.usaw_results,
            iwf_results: row.iwf_results,
            population_percentiles: {
                usaw: getAthletePercentiles(row.usaw_results, gender, 'usaw'),
                iwf: getAthletePercentiles(row.iwf_results, gender, 'iwf')
            }
        };

        const jsonStr = JSON.stringify(data);
        const compressed = zlib.gzipSync(jsonStr);

        const writeFile = (type, id) => {
            if (!id) return;
            const idStr = id.toString();
            const shard = idStr.slice(-2).padStart(2, '0');
            const dir = path.join(OUTPUT_DIR, type, shard);
            const file = path.join(dir, `${idStr}.json.gz`);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(file, compressed);
            fs.chmodSync(file, 0o644);
        };

        // Triple-Writer Shard generation using IDs collected in the same query
        const shardIds = row.shard_ids || {};
        if (shardIds.usaw_ids) shardIds.usaw_ids.forEach(id => writeFile('usaw', id));
        if (shardIds.iwf_ids) shardIds.iwf_ids.forEach(id => writeFile('iwf', id));
        if (shardIds.internal_ids) shardIds.internal_ids.forEach(id => writeFile('internal', id));

        return { success: true, shards_written: (shardIds.usaw_ids?.length || 0) + (shardIds.iwf_ids?.length || 0) + (shardIds.internal_ids?.length || 0) };

    } catch (err) {
        console.error(`[ASSEMBLER] Universal Fatal Error for USAW:${usaw_id}, IWF:${iwf_id}:`, err);
        return { success: false, error: err.message };
    } finally {
        if (!externalClient) await client.end();
    }
}

module.exports = { generateAthlete };
