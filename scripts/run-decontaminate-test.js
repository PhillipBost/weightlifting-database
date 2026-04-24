
const minimist = require('minimist');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const { SimpleLogger } = require('./meet-re-import/lib/simple-logger');
const { UnifiedConfiguration, UnifiedSession } = require('./unified-scraper/lib/shared-config');
const { WsoBackfillEngine } = require('./unified-scraper/lib/engines/wso-decontamination-engine');

async function run() {
    const args = minimist(process.argv.slice(2), {
        string: ['name'],
        boolean: ['dry-run'],
        alias: { 'n': 'name' }
    });

    if (!args.name) {
        console.log('Usage: node scripts/run-decontaminate-test.js --name="Athlete Name"');
        process.exit(1);
    }

    const logger = new SimpleLogger('DecontaminateTest');
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    logger.info(`🧪 Starting Isolated Decontamination Test for: ${args.name}`);

    const config = new UnifiedConfiguration({
        mode: 'wso',
        athleteNames: [args.name],
        force: true, // We must use force to process existing records
        membershipDuplicates: true, // This flag triggers the duplication logic
        logLevel: 'debug',
        dryRun: args['dry-run'] || false
    });

    const engine = new WsoBackfillEngine(supabase, config, logger);
    const session = new UnifiedSession('decontaminate-test');

    try {
        await engine.run(session);
        logger.info('✅ Test Run Complete');
    } catch (err) {
        logger.error(`❌ Test Run Failed: ${err.message}`);
        console.error(err);
    }
}

run();
