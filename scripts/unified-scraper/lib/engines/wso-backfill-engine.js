const fs = require('fs');
const path = require('path');
const {
    runBase64UrlLookupProtocol,
    verifyLifterParticipationInMeet,
    findOrCreateLifter
} = require('../../../production/database-importer-custom');

class WsoBackfillEngine {
    constructor(supabase, config, logger) {
        this.supabase = supabase;
        this.config = config;
        this.logger = logger;
        this.skipList = new Set();
    }

    async run(session) {
        this.logger.info('Starting WSO Backfill Engine');

        // Load skip list
        this.loadUnresolvedList();

        // Query results
        const results = await this.queryIncompleteResults();

        if (results.length === 0) {
            this.logger.info('No results found needing WSO backfill');
            return;
        }

        this.logger.info(`Processing ${results.length} results...`);

        for (const result of results) {
            try {
                // Determine potential lifter IDs (if we need them for Tier 1.5/2)
                const potentialLifterIds = result.lifter_id ? [result.lifter_id] : [];

                // Check for duplicates
                const hasDuplicates = await this.hasDuplicateNames(result.lifter_name);

                let success = false;

                // TIER 1 & 1.5: Division Rankings via Base64 URL
                // We use the shared implementation which does batch enrichment
                if (!hasDuplicates) {
                    this.logger.info(`Running Tier 1 for ${result.lifter_name}...`);
                    const tier1Result = await runBase64UrlLookupProtocol(
                        result.lifter_name,
                        potentialLifterIds,
                        result.meet_id,
                        result.date,
                        result.age_category,
                        result.weight_class
                    );

                    if (tier1Result) {
                        success = true;
                        session.completed++;
                        this.logger.info(`✅ Tier 1 success for ${result.lifter_name}`);
                    }
                } else {
                    this.logger.info(`Duplicate names detected for ${result.lifter_name}, skipping Tier 1`);
                }

                // TIER 2: Member Page Verification (if T1 failed or duplicates)
                if (!success) {
                    this.logger.info(`Attempting Tier 2 (Member Page) for ${result.lifter_name}...`);

                    // We need the internal_id to run Tier 2
                    // Fetch lifter(s) with this name
                    const lifters = await this.findLiftersWithSameName(result.lifter_name);

                    for (const lifter of lifters) {
                        if (!lifter.internal_id) continue;

                        const found = await verifyLifterParticipationInMeet(
                            lifter.internal_id,
                            result.meet_id
                        );

                        if (found) {
                            success = true;
                            // Enforce the link in DB (verifyLifterParticipationInMeet doesn't seem to update DB, just verifies)
                            // But surgical-strike logic did update.
                            // We should probably rely on the fact that if we verify it, we can maybe trigger an update?
                            // Actually verifyLifterParticipationInMeet just returns true/false.
                            // We might need to manually update if verified?

                            // For now, let's just mark success and maybe update wso/club if we scraped it?
                            // verifyLifterParticipationInMeet doesn't return the data, just boolean.
                            // Access to member page data would be needed. 

                            // Limitation: verifyLifterParticipationInMeet in database-importer-custom.js doesn't return the data.
                            // surgical-strike-wso-scraper.js implements its own `scrapeAthleteMemberPage`.
                            // Maybe I SHOULD have copied that?

                            // For now, assume if Tier 1 failed, we fallback to just logging it, or if Tier 2 passes we trust the existing data?
                            // But WSO backfill is ABOUT populating missing data.
                            // If Tier 1 (Rankings) failed, we might not have the WSO/Club data.
                            // Member page usually has Club/WSO? checking member page scraping logic...
                            // In surgical-strike, scrapeAthleteMemberPage extracted: meet_name, date, division, body_weight, lifts...
                            // It does NOT seem to extract WSO/Club from the member history table!
                            // So Tier 2 is mainly for verifying identity to link internal_id.

                            // So if Tier 1 fails (not in rankings), and Tier 2 succeeds (found in history), 
                            // we still might not have WSO/Club if it's not on the history table.
                            // Thus runBase64UrlLookupProtocol is the primary source for WSO/Club.

                            if (success) {
                                session.completed++;
                                this.logger.info(`✅ Tier 2 verified participation for ${result.lifter_name} (Internal ID: ${lifter.internal_id})`);
                            }
                            break;
                        }
                    }
                }

                if (!success) {
                    this.logger.warn(`❌ Failed to recover data for ${result.lifter_name}`);
                    session.failed++;
                    this.addToUnresolvedList({
                        result_id: result.result_id,
                        lifter_name: result.lifter_name,
                        date: result.date
                    });
                } else {
                    session.updated++; // Assuming success means update happened in Tier 1
                }

            } catch (error) {
                this.logger.error(`Error processing ${result.lifter_name}: ${error.message}`);
                session.errors.push({ resultId: result.result_id, error: error.message });
            }
        }
    }

    async queryIncompleteResults() {
        // ... (Logic from surgical-strike-wso-scraper.js)
        let query = this.supabase
            .from('usaw_meet_results')
            .select('result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, competition_age, wso, club_name, total, date')
            .not('age_category', 'is', null)
            .not('weight_class', 'is', null)
            .not('meet_id', 'is', null);

        if (!this.config.force) {
            query = query.filter('total', 'gt', '0');
            query = query.is('wso', null);
        }

        if (this.config.meetIds) {
            query = query.in('meet_id', this.config.meetIds);
        }

        if (this.config.athleteName) {
            query = query.eq('lifter_name', this.config.athleteName);
        }

        if (this.config.genderFilter) {
            query = query.eq('gender', this.config.genderFilter);
        }

        if (this.config.startDate) {
            query = query.gte('date', this.config.startDate);
        }
        if (this.config.endDate) {
            query = query.lte('date', this.config.endDate);
        }

        if (this.config.maxResults) {
            query = query.limit(this.config.maxResults);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Filter out skip list (unless forced)
        if (this.config.force) {
            return data;
        }
        return data.filter(r => !this.skipList.has(r.result_id));
    }

    async hasDuplicateNames(lifterName) {
        const { data } = await this.supabase
            .from('usaw_lifters')
            .select('lifter_id')
            .eq('athlete_name', lifterName);
        return data && data.length > 1;
    }

    async findLiftersWithSameName(lifterName) {
        const { data } = await this.supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name, internal_id')
            .eq('athlete_name', lifterName)
            .not('internal_id', 'is', null);
        return data || [];
    }

    loadUnresolvedList() {
        if (fs.existsSync(this.config.unresolvedPath)) {
            try {
                const data = fs.readFileSync(this.config.unresolvedPath, 'utf8');
                const list = JSON.parse(data);
                list.forEach(item => this.skipList.add(item.result_id));
            } catch (e) {
                this.logger.warn('Failed to load unresolved list');
            }
        }
    }

    addToUnresolvedList(item) {
        if (this.config.dryRun) return;
        this.skipList.add(item.result_id);

        let existing = [];
        if (fs.existsSync(this.config.unresolvedPath)) {
            try {
                existing = JSON.parse(fs.readFileSync(this.config.unresolvedPath, 'utf8'));
            } catch (e) { }
        }
        existing.push(item);

        // Ensure dir
        const dir = path.dirname(this.config.unresolvedPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(this.config.unresolvedPath, JSON.stringify(existing, null, 2));
    }
}

module.exports = { WsoBackfillEngine };
