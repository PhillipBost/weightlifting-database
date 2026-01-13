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
                        result.body_weight_kg,
                        false, // isFallbackCheck
                        result.total,
                        result.best_snatch,
                        result.best_cj,
                        null, // browser (optional)
                        this.config.force // forceUpdate
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
                let lifters = [];
                if (!success) {
                    this.logger.info(`Attempting Tier 2 (Member Page) for ${result.lifter_name}...`);

                    // We need the internal_id to run Tier 2
                    // Fetch lifter(s) with this name
                    lifters = await this.findLiftersWithSameName(result.lifter_name);

                    for (const lifter of lifters) {
                        if (!lifter.internal_id) continue;

                        const resultVerification = await verifyLifterParticipationInMeet(
                            lifter.internal_id,
                            result.meet_id,
                            result.lifter_name,
                            result.weight_class, // Pass weight class for enhanced verification
                            result.total,
                            result.best_snatch,
                            result.best_cj
                        );

                        if (resultVerification.verified) {
                            // Identity Verified via Tier 2
                            this.logger.info(`✅ Tier 2 verified participation for ${result.lifter_name} (Internal ID: ${lifter.internal_id})`);

                            // METADATA UPDATE: Membership Number
                            if (resultVerification.metadata && resultVerification.metadata.membershipNumber) {
                                const memNum = resultVerification.metadata.membershipNumber;
                                this.logger.info(`  📝 Found Membership Number: ${memNum}`);

                                const { error: memError } = await this.supabase
                                    .from('usaw_lifters')
                                    .update({ membership_number: memNum })
                                    .eq('lifter_id', lifter.lifter_id);

                                if (memError) {
                                    this.logger.warn(`  ⚠️ Failed to save membership number: ${memError.message}`);
                                } else {
                                    this.logger.info(`  💾 Saved membership number ${memNum}`);
                                }
                            }

                            // DECONTAMINATION: Check if the verified lifter matches the current result's lifter_id
                            if (result.lifter_id && lifter.lifter_id && result.lifter_id !== lifter.lifter_id) {
                                this.logger.info(`  ♻️ Decontamination: Reassigning result ${result.result_id} from Lifter ${result.lifter_id} to Verified Lifter ${lifter.lifter_id}`);

                                const { error: reassignmentError } = await this.supabase
                                    .from('usaw_meet_results')
                                    .update({ lifter_id: lifter.lifter_id })
                                    .eq('result_id', result.result_id);

                                let cleanupNeeded = false;

                                if (reassignmentError) {
                                    if (reassignmentError.message && reassignmentError.message.includes('unique constraint')) {
                                        this.logger.warn(`  ⚠️ Conflict detected: Verified Lifter ${lifter.lifter_id} already has a result for this meet/weight class.`);
                                        this.logger.info(`  🗑️ Resolution: Deleting redundant result ${result.result_id} from Ghost Lifter ${result.lifter_id} to resolve conflict.`);

                                        const { error: conflictDeleteError } = await this.supabase
                                            .from('usaw_meet_results')
                                            .delete()
                                            .eq('result_id', result.result_id);

                                        if (conflictDeleteError) {
                                            this.logger.error(`  ❌ Failed to delete conflicting result: ${conflictDeleteError.message}`);
                                        } else {
                                            this.logger.info(`  ✅ Redundant result deleted.`);
                                            cleanupNeeded = true;
                                        }
                                    } else {
                                        this.logger.error(`  ❌ Failed to reassign lifter: ${reassignmentError.message}`);
                                    }
                                } else {
                                    this.logger.info(`  ✅ Result reassigned successfully`);
                                    cleanupNeeded = true;
                                }

                                if (cleanupNeeded) {
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
                                resultVerification.foundDate || result.date,
                                lookupCategory, // Use inferred or original category
                                result.weight_class,
                                result.body_weight_kg,
                                false, // isFallbackCheck
                                result.total,
                                result.best_snatch,
                                result.best_cj,
                                null, // browser
                                this.config.force // forceUpdate
                            );

                            if (tier1Result) {
                                success = true;
                                session.completed++;
                                this.logger.info(`✅ Tier 1 success (after Identity Verification) for ${result.lifter_name}`);
                            } else {
                                // We verified identity but failed to scrape metadata (no total or not in rankings)
                                success = true;
                                session.completedWithoutMetadata++;
                                this.logger.info(`ℹ️ Identity verified, but metadata enrichment skipped (no total or not in rankings) for ${result.lifter_name}`);
                            }
                            break;
                        }
                    }
                }

                if (!success && lifters.length > 0) {
                    this.logger.info(`⚠️ Tier 2 failed/skipped. Attempting Tier 1 Discovery for ${lifters.length} candidates...`);

                    // Use the result's category or infer from gender if possible (defaulting to Open if desperate)
                    let discoveryCategory = result.age_category;
                    if ((!discoveryCategory || discoveryCategory === 'Unknown') && result.gender) {
                        discoveryCategory = (result.gender === 'M') ? "Open Men's" : "Open Women's";
                    }

                    const potentialIds = lifters.map(l => l.lifter_id);
                    const tier1Result = await runBase64UrlLookupProtocol(
                        result.lifter_name,
                        potentialIds,
                        result.meet_id,
                        result.date,
                        discoveryCategory,
                        result.weight_class,
                        result.body_weight_kg,
                        false,
                        result.total,
                        result.best_snatch,
                        result.best_cj,
                        null,
                        this.config.force
                    );

                    if (tier1Result) {
                        success = true;
                        session.completed++;
                        this.logger.info(`✅ Tier 1 Discovery Success: Disambiguated/Verified via Rankings Search`);
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

        // Base select with necessary joins
        const selectString = `
            result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, body_weight_kg, competition_age, wso, club_name, total, best_snatch, best_cj, date,
            usaw_lifters (membership_number, internal_id),
            usaw_meets (Level)
        `;

        // TARGET SELECTION
        const targetWso = this.config.missingWso;
        const targetClub = this.config.missingClub;
        const targetAge = this.config.missingAge;
        const targetGender = this.config.missingGender;
        const targetRank = this.config.missingRank;
        const targetMembership = this.config.missingMembership;
        const targetInternalId = this.config.missingInternalId;

        const isExplicitTargeting = targetWso || targetClub || targetAge || targetGender || targetRank || targetMembership || targetInternalId;

        // We will build a list of "Query Generators" to run in parallel and merge
        // This avoids the complex "OR across tables" limitation in PostgREST
        const queriesToRun = [];

        const baseFilter = (q) => {
            q = q.select(selectString).not('meet_id', 'is', null);

            // Zero Total Filter
            if (!this.config.force || this.config.excludeZeroTotal) {
                q = q.filter('total', 'gt', '0');
            }

            // Standard Filters
            if (this.config.meetIds) q = q.in('meet_id', this.config.meetIds);
            if (this.config.athleteNames && this.config.athleteNames.length > 0) {
                const queries = [];
                this.config.athleteNames.forEach(name => {
                    const doubleSpaced = name.replace(/ /g, '  ');
                    if (name !== doubleSpaced) {
                        queries.push(`lifter_name.ilike.${name}`);
                        queries.push(`lifter_name.ilike.${doubleSpaced}`);
                    } else {
                        queries.push(`lifter_name.ilike.${name}`);
                    }
                });
                if (queries.length > 0) {
                    q = q.or(queries.join(','));
                }
            }
            if (this.config.genderFilter) q = q.eq('gender', this.config.genderFilter);
            if (this.config.startDate) q = q.gte('date', this.config.startDate);
            if (this.config.endDate) q = q.lte('date', this.config.endDate);
            if (this.config.maxResults) q = q.limit(this.config.maxResults);

            return q;
        };

        // 1. FORCE MODE WITH SCOPE
        // If --force is used AND we have specific targets (meet or athlete), 
        // we want to process ALL results matching the scope, regardless of whether they have missing data.
        const isForcedScope = this.config.force && (this.config.meetIds || this.config.athleteName);

        if (isForcedScope) {
            this.logger.info('💪 Force Mode with Scope detected: Bypassing "missing data" checks.');
            let q = this.supabase.from('usaw_meet_results');
            q = baseFilter(q);

            // We still need to select the right columns to make the processing logic work
            q = q.select(`
                result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, body_weight_kg, competition_age, wso, club_name, total, best_snatch, best_cj, date,
                usaw_lifters (membership_number, internal_id),
                usaw_meets (Level)
            `);

            queriesToRun.push({ name: 'Forced Scope Query', query: q });

        } else {
            // STANDARD MODE (Existing Logic)

            // 1. LOCAL MISSING COLUMNS QUERY
            // Include if ANY local target is set OR if we are in Default Mode
            const runLocalQuery = !isExplicitTargeting || (targetWso || targetClub || targetAge || targetGender || targetRank);

            if (runLocalQuery) {
                let q = this.supabase.from('usaw_meet_results');
                q = baseFilter(q);

                const filterParts = [];
                if (!isExplicitTargeting) {
                    // DEFAULT SET (Local)
                    this.logger.info('🎯 No specific targets set. Using Default Set: WSO, Age, Gender, Membership, Internal ID');
                    filterParts.push('wso.is.null');
                    filterParts.push('wso.eq.');
                    filterParts.push('competition_age.is.null');
                    filterParts.push('gender.is.null');
                } else {
                    // EXPLICIT LOCAL
                    if (targetWso) {
                        filterParts.push('wso.is.null');
                        filterParts.push('wso.eq.');
                    }
                    if (targetClub) filterParts.push('club_name.is.null');
                    if (targetAge) filterParts.push('competition_age.is.null');
                    if (targetGender) filterParts.push('gender.is.null');
                    if (targetRank) filterParts.push('national_rank.is.null');
                }

                if (filterParts.length > 0) {
                    q = q.or(filterParts.join(','));
                    queriesToRun.push({ name: 'Local Missing', query: q });
                }
            }

            // 2. REMOTE MISSING QUERY: MEMBERSHIP
            // Explicit or Default
            if (!isExplicitTargeting || targetMembership) {
                let q = this.supabase.from('usaw_meet_results');
                q = baseFilter(q);

                q = q.select(`
                    result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, body_weight_kg, competition_age, wso, club_name, total, best_snatch, best_cj, date,
                    usaw_lifters!inner(membership_number, internal_id),
                    usaw_meets(Level)
                `);

                q = q.filter('usaw_lifters.membership_number', 'is', 'null');
                queriesToRun.push({ name: 'Missing Membership', query: q });
            }

            // 3. REMOTE MISSING QUERY: INTERNAL ID
            // Explicit or Default
            if (!isExplicitTargeting || targetInternalId) {
                let q = this.supabase.from('usaw_meet_results');
                q = baseFilter(q);

                q = q.select(`
                    result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, body_weight_kg, competition_age, wso, club_name, total, best_snatch, best_cj, date,
                    usaw_lifters!inner(membership_number, internal_id),
                    usaw_meets(Level)
                `);

                q = q.filter('usaw_lifters.internal_id', 'is', 'null');
                queriesToRun.push({ name: 'Missing Internal ID', query: q });
            }
        }

        // EXECUTE ALL QUERIES
        this.logger.info(`🚀 Executing ${queriesToRun.length} parallel queries...`);
        const resultsArray = await Promise.all(queriesToRun.map(async (item) => {
            const { data, error } = await item.query;
            if (error) {
                this.logger.error(`Query '${item.name}' failed: ${error.message}`);
                return [];
            }
            return data || [];
        }));

        // MERGE AND DEDUPLICATE
        const distinctMap = new Map();
        resultsArray.flat().forEach(r => {
            if (!distinctMap.has(r.result_id)) {
                distinctMap.set(r.result_id, r);
            }
        });

        let finalData = Array.from(distinctMap.values());

        // Filter out skip list (unless forced)
        if (!this.config.force) {
            finalData = finalData.filter(r => !this.skipList.has(r.result_id));
        }

        this.logger.info(`✅ Found ${finalData.length} unique results needing processing.`);
        return finalData;
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
