#!/usr/bin/env node
/**
 * PRODUCTION: OWLCMS Event-Driven Pipeline Daemon
 * 
 * Maintains a persistent, zero-overhead connection to PostgreSQL listening for
 * database change notifications on 'owlcms_pipeline_event'.
 * 
 * When Next.js inserts new PENDING lifters or approves an athlete link,
 * PostgreSQL instantaneously pushes a notification frame down the existing connection.
 * The daemon debounces burst writes (e.g. 150 lifters in a meet) and triggers the
 * post-ingestion matching pipeline and static shard generator automatically.
 * 
 * 100% event-driven, zero polling, zero open inbound firewall ports.
 */

require('dotenv').config();
const { Client } = require('pg');
const { runPipeline } = require('./run-owlcms-pipeline');

const DEBOUNCE_MS = 1500; // Debounce window to allow multi-row inserts to complete
let debounceTimer = null;
let isPipelineActive = false;
let pendingRunQueued = false;

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
 * Debounce burst notifications and trigger pipeline
 */
function triggerDebouncedPipeline(eventPayload) {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
        debounceTimer = null;

        if (isPipelineActive) {
            console.log('[DAEMON] Pipeline currently running. Queuing pass to drain new records upon completion.');
            pendingRunQueued = true;
            return;
        }

        isPipelineActive = true;
        try {
            console.log('\n⚡ [DAEMON] Database change event detected. Triggering post-ingestion pipeline...');
            await runPipeline();
        } catch (err) {
            console.error('[DAEMON] Pipeline execution error:', err.message);
        } finally {
            isPipelineActive = false;
            if (pendingRunQueued) {
                pendingRunQueued = false;
                triggerDebouncedPipeline({ queued: true });
            }
        }
    }, DEBOUNCE_MS);
}

/**
 * Main daemon startup and listener loop
 */
async function startDaemon() {
    const config = getPgConfig();
    const client = new Client(config);
    activeClient = client;

    client.on('notification', msg => {
        if (msg.channel === 'owlcms_pipeline_event') {
            let parsed = {};
            try { parsed = JSON.parse(msg.payload); } catch {}
            console.log(`[DAEMON] Received Postgres notification: ${parsed.event || msg.payload}`);
            triggerDebouncedPipeline(parsed);
        }
    });

    client.on('error', err => {
        console.error('[DAEMON] Postgres connection error:', err.message);
        reconnect();
    });

    try {
        console.log(`[DAEMON] Connecting to PostgreSQL at ${config.host || 'DATABASE_URL'}...`);
        await client.connect();
        await client.query('LISTEN owlcms_pipeline_event');
        console.log('📡 [DAEMON] Actively listening on channel "owlcms_pipeline_event"');
        console.log('💤 [DAEMON] Daemon is idle (0% CPU). Awaiting database change events from Supabase/Next.js...\n');
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

let activeClient = null;
let isShuttingDown = false;

// Graceful shutdown handling (registered once)
const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n[DAEMON] Shutting down gracefully...');
    if (debounceTimer) clearTimeout(debounceTimer);
    if (activeClient) {
        try {
            await activeClient.query('UNLISTEN owlcms_pipeline_event');
            await activeClient.end();
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
