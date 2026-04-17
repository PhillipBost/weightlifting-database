const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * SEED.JS - DATA FACTORY ASSEMBLER
 * 
 * Objectives:
 * 1. UNIFY identities from USAW and IWF.
 * 2. AGGREGATE full competitive history into JSON.
 * 3. SHARD files by last-2-digits of id (Option A).
 * 4. BATCH results (1,000/chunk) to stay under 4GB RAM.
 * 5. PERMISSIONS set to 644 for Nginx readability.
 */

// Deployment Config
const client = new Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST, // Use Internal Docker IP for best performance
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const OUTPUT_DIR = process.env.OUTPUT_DIR || '/var/www/athlete-data';
const BATCH_SIZE = 1000;

async function run() {
    try {
        await client.connect();
        console.log(`[DATA FACTORY] Connected. Outputting to: ${OUTPUT_DIR}`);

        let offset = 0;
        let totalProcessed = 0;

        while (true) {
            console.log(`[DATA FACTORY] Processing Batch: ${offset} - ${offset + BATCH_SIZE}...`);

            // THE MASTER QUERY: Performs deep joins and pre-packs results into JSONB arrays
            const query = `
                WITH usaw_results_agg AS (
                    SELECT lifter_id, jsonb_agg(r ORDER BY date DESC) as results
                    FROM usaw_meet_results r GROUP BY lifter_id
                ),
                iwf_results_agg AS (
                    SELECT db_lifter_id, jsonb_agg(r ORDER BY date DESC) as results
                    FROM iwf_meet_results r GROUP BY db_lifter_id
                )
                SELECT 
                    COALESCE(aa.usaw_lifter_id, ul.lifter_id, il.db_lifter_id) as master_id,
                    COALESCE(ul.athlete_name, il.athlete_name) as name,
                    COALESCE(ura.results, '[]'::jsonb) as usaw_results,
                    COALESCE(ira.results, '[]'::jsonb) as iwf_results
                FROM usaw_lifters ul
                FULL OUTER JOIN athlete_aliases aa ON ul.lifter_id = aa.usaw_lifter_id
                FULL OUTER JOIN iwf_lifters il ON aa.iwf_db_lifter_id = il.db_lifter_id
                LEFT JOIN usaw_results_agg ura ON ul.lifter_id = ura.lifter_id
                LEFT JOIN iwf_results_agg ira ON il.db_lifter_id = ira.db_lifter_id
                WHERE ura.results IS NOT NULL OR ira.results IS NOT NULL
                ORDER BY master_id
                LIMIT $1 OFFSET $2;
            `;

            const res = await client.query(query, [BATCH_SIZE, offset]);
            
            if (res.rows.length === 0) {
                console.log("[DATA FACTORY] All records processed.");
                break;
            }

            for (let row of res.rows) {
                const id = row.master_id.toString();
                // SHARDING: Option A (Last 2 digits)
                const shard = id.slice(-2).padStart(2, '0');
                const dir = path.join(OUTPUT_DIR, shard);
                const fileName = `${id}.json`;
                const filePath = path.join(dir, fileName);

                // Ensure subdirectory exists
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                // ATOMIC WRITE: Write to .tmp, then move to final destination
                const tempPath = `${filePath}.tmp`;
                fs.writeFileSync(tempPath, JSON.stringify(row));
                fs.renameSync(tempPath, filePath);
                
                // PERMISSIONS: Set to 644 (root:rw, group:r, other:r) so Nginx can read
                fs.chmodSync(filePath, 0o644);
            }

            totalProcessed += res.rows.length;
            offset += BATCH_SIZE;
            console.log(`[DATA FACTORY] Batch complete. Total Saved: ${totalProcessed}`);
        }

        console.log(`[DATA FACTORY] SUCCESS. Generated ${totalProcessed} files.`);

    } catch (err) {
        console.error('[DATA FACTORY] CRITICAL ERROR:', err);
    } finally {
        await client.end();
        console.log("[DATA FACTORY] Database connection closed.");
    }
}

run();
