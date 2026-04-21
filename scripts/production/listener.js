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
    const { lifter_id, secret } = req.body;

    // Security Check
    if (secret !== WEBHOOK_SECRET) {
        console.warn(`[LISTENER] Unauthorized request attempt from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!lifter_id) {
        return res.status(400).json({ error: 'Missing lifter_id' });
    }

    console.log(`[LISTENER] Received refresh request for Lifter ID: ${lifter_id}`);

    // Trigger the real-time refresh
    const result = await generateAthlete(lifter_id);

    if (result.success) {
        console.log(`[LISTENER] Success: Refreshed ${result.name} (${lifter_id})`);
        return res.json({ success: true, message: `Refreshed ${result.name}` });
    } else {
        console.error(`[LISTENER] Failed: ${result.error}`);
        return res.status(500).json({ success: false, error: result.error });
    }
});

app.listen(PORT, () => {
    console.log(`[LISTENER] Data Factory Webhook Listener active on port ${PORT}`);
    console.log(`[LISTENER] Target: ${process.env.OUTPUT_DIR || '/var/www/athlete-data'}`);
});
