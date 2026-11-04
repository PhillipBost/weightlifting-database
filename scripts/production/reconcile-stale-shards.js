#!/usr/bin/env node
/**
 * PRODUCTION: Historical Athlete Shard Reconciler
 * 
 * Inspects athlete records across USAW, IWF, and OWLCMS against static JSON shards
 * on disk (/var/www/athlete-data) to identify missing, timestamp-stale, or count-mismatched
 * shards. Enqueues stale records into public.athlete_shard_queue or compiles them directly.
 * 
 * Usage:
 *   node scripts/production/reconcile-stale-shards.js [options]
 * 
 * Options:
 *   --dry-run              Report stale/missing shards without modifying DB queue or files
 *   --compile              Compile shards directly in-process instead of enqueuing to PostgreSQL
 *   --deep                 Decompress gzip shards and verify exact meet result counts vs DB
 *   --federation=<fed>     Filter by federation: 'usaw', 'iwf', 'owlcms', or 'all' (default: all)
 *   --athlete-id=<id>      Target a specific single athlete ID or membership number
 *   --limit=<number>       Maximum number of stale athletes to process per federation
 *   --batch-size=<number>  Query chunk size (default: 1000)
 *   --output-dir=<path>    Custom static shard root directory (default: process.env.OUTPUT_DIR || /var/www/athlete-data)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Pool } = require('pg');
const { generateAthlete } = require('./assembler');

// Configuration and CLI argument parsing
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isCompile = args.includes('--compile');
const isDeep = args.includes('--deep');

function getArgValue(prefix) {
    const matched = args.find(a => a.startsWith(prefix));
    return matched ? matched.split('=')[1] : null;
}

const targetFederation = (getArgValue('--federation') || 'all').toLowerCase();
const targetAthleteId = getArgValue('--athlete-id');
const limitArg = getArgValue('--limit');
const maxLimit = limitArg ? parseInt(limitArg, 10) : Infinity;
const batchSizeArg = getArgValue('--batch-size');
const batchSize = batchSizeArg ? parseInt(batchSizeArg, 10) : 1000;
const outputDir = getArgValue('--output-dir') || process.env.OUTPUT_DIR || '/var/www/athlete-data';

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

/**
 * Resolve target shard file path on disk
 */
function getShardFilePath(federation, publicId) {
    if (!publicId) return null;
    const idStr = String(publicId);
    const shard = idStr.slice(-2).padStart(2, '0');
    return path.join(outputDir, federation, shard, `${idStr}.json.gz`);
}

/**
 * Inspect a single shard file for existence, timestamp freshness, and optionally result count
 */
function inspectShard(filePath, dbResultCount, latestDbTime) {
    if (!fs.existsSync(filePath)) {
        return { isStale: true, reason: 'FILE_MISSING' };
    }

    const stat = fs.statSync(filePath);
    const shardMtimeMs = stat.mtimeMs;
    const latestDbMs = latestDbTime ? new Date(latestDbTime).getTime() : 0;

    // Allow 2-second grace period for filesystem timestamp clock skew
    if (latestDbMs > (shardMtimeMs + 2000)) {
        return { 
            isStale: true, 
            reason: `TIMESTAMP_STALE (DB: ${new Date(latestDbMs).toISOString()} > Disk: ${new Date(shardMtimeMs).toISOString()})` 
        };
    }

    if (isDeep) {
        try {
            const compressed = fs.readFileSync(filePath);
            const decompressed = zlib.gunzipSync(compressed);
            const shardData = JSON.parse(decompressed.toString('utf8'));
            
            // Replicate count aggregation from assembler:
            // Results can be under data.results or nested under federations
            let shardCount = 0;
            if (Array.isArray(shardData.results)) {
                shardCount = shardData.results.length;
            } else if (Array.isArray(shardData.meet_results)) {
                shardCount = shardData.meet_results.length;
            } else if (shardData.usaw_results || shardData.iwf_results || shardData.owlcms_results) {
                shardCount = (shardData.usaw_results?.length || 0) + 
                             (shardData.iwf_results?.length || 0) + 
                             (shardData.owlcms_results?.length || 0);
            }

            if (shardCount !== dbResultCount) {
                return {
                    isStale: true,
                    reason: `COUNT_MISMATCH (DB has ${dbResultCount} results, Shard has ${shardCount})`
                };
            }
        } catch (readErr) {
            return { isStale: true, reason: `CORRUPT_SHARD (${readErr.message})` };
        }
    }

    return { isStale: false };
}

/**
 * Reconcile USAW Athletes
 */
