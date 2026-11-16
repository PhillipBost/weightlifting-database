#!/usr/bin/env node
/**
 * PRODUCTION: Static Meet Shard Backfill & Reconciliation Pipeline
 *
 * Generates pre-compiled .json.gz meet shards across USAW, IWF, and OWLCMS
 * at {OUTPUT_DIR}/meets/{federation}/{shardId}/{meetId}.json.gz.
 *
 * Usage:
 *   node scripts/production/backfill-meet-shards.js [options]
 *
 * Options:
 *   --federation=<fed>     'usaw', 'iwf', 'owlcms', or 'all' (default: 'all')
 *   --meet-id=<id>         Target a specific single meet ID
 *   --batch-size=<n>       Query page size (default: 250)
 *   --limit=<n>            Maximum meets to process per federation
 *   --dry-run              Report meets to process without writing files or DB queue
 *   --enqueue              Enqueue into public.meet_shard_queue instead of direct compile
 *   --only-missing         Skip meets whose .json.gz shard already exists on disk
 *   --output-dir=<path>    Custom shard root (default: process.env.OUTPUT_DIR || /var/www/athlete-data)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { generateMeet, getMeetShardId } = require('./assembler');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isEnqueue = args.includes('--enqueue');
const isOnlyMissing = args.includes('--only-missing');

function getArgValue(prefix) {
    const matched = args.find(a => a.startsWith(prefix));
    return matched ? matched.split('=')[1] : null;
}

const targetFederation = (getArgValue('--federation') || 'all').toLowerCase();
const targetMeetId = getArgValue('--meet-id');
const limitArg = getArgValue('--limit');
const maxLimit = limitArg ? parseInt(limitArg, 10) : Infinity;
const batchSizeArg = getArgValue('--batch-size');
const batchSize = batchSizeArg ? parseInt(batchSizeArg, 10) : 250;
const outputDir = getArgValue('--output-dir') || process.env.OUTPUT_DIR || '/var/www/athlete-data';

const FEDERATION_TABLES = {
    usaw: { table: 'public.usaw_meets', idCol: 'meet_id', orderCol: 'meet_id' },
    iwf: { table: 'public.iwf_meets', idCol: 'iwf_meet_id', orderCol: 'db_meet_id' },
    owlcms: { table: 'public.owlcms_meets', idCol: 'meet_id', orderCol: 'meet_id' }
};

function getPgConfig() {
    if (process.env.DATABASE_URL) {
        return {
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL.includes('sslmode=require') || process.env.DB_SSL === 'true'
                ? { rejectUnauthorized: false }
                : false
        };
    }
    return {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'postgres',
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT || '5432', 10),
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };
}

function getMeetShardPath(federation, meetId) {
    const idStr = String(meetId).trim();
    const shardId = getMeetShardId(idStr);
    return path.join(outputDir, 'meets', federation, shardId, `${idStr}.json.gz`);
}

async function backfillFederation(client, federation, summary) {
    const cfg = FEDERATION_TABLES[federation];
    if (!cfg) return;

    console.log(`\n--- Backfilling ${federation.toUpperCase()} Meets ---`);
    let offset = 0;
    let processedForFed = 0;

    while (processedForFed < maxLimit) {
        let query = `SELECT ${cfg.idCol}::text AS meet_id FROM ${cfg.table} WHERE ${cfg.idCol} IS NOT NULL`;
        const params = [];

        if (targetMeetId) {
            params.push(String(targetMeetId));
            query += ` AND ${cfg.idCol}::text = $1`;
        }

        query += ` ORDER BY ${cfg.orderCol} ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(batchSize, offset);

        const { rows } = await client.query(query, params);
        if (rows.length === 0) break;

        for (const row of rows) {
            if (processedForFed >= maxLimit) break;
            const meetId = row.meet_id;
            summary.scanned++;

            const shardPath = getMeetShardPath(federation, meetId);
            if (isOnlyMissing && fs.existsSync(shardPath)) {
                summary.skipped++;
                continue;
            }

            processedForFed++;

            if (isDryRun) {
                summary.planned++;
                if (targetMeetId || summary.planned <= 10) {
                    console.log(`[DRY-RUN] Would ${isEnqueue ? 'enqueue' : 'compile'} ${federation.toUpperCase()} Meet ${meetId} -> ${shardPath}`);
                }
                continue;
            }

            if (isEnqueue) {
                await client.query(
                    `INSERT INTO public.meet_shard_queue (federation, meet_id, enqueued_at)
                     VALUES ($1, $2, clock_timestamp())
                     ON CONFLICT (federation, meet_id) DO UPDATE SET enqueued_at = clock_timestamp()`,
                    [federation, meetId]
                );
                summary.enqueued++;
            } else {
                const res = await generateMeet({ federation, meet_id: meetId }, client);
                if (res && res.success) {
                    summary.compiled++;
                } else {
                    summary.errors++;
                    console.warn(`[${federation.toUpperCase()}] Failed Meet ${meetId}: ${res?.error || 'Unknown error'}`);
                }
            }
        }

        if (!isDryRun && !isEnqueue && processedForFed > 0) {
            console.log(`[${federation.toUpperCase()}] Progress: ${processedForFed} meets processed (compiled: ${summary.compiled}, errors: ${summary.errors})`);
        }

        offset += rows.length;
        if (targetMeetId) break;
    }
}

async function main() {
    console.log('================================================================');
    console.log('🏟️  STATIC MEET SHARD BACKFILL PIPELINE');
    console.log(`   Output Directory:   ${outputDir}`);
    console.log(`   Mode:               ${isDryRun ? 'DRY-RUN' : (isEnqueue ? 'ENQUEUE TO OUTBOX' : 'DIRECT COMPILE')}`);
    console.log(`   Only Missing:       ${isOnlyMissing ? 'YES' : 'NO'}`);
    console.log(`   Federation Filter:  ${targetFederation.toUpperCase()}`);
    if (targetMeetId) console.log(`   Target Meet ID:     ${targetMeetId}`);
    if (limitArg) console.log(`   Limit Per Fed:      ${maxLimit}`);
    console.log('================================================================');

    const federations = targetFederation === 'all'
        ? ['usaw', 'iwf', 'owlcms']
        : [targetFederation];

    for (const fed of federations) {
        if (!FEDERATION_TABLES[fed]) {
            console.error(`Invalid federation: "${fed}". Expected usaw, iwf, owlcms, or all.`);
            process.exit(1);
        }
    }

    const pool = new Pool(getPgConfig());
    const client = await pool.connect();

    const summary = {
        scanned: 0,
        skipped: 0,
        planned: 0,
        compiled: 0,
        enqueued: 0,
        errors: 0
    };

    try {
        for (const fed of federations) {
            await backfillFederation(client, fed, summary);
        }

        if (!isDryRun && isEnqueue && summary.enqueued > 0) {
            console.log(`\n📢 Notifying daemon on "meet_shard_event" for ${summary.enqueued} enqueued meets...`);
            await client.query("SELECT pg_notify('meet_shard_event', '')");
        }

        console.log('\n================================================================');
        console.log('🏁 MEET SHARD BACKFILL SUMMARY');
        console.log(`   Total Scanned:    ${summary.scanned}`);
        if (isOnlyMissing) console.log(`   Skipped Fresh:    ${summary.skipped}`);
        if (isDryRun) console.log(`   Planned:          ${summary.planned}`);
        else if (isEnqueue) console.log(`   Enqueued to DB:   ${summary.enqueued}`);
        else {
            console.log(`   Compiled Shards:  ${summary.compiled}`);
            console.log(`   Errors:           ${summary.errors}`);
        }
        console.log('================================================================\n');

        if (summary.errors > 0) process.exitCode = 1;
    } catch (err) {
        console.error('💥 Fatal backfill error:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = { main, getMeetShardPath };
