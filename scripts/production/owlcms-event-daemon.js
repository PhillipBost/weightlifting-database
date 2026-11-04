#!/usr/bin/env node
/**
 * PRODUCTION: OWLCMS Event-Driven Pipeline & Universal Athlete Shard Daemon
 * 
 * Maintains a persistent, zero-overhead connection to PostgreSQL listening for
 * database change notifications on 'owlcms_pipeline_event' and 'athlete_shard_event'.
 * 
 * 1. owlcms_pipeline_event: Triggers venue geocoding, cross-federation athlete linking,
 *    and static shard generation for newly imported OWLCMS meets.
 * 2. athlete_shard_event: Triggers atomic draining of public.athlete_shard_queue,
 *    recompiling static shards across all federations (USAW, IWF, OWLCMS).
 * 
 * 100% event-driven, zero polling, zero open inbound firewall ports.
 */

require('dotenv').config();
const { Client, Pool } = require('pg');
const { runPipeline } = require('./run-owlcms-pipeline');
const { generateAthlete } = require('./assembler');

const PIPELINE_DEBOUNCE_MS = 1500; // Debounce window for burst OWLCMS meet imports
const SHARD_DEBOUNCE_MS = 2000;    // Debounce window for bulk athlete shard triggers

let pipelineDebounceTimer = null;
let shardDebounceTimer = null;

let isPipelineActive = false;
let pendingPipelineRunQueued = false;

let isDrainingQueue = false;
let pendingShardDrainQueued = false;

let pool = null;
let activeClient = null;
let isShuttingDown = false;

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
 * Drain the athlete shard outbox queue atomically
 */
async function drainAthleteShardQueue() {
    if (!pool) return;

    if (isDrainingQueue) {
        pendingShardDrainQueued = true;
        return;
    }

    isDrainingQueue = true;
    try {
        while (true) {
            const { rows } = await pool.query(
                `SELECT federation, entity_id, enqueued_at 
                 FROM public.athlete_shard_queue 
                 ORDER BY enqueued_at ASC 
                 LIMIT 100`
            );

            if (rows.length === 0) break;

            console.log(`\n⚡ [DAEMON] Draining batch of ${rows.length} athlete shard update(s)...`);

            const client = await pool.connect();
            try {
                for (const row of rows) {
                    const { federation, entity_id, enqueued_at } = row;
                    const params = {};
                    if (federation === 'usaw') {
                        params.usaw_lifter_id = entity_id;
                    } else if (federation === 'iwf') {
                        params.iwf_id = entity_id;
                    } else if (federation === 'owlcms') {
                        params.owlcms_id = entity_id;
                    }

                    try {
                        const result = await generateAthlete(params, client);
                        if (result && result.success) {
                            console.log(`[DAEMON] Successfully updated static shard for ${federation.toUpperCase()} ID: ${entity_id}`);
                        } else {
                            console.warn(`[DAEMON] Static shard build returned failure for ${federation.toUpperCase()} ID ${entity_id}: ${result?.error || 'Unknown error'}`);
                        }
                    } catch (compileErr) {
                        console.error(`[DAEMON] Exception compiling shard for ${federation.toUpperCase()} ID ${entity_id}:`, compileErr.message);
                    }

                    // Delete the processed row from outbox table
                    await client.query(
                        `DELETE FROM public.athlete_shard_queue 
                         WHERE federation = $1 AND entity_id = $2 AND enqueued_at <= $3`,
                        [federation, entity_id, enqueued_at]
                    );
                }
            } finally {
                client.release();
            }
        }
    } catch (err) {
        console.error('[DAEMON] Error during shard queue drain:', err.message);
    } finally {
        isDrainingQueue = false;
        if (pendingShardDrainQueued) {
            pendingShardDrainQueued = false;
            drainAthleteShardQueue();
        }
    }
}

/**
 * Debounce burst notifications for athlete shard updates
 */