async function reconcileUsaw(client, summary) {
    console.log('\n--- Scanning USAW Athletes ---');
    let offset = 0;
    let staleCount = 0;

    while (staleCount < maxLimit) {
        let query = `
            SELECT 
                l.lifter_id,
                l.membership_number,
                COUNT(r.result_id)::int AS db_result_count,
                MAX(r.updated_at) AS max_result_updated_at,
                l.updated_at AS lifter_updated_at
            FROM public.usaw_lifters l
            LEFT JOIN public.usaw_meet_results r ON l.lifter_id = r.lifter_id
        `;
        const params = [];

        if (targetAthleteId) {
            params.push(targetAthleteId);
            query += ` WHERE l.membership_number::text = $1 OR l.lifter_id::text = $1 `;
        }

        query += ` GROUP BY l.lifter_id, l.membership_number ORDER BY l.lifter_id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(batchSize, offset);

        const { rows } = await client.query(query, params);
        if (rows.length === 0) break;

        for (const row of rows) {
            summary.scanned++;
            const publicId = row.membership_number || row.lifter_id;
            const filePath = getShardFilePath('usaw', publicId);
            const latestDbTime = Math.max(
                row.max_result_updated_at ? new Date(row.max_result_updated_at).getTime() : 0,
                row.lifter_updated_at ? new Date(row.lifter_updated_at).getTime() : 0
            );

            const check = inspectShard(filePath, row.db_result_count, latestDbTime);
            if (check.isStale) {
                staleCount++;
                summary.stale++;
                console.log(`[USAW] Stale Athlete ID: ${row.lifter_id} (Member #: ${publicId}) - Reason: ${check.reason}`);

                if (!isDryRun) {
                    if (isCompile) {
                        try {
                            await generateAthlete({ usaw_id: row.lifter_id }, client);
                            summary.compiled++;
                        } catch (err) {
                            console.error(`[USAW] Compile error for lifter_id ${row.lifter_id}:`, err.message);
                        }
                    } else {
                        await client.query(
                            `INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                             VALUES ('usaw', $1, clock_timestamp())
                             ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp()`,
                            [row.lifter_id]
                        );
                        summary.enqueued++;
                    }
                }
            } else {
                summary.fresh++;
            }

            if (staleCount >= maxLimit) break;
        }

        offset += rows.length;
        if (targetAthleteId) break;
    }
}

/**
 * Reconcile IWF Athletes
 */
async function reconcileIwf(client, summary) {
    console.log('\n--- Scanning IWF Athletes ---');
    let offset = 0;
    let staleCount = 0;

    while (staleCount < maxLimit) {
        let query = `
            SELECT 
                l.db_lifter_id,
                l.iwf_lifter_id,
                COUNT(r.result_id)::int AS db_result_count,
                MAX(r.updated_at) AS max_result_updated_at,
                l.updated_at AS lifter_updated_at
            FROM public.iwf_lifters l
            LEFT JOIN public.iwf_meet_results r ON l.db_lifter_id = r.db_lifter_id
        `;
        const params = [];

        if (targetAthleteId) {
            params.push(targetAthleteId);
            query += ` WHERE l.iwf_lifter_id::text = $1 OR l.db_lifter_id::text = $1 `;
        }

        query += ` GROUP BY l.db_lifter_id, l.iwf_lifter_id ORDER BY l.db_lifter_id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(batchSize, offset);

        const { rows } = await client.query(query, params);
        if (rows.length === 0) break;

        for (const row of rows) {
            summary.scanned++;
            const publicId = row.iwf_lifter_id || row.db_lifter_id;
            const filePath = getShardFilePath('iwf', publicId);
            const latestDbTime = Math.max(
                row.max_result_updated_at ? new Date(row.max_result_updated_at).getTime() : 0,
                row.lifter_updated_at ? new Date(row.lifter_updated_at).getTime() : 0
            );

            const check = inspectShard(filePath, row.db_result_count, latestDbTime);
            if (check.isStale) {
                staleCount++;
                summary.stale++;
                console.log(`[IWF] Stale Athlete DB ID: ${row.db_lifter_id} (IWF ID: ${publicId}) - Reason: ${check.reason}`);

                if (!isDryRun) {
                    if (isCompile) {
                        try {
                            await generateAthlete({ iwf_id: row.db_lifter_id }, client);
                            summary.compiled++;
                        } catch (err) {
                            console.error(`[IWF] Compile error for db_lifter_id ${row.db_lifter_id}:`, err.message);
                        }
                    } else {
                        await client.query(
                            `INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                             VALUES ('iwf', $1, clock_timestamp())
                             ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp()`,
                            [row.db_lifter_id]
                        );
                        summary.enqueued++;
                    }
                }
            } else {
                summary.fresh++;
            }

            if (staleCount >= maxLimit) break;
        }

        offset += rows.length;
        if (targetAthleteId) break;
    }
}

/**
 * Reconcile OWLCMS Athletes
 */
async function reconcileOwlcms(client, summary) {
    console.log('\n--- Scanning OWLCMS Athletes ---');
    let offset = 0;
    let staleCount = 0;

    while (staleCount < maxLimit) {
        let query = `
            SELECT 
                l.lifter_id,
                COUNT(r.result_id)::int AS db_result_count,
                MAX(r.updated_at) AS max_result_updated_at,
                l.updated_at AS lifter_updated_at
            FROM public.owlcms_lifters l
            LEFT JOIN public.owlcms_meet_results r ON l.lifter_id = r.lifter_id
        `;
        const params = [];

        if (targetAthleteId) {
            params.push(targetAthleteId);
            query += ` WHERE l.lifter_id::text = $1 `;
        }

        query += ` GROUP BY l.lifter_id ORDER BY l.lifter_id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(batchSize, offset);

        const { rows } = await client.query(query, params);
        if (rows.length === 0) break;

        for (const row of rows) {
            summary.scanned++;
            const publicId = row.lifter_id;
            const filePath = getShardFilePath('owlcms', publicId);
            const latestDbTime = Math.max(
                row.max_result_updated_at ? new Date(row.max_result_updated_at).getTime() : 0,
                row.lifter_updated_at ? new Date(row.lifter_updated_at).getTime() : 0
            );

            const check = inspectShard(filePath, row.db_result_count, latestDbTime);
            if (check.isStale) {
                staleCount++;
                summary.stale++;
                console.log(`[OWLCMS] Stale Athlete ID: ${row.lifter_id} - Reason: ${check.reason}`);

                if (!isDryRun) {
                    if (isCompile) {
                        try {
                            await generateAthlete({ owlcms_id: row.lifter_id }, client);
                            summary.compiled++;
                        } catch (err) {
                            console.error(`[OWLCMS] Compile error for lifter_id ${row.lifter_id}:`, err.message);
                        }
                    } else {
                        await client.query(
                            `INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                             VALUES ('owlcms', $1, clock_timestamp())
                             ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp()`,
                            [row.lifter_id]
                        );
                        summary.enqueued++;
                    }
                }
            } else {
                summary.fresh++;
            }

            if (staleCount >= maxLimit) break;
        }

        offset += rows.length;
        if (targetAthleteId) break;
    }
}

