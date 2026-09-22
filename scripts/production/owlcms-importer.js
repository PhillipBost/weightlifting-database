/**
 * OWLCMS Competition Ingestion Engine
 * 
 * Ingests OWLCMS JSON Version 2 (CompetitionDataV2) export files into Supabase:
 *   1. owlcms_meets        - Meet metadata, venue, config, raw payload
 *   2. owlcms_lifters      - Athlete biographical profiles (UTF-8 preserved, homonym-safe)
 *   3. owlcms_meet_results - Single platform appearance per row, signed attempts,
 *                            timestamps, and participations JSONB.
 *   4. owlcms_meet_teams   - Per-competition team/delegation entries (code, name, kind).
 *
 * Geography/organizer/scope capture (2026-09-21):
 *   - competition.competitionSite is VENUE free-text and is stored in
 *     owlcms_meets.venue. It is never treated as a country (the owlcms format
 *     has no host-country field).
 *   - Organizer identity is resolved SEARCH-ONLY against the federation
 *     registry; unmatched organizers (typically clubs) are recorded as
 *     evidence and never auto-inserted (no registry pre-seeding).
 *   - competition_scope is derived conservatively from the sanctioning
 *     federation's registry level; team/record evidence is stored as
 *     corroboration only and never upgrades the scope.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');

const gzipAsync = promisify(zlib.gzip);
const { resolveOrDiscoverFederation, searchFederations } = require('./federation-resolver.js');

/**
 * Initialize default Supabase client from environment
 */
function getSupabaseClient() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment');
    }
    return createClient(url, key);
}

/**
 * Format date values from owlcms JSON (handles [YYYY, M, D] arrays and ISO strings)
 * Returns 'YYYY-MM-DD' or null
 */
function normalizeDate(rawDate) {
    if (!rawDate) return null;
    
    if (Array.isArray(rawDate)) {
        if (rawDate.length >= 3) {
            const y = rawDate[0];
            const m = String(rawDate[1]).padStart(2, '0');
            const d = String(rawDate[2]).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        return null;
    }
    
    if (typeof rawDate === 'string') {
        const trimmed = rawDate.trim();
        // Check if matches YYYY-MM-DD
        const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (match) {
            const y = match[1];
            const m = String(match[2]).padStart(2, '0');
            const d = String(match[3]).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        // Try Date parse
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
        }
    }
    
    return null;
}

/**
 * Format ISO timestamps for TIMESTAMPTZ columns
 */
function normalizeTimestamp(rawTime) {
    if (!rawTime || typeof rawTime !== 'string') return null;
    const trimmed = rawTime.trim();
    if (!trimmed) return null;
    
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

/**
 * Normalize signed attempt numbers (+ = make, - = miss, null/0 = pass)
 */
function normalizeAttempt(val) {
    if (val === null || val === undefined) return null;
    const num = Number(val);
    if (isNaN(num) || num === 0) return null;
    return num;
}

/**
 * Parse numeric metric or return null
 */
function normalizeNumber(val) {
    if (val === null || val === undefined) return null;
    const num = Number(val);
    if (isNaN(num)) return null;
    return num;
}

/**
 * Asynchronously compress buffer/string using gzip (level 6)
 */
async function compressPayload(input) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8');
    return gzipAsync(buf, { level: 6 });
}

/**
 * Compute SHA-256 hex digest of buffer or string
 */
function calculateSha256(input) {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8');
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Sanitize filename for Supabase Storage archive
 * Strips existing .json, .gz extensions, normalizes characters, appends .json.gz
 */
function sanitizeArchiveFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
        return `export_${Date.now()}.json.gz`;
    }
    let base = path.basename(fileName);
    base = base.replace(/\.gz$/i, '');
    base = base.replace(/\.json$/i, '');
    const sanitized = base.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/_+/g, '_');
    return `${sanitized || 'export'}.json.gz`;
}

