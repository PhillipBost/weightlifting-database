const { createClient } = require('@supabase/supabase-js');
const { WsoBackfillEngine } = require('./wso-decontamination-engine');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error('❌ Missing Supabase credentials in .env file.');
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const args = process.argv.slice(2);
const athleteIdx = args.indexOf('--athlete');
const athleteArg = athleteIdx !== -1 ? args[athleteIdx + 1] : args.find(a => !a.startsWith('--'));
const isDryRun = args.includes('--dry-run') || args.includes('--dryRun');

const config = {
    dryRun: isDryRun,
    force: true, // Force processing for the test
    athleteNames: athleteArg ? [athleteArg] : ['Sarah Roberts'],
    unresolvedPath: path.resolve(__dirname, '../../../unresolved_collisions.json')
};

const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
};

async function main() {
    console.log(`🚀 Starting Forensic Decontamination Test`);
    console.log(`👤 Athlete: ${config.athleteNames.join(', ')}`);
    console.log(`🏁 Mode: ${config.dryRun ? 'DRY RUN (No database mutations)' : 'LIVE (Database mutations enabled)'}`);
    console.log('------------------------------------------------------------');

    try {
        const engine = new WsoBackfillEngine(supabase, config, logger);
        await engine.run({ id: 'test-session-' + Date.now() });
        console.log('------------------------------------------------------------');
        console.log('✅ Test sequence completed.');
    } catch (error) {
        console.error('❌ Engine execution failed:', error.message);
        console.error(error.stack);
    }
}

main();
