const fs = require('fs');
const path = require('path');
const {
    runBase64UrlLookupProtocol,
    verifyLifterParticipationInMeet,
    findOrCreateLifter
} = require('../../../production/database-importer-decontamination');

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

                        // NEW: Forensic Career Verification - Collect all evidence from the Duplicate record
                        let evidenceResults = [];
                        if (lifter.membership_number) {
                            const master = await this.identifySameNameMasterInDB(lifter.membership_number, result.lifter_name);
                            if (master && master.lifter_id !== lifter.lifter_id) {
                                // Fetch ALL unique results from this specific lifter ID to verify they are matched on Sport80
                                const { data: evidence } = await this.supabase
                                    .from('usaw_meet_results')
                                    .select('meet_name, date, total')
                                    .eq('lifter_id', lifter.lifter_id);
                                
                                if (evidence && evidence.length > 0) {
                                    evidenceResults = evidence.map(e => ({
                                        Meet: e.meet_name,
                                        Date: e.date,
                                        Total: e.total,
                                        found: false
                                    }));
                                    this.logger.info(`    🔍 [Forensic-Audit] Extracting ${evidenceResults.length} evidence points from ID ${lifter.lifter_id}`);
                                }
                            }
                        }

                        // INDEPENDENT PROFILE VERIFICATION
                        // We visit EACH profile directly to find the TRUTH about its membership number and career.
                        const resultVerification = await verifyLifterParticipationInMeet(
                            null, // browser
                            lifter.internal_id,
                            result.lifter_name,
                            evidenceResults, // PASS ALL EVIDENCE
                            null, // providedBrowser
                            lifter.membership_number
                        );

                        if (resultVerification && resultVerification.verified) {
                            // Extract actual membership number from Sport80 profile
                            const actualMembershipNumber = resultVerification.metadata?.membershipNumber;

                            if (actualMembershipNumber && lifter.membership_number && actualMembershipNumber !== String(lifter.membership_number)) {
                                this.logger.warn(`🔍 [Discovery] ID ${lifter.lifter_id} profile on Sport80 says Membership # is ${actualMembershipNumber} (Current DB: ${lifter.membership_number})`);
                                
                                if (this.config.dryRun) {
                                    this.logger.info(`   [DRY RUN] Would CORRECT Membership # for ID ${lifter.lifter_id} to ${actualMembershipNumber}`);
                                } else {
                                    this.logger.info(`   🛠️ Correcting Membership # for ID ${lifter.lifter_id}...`);
                                    await this.supabase.from('usaw_lifters').update({ 
                                        membership_number: actualMembershipNumber 
                                    }).eq('lifter_id', lifter.lifter_id);
                                }
                                continue; // Link collision solved via discovery
                            }
                            this.logger.info(`✅ Tier 2 verified ${resultVerification.career_verified ? 'FULL FORENSIC CAREER' : 'participation'} for ${result.lifter_name} (Internal ID: ${lifter.internal_id})`);

                            // SURGICAL DECONTAMINATION: With Fidelity Handling
                            const isCollision = resultVerification.decontaminationRequired && resultVerification.lifterId !== lifter.lifter_id;
                            const hasPersonaConflict = resultVerification.persona_conflict;
                            
                            if (isCollision) {
                                if (resultVerification.career_verified && !hasPersonaConflict) {
                                    this.logger.info(`🚨 [Forensic Victory] Career Union Verified on Sport80. Triggering Surgical Merge.`);
                                    await this.surgicallyDecontaminate(resultVerification.lifterId, lifter.lifter_id, result.lifter_name);
                                } else if (hasPersonaConflict) {
                                    this.logger.warn(`🛑 [Persona Conflict] Sport80 profile contains results with the same date/name but DIFFERENT totals.`);
                                    this.logger.warn(`   ID ${lifter.lifter_id} belongs to a different human than Master ID ${resultVerification.lifterId}.`);
                                    
                                    if (this.config.dryRun) {
                                        this.logger.info(`   [DRY RUN] Would REFUTE link: Setting membership_number = NULL for ID ${lifter.lifter_id}`);
                                    } else {
                                        this.logger.info(`   🛠️ Breaking bad link: Removing Membership # from ID ${lifter.lifter_id}...`);
                                        await this.supabase.from('usaw_lifters').update({ membership_number: null }).eq('lifter_id', lifter.lifter_id);
                                    }
                                } else {
                                    this.logger.warn(`⚠️ [Refutation] Split profiles detected. ID ${lifter.lifter_id} results do NOT belong to Master ID ${resultVerification.lifterId} on Sport80.`);
                                    
                                    if (this.config.dryRun) {
                                        this.logger.info(`   [DRY RUN] Would REFUTE link: Setting membership_number = NULL for ID ${lifter.lifter_id}`);
                                    } else {
                                        this.logger.info(`   🛠️ Breaking bad link: Removing Membership # from ID ${lifter.lifter_id}...`);
                                        await this.supabase.from('usaw_lifters').update({ membership_number: null }).eq('lifter_id', lifter.lifter_id);
                                    }
                                }
                            }

                            // METADATA UPDATE: Membership Number
                            if (resultVerification.metadata && resultVerification.metadata.membershipNumber) {
                                const memNum = resultVerification.metadata.membershipNumber;
                                if (this.config.dryRun) {
                                    this.logger.info(`  [DRY RUN] Would save Membership Number: ${memNum}`);
                                } else {
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

        const isForcedScope = this.config.force && (this.config.meetIds || (this.config.athleteNames && this.config.athleteNames.length > 0) || this.config.membershipDuplicates);

        if (isForcedScope) {
            this.logger.info('💪 Force Mode with Scope detected: Bypassing "missing data" checks.');

            if (this.config.membershipDuplicates) {
                this.logger.info('🎯 Membership Duplicates Mode: Identifying athletes with colliding membership numbers...');

                const { data: lifterData, error: lifterError } = await this.supabase
                    .from('usaw_lifters')
                    .select('lifter_id, membership_number')
                    .not('membership_number', 'is', null)
                    .filter('membership_number', 'gt', 0);

                if (lifterError) {
                    this.logger.error(`Failed to fetch lifters for duplication check: ${lifterError.message}`);
                } else {
                    const membershipGroups = {};
                    lifterData.forEach(l => {
                        const mn = l.membership_number;
                        if (!membershipGroups[mn]) membershipGroups[mn] = [];
                        membershipGroups[mn].push(l.lifter_id);
                    });

                    const subordinateIds = [];
                    let duplicateCount = 0;
                    
                    for (const [mn, ids] of Object.entries(membershipGroups)) {
                        if (ids.length > 1) {
                            const groupWithCounts = [];
                            for (const id of ids) {
                                const { count } = await this.supabase
                                    .from('usaw_meet_results')
                                    .select('*', { count: 'exact', head: true })
                                    .eq('lifter_id', id);
                                groupWithCounts.push({ id, results: count || 0 });
                            }
                            
                            groupWithCounts.sort((a, b) => b.results - a.results);
                            const master = groupWithCounts[0];
                            const subordinates = groupWithCounts.slice(1);
                            
                            subordinateIds.push(...subordinates.map(s => s.id));
                            duplicateCount++;
                        }
                    }

                    this.logger.info(`  🔍 Found ${duplicateCount} collision groups. Targeted ${subordinateIds.length} duplicate profiles for immediate cleanup.`);

                    if (subordinateIds.length > 0) {
                        const batchSize = 100;
                        for (let i = 0; i < subordinateIds.length; i += batchSize) {
                            const batch = subordinateIds.slice(i, i + batchSize);
                            let q = this.supabase.from('usaw_meet_results');
                            q = baseFilter(q);
                            q = q.in('lifter_id', batch);
                            queriesToRun.push({ name: `Duplicate Batch ${i/batchSize + 1}`, query: q });
                        }
                    }
                }
            } else {
                let q = this.supabase.from('usaw_meet_results');
                q = baseFilter(q);
                q = q.select(`
                    result_id, lifter_id, lifter_name, meet_id, gender, age_category, weight_class, body_weight_kg, competition_age, wso, club_name, total, best_snatch, best_cj, date,
                    usaw_lifters (membership_number, internal_id),
                    usaw_meets (Level)
                `);
                queriesToRun.push({ name: 'Forced Scope Query', query: q });
            }

        } else {
            const runLocalQuery = !isExplicitTargeting || (targetWso || targetClub || targetAge || targetGender || targetRank);

            if (runLocalQuery) {
                let q = this.supabase.from('usaw_meet_results');
                q = baseFilter(q);

                const filterParts = [];
                if (!isExplicitTargeting) {
                    this.logger.info('🎯 No specific targets set. Using Default Set: WSO, Age, Gender, Membership, Internal ID');
                    filterParts.push('wso.is.null');
                    filterParts.push('wso.eq.');
                    filterParts.push('competition_age.is.null');
                    filterParts.push('gender.is.null');
                } else {
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

        this.logger.info(`🚀 Executing ${queriesToRun.length} parallel queries...`);
        const resultsArray = await Promise.all(queriesToRun.map(async (item) => {
            const { data, error } = await item.query;
            if (error) {
                this.logger.error(`Query '${item.name}' failed: ${error.message}`);
                return [];
            }
            return data || [];
        }));

        const distinctMap = new Map();
        resultsArray.flat().forEach(r => {
            if (!distinctMap.has(r.result_id)) {
                distinctMap.set(r.result_id, r);
            }
        });

        let finalData = Array.from(distinctMap.values());

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
            .select('lifter_id, athlete_name, internal_id, membership_number')
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
        const dir = path.dirname(this.config.unresolvedPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.config.unresolvedPath, JSON.stringify(existing, null, 2));
    }

    async surgicallyDecontaminate(masterId, duplicateId, athleteName) {
        const isDryRun = this.config.dryRun;
        this.logger.info(`🔥 [Forensic] ${isDryRun ? '[DRY RUN] ' : ''}Initiating Surgical Decontamination for ${athleteName}`);
        this.logger.info(`   Master: ${masterId} | Duplicate: ${duplicateId}`);

        this.logger.info(`   Pass 1: Identifying result collisions and harvesting metadata...`);
        
        const { data: masterResults } = await this.supabase
            .from('usaw_meet_results')
            .select('result_id, meet_name, date, total, wso, club_name')
            .eq('lifter_id', masterId);

        const { data: duplicateResults } = await this.supabase
            .from('usaw_meet_results')
            .select('result_id, meet_name, date, total, wso, club_name')
            .eq('lifter_id', duplicateId);

        const collisions = [];
        const metadataHarvest = [];

        if (masterResults && duplicateResults) {
            for (const dr of duplicateResults) {
                const masterMatch = masterResults.find(mr => 
                    mr.meet_name === dr.meet_name && 
                    mr.date === dr.date && 
                    Math.abs(parseFloat(mr.total) - parseFloat(dr.total)) < 0.1
                );

                if (masterMatch) {
                    collisions.push(dr.result_id);
                    const needsWso = !masterMatch.wso && dr.wso;
                    const needsClub = (!masterMatch.club_name || masterMatch.club_name === '-') && (dr.club_name && dr.club_name !== '-');

                    if (needsWso || needsClub) {
                        metadataHarvest.push({
                            targetResultId: masterMatch.result_id,
                            update: {
                                ...(needsWso ? { wso: dr.wso } : {}),
                                ...(needsClub ? { club_name: dr.club_name } : {})
                            }
                        });
                    }
                }
            }
        }

        if (metadataHarvest.length > 0) {
            this.logger.info(`   ✨ Harvesting metadata from ${metadataHarvest.length} duplicate results...`);
            for (const item of metadataHarvest) {
                if (isDryRun) {
                    this.logger.info(`   [DRY RUN] Would update Master Result ${item.targetResultId} with: ${JSON.stringify(item.update)}`);
                } else {
                    await this.supabase.from('usaw_meet_results').update(item.update).eq('result_id', item.targetResultId);
                }
            }
        }

        if (collisions.length > 0) {
            this.logger.warn(`   ⚠️ Found ${collisions.length} colliding results.`);
            if (isDryRun) {
                this.logger.info(`   [DRY RUN] Would delete ${collisions.length} collisions from duplicate record ${duplicateId}.`);
            } else {
                const { error: delError } = await this.supabase
                    .from('usaw_meet_results')
                    .delete()
                    .in('result_id', collisions);
                
                if (delError) {
                    this.logger.error(`   ❌ Failed to delete collisions: ${delError.message}`);
                    return;
                }
                this.logger.info(`   ✅ Deleted redundant results.`);
            }
        }

        this.logger.info(`   Pass 2: Reassigning unique results...`);
        if (isDryRun) {
            this.logger.info(`   [DRY RUN] Would reassign unique results from Duplicate ${duplicateId} to Master ${masterId}.`);
        } else {
            const { error: updateError } = await this.supabase
                .from('usaw_meet_results')
                .update({ lifter_id: masterId })
                .eq('lifter_id', duplicateId);

            if (updateError) {
                this.logger.error(`   ❌ Failed to reassign results: ${updateError.message}`);
                return;
            }
            this.logger.info(`   ✅ Results moved successfully.`);
        }

        this.logger.info(`   Pass 3: Final profile cleanup...`);
        const { count } = await this.supabase
            .from('usaw_meet_results')
            .select('*', { count: 'exact', head: true })
            .eq('lifter_id', duplicateId);

        if (count === 0 || (isDryRun && (count - (duplicateResults.length - collisions.length)) === 0)) {
            if (isDryRun) {
                this.logger.info(`   [DRY RUN] Would erase Duplicate Profile ${duplicateId}.`);
            } else {
                this.logger.info(`   🗑️ Erasing empty Duplicate Profile ${duplicateId}...`);
                const { error: lifterDeleteError } = await this.supabase
                    .from('usaw_lifters')
                    .delete()
                    .eq('lifter_id', duplicateId);
                
                if (lifterDeleteError) {
                    this.logger.warn(`   ⚠️ Cleanup Error: ${lifterDeleteError.message}`);
                } else {
                    this.logger.info(`   ✅ Decontamination Complete: ${athleteName} is now unified.`);
                }
            }
        } else {
            this.logger.warn(`   ⚠️ Protection: Duplicate ${duplicateId} still has results. Logic aborted cleanup.`);
        }
    }

    async identifySameNameMasterInDB(membershipNumber, athleteName) {
        if (!membershipNumber || !athleteName) return null;

        const { data: candidates, error } = await this.supabase
            .from('usaw_lifters')
            .select('lifter_id, athlete_name')
            .eq('membership_number', membershipNumber);

        if (error || !candidates || candidates.length <= 1) return null;

        const sameNameMatches = candidates.filter(c => 
            c.athlete_name.toLowerCase().trim() === athleteName.toLowerCase().trim()
        );

        if (sameNameMatches.length <= 1) return null;

        return sameNameMatches.sort((a, b) => a.lifter_id - b.lifter_id)[0];
    }
}

module.exports = { WsoBackfillEngine };
