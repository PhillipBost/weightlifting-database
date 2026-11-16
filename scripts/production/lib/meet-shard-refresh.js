/**
 * Shared Meet Shard Refresh & Outbox Queue Helpers
 *
 * Centralizes:
 *   1. Draining public.meet_shard_queue for background daemons (listener.js / owlcms-event-daemon.js)
 *   2. Direct or HTTP-webhook meet shard regeneration after ingestion or admin actions
 *   3. Safe outbox enqueueing via Supabase client
 */

const { generateMeet } = require('../assembler');

/**
 * Drain public.meet_shard_queue atomically.
 * Tolerates missing table (42P01) if migration has not been applied yet.
 */
async function drainMeetShardQueue(pool, logPrefix = '[MEET-SHARD]') {
    if (!pool) return { drained: 0 };

    let totalDrained = 0;
    while (true) {
        let rows;
        try {
            const res = await pool.query(
                `SELECT federation, meet_id, enqueued_at
                 FROM public.meet_shard_queue
                 ORDER BY enqueued_at ASC
                 LIMIT 100`
            );
            rows = res.rows;
        } catch (err) {
            if (err.code === '42P01') {
                // Table does not exist yet
                return { drained: totalDrained, missingTable: true };
            }
            throw err;
        }

        if (!rows || rows.length === 0) break;

        console.log(`\n⚡ ${logPrefix} Draining batch of ${rows.length} meet shard update(s)...`);

        const client = await pool.connect();
        try {
            for (const row of rows) {
                const { federation, meet_id } = row;
                try {
                    const result = await generateMeet({ federation, meet_id }, client);
                    if (result && result.success) {
                        console.log(`${logPrefix} ✅ Compiled meet shard for ${federation.toUpperCase()} Meet ${meet_id} (${result.result_count} results)`);
                        totalDrained++;
                    } else {
                        console.warn(`${logPrefix} ⚠️ Meet shard build failed for ${federation.toUpperCase()} Meet ${meet_id}: ${result?.error || 'Unknown error'}`);
                    }
                } catch (compileErr) {
                    console.error(`${logPrefix} ❌ Exception compiling meet shard for ${federation.toUpperCase()} Meet ${meet_id}:`, compileErr.message);
                }

                await client.query(
                    `DELETE FROM public.meet_shard_queue
                     WHERE federation = $1 AND meet_id = $2`,
                    [federation, meet_id]
                );
            }
        } finally {
            client.release();
        }
    }

    return { drained: totalDrained };
}

/**
 * Resolve the HTTP meet-refresh URL from HETZNER_MEET_SHARD_REFRESH_URL or HETZNER_SHARD_REFRESH_URL.
 */
function resolveMeetRefreshWebhookUrl() {
    if (process.env.HETZNER_MEET_SHARD_REFRESH_URL) {
        return process.env.HETZNER_MEET_SHARD_REFRESH_URL;
    }
    const base = process.env.HETZNER_SHARD_REFRESH_URL;
    if (!base) return null;
    // Both /refresh-athlete (extended) and /refresh-meet are supported; prefer /refresh-meet when URL ends with /refresh-athlete
    return base.replace(/\/refresh-athlete\/?$/i, '/refresh-meet');
}

/**
 * Refresh one or more meet shards directly (if PG creds exist) or via HTTP webhook (if configured).
 * Non-fatal: logs warnings on failure so ingestion pipelines are never blocked.
 */
async function triggerMeetShardRefresh(federation, meetIds, options = {}) {
    const list = (Array.isArray(meetIds) ? meetIds : [meetIds])
        .map(id => (id !== null && id !== undefined ? String(id).trim() : ''))
        .filter(Boolean);

    const uniqueIds = Array.from(new Set(list));
    if (uniqueIds.length === 0) return { success: true, refreshed: 0 };

    // 1. Direct compilation when local PG credentials are available (e.g. Hetzner host)
    if (process.env.DB_HOST || process.env.DATABASE_URL) {
        let refreshed = 0;
        for (const meetId of uniqueIds) {
            try {
                const res = await generateMeet({
                    federation,
                    meet_id: meetId,
                    is_db_meet_id: Boolean(options.is_db_meet_id)
                }, options.client || null);

                if (res && res.success) {
                    console.log(`  ✅ Meet shard compiled: /meets/${federation}/${res.shard_id}/${res.meet_id}.json.gz (${res.result_count} results)`);
                    refreshed++;
                } else {
                    console.warn(`  ⚠️ Meet shard compile warning (${federation}:${meetId}): ${res?.error || 'Unknown error'}`);
                }
            } catch (err) {
                console.warn(`  ⚠️ Meet shard compile error (${federation}:${meetId}): ${err.message}`);
            }
        }
        return { success: true, mode: 'direct', refreshed };
    }

    // 2. HTTP Webhook fallback (e.g. GitHub Actions -> Hetzner listener on port 8889)
    const webhookUrl = resolveMeetRefreshWebhookUrl();
    if (webhookUrl) {
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    federation,
                    meet_ids: uniqueIds,
                    is_db_meet_id: Boolean(options.is_db_meet_id),
                    secret: process.env.WEBHOOK_SECRET || 'changeme_12345'
                })
            });

            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                console.log(`  ✅ Meet shard webhook refresh triggered for ${uniqueIds.length} ${federation.toUpperCase()} meet(s).`);
                return { success: true, mode: 'webhook', refreshed: data.meet_shards_written || uniqueIds.length };
            } else {
                console.warn(`  ⚠️ Meet shard webhook returned HTTP ${response.status}`);
            }
        } catch (err) {
            console.warn(`  ⚠️ Meet shard webhook failed: ${err.message}`);
        }
    }

    // 3. Optional Supabase outbox fallback if client provided
    if (options.supabase && !options.is_db_meet_id) {
        await enqueueMeetShards(options.supabase, federation, uniqueIds);
    }

    return { success: true, mode: 'deferred', refreshed: 0 };
}

/**
 * Enqueue meet IDs into public.meet_shard_queue via Supabase client.
 */
async function enqueueMeetShards(supabase, federation, meetIds) {
    if (!supabase) return { enqueued: 0 };
    const uniqueIds = Array.from(new Set(
        (Array.isArray(meetIds) ? meetIds : [meetIds])
            .map(id => (id !== null && id !== undefined ? String(id).trim() : ''))
            .filter(Boolean)
    ));
    if (uniqueIds.length === 0) return { enqueued: 0 };

    const nowIso = new Date().toISOString();
    const rows = uniqueIds.map(meet_id => ({
        federation,
        meet_id,
        enqueued_at: nowIso
    }));

    const { error } = await supabase
        .from('meet_shard_queue')
        .upsert(rows, { onConflict: 'federation,meet_id' });

    if (error) {
        console.warn(`  ⚠️ Failed to enqueue to meet_shard_queue: ${error.message}`);
        return { enqueued: 0, error: error.message };
    }

    return { enqueued: uniqueIds.length };
}

module.exports = {
    drainMeetShardQueue,
    triggerMeetShardRefresh,
    enqueueMeetShards,
    resolveMeetRefreshWebhookUrl
};
