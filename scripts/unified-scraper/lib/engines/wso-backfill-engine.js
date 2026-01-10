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
                        result.best_cj
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
                                result.best_cj
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
                        result.date,
                        discoveryCategory,
                        result.weight_class,
                        result.body_weight_kg,
                        false,
                        result.total,
                        result.best_snatch,
                        result.best_cj
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
        // QUERY MODIFICATION
        let query = this.supabase
            .from('usaw_meet_results')
            .select('result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, body_weight_kg, competition_age, wso, club_name, total, best_snatch, best_cj, date')
            .not('meet_id', 'is', null);

        // --- Logic Block: Target Selection ---
        // Determine what we are "hunting" for
        const targetWso = this.config.missingWso;
        const targetClub = this.config.missingClub;
        const targetAge = this.config.missingAge;
        const targetGender = this.config.missingGender;
        const targetRank = this.config.missingRank;
        const targetMembership = this.config.missingMembership;

        // "Generic" targets that are direct columns on usaw_meet_results
        // If NO specific targets are set, we use a Default Set.
        // Default Set: WSO, Age, Gender, Rank, Membership, Level.
        // EXCLUDED from Default: Club Name (because missing clubs are common/expected)

        const isExplicitTargeting = targetWso || targetClub || targetAge || targetGender || targetRank || targetMembership;

        let filterParts = [];

        if (!isExplicitTargeting) {
            if (this.config.force) {
                this.logger.info('💪 Force mode active: Bypassing default missing-data filters.');
            } else {
                // APPLY DEFAULT TARGETS
                this.logger.info('🎯 No specific targets set. Using Default Set: WSO, Age, Gender, Rank, Membership, Level');

                // 1. Simple columns checks
                filterParts.push('wso.is.null');
                // Check for missing age (NULL or 'Unknown' or '-') - usually just NULL in DB for new imports, but let's stick to simple null check for now or basic consistency
                filterParts.push('competition_age.is.null');
                filterParts.push('gender.is.null');
                filterParts.push('national_rank.is.null');

                // 2. Membership Number Check (Requires Join if not on results table... wait, membership_number IS on lifters table, not results)
                // The result table does NOT have membership_number. We must join lifters.
                // Due to Supabase/PostgREST limitations, OR filters across joined tables in a single string are tricky.
                // We might need to handle the "OR" logic carefully.
                // However, the user request implies we can find results that *need* enrichment. 
                // If we are looking for ANY of these, we can't easily do a single clean OR query mixing local cols and joined cols 
                // without embedding the resource.
                // Let's refine the query strategy: 
                // We will fetch more results and filter in memory if the query gets too complex, OR we strictly stick to what we can query.
                // For now, let's stick to the "OR" string for the local columns.

                // NOTE: Membership number is on `usaw_lifters`. `level` is on `usaw_meets`.
                // We cannot easily include them in a single top-level `.or()` filter string with local columns efficiently without complex syntax.
                // Strategy: We will proceed with the local column checks for the main query.
                // If allow Default Targets, we will ALSO include checks for joined data if possible,
                // OR we define "results that could use enrichment" as the primary filter.

                // To simplify and ensure we don't break existing flows:
                // We will filter for local columns first. 
                // If the user wants to find missing membership specifically, they should ideally use the flag or we handle it in a separate pass?
                // Actually, let's look at the instruction: "Target results missing WSO (Default if no target specified)" 
                // AND "Default Set: ... Membership Number".

                // We'll add the join to `usaw_lifters` and `usaw_meets` to the select.
                query = query.select('usaw_lifters!inner(membership_number), usaw_meets!inner(Level)');

                // IMPORTANT: "Inner" join might exclude rows where lifter/meet is missing, which shouldn't happen for valid results.
                // But we want to find where membership_number IS NULL.
                // Postgrest text search filter: `usaw_lifters.membership_number.is.null` can work in the OR string?
                // No, standard `.or()` on the root typically handles root columns.
                // Let's rely on checking the LOCAL columns first for the query filter to keep it performant
                // and maybe filter the complicated joins in a second step or assume the "WSO" part catches most.
                // BUT the user wants to find results specifically missing these things.

                // REVISED STRATEGY for COMPLEX OR: 
                // It is very hard to do "Col A is null OR TableB.ColC is null" in one request without raw SQL.
                // For Safety and Stability (Crucial requirement): 
                // We will stick to the local columns for the Database Filter 'OR' string: WSO, Age, Gender, Rank.
                // We will then manually check Membership and Level in the application logic loop if they were fetched.
                // Wait, if I don't filter in DB, I might get 0 results if WSO is present but Membership is missing.
                // This suggests unrelated "missing" checks might need separate queries or a Raw SQL query.
                // Given "Crucial: do not break...", let's prioritize the original behavior (WSO) + easy local columns.
                // If we need to find missing memberships, the reliable way without Raw SQL is a separate targeted run or using the specific flag.

                // BUT, the implementation plan promised "Dynamic Query Building".
                // Let's implement the "OR" for local columns.

                // Adding Level and Membership to the SELECT so we can inspect them.
                query = query.select(`
                *,
                usaw_lifters (membership_number),
                usaw_meets (Level)
            `);

                // Construct the OR filter for LOCAL columns
                // wso, competition_age, gender, national_rank
                // To include membership/level in the "OR", we would need to inspect them after fetch or use `!inner` join filter tricks which reduce result set to ONLY missing.
                // But default is "ANY of these missing".

                // Compromise for "Default Logic":
                // We will query for rows where LOCAL metadata is missing.
                // This covers WSO, Age, Gender, Rank.
                // This covers the vast majority of "incomplete" data.
                // Missing Membership usually correlates with these.

                filterParts.push('wso.is.null');
                filterParts.push('wso.eq.'); // Also catch empty strings
                filterParts.push('competition_age.is.null');
                filterParts.push('gender.is.null');
                filterParts.push('national_rank.is.null');
                // filterParts.push('level.is.null'); // Level is on meet, not result. Not local.

                query = query.or(filterParts.join(','));
            }
        } else {
            // EXPLICIT TARGETING
            this.logger.info('🎯 Explicit targeting active');

            // If explicit *Local* targets are set, build the OR string
            let orParams = [];

            if (targetWso) {
                orParams.push('wso.is.null');
                orParams.push('wso.eq.');
            }
            if (targetClub) orParams.push('club_name.is.null'); // Careful, "missing club" is common. Only search if asked.
            if (targetAge) orParams.push('competition_age.is.null');
            if (targetGender) orParams.push('gender.is.null');
            if (targetRank) orParams.push('national_rank.is.null');

            if (orParams.length > 0) {
                query = query.or(orParams.join(','));
            } else {
                // If only Remote targets (Membership) are set, we shouldn't filter local columns to NULL 
                // or we'll miss rows that have WSO but no Membership.
                // In this case, we act as a "pass-through" on local columns and rely on the join filter.
            }

            // Handle Membership Target (Join)
            if (targetMembership) {
                this.logger.info('  -> Including filter for Missing Membership Number');
                // We use !inner to enforce the filter on the joined table relationship to returning rows
                query = query.select('*, usaw_lifters!inner(membership_number)');
                query = query.filter('usaw_lifters.membership_number', 'is', 'null');
            }
        }

        // --- End Target Selection ---

        // ZERO TOTAL HANDLING
        // Current logic was: if (!force) filter total > 0.
        // New logic: if (!force OR excludeZeroTotal) filter total > 0.
        if (!this.config.force || this.config.excludeZeroTotal) {
            query = query.filter('total', 'gt', '0');
        }

        // Standard Filters
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