function triggerDebouncedShardDrain() {
    if (shardDebounceTimer) {
        clearTimeout(shardDebounceTimer);
    }

    shardDebounceTimer = setTimeout(() => {
        shardDebounceTimer = null;
        drainAthleteShardQueue();
    }, SHARD_DEBOUNCE_MS);
}

/**
 * Debounce burst notifications and trigger pipeline
 */
function triggerDebouncedPipeline(eventPayload) {
    if (pipelineDebounceTimer) {
        clearTimeout(pipelineDebounceTimer);
    }

    pipelineDebounceTimer = setTimeout(async () => {
        pipelineDebounceTimer = null;

        if (isPipelineActive) {
            console.log('[DAEMON] Pipeline currently running. Queuing pass to drain new records upon completion.');
            pendingPipelineRunQueued = true;
            return;
        }

        isPipelineActive = true;
        try {
            console.log('\n⚡ [DAEMON] OWLCMS pipeline change event detected. Triggering post-ingestion pipeline...');
            await runPipeline();
            // Drain any athlete shards enqueued during linking
            drainAthleteShardQueue();
        } catch (err) {
            console.error('[DAEMON] Pipeline execution error:', err.message);
        } finally {
            isPipelineActive = false;
            if (pendingPipelineRunQueued) {
                pendingPipelineRunQueued = false;
                triggerDebouncedPipeline({ queued: true });
            }
        }
    }, PIPELINE_DEBOUNCE_MS);
}

/**
 * Main daemon startup and listener loop
 */
async function startDaemon() {
    const config = getPgConfig();

    // Initialize shared connection pool for queries and shard compilation
    pool = new Pool({
        ...config,
        max: 10,
        idleTimeoutMillis: 30000
    });

    pool.on('error', err => {
        console.error('[DAEMON] Unexpected Pool error:', err.message);
    });

    const client = new Client(config);
    activeClient = client;

    client.on('notification', msg => {
        if (msg.channel === 'owlcms_pipeline_event') {
            let parsed = {};
            try { parsed = JSON.parse(msg.payload); } catch {}
            console.log(`[DAEMON] Received Postgres notification on "owlcms_pipeline_event": ${parsed.event || msg.payload}`);
            triggerDebouncedPipeline(parsed);
        } else if (msg.channel === 'athlete_shard_event') {
            console.log(`[DAEMON] Received Postgres notification on "athlete_shard_event"`);
            triggerDebouncedShardDrain();
        }
    });

    client.on('error', err => {
        console.error('[DAEMON] Postgres listener connection error:', err.message);
        reconnect();
    });

    try {
        console.log(`[DAEMON] Connecting to PostgreSQL at ${config.host || 'DATABASE_URL'}...`);
        await client.connect();
        await client.query('LISTEN owlcms_pipeline_event');
        await client.query('LISTEN athlete_shard_event');
        console.log('📡 [DAEMON] Actively listening on channels: "owlcms_pipeline_event", "athlete_shard_event"');
        console.log('💤 [DAEMON] Daemon is idle (0% CPU). Awaiting database change events from Supabase/Next.js...\n');

        // Startup catch-up: drain any pending outbox items that arrived while daemon was offline
        drainAthleteShardQueue();
    } catch (err) {
        console.error('[DAEMON] Initial connection failed:', err.message);
        reconnect();
    }

    function reconnect() {
        try { client.end(); } catch {}
        activeClient = null;
        console.log('[DAEMON] Scheduling reconnect in 5 seconds...');
        setTimeout(startDaemon, 5000);
    }
}

// Graceful shutdown handling (registered once)
const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n[DAEMON] Shutting down gracefully...');
    if (pipelineDebounceTimer) clearTimeout(pipelineDebounceTimer);
    if (shardDebounceTimer) clearTimeout(shardDebounceTimer);
    if (activeClient) {
        try {
            await activeClient.query('UNLISTEN owlcms_pipeline_event');
            await activeClient.query('UNLISTEN athlete_shard_event');
            await activeClient.end();
        } catch {}
    }
    if (pool) {
        try {
            await pool.end();
        } catch {}
    }
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
    startDaemon();
}

module.exports = { startDaemon };
