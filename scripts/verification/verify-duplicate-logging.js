
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { MeetCompletenessEngine } = require('../meet-re-import/lib/meet-completeness-engine');

// Mock config
const config = {
    logLevel: 'debug',
    force: false
};

async function run() {
    console.log('🚀 Starting Duplicate Logging Verification...');

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
    );

    const engine = new MeetCompletenessEngine(supabase, config);

    // We specifically want to test the _findDuplicates logic
    // We can call analyzeMeetCompleteness for meet 2748

    // Redirect console.log to file manually to avoid encoding issues
    const fs = require('fs');
    const logFile = 'verification_result_utf8.txt';
    const log = (msg) => {
        console.log(msg);
        fs.appendFileSync(logFile, (typeof msg === 'object' ? JSON.stringify(msg, null, 2) : msg) + '\n');
    };

    // Monkey patch logger
    engine.logger = {
        info: (msg, data) => log(`[INFO] ${msg} ${data ? JSON.stringify(data) : ''}`),
        warn: (msg, data) => log(`[WARN] ${msg} ${data ? JSON.stringify(data) : ''}`),
        error: (msg, data) => log(`[ERROR] ${msg} ${data ? JSON.stringify(data) : ''}`),
        debug: (msg, data) => log(`[DEBUG] ${msg} ${data ? JSON.stringify(data) : ''}`),
        logMeetStart: () => { },
        logScrapeStart: () => { },
    };

    log('🧪 Analyzing Meat 2748 (known to have duplicates)...');
    try {
        const result = await engine.analyzeMeetCompleteness(2748);
        log('✅ Analysis Logged');

        // Output result summary
        log('\n📊 Result Summary:');
        log(result);

    } catch (error) {
        log('❌ Error: ' + error.message);
    }
}

run();
