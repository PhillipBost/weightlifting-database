const express = require('express');
const { Pool, Client } = require('pg');
const { generateAthlete } = require('./assembler');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = 8889;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'changeme_12345';
const SHARD_DEBOUNCE_MS = 1500;

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

const pool = new Pool(getPgConfig());
let isDrainingQueue = false;
let pendingDrainQueued = false;
let shardDebounceTimer = null;

/**
 * Atomically drains public.athlete_shard_queue and compiles static shards
 */
async function drainAthleteShardQueue() {
    if (isDrainingQueue) {
        pendingDrainQueued = true;
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

            console.log(`\n⚡ [OUTBOX] Draining batch of ${rows.length} athlete shard update(s)...`);

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
                            console.log(`[OUTBOX] ✅ Compiled shard for ${federation.toUpperCase()} ID: ${entity_id}`);
                        } else {
                            console.warn(`[OUTBOX] ⚠️ Shard build failed for ${federation.toUpperCase()} ID ${entity_id}: ${result?.error || 'Unknown error'}`);
                        }
                    } catch (compileErr) {
                        console.error(`[OUTBOX] ❌ Error compiling shard for ${federation.toUpperCase()} ID ${entity_id}:`, compileErr.message);
                    }

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
        console.error('[OUTBOX] Error during shard queue drain:', err.message);
    } finally {
        isDrainingQueue = false;
        if (pendingDrainQueued) {
            pendingDrainQueued = false;
            drainAthleteShardQueue();
        }
    }
}

function triggerDebouncedDrain() {
    if (shardDebounceTimer) clearTimeout(shardDebounceTimer);
    shardDebounceTimer = setTimeout(() => {
        shardDebounceTimer = null;
        drainAthleteShardQueue();
    }, SHARD_DEBOUNCE_MS);
}

/**
 * Persistent PostgreSQL LISTEN connection with auto-reconnect
 */
async function startPostgresListener() {
    const client = new Client(getPgConfig());

    client.on('error', (err) => {
        console.error('❌ [PG-LISTEN] Connection error:', err.message);
    });

    client.on('end', () => {
        console.warn('⚠️ [PG-LISTEN] Connection ended. Reconnecting in 3s...');
        setTimeout(startPostgresListener, 3000);
    });

    client.on('notification', (msg) => {
        if (msg.channel === 'athlete_shard_event') {
            console.log('[PG-LISTEN] 🔔 Received "athlete_shard_event" notification from PostgreSQL');
            triggerDebouncedDrain();
        }
    });

    try {
        await client.connect();
        await client.query('LISTEN athlete_shard_event');
        console.log('📡 [PG-LISTEN] Actively listening on PostgreSQL channel: "athlete_shard_event"');
        // Initial drain of any existing queued items on startup
        drainAthleteShardQueue();
    } catch (err) {
        console.error('❌ [PG-LISTEN] Failed to connect:', err.message, '- retrying in 5s...');
        setTimeout(startPostgresListener, 5000);
    }
}

// HTTP Webhook Endpoint (Phase 3.2 compatibility)
app.post('/refresh-athlete', async (req, res) => {
    const { usaw_id, iwf_id, owlcms_id, secret } = req.body;

    if (secret !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!usaw_id && !iwf_id && !owlcms_id) {
        return res.status(400).json({ error: 'Missing athlete identifiers (usaw_id, iwf_id, or owlcms_id required)' });
    }

    console.log(`[HTTP] Received refresh request - USAW: ${usaw_id}, IWF: ${iwf_id}, OWLCMS: ${owlcms_id}`);
    const result = await generateAthlete({ usaw_id, iwf_id, owlcms_id });

    if (result.success) {
        return res.json({ success: true, shards_written: result.shards_written });
    } else {
        return res.status(500).json({ success: false, error: result.error });
    }
});

app.listen(PORT, () => {
    console.log(`[HTTP] Webhook listener active on port ${PORT}`);
    console.log(`[STORAGE] Target directory: ${process.env.OUTPUT_DIR || '/var/www/athlete-data'}`);
    startPostgresListener();
});
