const express = require('express');
const { Pool, Client } = require('pg');
const { generateAthlete, generateMeet } = require('./assembler');
const { drainMeetShardQueue } = require('./lib/meet-shard-refresh');
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

let isDrainingMeetQueue = false;
let pendingMeetDrainQueued = false;
let meetDebounceTimer = null;

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
                         WHERE federation = $1 AND entity_id = $2`,
                        [federation, entity_id]
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

async function runMeetShardDrain() {
    if (isDrainingMeetQueue) {
        pendingMeetDrainQueued = true;
        return;
    }

    isDrainingMeetQueue = true;
    try {
        await drainMeetShardQueue(pool, '[OUTBOX-MEET]');
    } catch (err) {
        console.error('[OUTBOX-MEET] Error during meet shard queue drain:', err.message);
    } finally {
        isDrainingMeetQueue = false;
        if (pendingMeetDrainQueued) {
            pendingMeetDrainQueued = false;
            runMeetShardDrain();
        }
    }
}

function triggerDebouncedMeetDrain() {
    if (meetDebounceTimer) clearTimeout(meetDebounceTimer);
    meetDebounceTimer = setTimeout(() => {
        meetDebounceTimer = null;
        runMeetShardDrain();
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
        } else if (msg.channel === 'meet_shard_event') {
            console.log('[PG-LISTEN] 🔔 Received "meet_shard_event" notification from PostgreSQL');
            triggerDebouncedMeetDrain();
        }
    });

    try {
        await client.connect();
        await client.query('LISTEN athlete_shard_event');
        await client.query('LISTEN meet_shard_event');
        console.log('📡 [PG-LISTEN] Actively listening on PostgreSQL channels: "athlete_shard_event", "meet_shard_event"');
        // Initial drain of any existing queued items on startup
        drainAthleteShardQueue();
        runMeetShardDrain();
    } catch (err) {
        console.error('❌ [PG-LISTEN] Failed to connect:', err.message, '- retrying in 5s...');
        setTimeout(startPostgresListener, 5000);
    }
}

/**
 * Compile one or more meet shards from an HTTP refresh payload.
 */
async function handleMeetRefreshPayload(body) {
    const federation = String(body.federation || '').trim().toLowerCase();
    const isDbMeetId = Boolean(body.is_db_meet_id);
    const ids = Array.isArray(body.meet_ids)
        ? body.meet_ids
        : (body.meet_id !== undefined && body.meet_id !== null ? [body.meet_id] : []);

    const results = [];
    for (const id of ids) {
        const res = await generateMeet({ federation, meet_id: id, is_db_meet_id: isDbMeetId });
        results.push(res);
    }
    return results;
}

// HTTP Webhook Endpoint (Phase 3.2 compatibility + Meet Refresh extension)
app.post('/refresh-athlete', async (req, res) => {
    const { usaw_id, iwf_id, owlcms_id, federation, meet_id, meet_ids, is_db_meet_id, secret } = req.body;

    if (secret !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const hasAthleteIds = Boolean(usaw_id || iwf_id || owlcms_id);
    const hasMeetIds = Boolean(federation && (meet_id !== undefined || (Array.isArray(meet_ids) && meet_ids.length > 0)));

    if (!hasAthleteIds && !hasMeetIds) {
        return res.status(400).json({ error: 'Missing identifiers (athlete ids or federation + meet_id required)' });
    }

    const responsePayload = { success: true };

    if (hasAthleteIds) {
        console.log(`[HTTP] Received athlete refresh request - USAW: ${usaw_id}, IWF: ${iwf_id}, OWLCMS: ${owlcms_id}`);
        const result = await generateAthlete({ usaw_id, iwf_id, owlcms_id });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.error });
        }
        responsePayload.shards_written = result.shards_written;
    }

    if (hasMeetIds) {
        console.log(`[HTTP] Received meet refresh via /refresh-athlete - Fed: ${federation}, Meet: ${meet_id || meet_ids.join(',')}`);
        const meetResults = await handleMeetRefreshPayload({ federation, meet_id, meet_ids, is_db_meet_id });
        const failed = meetResults.find(r => !r.success);
        if (failed) {
            return res.status(500).json({ success: false, error: failed.error, meet_results: meetResults });
        }
        responsePayload.meet_shards_written = meetResults.length;
        responsePayload.meet_paths = meetResults.map(r => r.file_path);
    }

    return res.json(responsePayload);
});

// Dedicated Meet Shard Refresh Endpoint
app.post('/refresh-meet', async (req, res) => {
    const { federation, meet_id, meet_ids, is_db_meet_id, secret } = req.body || {};

    if (secret !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const hasMeetIds = Boolean(federation && (meet_id !== undefined || (Array.isArray(meet_ids) && meet_ids.length > 0)));
    if (!hasMeetIds) {
        return res.status(400).json({ error: 'federation (usaw|iwf|owlcms) and meet_id (or meet_ids) are required' });
    }

    console.log(`[HTTP] Received meet refresh request - Fed: ${federation}, Meet: ${meet_id || meet_ids.join(',')}`);
    const meetResults = await handleMeetRefreshPayload({ federation, meet_id, meet_ids, is_db_meet_id });
    const failed = meetResults.find(r => !r.success);
    if (failed) {
        return res.status(500).json({ success: false, error: failed.error, meet_results: meetResults });
    }

    return res.json({
        success: true,
        meet_shards_written: meetResults.length,
        paths: meetResults.map(r => r.file_path)
    });
});

app.listen(PORT, () => {
    console.log(`[HTTP] Webhook listener active on port ${PORT}`);
    console.log(`[STORAGE] Target directory: ${process.env.OUTPUT_DIR || '/var/www/athlete-data'}`);
    startPostgresListener();
});
