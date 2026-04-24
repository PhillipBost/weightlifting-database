const express = require('express');
const { generateAthlete } = require('./assembler');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = 8889;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'changeme_12345';

/**
 * WEBHOOK LISTENER - Phase 3.2
 * Receives lifter_id from Postgres and triggers an individual JSON update.
 */
app.post('/refresh-athlete', async (req, res) => {
    const { usaw_id, iwf_id, secret } = req.body;

    // Security Check
    if (secret !== WEBHOOK_SECRET) {
        console.warn(`[LISTENER] Unauthorized request attempt from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!usaw_id && !iwf_id) {
        return res.status(400).json({ error: 'Missing athlete identifiers' });
    }

    console.log(`[LISTENER] Received refresh request - USAW: ${usaw_id}, IWF: ${iwf_id}`);

    // Trigger the real-time refresh
    const result = await generateAthlete({ usaw_id, iwf_id });

    if (result.success) {
        console.log(`[LISTENER] Success: Shards updated for USAW:${usaw_id}, IWF:${iwf_id}`);
        return res.json({ success: true, shards_written: result.shards_written });
    } else {
        console.error(`[LISTENER] Failed: ${result.error}`);
        return res.status(500).json({ success: false, error: result.error });
    }
});

app.listen(PORT, () => {
    console.log(`[LISTENER] Data Factory Webhook Listener active on port ${PORT}`);
    console.log(`[LISTENER] Target: ${process.env.OUTPUT_DIR || '/var/www/athlete-data'}`);
});
