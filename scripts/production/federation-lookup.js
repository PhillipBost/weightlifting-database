#!/usr/bin/env node
/**
 * PRODUCTION: Federation Lookup Service (Geographic/Organizer Cascade Support)
 * Date: 2026-09-21
 *
 * Read-only lookup layer backing the editable cascade
 *   Continent -> Country -> Organizer / regional body
 * and the competition-scope inference contract.
 *
 * Endpoints exposed through scripts/production/owlcms-upload-server.js:
 *   GET  /api/federations/options        -> listFederationOptions()
 *   GET  /api/federations/lineage/:id    -> getFederationLineage()
 *   POST /api/federations/resolve        -> resolveCascadeInputs()
 *
 * Security model:
 *   - All functions run server-side with the service role.
 *   - Anonymous/anon-key database access is blocked by Row-Level Security
 *     (RLS) on the federation tables (verified deployed behavior), so
 *     collaborators call these application endpoints only; database and
 *     service-role credentials are never exposed to them.
 *
 * Boundary rules enforced here:
 *   - SEARCH-ONLY resolution. This module never inserts into
 *     federation_registry: no pre-seeding or synthesizing of records.
 *   - Repeated record rows are deduplicated by value before resolution;
 *     they are not independent confirmations.
 *   - Scope suggestions derive from the sanctioning federation's registry
 *     level only; team/record evidence is corroboration and never upgrades
 *     scope. Club team names never prove a local event.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { searchFederations } = require('./federation-resolver.js');

let cachedClient = null;

function getClient() {
    if (cachedClient) return cachedClient;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment');
    }
    cachedClient = createClient(url, key);
    return cachedClient;
}

const ALLOWED_LEVELS = ['international', 'continental', 'national', 'regional_state_wso', 'club'];

/**
 * Summarize ranked search_federations candidates for evidence records.
 * match_rank is a deterministic match-tier score, NOT a calibrated probability:
 * 100 exact temporally-valid localized name/acronym; 95 exact short_code;
 * 90 exact canonical name; 85 exact but outside validity window;
 * 75/70 substring (queries >= 3 chars); 65 legacy known_aliases.
 */
function summarizeCandidates(matches) {
    return (matches || []).map(m => ({
        id: m.id,
        canonical_name: m.canonical_name,
        matched_name: m.matched_name,
        matched_acronym: m.matched_acronym,
        matched_name_type: m.matched_name_type,
        level: m.level,
        country_code: m.country_code,
        is_verified: m.is_verified,
        is_temporally_exact: m.is_temporally_exact,
        match_rank: m.match_rank
    }));
}

/**
 * Classify ranked candidates into a lookup status:
 *   no_match  - no candidates, or top rank below 75
 *   ambiguous - two or more candidates tied at the top rank (>= 75)
 *   unique    - single top candidate (>= 75); confidence_tier:
 *               'exact' when top rank >= 90, 'substring' when 75-89
 */
function classifyCandidates(candidates) {
    if (!candidates || candidates.length === 0 || candidates[0].match_rank < 75) {
        return { status: 'no_match', confidence_tier: null };
    }
    if (candidates.length > 1 && candidates[1].match_rank === candidates[0].match_rank) {
        return { status: 'ambiguous', confidence_tier: null };
    }
    return {
        status: 'unique',
        confidence_tier: candidates[0].match_rank >= 90 ? 'exact' : 'substring'
    };
}

// (listFederationOptions follows below.)

/**
 * List cascade options, with explicit parent constraint and PIT filtering.
 *
 * @param {Object} params
 *   level       - 'international' | 'continental' | 'national' | 'regional_state_wso' | 'club' (optional)
 *   parent_id   - UUID; restricts to direct children via registry.parent_federation_id (optional)
 *   q           - search text; >= 3 chars enables substring, shorter requires exact match (optional)
 *   as_of_date  - 'YYYY-MM-DD'; filters display names to those valid on the date (optional)
 *   limit       - page size, 1-200, default 50
 *   offset      - page offset, default 0
 * @returns { total_count, limit, offset, has_more, items[] }
 *   items[] carry PIT-active display_names so historical names resolve by date.
 *   Empty result is a legitimate outcome (no options), NOT an error.
 */
