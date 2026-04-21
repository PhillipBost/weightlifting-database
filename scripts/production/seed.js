const { Client } = require('pg');
const { generateAthlete } = require('./assembler');
require('dotenv').config();

const clientConfigs = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
};

const BATCH_SIZE = 1000;

async function run() {
    const client = new Client(clientConfigs);
    try {
        await client.connect();
        console.log(`[DATA FACTORY] Starting Universal Bulk Re-Seed (Phase 4.3)...`);

        // --- PASS 1: DOMESTIC & LINKED POPULATION ---
        // This covers every athlete in usaw_lifters (including those with IWF links)
        console.log(`\n[PASS 1] Generating shards for USAW Lifters...`);
        let offset = 0;
        let totalUsaw = 0;

        while (true) {
            const res = await client.query(
                `SELECT lifter_id FROM usaw_lifters ORDER BY lifter_id LIMIT $1 OFFSET $2`,
                [BATCH_SIZE, offset]
            );

            if (res.rows.length === 0) break;

            for (let row of res.rows) {
                // v4.3 Assembler creates shards for the USAW ID and any linked IWF IDs automatically
                await generateAthlete({ usaw_id: row.lifter_id }, client);
            }

            totalUsaw += res.rows.length;
            offset += BATCH_SIZE;
            console.log(`[PASS 1] Progress: ${totalUsaw} USAW athletes processed.`);
        }

        // --- PASS 2: INTERNATIONAL-ONLY POPULATION ---
        // This covers international athletes with no domestic record.
        console.log(`\n[PASS 2] Generating shards for IWF-Only Lifters (unlinked)...`);
        offset = 0;
        let totalIwf = 0;

        while (true) {
            const res = await client.query(
                `SELECT il.db_lifter_id 
                 FROM iwf_lifters il 
                 LEFT JOIN athlete_aliases aa ON il.db_lifter_id = aa.iwf_db_lifter_id 
                 WHERE aa.usaw_lifter_id IS NULL
                 ORDER BY il.db_lifter_id 
                 LIMIT $1 OFFSET $2`,
                [BATCH_SIZE, offset]
            );

            if (res.rows.length === 0) break;

            for (let row of res.rows) {
                await generateAthlete({ iwf_id: row.db_lifter_id }, client);
            }

            totalIwf += res.rows.length;
            offset += BATCH_SIZE;
            console.log(`[PASS 2] Progress: ${totalIwf} IWF-only profiles processed.`);
        }

        console.log(`\n[DATA FACTORY] UNIVERSAL BULK RE-SEED COMPLETE.`);
        console.log(`- Batch 1 (Domestic/Linked): ${totalUsaw}`);
        console.log(`- Batch 2 (International-Only): ${totalIwf}`);

    } catch (err) {
        console.error('[DATA FACTORY] CRITICAL ERROR:', err);
    } finally {
        await client.end();
    }
}

run();