// ---------------------------------------------------------------------------
// Geography / organizer / competition-scope inference helpers (2026-09-21)
// ---------------------------------------------------------------------------

/**
 * Map a sanctioning federation's registry level to a competition scope.
 * Club and unresolved levels intentionally map to 'unknown':
 * a club organizer or club team names never prove a local event (USAW
 * national events use club names as team names).
 */
const SCOPE_BY_SANCTION_LEVEL = {
    international: 'international',
    continental: 'continental',
    national: 'national',
    regional_state_wso: 'regional'
};

/**
 * Classify a team label from the owlcms export.
 * Only an unambiguous 3-letter uppercase code is classified 'delegation'.
 * Club vs province/state CANNOT be distinguished from source data, so those
 * stay 'unknown' for the uploader to confirm.
 */
function classifyTeamKind(name) {
    return (typeof name === 'string' && /^[A-Z]{3}$/.test(name.trim())) ? 'delegation' : 'unknown';
}

/**
 * Extract per-meet team/delegation entries.
 * JSONv2 exports carry a top-level teams[] array ({id, name}); legacy full
 * database exports carry display strings on athlete.team instead.
 * Deduplicated in memory by (code, name).
 */
function extractMeetTeams(data, athletes) {
    const teams = [];
    const seen = new Set();
    const add = (code, name, raw) => {
        const key = `${code || ''}|${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        teams.push({ team_code: code, team_name: name, team_kind: classifyTeamKind(name), raw: raw || null });
    };
    if (Array.isArray(data.teams)) {
        for (const t of data.teams) {
            if (t && t.name !== undefined && String(t.name).trim() !== '') {
                add(t.id !== undefined ? String(t.id) : null, String(t.name).trim(), t);
            }
        }
    } else {
        for (const a of athletes) {
            if (a && a.team !== undefined && a.team !== null && String(a.team).trim() !== '') {
                add(null, String(a.team).trim(), null);
            }
        }
    }
    return teams;
}

/**
 * Deduplicated reference-record evidence.
 * records[] rows are per (age group x bodyweight category x lift) inside a
 * record set; repeated rows are NOT independent confirmations, so evidence is
 * deduplicated by (recordFederation, recordName).
 */
function extractRecordEvidence(data) {
    const sets = [];
    const seen = new Set();
    if (Array.isArray(data.records)) {
        for (const r of data.records) {
            if (!r) continue;
            const fed = (r.recordFederation !== undefined && r.recordFederation !== null) ? String(r.recordFederation) : null;
            const label = (r.recordName !== undefined && r.recordName !== null) ? String(r.recordName) : null;
            if (!fed && !label) continue;
            const key = `${fed || ''}|${label || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            sets.push({ record_federation: fed, record_name: label });
        }
    }
    return {
        raw_record_rows: Array.isArray(data.records) ? data.records.length : 0,
        deduplicated_record_sets: sets,
        distinct_record_federations: [...new Set(sets.map(s => s.record_federation).filter(Boolean))]
    };
}

/**
 * Derive a conservative competition-scope suggestion with full evidence.
 * Basis is the resolved sanctioning federation's registry level ONLY;
 * team/record evidence is recorded as corroboration and never upgrades scope.
 */
function inferCompetitionScope(federationMeta, recordEvidence, meetTeams) {
    const sanctionLevel = (federationMeta && federationMeta.level) ? federationMeta.level : null;
    const delegationTeams = meetTeams.filter(t => t.team_kind === 'delegation').map(t => t.team_name);
    return {
        suggested_scope: SCOPE_BY_SANCTION_LEVEL[sanctionLevel] || 'unknown',
        basis: sanctionLevel ? 'sanction_federation_level' : 'unresolved_sanction_federation',
        sanction_federation_level: sanctionLevel,
        record_evidence: recordEvidence,
        team_evidence: {
            team_count: meetTeams.length,
            delegation_code_teams: delegationTeams,
            delegation_code_count: delegationTeams.length,
            club_or_subdivision_teams_unknown: meetTeams.filter(t => t.team_kind === 'unknown').length
        },
        caveats: [
            'Club team names never prove a local event (USAW national events use club names as team names).',
            'Reference record rows are deduplicated by (recordFederation, recordName); repeated rows are not independent confirmations.',
            'Team and record evidence is corroboration only and never upgrades the suggested scope.'
        ]
    };
}