async function listFederationOptions(params = {}) {
    const {
        level = null,
        parent_id = null,
        q = null,
        as_of_date = null,
        limit = 50,
        offset = 0
    } = params;

    if (level && !ALLOWED_LEVELS.includes(level)) {
        throw new Error(`Invalid level '${level}'. Allowed: ${ALLOWED_LEVELS.join(', ')}`);
    }

    const client = getClient();

    let query = client
        .from('federation_registry')
        .select('id, canonical_name, short_code, country_code, level, parent_federation_id, is_verified, known_aliases')
        .order('canonical_name', { ascending: true })
        .limit(1000);
    if (level) query = query.eq('level', level);
    if (parent_id) query = query.eq('parent_federation_id', parent_id);

    const { data: registryRows, error } = await query;
    if (error) throw new Error(`Registry lookup failed: ${error.message}`);

    // Point-in-Time active display names
    const locByFed = {};
    const ids = (registryRows || []).map(r => r.id);
    if (ids.length > 0) {
        const { data: locs, error: locError } = await client
            .from('federation_localizations')
            .select('federation_id, language_code, full_name, acronym, name_type, valid_from, valid_until')
            .in('federation_id', ids)
            .limit(4000);
        if (locError) throw new Error(`Localization lookup failed: ${locError.message}`);
        for (const loc of (locs || [])) {
            if (as_of_date) {
                if (loc.valid_from && loc.valid_from > as_of_date) continue;
                if (loc.valid_until && loc.valid_until < as_of_date) continue;
            }
            (locByFed[loc.federation_id] = locByFed[loc.federation_id] || []).push({
                language_code: loc.language_code,
                full_name: loc.full_name,
                acronym: loc.acronym,
                name_type: loc.name_type
            });
        }
    }

    let items = (registryRows || []).map(r => Object.assign({}, r, { display_names: locByFed[r.id] || [] }));

    // Optional text filter: exact match at any length; substring only for >= 3 chars
    if (q && String(q).trim() !== '') {
        const clean = String(q).trim();
        const lower = clean.toLowerCase();
        const allowSubstring = clean.length >= 3;
        items = items.filter(r => {
            const haystack = [r.canonical_name, r.short_code, ...((r.known_aliases) || [])];
            for (const d of (r.display_names || [])) {
                haystack.push(d.full_name);
                if (d.acronym) haystack.push(d.acronym);
            }
            return haystack.some(h => {
                if (!h) return false;
                const hl = String(h).toLowerCase();
                return hl === lower || (allowSubstring && hl.includes(lower));
            });
        });
    }

    const total = items.length;
    const lim = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));
    const off = Math.max(0, parseInt(offset, 10) || 0);

    return {
        total_count: total,
        limit: lim,
        offset: off,
        has_more: off + lim < total,
        items: items.slice(off, off + lim)
    };
}

// (Lineage and cascade resolution functions follow below.)

/**
 * Complete parent chain (lineage) for a federation, over affiliation edges,
 * with Point-in-Time filtering of edge effective windows.
 *
 * Multi-parent graphs are supported: every active parent edge is followed
 * (e.g., a national body with both an international and a continental edge),
 * with a depth cap of 6 and a cycle guard.
 *
 * @param {string} id - federation UUID
 * @param {string|null} asOfDate - 'YYYY-MM-DD' or null (edges with NULL
 *        effective windows always qualify; dated edges must cover the date)
 * @returns { status, entity, as_of_date, hops[], roots[] }
 *   status 'no_match' when the id does not exist (caller maps to HTTP 404)
 */
async function getFederationLineage(id, asOfDate = null) {
    if (!id) throw new Error('Federation id is required');
    const client = getClient();

    const { data: self, error: selfError } = await client
        .from('federation_registry')
        .select('id, canonical_name, short_code, level, country_code, is_verified')
        .eq('id', id)
        .maybeSingle();
    if (selfError) throw new Error(`Registry lookup failed: ${selfError.message}`);
    if (!self) {
        return { status: 'no_match' };
    }

    const MAX_DEPTH = 6;
    const hops = [];
    const visited = new Set([id]);
    let frontier = [{ id, depth: 0 }];

    while (frontier.length > 0) {
        const next = [];
        for (const node of frontier) {
            const { data: edges, error: edgeError } = await client
                .from('federation_affiliations')
                .select('parent_id, relationship_type, is_active, effective_start, effective_end, is_verified, citation')
                .eq('child_id', node.id)
                .eq('is_active', true);
            if (edgeError) throw new Error(`Affiliation lookup failed: ${edgeError.message}`);

            for (const edge of (edges || [])) {
                if (asOfDate) {
                    if (edge.effective_start && edge.effective_start > asOfDate) continue;
                    if (edge.effective_end && edge.effective_end < asOfDate) continue;
                }
                if (visited.has(edge.parent_id)) continue;
                visited.add(edge.parent_id);

                const { data: parent } = await client
                    .from('federation_registry')
                    .select('id, canonical_name, short_code, level, country_code, is_verified')
                    .eq('id', edge.parent_id)
                    .maybeSingle();

                hops.push({
                    depth: node.depth + 1,
                    via_child_id: node.id,
                    parent: parent || { id: edge.parent_id },
                    relationship_type: edge.relationship_type,
                    is_verified: edge.is_verified,
                    citation: edge.citation,
                    effective_start: edge.effective_start,
                    effective_end: edge.effective_end
                });

                if (node.depth + 1 < MAX_DEPTH) {
                    next.push({ id: edge.parent_id, depth: node.depth + 1 });
                }
            }
        }
        frontier = next;
    }

    // Roots = hops whose parent never appears as a via_child further up
    const roots = hops.filter(h =>
        h.parent && !hops.some(o => o.via_child_id === h.parent.id)
    );

    return { status: 'ok', entity: self, as_of_date: asOfDate, hops, roots };
}