/**
 * Main Runner
 */
async function main() {
    console.log('================================================================');
    console.log('🎯 ATHLETE STATIC SHARD RECONCILER');
    console.log(`   Output Directory:   ${outputDir}`);
    console.log(`   Mode:               ${isDryRun ? 'DRY-RUN (Scan Only)' : (isCompile ? 'DIRECT COMPILE' : 'ENQUEUE TO OUTBOX')}`);
    console.log(`   Deep Verification:  ${isDeep ? 'YES (Gzip results parsed)' : 'NO (Timestamp and existence only)'}`);
    console.log(`   Federation Filter:  ${targetFederation.toUpperCase()}`);
    if (targetAthleteId) console.log(`   Target Athlete ID:  ${targetAthleteId}`);
    if (limitArg) console.log(`   Limit Per Fed:      ${maxLimit}`);
    console.log('================================================================');

    const hasDiskAccess = fs.existsSync(outputDir);
    if (!hasDiskAccess) {
        console.warn(`\n⚠️  WARNING: Shard directory "${outputDir}" does not exist in this environment.`);
        console.warn('   Every athlete will be evaluated as FILE_MISSING if scanning proceeds.');
        console.warn('   For full reconciliation, execute this script directly on the Hetzner host where shards reside.\n');
    }

    const pool = new Pool(getPgConfig());
    const client = await pool.connect();

    const summary = {
        scanned: 0,
        fresh: 0,
        stale: 0,
        enqueued: 0,
        compiled: 0
    };

    try {
        if (targetFederation === 'all' || targetFederation === 'usaw') {
            await reconcileUsaw(client, summary);
        }

        if (targetFederation === 'all' || targetFederation === 'iwf') {
            await reconcileIwf(client, summary);
        }

        if (targetFederation === 'all' || targetFederation === 'owlcms') {
            await reconcileOwlcms(client, summary);
        }

        // If records were enqueued in non-dry-run mode, trigger notification so daemon wakes up
        if (summary.enqueued > 0) {
            console.log(`\n📢 Notifying daemon on "athlete_shard_event" for ${summary.enqueued} enqueued athletes...`);
            await client.query("SELECT pg_notify('athlete_shard_event', '')");
        }

        console.log('\n================================================================');
        console.log('🏁 RECONCILIATION SUMMARY');
        console.log(`   Total Scanned:    ${summary.scanned}`);
        console.log(`   Fresh Shards:     ${summary.fresh}`);
        console.log(`   Stale / Missing:  ${summary.stale}`);
        if (!isDryRun) {
            if (isCompile) {
                console.log(`   Directly Built:   ${summary.compiled}`);
            } else {
                console.log(`   Enqueued to DB:   ${summary.enqueued}`);
            }
        }
        console.log('================================================================\n');

    } catch (err) {
        console.error('💥 Fatal reconciliation error:', err);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = { main, inspectShard };