/**
 * Summarize ranked search_federations candidates for evidence records.
 */
function summarizeCandidates(matches) {
    return (matches || []).map(m => ({
        id: m.id,
        canonical_name: m.canonical_name,
        matched_name: m.matched_name,
        matched_acronym: m.matched_acronym,
        level: m.level,
        country_code: m.country_code,
        is_verified: m.is_verified,
        is_temporally_exact: m.is_temporally_exact,
        match_rank: m.match_rank
    }));
}

/**
 * Classify ranked candidates into a lookup status.
 * Statuses: no_match | unique | ambiguous
 * 'unique' with top rank >= 90 is exact-tier (adoptable); 75-89 is substring-tier.
 */
function classifyCandidates(candidates) {
    if (!candidates || candidates.length === 0 || candidates[0].match_rank < 75) {
        return 'no_match';
    }
    if (candidates.length > 1 && candidates[1].match_rank === candidates[0].match_rank) {
        return 'ambiguous';
    }
    return 'unique';
}

/**
 * Validate that payload is an OWLCMS Version 2 export
 */
function validateOwlcmsV2Payload(data) {
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Payload must be a valid JSON object' };
    }
    
    const version = data.formatVersion || data.version;
    const versionStr = String(version);
    if (!versionStr.startsWith('2')) {
        return { 
            valid: false, 
            error: `Unsupported OWLCMS format version: '${version}'. Expected Version 2.x (CompetitionDataV2).` 
        };
    }
    
    if (!data.competition && !data.athletes && !data.competitors) {
        return { 
            valid: false, 
            error: 'Invalid payload: missing competition and athlete data structures.' 
        };
    }
    
    return { valid: true };
}

/**
 * Main ingestion function
 * 
 * @param {Object} data - Parsed OWLCMS v2 JSON
 * @param {Object} options - Ingestion options
 * @param {string} [options.sourceFileName] - Name of uploaded file
 * @param {boolean} [options.dryRun=false] - If true, validates and parses without writing to DB
 * @param {Object} [options.client] - Optional Supabase client instance
 * @returns {Promise<Object>} Ingestion summary
 */
