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
            console.log(''); // Separator between athletes
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
                        result.weight_class,
                        result.body_weight_kg
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

                        const resultVerification = await verifyLifterParticipationInMeet(
                            lifter.internal_id,
                            result.meet_id
                        );

                        if (resultVerification.verified) {
                            // Identity Verified via Tier 2
                            this.logger.info(`✅ Tier 2 verified participation for ${result.lifter_name} (Internal ID: ${lifter.internal_id})`);

                            // DECONTAMINATION: Check if the verified lifter matches the current result's lifter_id
                            if (result.lifter_id && lifter.lifter_id && result.lifter_id !== lifter.lifter_id) {
                                this.logger.info(`  ♻️ Decontamination: Reassigning result ${result.result_id} from Lifter ${result.lifter_id} to Verified Lifter ${lifter.lifter_id}`);

                                const { error: reassignmentError } = await this.supabase
                                    .from('usaw_meet_results')
                                    .update({ lifter_id: lifter.lifter_id })
                                    .eq('result_id', result.result_id);

                                if (reassignmentError) {
                                    this.logger.error(`  ❌ Failed to reassign lifter: ${reassignmentError.message}`);
                                } else {
                                    this.logger.info(`  ✅ Result reassigned successfully`);

                                    // PHANTOM CLEANUP: Check if old lifter has any remaining results
                                    // If not, delete the phantom lifter to keep DB clean
                                    const oldLifterId = result.lifter_id;
                                    const { count } = await this.supabase
                                        .from('usaw_meet_results')
                                        .select('*', { count: 'exact', head: true })
                                        .eq('lifter_id', oldLifterId);

                                    if (count === 0) {
                                        this.logger.info(`  🗑️ Phantom Lifter Cleanup: Lifter ${oldLifterId} has 0 results remaining. Deleting...`);
                                        const { error: deleteError } = await this.supabase
                                            .from('usaw_lifters')
                                            .delete()
                                            .eq('lifter_id', oldLifterId);

                                        if (deleteError) {
                                            this.logger.error(`  ❌ Failed to delete phantom lifter: ${deleteError.message}`);
                                        } else {
                                            this.logger.info(`  ✅ Phantom lifter ${oldLifterId} deleted successfully`);
                                        }
                                    } else {
                                        this.logger.info(`  ℹ️ Old Lifter ${oldLifterId} still has ${count} results. Keeping record.`);
                                    }
                                }
                            }

                            // Check metadata for gender to infer category if unknown
                            let lookupCategory = result.age_category;
                            let metaMsg = '';

                            const isUnknownCategory = !result.age_category || result.age_category === '-' || result.age_category === 'Unknown';
                            if (isUnknownCategory && resultVerification.metadata && resultVerification.metadata.gender) {
                                const gender = resultVerification.metadata.gender;
                                lookupCategory = (gender === 'M') ? "Open Men's" : "Open Women's";
                                metaMsg = ` (Inferred Category: ${lookupCategory})`;
                                this.logger.info(`  🔄 Inferred Age Category from Tier 2 metadata: ${lookupCategory}`);
                            }

                            // NOW: Re-run Tier 1 (rankings) with the specific verified lifter ID to get metadata
                            this.logger.info(`Running Tier 1 (Base64) with verified lifter ID ${lifter.lifter_id}${metaMsg}...`);

                            const tier1Result = await runBase64UrlLookupProtocol(
                                result.lifter_name,
                                [lifter.lifter_id], // Pass verified ID
                                result.meet_id,
                                result.date,
                                lookupCategory, // Use inferred or original category
                                result.weight_class,
                                result.body_weight_kg
                            );

                            if (tier1Result) {
                                success = true;
                                session.completed++;
                                this.logger.info(`✅ Tier 1 success (after Identity Verification) for ${result.lifter_name}`);
                            } else {
                                // We verified identity but failed to scrape rankings (maybe missing from rankings?)
                                success = true;
                                session.completed++;
                                this.logger.warn(`⚠️ Identity verified but failed to scrape metadata from rankings for ${result.lifter_name}`);
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
            // QUERY MODIFICATION
            .select('result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, body_weight_kg, competition_age, wso, club_name, total, date')
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
            // Handle "Double space fuzzy" - match both "Name Surname" and "Name  Surname"
            const name = this.config.athleteName;
            const doubleSpaced = name.replace(/ /g, '  ');

            if (name !== doubleSpaced) {
                // Use OR filter with ilike to handle both variations case-insensitively
                query = query.or(`lifter_name.ilike.${name},lifter_name.ilike.${doubleSpaced}`);
            } else {
                query = query.ilike('lifter_name', name);
            }
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
