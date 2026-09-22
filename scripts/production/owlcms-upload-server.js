/**
 * OWLCMS Web Upload Server
 * 
 * Provides an immediate, local web interface and API endpoint allowing front-end users
 * to select an OWLCMS JSONv2 file, click "Import Competition Data", and ingest the results
 * directly into Supabase.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const { importOwlcmsJson } = require('./owlcms-importer');
const { runPipeline } = require('./run-owlcms-pipeline');
const {
    listFederationOptions,
    getFederationLineage,
    resolveCascadeInputs
} = require('./federation-lookup.js');

const app = express();
const PORT = process.env.OWLCMS_PORT || 8890;

// Configure JSON parser with generous payload limit (OWLCMS JSONs can be 2-10MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static assets from public/ directory
const publicDir = path.join(__dirname, '..', '..', 'public');
app.use(express.static(publicDir));

// Route: Web Uploader UI
app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'owlcms-uploader.html'));
});

app.get('/owlcms', (req, res) => {
    res.sendFile(path.join(publicDir, 'owlcms-uploader.html'));
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'owlcms-upload-server',
        timestamp: new Date().toISOString()
    });
});

// API Endpoint: Ingest OWLCMS JSONv2
app.post('/api/upload-owlcms', async (req, res) => {
    const { fileName, dryRun, payload, uploaderSelections } = req.body;

    if (!payload || typeof payload !== 'object') {
        return res.status(400).json({
            success: false,
            error: 'Missing or invalid JSON payload in request body.'
        });
    }

    try {
        console.log(`[OWLCMS_SERVER] Received import request: "${fileName || 'upload.json'}" (Dry-run: ${!!dryRun})`);

        const result = await importOwlcmsJson(payload, {
            sourceFileName: fileName || 'upload.json',
            dryRun: Boolean(dryRun),
            // Explicit uploader cascade selections/overrides (including clears).
            // Server inference is recorded separately in geography_inference
            // and is never overwritten by these; both persist side by side.
            uploaderSelections: (uploaderSelections && typeof uploaderSelections === 'object' && !Array.isArray(uploaderSelections))
                ? uploaderSelections
                : null
        });

        return res.json(result);
    } catch (err) {
        console.error(`[OWLCMS_SERVER] Ingestion error: ${err.message}`);
        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// ---------------------------------------------------------------------------
// Federation cascade lookup endpoints (read-only, service-role proxied).
// Anonymous/anon-key database access is blocked by RLS, so clients (including
// the collaborator website) must use these endpoints; credentials never leave
// the server. See docs/GEOGRAPHY_ORGANIZER_CASCADE_API.md for the contract.
// ---------------------------------------------------------------------------

// List cascade options (continent = level:continental, country = level:national,
// organizer = level:national|regional_state_wso|club constrained by parent_id)
app.get('/api/federations/options', async (req, res) => {
    try {
        const { level, parent_id, q, as_of_date, limit, offset } = req.query;
        const result = await listFederationOptions({
            level: level || null,
            parent_id: parent_id || null,
            q: q || null,
            as_of_date: as_of_date || null,
            limit: limit || 50,
            offset: offset || 0
        });
        return res.json(result);
    } catch (err) {
        console.error(`[OWLCMS_SERVER] Federation options error: ${err.message}`);
        return res.status(400).json({ success: false, error: err.message });
    }
});

// Complete parent chain from a recognized organizer, with PIT date filtering
app.get('/api/federations/lineage/:id', async (req, res) => {
    try {
        const result = await getFederationLineage(req.params.id, req.query.as_of_date || null);
        if (!result || result.status === 'no_match') {
            return res.status(404).json({ success: false, error: 'Federation not found' });
        }
        return res.json(result);
    } catch (err) {
        console.error(`[OWLCMS_SERVER] Federation lineage error: ${err.message}`);
        return res.status(400).json({ success: false, error: err.message });
    }
});

// Batch resolution for cascade inference (search-only; never creates records)
app.post('/api/federations/resolve', async (req, res) => {
    try {
        const result = await resolveCascadeInputs(req.body || {});
        return res.json(result);
    } catch (err) {
        console.error(`[OWLCMS_SERVER] Federation resolve error: ${err.message}`);
        return res.status(400).json({ success: false, error: err.message });
    }
});

// API Endpoint: Trigger Post-Ingestion Pipeline (Non-blocking)
app.post('/api/pipeline/run', (req, res) => {
    console.log('[OWLCMS_SERVER] Pipeline run requested via API trigger');
    runPipeline().catch(err => console.error('[OWLCMS_SERVER] Pipeline execution error:', err.message));
    return res.json({
        success: true,
        message: 'Post-ingestion pipeline triggered asynchronously.'
    });
});

app.listen(PORT, () => {
    console.log(`\n🚀 OWLCMS Upload Server running on: http://localhost:${PORT}`);
    console.log(`   Direct Uploader URL: http://localhost:${PORT}/owlcms`);
    console.log(`   API Endpoint:        POST http://localhost:${PORT}/api/upload-owlcms`);
    console.log(`   Pipeline Endpoint:   POST http://localhost:${PORT}/api/pipeline/run\n`);
});

module.exports = app;