async function importOwlcmsJson(data, options = {}) {
    const {
        sourceFileName = 'upload.json',
        dryRun = false,
        client = null,
        rawBuffer = null,
        uploaderSelections = null
    } = options;
    
    // 1. Validation
    const validation = validateOwlcmsV2Payload(data);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    
    const supabase = dryRun ? null : (client || getSupabaseClient());
    
    // Compute archive hashes and gzip compression buffer
    const rawJsonBuffer = rawBuffer || Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf-8');
    const rawPayloadHash = calculateSha256(rawJsonBuffer);
    const compressedBuffer = await compressPayload(rawJsonBuffer);
    const rawStorageHash = calculateSha256(compressedBuffer);
    const rawStorageBytes = compressedBuffer.length;
    const sanitizedFileName = sanitizeArchiveFileName(sourceFileName);
    
    const comp = data.competition || {};
    const athletes = data.athletes || data.competitors || [];
    const teams = Array.isArray(data.teams) ? data.teams : [];
    
    // Build team lookup map (id -> name)
    const teamMap = new Map();
    for (const t of teams) {
        if (t && t.id !== undefined && t.name) {
            teamMap.set(String(t.id), t.name);
            teamMap.set(Number(t.id), t.name);
        }
    }
    
    // 2. Extract Meet Metadata
    const meetName = (comp.competitionName || comp.name || data.competitionName || 'OWLCMS Competition').trim();
    const startDate = normalizeDate(comp.competitionDate || comp.localizedCompetitionDate || data.startDate);
    const endDate = normalizeDate(comp.competitionEndDate || comp.competitionDate || data.endDate);
    const city = comp.competitionCity || data.city || null;

    // competitionSite is the venue free-text (verified across all available
    // exports: school names, street addresses, or a city name). It must NEVER
    // be treated as a country. The owlcms format has no host-country field;
    // comp.country / data.country are the only legitimate sources and are
    // absent in every observed export.
    const venue = comp.competitionSite || null;
    const hostCountryRaw = comp.country || data.country || null;
    const country = hostCountryRaw;
    const organizer = comp.competitionOrganizer || comp.federation || data.organizer || null;
    const formatVersion = String(data.formatVersion || data.version || '2.0');

    // Reference-record and team evidence (deduplicated; see helper docs)
    const recordEvidence = extractRecordEvidence(data);
    const meetTeams = extractMeetTeams(data, athletes);

    // Resolve canonical sanctioning federation via Living Federation Registry.
    // Skipped in dry-run mode: resolution can auto-discover registry rows and a
    // dry-run must remain strictly read-only.
    const rawFed = comp.federation || organizer;
    let federationId = null;
    let federationMeta = null;
    if (rawFed && !dryRun) {
        try {
            federationMeta = await resolveOrDiscoverFederation(rawFed, { countryCode: country, asOfDate: startDate });
            if (federationMeta) {
                federationId = federationMeta.id;
            }
        } catch (fedErr) {
            console.warn(`[owlcms_importer] Federation resolution warning: ${fedErr.message}`);
        }
    }

    // Organizer candidate resolution — SEARCH ONLY. Boundary rule: never
    // pre-seed or synthesize federation_registry records; unmatched organizers
    // (typically clubs) are recorded as evidence, never inserted.
    let organizerCandidate = {
        status: dryRun && organizer ? 'skipped_dry_run' : (organizer ? 'no_match' : 'missing_in_source'),
        raw: organizer,
        candidates: [],
        adopted_id: null
    };
    if (organizer && !dryRun) {
        try {
            const candidates = summarizeCandidates(await searchFederations(organizer, startDate));
            const status = classifyCandidates(candidates);
            organizerCandidate = {
                status,
                raw: organizer,
                candidates,
                // Adopt only exact-tier matches (rank >= 90: exact canonical
                // name, short code, or temporally-exact localized name)
                adopted_id: (status === 'unique' && candidates[0].match_rank >= 90) ? candidates[0].id : null
            };
        } catch (orgErr) {
            console.warn(`[owlcms_importer] Organizer lookup warning: ${orgErr.message}`);
            organizerCandidate = { status: 'lookup_failed', raw: organizer, candidates: [], adopted_id: null };
        }
    }

    // Host-country candidate resolution — SEARCH ONLY (future-proofing; every
    // observed export lacks the source field). Adopted only when the match is
    // exact-tier AND national-level; the adopted value is the candidate's
    // registry country code, never a raw string.
    let hostCountry = {
        status: dryRun && hostCountryRaw ? 'skipped_dry_run' : (hostCountryRaw ? 'no_match' : 'missing_in_source'),
        raw: hostCountryRaw,
        candidates: [],
        adopted_code: null
    };
    if (hostCountryRaw && !dryRun) {
        try {
            const candidates = summarizeCandidates(await searchFederations(hostCountryRaw, startDate));
            const status = classifyCandidates(candidates);
            hostCountry = {
                status,
                raw: hostCountryRaw,
                candidates,
                adopted_code: (status === 'unique' && candidates[0].match_rank >= 95 && candidates[0].level === 'national' && candidates[0].country_code)
                    ? candidates[0].country_code
                    : null
            };
        } catch (countryErr) {
            console.warn(`[owlcms_importer] Host country lookup warning: ${countryErr.message}`);
            hostCountry = { status: 'lookup_failed', raw: hostCountryRaw, candidates: [], adopted_code: null };
        }
    }

    // Conservative competition-scope suggestion + full evidence
    const scopeEvidence = inferCompetitionScope(federationMeta, recordEvidence, meetTeams);
    
    const meetRow = {
        meet_name: meetName,
        start_date: startDate,
        end_date: endDate,
        city: city,
        // genuine host-country text only; venue free-text no longer lands here
        country: country,
        venue: venue,
        host_country_code: hostCountry.adopted_code,
        organizer: organizer,
        organizer_federation_id: organizerCandidate.adopted_id,
        federation_id: federationId,
        competition_scope: scopeEvidence.suggested_scope,
        scope_evidence: scopeEvidence,
        geography_inference: {
            as_of_date: startDate,
            venue_raw: venue,
            competition_city_raw: city,
            host_country: hostCountry,
            sanction_federation: {
                raw: rawFed,
                resolved_id: federationId,
                canonical_name: federationMeta ? federationMeta.canonicalName : null,
                level: federationMeta ? federationMeta.level : null,
                match_rank: federationMeta ? federationMeta.matchRank : null
            },
            organizer: organizerCandidate,
            scope: scopeEvidence
        },
        // Only ever set from explicit uploader input; never inferred
        uploader_selections: uploaderSelections || null,
        format_version: formatVersion,
        source_file_name: sourceFileName,
        raw_payload: data // Preserves complete meet config, ageGroups, championships, records, officials
    };
    
    if (dryRun) {
        return {
            success: true,
            dryRun: true,
            meet: {
                meet_name: meetName,
                start_date: startDate,
                end_date: endDate,
                city,
                country,
                venue,
                host_country_code: hostCountry.adopted_code,
                organizer,
                organizer_federation_id: organizerCandidate.adopted_id,
                federation_id: federationId,
                federation: federationMeta,
                competition_scope: scopeEvidence.suggested_scope,
                scope_evidence: scopeEvidence,
                source_file_name: sourceFileName,
                raw_storage_path: `meets/{meet_id}/${sanitizedFileName}`,
                raw_storage_bytes: rawStorageBytes,
                raw_storage_hash: rawStorageHash,
                raw_payload_hash: rawPayloadHash
            },
            meet_teams: meetTeams,
            athletes_found: athletes.length,
            message: `Validation passed. Dry-run completed: ${athletes.length} athlete records parsed.`
        };
    }
    
    // 3. Insert Meet into public.owlcms_meets
    const { data: insertedMeet, error: meetError } = await supabase
        .from('owlcms_meets')
        .insert(meetRow)
        .select('meet_id')
        .single();
        
    if (meetError) {
        throw new Error(`Failed to insert meet record: ${meetError.message}`);
    }
    
    const meetId = insertedMeet.meet_id;
    const storagePath = `meets/${meetId}/${sanitizedFileName}`;
    console.log(`[OWLCMS_IMPORTER] Created meet_id ${meetId}: "${meetName}"`);

    // 3b. Capture per-competition team/delegation representation
    //     (non-fatal: a failure here never blocks result ingestion)
    if (meetTeams.length > 0) {
        try {
            const teamRows = meetTeams.map(t => ({
                meet_id: meetId,
                team_code: t.team_code,
                team_name: t.team_name,
                team_kind: t.team_kind,
                raw: t.raw
            }));
            const { error: teamInsertError } = await supabase
                .from('owlcms_meet_teams')
                .insert(teamRows);
            if (teamInsertError) {
                console.warn(`[OWLCMS_IMPORTER] Meet team capture non-fatal error: ${teamInsertError.message}`);
            } else {
                console.log(`[OWLCMS_IMPORTER] Captured ${teamRows.length} meet team entries.`);
            }
        } catch (teamErr) {
            console.warn(`[OWLCMS_IMPORTER] Meet team capture non-fatal error: ${teamErr.message}`);
        }
    }

    // 4. Archive compressed payload to Hetzner Supabase Storage container
    try {
        const { error: uploadError } = await supabase.storage
            .from('owlcms-archives')
            .upload(storagePath, compressedBuffer, {
                contentType: 'application/gzip',
                upsert: true
            });

        if (uploadError) {
            console.warn(`[OWLCMS_IMPORTER] Storage upload warning: ${uploadError.message}`);
        } else {
            console.log(`[OWLCMS_IMPORTER] Archived compressed file: ${storagePath} (${rawStorageBytes} bytes)`);
        }

        // Update meet record with storage metadata
        const { error: updateError } = await supabase
            .from('owlcms_meets')
            .update({
                raw_storage_path: storagePath,
                raw_storage_bytes: rawStorageBytes,
                raw_storage_hash: rawStorageHash,
                raw_payload_hash: rawPayloadHash
            })
            .eq('meet_id', meetId);

        if (updateError) {
            console.warn(`[OWLCMS_IMPORTER] Failed to update storage metadata: ${updateError.message}`);
        }
    } catch (archiveErr) {
        console.warn(`[OWLCMS_IMPORTER] Archival process non-fatal error: ${archiveErr.message}`);
    }
    
    // 4. Process Lifters & Results
    const lifterIdsByAthleteKey = new Map();
    let liftersCreated = 0;
    let liftersReused = 0;
    
    // Ingest each athlete profile into owlcms_lifters
    for (let i = 0; i < athletes.length; i++) {
        const ath = athletes[i];
        
        const firstName = ath.firstName ? ath.firstName.trim() : '';
        const lastName = ath.lastName ? ath.lastName.trim() : '';
        const athleteName = `${firstName} ${lastName}`.trim() || 'Unknown Athlete';
        
        const gender = ath.gender ? ath.gender.trim().toUpperCase() : null;
        const exactBirthDate = normalizeDate(ath.isoBirthDate || ath.fullBirthDate || ath.birthDate);
        let birthYear = null;
        if (exactBirthDate) {
            birthYear = parseInt(exactBirthDate.split('-')[0], 10);
        } else if (ath.yearOfBirth || ath.birthYear) {
            birthYear = parseInt(ath.yearOfBirth || ath.birthYear, 10);
        }
        
        // Resolve club / team
        let clubName = ath.club || null;
        if (!clubName && ath.team !== undefined && teamMap.has(ath.team)) {
            clubName = teamMap.get(ath.team);
        }
        
        // Country / federation code
        let countryCode = ath.federationCodes ? ath.federationCodes.trim() : null;
        if (!countryCode && ath.country) countryCode = ath.country.trim();
        
        // Membership number
        const membership = (ath.membership || ath.membershipNumber || '').toString().trim() || null;
        
        // Athlete matching key:
        // If membership is present, check existing lifters with (membership_number + athlete_name)
        // Otherwise, insert new lifter to prevent homonym collision
        let existingLifterId = null;
        
        if (membership) {
            const { data: matchedLifter, error: matchError } = await supabase
                .from('owlcms_lifters')
                .select('lifter_id')
                .eq('membership_number', membership)
                .eq('athlete_name', athleteName)
                .limit(1)
                .maybeSingle();
                
            if (!matchError && matchedLifter) {
                existingLifterId = matchedLifter.lifter_id;
            }
        }
        
        let lifterId;
        if (existingLifterId) {
            lifterId = existingLifterId;
            liftersReused++;
        } else {
            const lifterRow = {
                athlete_name: athleteName,
                first_name: firstName || null,
                last_name: lastName || null,
                gender: gender,
                birth_year: birthYear,
                exact_birth_date: exactBirthDate,
                country_code: countryCode,
                club_name: clubName,
                membership_number: membership,
                raw_payload: ath
            };
            
            const { data: newLifter, error: lifterInsertError } = await supabase
                .from('owlcms_lifters')
                .insert(lifterRow)
                .select('lifter_id')
                .single();
                
            if (lifterInsertError) {
                throw new Error(`Failed to insert lifter "${athleteName}": ${lifterInsertError.message}`);
            }
            lifterId = newLifter.lifter_id;
            liftersCreated++;
        }
        
        // Map athlete index/key to lifterId
        const athleteKey = ath.key || ath.id || i;
        lifterIdsByAthleteKey.set(athleteKey, lifterId);
    }
    
    // 5. Ingest Platform Results (1 physical session = 1 row)
    const resultsToInsert = [];
    
    for (let i = 0; i < athletes.length; i++) {
        const ath = athletes[i];
        const athleteKey = ath.key || ath.id || i;
        const lifterId = lifterIdsByAthleteKey.get(athleteKey);
        
        const category = (ath.categoryCode || 'OPEN').trim();
        const bodyWeight = normalizeNumber(ath.bodyWeight ?? ath.presumedBodyWeight);
        const scaleWeight = normalizeNumber(ath.scaleWeight);
        
        const snatch1 = normalizeAttempt(ath.snatch1ActualLift);
        const snatch2 = normalizeAttempt(ath.snatch2ActualLift);
        const snatch3 = normalizeAttempt(ath.snatch3ActualLift);
        const bestSnatch = normalizeNumber(ath.bestSnatch);
        
        const snatch1Time = normalizeTimestamp(ath.snatch1LiftTime);
        const snatch2Time = normalizeTimestamp(ath.snatch2LiftTime);
        const snatch3Time = normalizeTimestamp(ath.snatch3LiftTime);
        
        const cj1 = normalizeAttempt(ath.cleanJerk1ActualLift);
        const cj2 = normalizeAttempt(ath.cleanJerk2ActualLift);
        const cj3 = normalizeAttempt(ath.cleanJerk3ActualLift);
        const bestCj = normalizeNumber(ath.bestCleanJerk);
        
        const cj1Time = normalizeTimestamp(ath.cleanJerk1LiftTime);
        const cj2Time = normalizeTimestamp(ath.cleanJerk2LiftTime);
        const cj3Time = normalizeTimestamp(ath.cleanJerk3LiftTime);
        
        const total = normalizeNumber(ath.total);
        const sinclair = normalizeNumber(ath.sinclair);
        const robi = normalizeNumber(ath.robi);
        const gamx = normalizeNumber(ath.gamx);
        
        const eligible = ath.eligibleForIndividualRanking !== false;
        const rankingStatusReason = ath.rankingStatusReason || null;
        
        // Participations JSONB array preserves all multi-championship leaderboards
        const participations = Array.isArray(ath.participations) ? ath.participations : [];
        
        resultsToInsert.push({
            meet_id: meetId,
            lifter_id: lifterId,
            gender: ath.gender ? ath.gender.trim().toUpperCase() : null,
            birth_year: ath.birthYear || (ath.isoBirthDate ? parseInt(ath.isoBirthDate.split('-')[0], 10) : null),
            competition_age: (startDate && (ath.birthYear || ath.isoBirthDate)) 
                ? (parseInt(startDate.split('-')[0], 10) - (ath.birthYear || parseInt(ath.isoBirthDate.split('-')[0], 10))) 
                : null,
            body_weight_kg: bodyWeight,
            scale_weight_kg: scaleWeight,
            category: category,
            session_name: ath.sessionName || null,
            lot_number: ath.lotNumber ? parseInt(ath.lotNumber, 10) : null,
            start_number: ath.startNumber ? parseInt(ath.startNumber, 10) : null,
            snatch_1: snatch1,
            snatch_2: snatch2,
            snatch_3: snatch3,
            best_snatch: bestSnatch,
            snatch_1_time: snatch1Time,
            snatch_2_time: snatch2Time,
            snatch_3_time: snatch3Time,
            cj_1: cj1,
            cj_2: cj2,
            cj_3: cj3,
            best_cj: bestCj,
            cj_1_time: cj1Time,
            cj_2_time: cj2Time,
            cj_3_time: cj3Time,
            total: total,
            sinclair: sinclair,
            robi: robi,
            gamx: gamx,
            eligible_for_individual_ranking: eligible,
            ranking_status_reason: rankingStatusReason,
            participations: participations,
            raw_payload: ath
        });
    }
    
    // Batch insert results in chunks of 100
    const CHUNK_SIZE = 100;
    let resultsInserted = 0;
    
    for (let c = 0; c < resultsToInsert.length; c += CHUNK_SIZE) {
        const chunk = resultsToInsert.slice(c, c + CHUNK_SIZE);
        const { error: resultInsertError } = await supabase
            .from('owlcms_meet_results')
            .upsert(chunk, { onConflict: 'meet_id,lifter_id,category' });
            
        if (resultInsertError) {
            throw new Error(`Failed to insert meet results batch: ${resultInsertError.message}`);
        }
        resultsInserted += chunk.length;
    }
    
    console.log(`[OWLCMS_IMPORTER] Finished import for meet_id ${meetId}: ${resultsInserted} results saved.`);
    
    return {
        success: true,
        meet_id: meetId,
        meet_name: meetName,
        start_date: startDate,
        end_date: endDate,
        city: city,
        country: country,
        venue: venue,
        host_country_code: hostCountry.adopted_code,
        organizer: organizer,
        organizer_federation_id: organizerCandidate.adopted_id,
        federation_id: federationId,
        competition_scope: scopeEvidence.suggested_scope,
        teams_captured: meetTeams.length,
        source_file_name: sourceFileName,
        raw_storage_path: storagePath,
        raw_storage_bytes: rawStorageBytes,
        raw_storage_hash: rawStorageHash,
        raw_payload_hash: rawPayloadHash,
        lifters_created: liftersCreated,
        lifters_reused: liftersReused,
        total_results_imported: resultsInserted
    };
}

