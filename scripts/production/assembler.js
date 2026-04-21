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

        const data = {
            athlete_name: row.usaw_athlete_name || row.iwf_athlete_name,
            iwf_athlete_name: row.iwf_athlete_name,
            membership_number: row.membership_number,
            internal_id: row.internal_id,
            country_code: countryCode,
            country_name: countryName,
            gender: latestUsaw?.gender || latestIwf?.gender || null,
            wso: (row.usaw_results || []).find(r => r.wso && r.wso.trim() !== '')?.wso || null,
            club_name: (row.usaw_results || []).find(r => r.club_name && r.club_name.trim() !== '')?.club_name || null,
            iwf_profiles: row.iwf_profiles,
            external_links: externalLinks,
            usaw_results: row.usaw_results,
            iwf_results: row.iwf_results
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