// (resolveCascadeInputs follows below.)

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
 * Batch resolution for cascade inference: resolves organizer, sanctioning
 * federation, host country, deduplicated record federations, and team names
 * against the registry, with explicit per-field statuses and full evidence.
 *
 * SEARCH-ONLY: no registry rows are ever created here.
 *
 * @param {Object} payload
 *   organizer_text     - competition.competitionOrganizer raw text (optional)
 *   federation_text    - competition.federation raw text (optional)
 *   host_country_text  - raw host country text, if any source provides one (optional)
 *   record_federations - array of raw records[].recordFederation values;
 *                        duplicated BEFORE resolution (repeated rows are not
 *                        independent confirmations)
 *   team_names         - array of team names/codes from the export (optional)
 *   competition_date   - 'YYYY-MM-DD' for Point-in-Time matching (recommended)
 * @returns per-field { status: no_match|unique|ambiguous|missing_in_source,
 *                      confidence_tier, candidates[] } plus a conservative
 *          suggested_scope derived from the sanctioning federation level only.
 */
async function resolveCascadeInputs(payload = {}) {
    const {
        organizer_text = null,
        federation_text = null,
        host_country_text = null,
        record_federations = [],
        team_names = [],
        competition_date = null
    } = payload;

    const asOf = competition_date || null;

    const resolveText = async (text) => {
        if (!text || !String(text).trim()) {
            return { status: 'missing_in_source', confidence_tier: null, candidates: [] };
        }
        let matches;
        try {
            matches = await searchFederations(String(text).trim(), asOf);
        } catch (err) {
            throw new Error(`Lookup failed for "${String(text).trim()}": ${err.message}`);
        }
        const candidates = summarizeCandidates(matches);
        const classification = classifyCandidates(candidates);
        return {
            status: classification.status,
            confidence_tier: classification.confidence_tier,
            candidates
        };
    };

    const organizer = await resolveText(organizer_text);
    const federation = await resolveText(federation_text);
    const host_country = await resolveText(host_country_text);

    // Deduplicate record federation codes by value before resolution
    const uniqueRecordFeds = [...new Set(
        (Array.isArray(record_federations) ? record_federations : [])
            .map(v => (v !== null && v !== undefined) ? String(v).trim() : '')
            .filter(Boolean)
    )];
    const recordFederationResolutions = [];
    for (const code of uniqueRecordFeds) {
        recordFederationResolutions.push({
            raw_code: code,
            resolution: await resolveText(code)
        });
    }

    // Team analysis: only an unambiguous 3-letter uppercase code is classified
    // 'delegation'; club vs province/state cannot be distinguished from source
    const teamAnalysis = (Array.isArray(team_names) ? team_names : [])
        .map(n => (n !== null && n !== undefined) ? String(n).trim() : '')
        .filter(Boolean)
        .map(name => ({
            name,
            kind: /^[A-Z]{3}$/.test(name) ? 'delegation' : 'unknown'
        }));
    const delegationCount = teamAnalysis.filter(t => t.kind === 'delegation').length;

    // Conservative scope suggestion from the sanctioning federation level only
    const sanctionLevel = (federation.status === 'unique')
        ? federation.candidates[0].level
        : null;
    const suggested_scope = SCOPE_BY_SANCTION_LEVEL[sanctionLevel] || 'unknown';

    return {
        as_of_date: asOf,
        organizer,
        federation,
        host_country,
        record_federations: {
            deduplicated_codes: uniqueRecordFeds,
            resolutions: recordFederationResolutions
        },
        teams: {
            analysis: teamAnalysis,
            delegation_code_count: delegationCount,
            note: 'Club vs province/state team names cannot be distinguished from source data; club names never prove a local event (USAW national events use club names as team names).'
        },
        suggested_scope,
        scope_basis: sanctionLevel ? 'sanction_federation_level' : 'unresolved_sanction_federation',
        caveats: [
            'match_rank is a deterministic match-tier score, not a calibrated probability.',
            'Re-scope or filtering decisions must not exclude organizers based on team/record evidence alone.'
        ]
    };
}

module.exports = {
    listFederationOptions,
    getFederationLineage,
    resolveCascadeInputs
};