// CLI Execution Handler
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`
Usage: node scripts/production/owlcms-importer.js <path-to-json-file> [--dry-run]
Example:
  node scripts/production/owlcms-importer.js "owlcms data/initial file for tests/PanAmU17+SudAmAll.json" --dry-run
        `);
        process.exit(0);
    }
    
    const filePath = args[0];
    const isDryRun = args.includes('--dry-run') || args.includes('-d');
    
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    
    try {
        const rawContent = fs.readFileSync(filePath, 'utf8');
        const jsonContent = JSON.parse(rawContent);
        
        console.log(`[OWLCMS_IMPORTER] Processing: ${filePath} (Dry-run: ${isDryRun})`);
        importOwlcmsJson(jsonContent, {
            sourceFileName: path.basename(filePath),
            dryRun: isDryRun
        }).then(res => {
            console.log('\n✅ Ingestion Success:');
            console.log(JSON.stringify(res, null, 2));
            process.exit(0);
        }).catch(err => {
            console.error('\n❌ Ingestion Failed:');
            console.error(err.message);
            process.exit(1);
        });
    } catch (e) {
        console.error(`Error parsing JSON: ${e.message}`);
        process.exit(1);
    }
}

module.exports = {
    importOwlcmsJson,
    validateOwlcmsV2Payload,
    normalizeDate,
    normalizeTimestamp,
    normalizeAttempt,
    compressPayload,
    calculateSha256,
    sanitizeArchiveFileName,
    // Geography / organizer / competition-scope helpers (2026-09-21)
    classifyTeamKind,
    extractMeetTeams,
    extractRecordEvidence,
    inferCompetitionScope,
    summarizeCandidates,
    classifyCandidates
};
