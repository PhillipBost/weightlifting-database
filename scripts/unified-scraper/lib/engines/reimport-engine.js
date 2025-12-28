const { MeetCompletenessEngine } = require('../../../meet-re-import/lib/meet-completeness-engine');
const { MeetSkipManager } = require('../../../meet-re-import/lib/meet-skip-manager');
const { DetailedReImportOrchestrator } = require('../../../meet-re-import/lib/detailed-orchestrator');
const { ProgressReporter } = require('../../../meet-re-import/lib/progress-reporter');
const { MeetFilterCriteria } = require('../../../meet-re-import/types');

class ReImportEngine {
    constructor(supabase, config, logger) {
        this.supabase = supabase;
        this.config = config;
        this.logger = logger;

        // Initialize components
        this.completenessEngine = new MeetCompletenessEngine(supabase, config);
        this.skipManager = new MeetSkipManager(supabase, config);
        this.orchestrator = new DetailedReImportOrchestrator(supabase, config);
        this.progressReporter = new ProgressReporter(config);
    }

    async run(session) {
        this.logger.info('Starting Re-Import Engine');

        const filters = new MeetFilterCriteria({
            meetIds: this.config.meetIds,
            startDate: this.config.startDate,
            endDate: this.config.endDate,
            athleteName: this.config.athleteName,
            limit: this.config.limit
        });

        const incompleteMeets = await this.completenessEngine.getIncompleteMeets(filters.toQueryParams());

        if (incompleteMeets.length === 0) {
            this.logger.info('No incomplete meets found');
            return;
        }

        this.logger.info(`Found ${incompleteMeets.length} incomplete meets`);

        if (this.config.dryRun || this.config.analyzeOnly) {
            incompleteMeets.forEach(meet => {
                this.logger.info(`  [${this.config.analyzeOnly ? 'ANALYZE' : 'DRY RUN'}] Meet ${meet.id}: ${meet.name}`);
            });
            return;
        }

        // Process batches
        // Note: meet-re-import used CLI class to batch. We'll do it here.
        const batches = [];
        for (let i = 0; i < incompleteMeets.length; i += this.config.batchSize) {
            batches.push(incompleteMeets.slice(i, i + this.config.batchSize));
        }

        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            this.logger.info(`Processing batch ${i + 1}/${batches.length}`);

            const batchResult = await this.orchestrator.processMeetBatch(batch);

            batchResult.meetResults.forEach(r => {
                session.results.push(r);
                if (r.success) session.completed++; else session.failed++;
            });

            if (i < batches.length - 1) {
                await new Promise(r => setTimeout(r, this.config.delay));
            }
        }
    }
}

module.exports = { ReImportEngine };
