/**
 * PRODUCTION: Symmetrical Athlete Evaluator Engine (v3.0 Strict + Shared-Meet Physics)
 *
 * Provides core matching, scoring, demographic gating, shared-meet attempt physics
 * verification, and enqueueing logic across all federations adhering strictly to ARCHITECTURE.md:
 *   1. Universal Demographic Anchor: Strict (gender, birth_year) auto-link gate, with bounded
 *      review-only fallback (+/-2 years or NULL birth year) for exact substantive name matches.
 *   2. Clean Substantive Tokenization: Diacritic/non-NFD Latin folding, deduplicated token sets,
 *      stopword/particle filtering, Mc-prefix merging, and Levenshtein/transposition typo detection.
 *   3. Strict Auto-Link Policy: Exact substantive name sets (order-independent), manual whitelists,
 *      or shared-meet 6-attempt signed physics only. Extra/missing middle names, typos, country
 *      divergence without <=15kg total corroboration, >25kg historical total divergence, and
 *      single-surname matches are never auto-linked.
 *   4. Full Historical Total Deltas: Minimum delta across all historical meet totals.
 *   5. Pairwise Graph Integrity: check_alias_type = 2.
 */

const {
    MANUAL_ATHLETE_MAP,
    BLACKLIST_ATHLETE_MAP,
    IWF_DUPLICATE_MAP,
    MANUAL_MEET_MAP,
    OWLCMS_MANUAL_MAP,
    OWLCMS_BLACKLIST_MAP
} = require('../../shared/athlete-mappings.js');

const CORE_FEDERATION_UUIDS = {
    USAW: '558e6d2b-e5a9-4503-a9f0-2ea2336d70c9',
    IWF: '754a4b29-bdea-4754-8b00-01a7a46bc58d',
    OWLCMS: 'd3eeeb41-1eb5-43e9-89cc-80eba58c2bf5'
};

const ALGORITHM_VERSION = 'v3.0-strict-physics-symmetrical';

/**
 * Common name particles and generational suffixes excluded from substantive overlap counts
 * so unrelated athletes sharing "de la" or "jr" cannot accumulate multi-token overlap.
 */
const NON_IDENTIFYING_TOKENS = new Set([
    'de', 'la', 'da', 'do', 'di', 'du', 'del', 'los', 'las', 'dos', 'das',
    'van', 'von', 'der', 'den', 'el', 'al', 'bin', 'binti',
    'jr', 'sr', 'ii', 'iii', 'iv'
]);

/**
 * Normalize a human name string: transliterate non-NFD Latin letters, strip diacritics,
 * split separator punctuation, merge spaced "mc <surname>" prefixes, and strip noise.
 */
function normalizeRawName(name) {
    if (!name || typeof name !== 'string') return '';
    return name
        .toLowerCase()
        .replace(/ł/g, 'l')
        .replace(/ø/g, 'o')
        .replace(/đ/g, 'd')
        .replace(/ð/g, 'd')
        .replace(/þ/g, 'th')
        .replace(/ß/g, 'ss')
        .replace(/æ/g, 'ae')
        .replace(/œ/g, 'oe')
        .replace(/ı/g, 'i')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[.\-_/]/g, ' ')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\bmc\s+([a-z]{3,})\b/g, 'mc$1')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Tokenize a human name into normalized lowercase tokens of length >= 2
 * (retains 2-character surnames like Li, Wu, Ma, Ng while dropping 1-letter initials).
 */
function tokenize(name) {
    const norm = normalizeRawName(name);
    if (!norm) return [];
    return norm.split(' ').filter(x => x.length >= 2);
}

/**
 * Return ordered, deduplicated substantive tokens (excluding non-identifying particles/suffixes).
 */
function extractSubstantiveTokens(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return [];
    const seen = new Set();
    const filtered = [];
    for (const t of tokens) {
        if (NON_IDENTIFYING_TOKENS.has(t)) continue;
        if (!seen.has(t)) {
            seen.add(t);
            filtered.push(t);
        }
    }
    if (filtered.length > 0) return filtered;
    return [...new Set(tokens)];
}

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
}

/**
 * Return true if two tokens differ strictly by a single adjacent character transposition
 * (e.g. "denies" vs "deines").
 */
function isAdjacentTransposition(a, b) {
    if (!a || !b || a.length !== b.length || a.length < 4) return false;
    const diffs = [];
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) diffs.push(i);
        if (diffs.length > 2) return false;
    }
    return (
        diffs.length === 2 &&
        diffs[1] === diffs[0] + 1 &&
        a[diffs[0]] === b[diffs[1]] &&
        a[diffs[1]] === b[diffs[0]]
    );
}

/**
 * Return true if two tokens match exactly or within strict typo bounds:
 * - minimum length >= 4
 * - adjacent transposition OR Levenshtein distance <= 1 (length 4-7) / <= 2 (length >= 8)
 */
function isFuzzyTokenMatch(tokA, tokB) {
    if (tokA === tokB) return true;
    const minLen = Math.min(tokA.length, tokB.length);
    const maxLen = Math.max(tokA.length, tokB.length);
    if (minLen < 4) return false;
    if (isAdjacentTransposition(tokA, tokB)) return true;
    const maxDist = maxLen >= 8 ? 2 : 1;
    if (Math.abs(tokA.length - tokB.length) > maxDist) return false;
    return levenshteinDistance(tokA, tokB) <= maxDist;
}

/**
 * Symmetrically analyze name similarity between two athlete names.
 *
 * Tiers:
 *   - EXACT_ORDERED (80): exact substantive token sequence (or identical >=2 raw tokens)
 *   - EXACT_SET_REORDERED (80): identical substantive token set in different order (LAST FIRST vs FIRST LAST)
 *   - TOKEN_SUBSET (70): shorter substantive set (size >= 2) fully contained in longer substantive set
 *   - FUZZY_EXACT_OR_SUBSET (68): all shorter substantive tokens (size >= 2) match distinct longer tokens via exact/fuzzy
 *   - PARTIAL_OVERLAP_NON_SUBSET (50): >= 2 exact substantive overlaps, neither is a subset
 *   - SINGLE_SURNAME_ONLY (35): exactly 1 exact substantive overlap matching the last substantive token of either name
 *   - NONE (0): no qualifying overlap
 */
function analyzeNameMatch(nameA, nameB) {
    const rawA = tokenize(nameA);
    const rawB = tokenize(nameB);
    if (rawA.length === 0 || rawB.length === 0) {
        return {
            tier: 'NONE',
            score: 0,
            exactMatched: 0,
            fuzzyMatched: 0,
            substantiveA: [],
            substantiveB: []
        };
    }

    const subA = extractSubstantiveTokens(rawA);
    const subB = extractSubstantiveTokens(rawB);

    // Handle legitimate doubled identical names (e.g. "Ahmed Ahmed" vs "Ahmed AHMED")
    if (rawA.length >= 2 && rawA.length === rawB.length && rawA.join(' ') === rawB.join(' ')) {
        return {
            tier: 'EXACT_ORDERED',
            score: 80,
            exactMatched: subA.length,
            fuzzyMatched: 0,
            substantiveA: subA,
            substantiveB: subB
        };
    }

    const [shorter, longer] = subA.length <= subB.length ? [subA, subB] : [subB, subA];
    const usedLongerIdx = new Set();
    let exactMatched = 0;
    let fuzzyMatched = 0;
    let minMatchedFuzzyLen = Infinity;
    let lastExactToken = null;
    const unmatchedShorter = [];

    // Pass 1: 1-to-1 exact token matches
    for (const sTok of shorter) {
        const idx = longer.findIndex((lTok, i) => !usedLongerIdx.has(i) && lTok === sTok);
        if (idx !== -1) {
            usedLongerIdx.add(idx);
            exactMatched++;
            lastExactToken = sTok;
        } else {
            unmatchedShorter.push(sTok);
        }
    }

    // Pass 2: 1-to-1 fuzzy token matches on remaining tokens (minimum edit distance)
    for (const sTok of unmatchedShorter) {
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < longer.length; i++) {
            if (usedLongerIdx.has(i)) continue;
            const lTok = longer[i];
            if (isFuzzyTokenMatch(sTok, lTok)) {
                const d = isAdjacentTransposition(sTok, lTok) ? 1 : levenshteinDistance(sTok, lTok);
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                }
            }
        }
        if (bestIdx !== -1) {
            usedLongerIdx.add(bestIdx);
            fuzzyMatched++;
            minMatchedFuzzyLen = Math.min(minMatchedFuzzyLen, Math.min(sTok.length, longer[bestIdx].length));
        }
    }

    if (shorter.length >= 2 && exactMatched === shorter.length) {
        if (subA.length === subB.length) {
            const ordered = subA.join(' ') === subB.join(' ');
            return {
                tier: ordered ? 'EXACT_ORDERED' : 'EXACT_SET_REORDERED',
                score: 80,
                exactMatched,
                fuzzyMatched: 0,
                substantiveA: subA,
                substantiveB: subB
            };
        }
        return {
            tier: 'TOKEN_SUBSET',
            score: 70,
            exactMatched,
            fuzzyMatched: 0,
            substantiveA: subA,
            substantiveB: subB
        };
    }

    if (
        shorter.length >= 2 &&
        exactMatched + fuzzyMatched === shorter.length &&
        fuzzyMatched >= 1 &&
        (exactMatched >= 1 || minMatchedFuzzyLen >= 5)
    ) {
        return {
            tier: 'FUZZY_EXACT_OR_SUBSET',
            score: 68,
            exactMatched,
            fuzzyMatched,
            substantiveA: subA,
            substantiveB: subB
        };
    }

    if (exactMatched >= 2) {
        return {
            tier: 'PARTIAL_OVERLAP_NON_SUBSET',
            score: 50,
            exactMatched,
            fuzzyMatched,
            substantiveA: subA,
            substantiveB: subB
        };
    }

    if (exactMatched === 1 && lastExactToken) {
        const isLastNameMatch =
            lastExactToken === subA[subA.length - 1] ||
            lastExactToken === subB[subB.length - 1];
        if (isLastNameMatch) {
            return {
                tier: 'SINGLE_SURNAME_ONLY',
                score: 35,
                exactMatched: 1,
                fuzzyMatched,
                substantiveA: subA,
                substantiveB: subB
            };
        }
    }

    return {
        tier: 'NONE',
        score: 0,
        exactMatched,
        fuzzyMatched,
        substantiveA: subA,
        substantiveB: subB
    };
}

/**
 * Parse numeric lift or total value (non-negative totals/bests).
 */
function parseLift(val) {
    if (val === null || val === undefined || val === '' || val === '---') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
}

/**
 * Parse a signed individual lift attempt (+ = make, - = miss, null/0/'---' = pass/no attempt).
 */
function parseAttempt(val) {
    if (val === null || val === undefined || val === '' || val === '---' || val === '0') return null;
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return null;
    return num;
}

/**
 * Extract normalized 3-letter country code from lifter record.
 */
function extractCountryCode(lifter) {
    if (!lifter) return null;
    if (lifter.country_code && lifter.country_code.trim().length === 3) {
        return lifter.country_code.trim().toUpperCase();
    }
    if (lifter.country && lifter.country.trim().length === 3) {
        return lifter.country.trim().toUpperCase();
    }
    const club = (lifter.club_name || '').trim().toUpperCase();
    if (club.length === 3) return club;
    const canadianProvinces = [
        'ONTARIO', 'QUÉBEC', 'QUEBEC', 'ALBERTA', 'BRITISH COLUMBIA',
        'SASKATCHEWAN', 'MANITOBA', 'NOVA SCOTIA', 'NEW BRUNSWICK', 'NEWFOUNDLAND', 'PEI'
    ];
    if (canadianProvinces.includes(club)) return 'CAN';
    if (club === 'USA' || club.includes('USA')) return 'USA';
    return null;
}

/**
 * Enforce token-count asymmetry guard: when one name has >= 2 more tokens than the other,
 * cap the score at capScore (default 79) so it routes to manual review instead of auto-linking.
 * Retained with stable signature for all cross-federation linker scripts.
 */
function applyTokenAsymmetryGuard(score, tokensA, tokensB, capScore = 79) {
    const diff = Math.abs(tokensA.length - tokensB.length);
    if (tokensA.length > 0 && tokensB.length > 0 && diff >= 2) {
        return {
            score: Math.min(score, capScore),
            asymmetric: true,
            reason: `Token-count asymmetry (${tokensA.length} vs ${tokensB.length} tokens; diff ${diff} >= 2): capped at ${capScore}% for manual review`
        };
    }
    return { score, asymmetric: false, reason: null };
}

/**
 * Calculate token overlap score between two athlete names.
 */
function calculateNameScore(nameA, nameB) {
    return analyzeNameMatch(nameA, nameB).score;
}

/**
 * Check if candidate pairing is manually blacklisted in shared mappings.
 */
function isPairBlacklisted(sourceFedCode, sourceId, targetFedCode, targetId) {
    const sId = parseInt(sourceId, 10);
    const tId = parseInt(targetId, 10);
    if (isNaN(sId) || isNaN(tId)) return false;

    // IWF <-> USAW (keyed by IWF db_lifter_id -> [usaw_lifter_ids])
    if (sourceFedCode === 'IWF' && targetFedCode === 'USAW') {
        if (BLACKLIST_ATHLETE_MAP[sId]?.includes(tId)) return true;
    }
    if (sourceFedCode === 'USAW' && targetFedCode === 'IWF') {
        if (BLACKLIST_ATHLETE_MAP[tId]?.includes(sId)) return true;
    }

    // OWLCMS <-> USAW and OWLCMS <-> IWF (keyed by OWLCMS lifter_id -> [rejected_ids])
    if (sourceFedCode === 'OWLCMS' && (targetFedCode === 'USAW' || targetFedCode === 'IWF')) {
        if (OWLCMS_BLACKLIST_MAP[sId]?.includes(tId)) return true;
    }
    if ((sourceFedCode === 'USAW' || sourceFedCode === 'IWF') && targetFedCode === 'OWLCMS') {
        if (OWLCMS_BLACKLIST_MAP[tId]?.includes(sId)) return true;
    }

    return false;
}

/**
 * Check if candidate pairing is manually whitelisted in shared mappings.
 */
function isPairWhitelisted(sourceFedCode, sourceId, targetFedCode, targetId) {
    const sId = parseInt(sourceId, 10);
    const tId = parseInt(targetId, 10);
    if (isNaN(sId) || isNaN(tId)) return false;

    // IWF <-> USAW (keyed by IWF db_lifter_id -> usaw_lifter_id)
    if (sourceFedCode === 'IWF' && targetFedCode === 'USAW') {
        if (MANUAL_ATHLETE_MAP[sId] === tId) return true;
    }
    if (sourceFedCode === 'USAW' && targetFedCode === 'IWF') {
        if (MANUAL_ATHLETE_MAP[tId] === sId) return true;
    }

    // OWLCMS <-> USAW / IWF (keyed by OWLCMS lifter_id -> { type: 'IWF' | 'USAW', id: number })
    if (sourceFedCode === 'OWLCMS' && (targetFedCode === 'USAW' || targetFedCode === 'IWF')) {
        const entry = OWLCMS_MANUAL_MAP[sId];
        if (entry && entry.type === targetFedCode && parseInt(entry.id, 10) === tId) return true;
    }
    if ((sourceFedCode === 'USAW' || sourceFedCode === 'IWF') && targetFedCode === 'OWLCMS') {
        const entry = OWLCMS_MANUAL_MAP[tId];
        if (entry && entry.type === sourceFedCode && parseInt(entry.id, 10) === sId) return true;
    }

    // IWF <-> IWF duplicate map (keyed by primary IWF db_lifter_id -> [duplicate_ids])
    if (sourceFedCode === 'IWF' && targetFedCode === 'IWF') {
        if (IWF_DUPLICATE_MAP[sId]?.includes(tId)) return true;
        if (IWF_DUPLICATE_MAP[tId]?.includes(sId)) return true;
    }

    return false;
}

/**
 * Return any manually whitelisted target athlete IDs for a given source athlete and target federation.
 * Allows the queue worker to resolve whitelists directly even if names changed or birth years differ.
 */
function getWhitelistedTargetIds(sourceFedCode, sourceId, targetFedCode) {
    const sId = parseInt(sourceId, 10);
    if (isNaN(sId)) return [];
    const results = new Set();

    if (sourceFedCode === 'IWF' && targetFedCode === 'USAW') {
        if (MANUAL_ATHLETE_MAP[sId] !== undefined) results.add(parseInt(MANUAL_ATHLETE_MAP[sId], 10));
    } else if (sourceFedCode === 'USAW' && targetFedCode === 'IWF') {
        for (const [iwfId, usawId] of Object.entries(MANUAL_ATHLETE_MAP)) {
            if (parseInt(usawId, 10) === sId) results.add(parseInt(iwfId, 10));
        }
    } else if (sourceFedCode === 'OWLCMS' && (targetFedCode === 'USAW' || targetFedCode === 'IWF')) {
        const entry = OWLCMS_MANUAL_MAP[sId];
        if (entry && entry.type === targetFedCode && entry.id !== undefined) {
            results.add(parseInt(entry.id, 10));
        }
    } else if ((sourceFedCode === 'USAW' || sourceFedCode === 'IWF') && targetFedCode === 'OWLCMS') {
        for (const [owlcmsId, entry] of Object.entries(OWLCMS_MANUAL_MAP)) {
            if (entry && entry.type === sourceFedCode && parseInt(entry.id, 10) === sId) {
                results.add(parseInt(owlcmsId, 10));
            }
        }
    } else if (sourceFedCode === 'IWF' && targetFedCode === 'IWF') {
        if (Array.isArray(IWF_DUPLICATE_MAP[sId])) {
            for (const dupId of IWF_DUPLICATE_MAP[sId]) results.add(parseInt(dupId, 10));
        }
        for (const [primaryId, dupIds] of Object.entries(IWF_DUPLICATE_MAP)) {
            if (Array.isArray(dupIds) && dupIds.includes(sId)) {
                results.add(parseInt(primaryId, 10));
            }
        }
    }

    return Array.from(results).filter(id => !isNaN(id));
}

/**
 * Extract all positive numeric historical totals from an athlete profile.
 */
function extractTotalsList(profile) {
    const totals = [];
    if (Array.isArray(profile?.historical_totals)) {
        for (const v of profile.historical_totals) {
            const n = parseLift(v);
            if (n !== null && n > 0) totals.push(n);
        }
    }
    if (Array.isArray(profile?.results)) {
        for (const r of profile.results) {
            const n = parseLift(r?.total);
            if (n !== null && n > 0) totals.push(n);
        }
    }
    if (totals.length === 0) {
        const single = parseLift(profile?.best_total ?? profile?.total);
        if (single !== null && single > 0) totals.push(single);
    }
    return totals;
}

/**
 * Compute minimum kilogram difference across all positive historical meet totals on both sides.
 */
function computeMinTotalDelta(source, target) {
    const sTotals = extractTotalsList(source);
    const tTotals = extractTotalsList(target);
    if (sTotals.length === 0 || tTotals.length === 0) return null;
    let minDelta = Infinity;
    for (const st of sTotals) {
        for (const tt of tTotals) {
            const d = Math.abs(st - tt);
            if (d < minDelta) minDelta = d;
        }
    }
    return Number.isFinite(minDelta) ? minDelta : null;
}

/**
 * Evaluate identity match between source athlete and target candidate under v3.0 Strict Policy.
 *
 * @param {Object} source Source athlete profile
 * @param {Object} target Target candidate profile
 * @param {string} sourceFedCode e.g. 'IWF', 'USAW', 'OWLCMS'
 * @param {string} targetFedCode e.g. 'IWF', 'USAW', 'OWLCMS'
 * @param {Object} [options] Optional evaluation flags ({ allowBirthYearFallback: boolean })
 * @returns {Object} Evaluation verdict, score, matchTier, evidence breakdown
 */
function evaluateCandidateMatch(source, target, sourceFedCode, targetFedCode, options = {}) {
    const allowBirthYearFallback = Boolean(options.allowBirthYearFallback);

    // 0. Manual Blacklist Check
    if (isPairBlacklisted(sourceFedCode, source.id, targetFedCode, target.id)) {
        return {
            status: 'NO_MATCH',
            score: 0,
            verdict: 'BLACKLISTED',
            matchTier: 'BLACKLISTED',
            breakdown: ['Candidate explicitly blacklisted in shared mappings']
        };
    }

    // 0. Manual Whitelist Check
    if (isPairWhitelisted(sourceFedCode, source.id, targetFedCode, target.id)) {
        return {
            status: 'MATCHED',
            score: 100,
            verdict: 'MANUAL_WHITELIST',
            matchTier: 'MANUAL_WHITELIST',
            breakdown: ['Candidate explicitly whitelisted in shared mappings']
        };
    }

    // 1. Universal Demographic Anchor: Strict Gender Gate
    const sGender = source.gender ? source.gender.trim().toUpperCase() : null;
    const tGender = target.gender ? target.gender.trim().toUpperCase() : null;
    if (sGender && tGender && sGender !== tGender) {
        return {
            status: 'NO_MATCH',
            score: 0,
            verdict: 'GENDER_MISMATCH',
            matchTier: 'NONE',
            breakdown: [`Gender divergence: ${sGender} vs ${tGender}`]
        };
    }
    if (allowBirthYearFallback && (!sGender || !tGender)) {
        return {
            status: 'NO_MATCH',
            score: 0,
            verdict: 'MISSING_GENDER',
            matchTier: 'NONE',
            breakdown: ['Missing gender for birth-year fallback review']
        };
    }

    // 2. Birth Year Gate (Exact required for auto-link; +/-2 years or NULL permitted in review-only fallback)
    const sYear = source.birth_year ? parseInt(source.birth_year, 10) : null;
    const tYear = target.birth_year ? parseInt(target.birth_year, 10) : null;
    const birthYearExactMatch = Boolean(sYear && tYear && sYear === tYear);
    const birthYearDelta = (sYear && tYear) ? Math.abs(sYear - tYear) : null;

    if (!birthYearExactMatch) {
        if (!allowBirthYearFallback) {
            return {
                status: 'NO_MATCH',
                score: 0,
                verdict: sYear && tYear ? 'BIRTH_YEAR_MISMATCH' : 'MISSING_BIRTH_YEAR',
                matchTier: 'NONE',
                breakdown: [`Birth year divergence: ${sYear ?? 'null'} vs ${tYear ?? 'null'}`]
            };
        }
        if (birthYearDelta !== null && birthYearDelta > 2) {
            return {
                status: 'NO_MATCH',
                score: 0,
                verdict: 'BIRTH_YEAR_MISMATCH',
                matchTier: 'NONE',
                breakdown: [`Birth year divergence (${birthYearDelta}y > 2y): ${sYear} vs ${tYear}`]
            };
        }
    }

    // 3. Substantive Name Analysis
    const nameMatch = analyzeNameMatch(source.name, target.name);
    if (nameMatch.tier === 'NONE') {
        return {
            status: 'NO_MATCH',
            score: 0,
            verdict: 'NO_TOKEN_OVERLAP',
            matchTier: 'NONE',
            breakdown: [`Names share 0 qualifying tokens: "${source.name}" vs "${target.name}"`]
        };
    }

    // 4. Country / Federation Code & Historical Total Signals
    const sCountry = extractCountryCode(source) || (sourceFedCode === 'USAW' ? 'USA' : null);
    const tCountry = extractCountryCode(target) || (targetFedCode === 'USAW' ? 'USA' : null);
    const sameCountry = Boolean(sCountry && tCountry && sCountry === tCountry);
    const countryDivergence = Boolean(sCountry && tCountry && sCountry !== tCountry);
    const minTotalDelta = computeMinTotalDelta(source, target);

    const breakdown = [];
    const isExactSubstantiveName =
        nameMatch.tier === 'EXACT_ORDERED' || nameMatch.tier === 'EXACT_SET_REORDERED';

    // 5. Bad or Missing Birth-Year Fallback Mode (Review-Only, Never Auto-Linked)
    if (!birthYearExactMatch) {
        if (!isExactSubstantiveName || countryDivergence) {
            return {
                status: 'NO_MATCH',
                score: 0,
                verdict: 'BIRTH_YEAR_FALLBACK_INSUFFICIENT',
                matchTier: 'NONE',
                breakdown: ['Birth-year fallback requires exact substantive name and non-conflicting country']
            };
        }

        breakdown.push(`Exact Substantive Name (${nameMatch.tier}): +${nameMatch.score}`);
        if (birthYearDelta !== null) {
            breakdown.push(`Birth Year Discrepancy (${sYear} vs ${tYear}, delta ${birthYearDelta}y): review-only fallback`);
        } else {
            breakdown.push(`Missing Birth Year (${sYear ?? 'null'} vs ${tYear ?? 'null'}): review-only fallback`);
        }
        if (sameCountry) breakdown.push(`Country Match (${sCountry}): +15`);
        if (minTotalDelta !== null) {
            breakdown.push(`Historical Total Delta (${minTotalDelta}kg)`);
        }
        const fallbackScore = (birthYearDelta === 1 || (minTotalDelta !== null && minTotalDelta <= 15)) ? 74 : 70;
        breakdown.push(`Strict policy cap (${fallbackScore}%): birth-year fallback routed to manual review`);

        return {
            status: 'REVIEW_NEEDED',
            score: fallbackScore,
            verdict: 'REVIEW_NEEDED',
            matchTier: 'BIRTH_YEAR_FALLBACK',
            breakdown
        };
    }

    // 6. Exact Demographic Match (Gender + Birth Year) — Tier-Specific Strict Scoring
    let score = nameMatch.score;
    breakdown.push(`Name (${nameMatch.tier}): +${nameMatch.score}`);
    score += 20;
    breakdown.push('Birth Year Match: +20');

    if (sameCountry) {
        score += 15;
        breakdown.push(`Country Match (${sCountry}): +15`);
    } else if (countryDivergence) {
        score -= 15;
        breakdown.push(`Country Divergence (${sCountry} vs ${tCountry}): -15`);
    }

    if (minTotalDelta !== null) {
        if (minTotalDelta <= 10) {
            score += 15;
            breakdown.push(`Historical Total Delta (${minTotalDelta}kg): +15`);
        } else if (minTotalDelta <= 25) {
            score += 5;
            breakdown.push(`Historical Total Delta (${minTotalDelta}kg): +5`);
        } else {
            score -= 10;
            breakdown.push(`Historical Total Divergence (${minTotalDelta}kg): -10`);
        }
    }

    // Tier A: Exact Substantive Name Set (Eligible for Strict Auto-Link)
    if (isExactSubstantiveName) {
        let finalScore = Math.min(Math.max(score, 0), 100);
        if (countryDivergence && (minTotalDelta === null || minTotalDelta > 15)) {
            finalScore = Math.min(finalScore, 75);
            breakdown.push('Strict policy cap (75%): country divergence without <=15kg historical total corroboration');
        } else if (minTotalDelta !== null && minTotalDelta > 25) {
            finalScore = Math.min(finalScore, 75);
            breakdown.push('Strict policy cap (75%): historical totals diverge by >25kg across all meets');
        }

        const status = finalScore >= 80 ? 'MATCHED' : (finalScore >= 60 ? 'REVIEW_NEEDED' : 'NO_MATCH');
        return {
            status,
            score: finalScore,
            verdict: status,
            matchTier: nameMatch.tier,
            breakdown
        };
    }

    // Tier B: Proper Token Subset (e.g. IWF "LAST First Middle" vs USAW "First Last") -> Review Only
    if (nameMatch.tier === 'TOKEN_SUBSET') {
        if (countryDivergence && minTotalDelta !== null && minTotalDelta > 25) {
            return {
                status: 'NO_MATCH',
                score: 55,
                verdict: 'NO_MATCH',
                matchTier: nameMatch.tier,
                breakdown: [...breakdown, 'Rejected: token subset with both country divergence and >25kg total divergence']
            };
        }
        const finalScore = Math.min(Math.max(score, 60), 75);
        breakdown.push('Strict policy cap (75%): extra or missing middle/compound name routed to manual review');
        return {
            status: 'REVIEW_NEEDED',
            score: finalScore,
            verdict: 'REVIEW_NEEDED',
            matchTier: nameMatch.tier,
            breakdown
        };
    }

    // Tier C: Fuzzy Typo / Transposition Match -> Review Only
    if (nameMatch.tier === 'FUZZY_EXACT_OR_SUBSET') {
        if (countryDivergence && minTotalDelta !== null && minTotalDelta > 25) {
            return {
                status: 'NO_MATCH',
                score: 55,
                verdict: 'NO_MATCH',
                matchTier: nameMatch.tier,
                breakdown: [...breakdown, 'Rejected: fuzzy typo match with both country divergence and >25kg total divergence']
            };
        }
        const finalScore = Math.min(Math.max(score, 60), 74);
        breakdown.push('Strict policy cap (74%): 1-2 character typo/transposition routed to manual review');
        return {
            status: 'REVIEW_NEEDED',
            score: finalScore,
            verdict: 'REVIEW_NEEDED',
            matchTier: nameMatch.tier,
            breakdown
        };
    }

    // Tier D: Single-Surname-Only Match -> Never Auto-Link; Review Only if Same Country + <=10kg Total Match
    if (nameMatch.tier === 'SINGLE_SURNAME_ONLY') {
        if (sameCountry && minTotalDelta !== null && minTotalDelta <= 10) {
            breakdown.push('Strict policy cap (65%): single-surname match corroborated by same country and <=10kg total');
            return {
                status: 'REVIEW_NEEDED',
                score: 65,
                verdict: 'REVIEW_NEEDED',
                matchTier: nameMatch.tier,
                breakdown
            };
        }
        return {
            status: 'NO_MATCH',
            score: 0,
            verdict: 'SINGLE_SURNAME_INSUFFICIENT',
            matchTier: nameMatch.tier,
            breakdown: [...breakdown, 'Rejected: single-surname match requires same country and <=10kg historical total']
        };
    }

    // Tier E: Non-Subset Partial Overlap (e.g. 2 of 4 tokens overlap) -> Never Auto-Link; Review Only if Same Country + <=15kg
    if (nameMatch.tier === 'PARTIAL_OVERLAP_NON_SUBSET') {
        if (sameCountry && minTotalDelta !== null && minTotalDelta <= 15) {
            breakdown.push('Strict policy cap (62%): non-subset partial overlap corroborated by same country and <=15kg total');
            return {
                status: 'REVIEW_NEEDED',
                score: 62,
                verdict: 'REVIEW_NEEDED',
                matchTier: nameMatch.tier,
                breakdown
            };
        }
        return {
            status: 'NO_MATCH',
            score: 0,
            verdict: 'PARTIAL_OVERLAP_INSUFFICIENT',
            matchTier: nameMatch.tier,
            breakdown: [...breakdown, 'Rejected: non-subset partial overlap requires same country and <=15kg historical total']
        };
    }

    return {
        status: 'NO_MATCH',
        score: 0,
        verdict: 'NO_MATCH',
        matchTier: 'NONE',
        breakdown
    };
}

/**
 * Count distinct substantive tokens that match (exactly or fuzzily) between two names.
 * Used by shared-meet physics verification so married/maiden surname changes (same first name)
 * still qualify when backed by exact 6-attempt competition scorecards.
 */
function countSharedNameTokens(nameA, nameB) {
    const subA = extractSubstantiveTokens(tokenize(nameA));
    const subB = extractSubstantiveTokens(tokenize(nameB));
    if (subA.length === 0 || subB.length === 0) return 0;

    const usedB = new Set();
    let count = 0;
    for (const tokA of subA) {
        const idx = subB.findIndex((tokB, i) => !usedB.has(i) && isFuzzyTokenMatch(tokA, tokB));
        if (idx !== -1) {
            usedB.add(idx);
            count++;
        }
    }
    return count;
}

/**
 * Evaluate shared-meet 6-attempt scorecard physics between an IWF and USAW athlete pair.
 *
 * Requires:
 *   - Non-blacklisted pair
 *   - Strict gender compatibility (if both non-null)
 *   - At least 1 exact or fuzzy substantive name token overlap
 *   - At least one mapped meet pair (via public.meet_aliases / MANUAL_MEET_MAP) with zero
 *     mismatched signed attempts and strong physical confirmation
 *
 * Outcome under Strict Policy:
 *   - Matching birth year -> MATCHED (100)
 *   - One birth year missing (null) + >=2 shared name tokens -> MATCHED (95)
 *   - Conflicting non-null birth years (e.g. bad IWF birth year) -> REVIEW_NEEDED (79)
 */
function evaluateSharedMeetPhysics(source, sourceResults, target, targetResults, mappedMeetLookup, sourceFedCode, targetFedCode) {
    if (!source || !target || !Array.isArray(sourceResults) || !Array.isArray(targetResults)) return null;
    if (sourceResults.length === 0 || targetResults.length === 0) return null;

    if (isPairBlacklisted(sourceFedCode, source.id, targetFedCode, target.id)) {
        return {
            status: 'NO_MATCH',
            score: 0,
            verdict: 'BLACKLISTED',
            matchTier: 'BLACKLISTED',
            breakdown: ['Candidate explicitly blacklisted in shared mappings']
        };
    }

    if (isPairWhitelisted(sourceFedCode, source.id, targetFedCode, target.id)) {
        return {
            status: 'MATCHED',
            score: 100,
            verdict: 'MANUAL_WHITELIST',
            matchTier: 'MANUAL_WHITELIST',
            breakdown: ['Candidate explicitly whitelisted in shared mappings']
        };
    }

    // Strict gender check (profile or result level)
    const sGender = (source.gender || sourceResults.find(r => r.gender)?.gender || '').trim().toUpperCase() || null;
    const tGender = (target.gender || targetResults.find(r => r.gender)?.gender || '').trim().toUpperCase() || null;
    if (sGender && tGender && sGender !== tGender) {
        return null;
    }

    const sharedNameTokens = countSharedNameTokens(source.name, target.name);
    if (sharedNameTokens === 0) {
        return null;
    }
    const nameMatch = analyzeNameMatch(source.name, target.name);

    let bestOutcome = null;

    for (const sRes of sourceResults) {
        const sMeetId = sRes.db_meet_id ?? sRes.meet_id;
        if (sMeetId == null) continue;
        const mappedTargets = mappedMeetLookup.get(Number(sMeetId));
        if (!mappedTargets || mappedTargets.size === 0) continue;

        for (const tRes of targetResults) {
            const tMeetId = tRes.db_meet_id ?? tRes.meet_id;
            if (tMeetId == null || !mappedTargets.has(Number(tMeetId))) continue;

            // Result-level gender check
            const srGender = sRes.gender ? sRes.gender.trim().toUpperCase() : sGender;
            const trGender = tRes.gender ? tRes.gender.trim().toUpperCase() : tGender;
            if (srGender && trGender && srGender !== trGender) continue;

            const slots = [
                [parseAttempt(sRes.snatch_lift_1), parseAttempt(tRes.snatch_lift_1)],
                [parseAttempt(sRes.snatch_lift_2), parseAttempt(tRes.snatch_lift_2)],
                [parseAttempt(sRes.snatch_lift_3), parseAttempt(tRes.snatch_lift_3)],
                [parseAttempt(sRes.cj_lift_1), parseAttempt(tRes.cj_lift_1)],
                [parseAttempt(sRes.cj_lift_2), parseAttempt(tRes.cj_lift_2)],
                [parseAttempt(sRes.cj_lift_3), parseAttempt(tRes.cj_lift_3)]
            ];

            const validSlots = slots.filter(([a, b]) => a !== null && b !== null);
            const matchedAttempts = validSlots.filter(([a, b]) => a === b).length;
            const mismatchedAttempts = validSlots.length - matchedAttempts;

            if (mismatchedAttempts > 0) continue;

            const sTotal = parseLift(sRes.total) || 0;
            const tTotal = parseLift(tRes.total) || 0;
            const sBestSn = parseLift(sRes.best_snatch) || 0;
            const tBestSn = parseLift(tRes.best_snatch) || 0;
            const sBestCj = parseLift(sRes.best_cj) || 0;
            const tBestCj = parseLift(tRes.best_cj) || 0;

            const exactNonZeroTotal = sTotal > 0 && tTotal > 0 && sTotal === tTotal;
            const exactBestSn = sBestSn > 0 && tBestSn > 0 && sBestSn === tBestSn;
            const exactBestCj = sBestCj > 0 && tBestCj > 0 && sBestCj === tBestCj;
            const bothBombedOut = sTotal === 0 && tTotal === 0;

            const attemptConfirmed =
                (matchedAttempts >= 4 && (exactNonZeroTotal || (bothBombedOut && (exactBestSn || exactBestCj)))) ||
                (validSlots.length >= 2 && matchedAttempts === validSlots.length && exactNonZeroTotal && (exactBestSn || exactBestCj)) ||
                (bothBombedOut && matchedAttempts >= 3);

            const summaryOnlyConfirmed =
                validSlots.length === 0 &&
                exactNonZeroTotal &&
                exactBestSn &&
                exactBestCj &&
                (nameMatch.tier === 'EXACT_ORDERED' || nameMatch.tier === 'EXACT_SET_REORDERED' || nameMatch.tier === 'TOKEN_SUBSET');

            if (!attemptConfirmed && !summaryOnlyConfirmed) continue;

            const sYear = parseInt(source.birth_year ?? sRes.birth_year, 10) || null;
            const tYear = parseInt(target.birth_year ?? tRes.birth_year, 10) || null;
            const birthYearMatches = Boolean(sYear && tYear && sYear === tYear);
            const birthYearConflicts = Boolean(sYear && tYear && sYear !== tYear);

            const breakdown = [
                `Shared Meet Physics (${sourceFedCode} meet ${sMeetId} <-> ${targetFedCode} meet ${tMeetId})`,
                attemptConfirmed
                    ? `Signed Attempts: ${matchedAttempts}/${validSlots.length} exact matches (0 mismatches)`
                    : `Scorecard Summary Match (attempt detail absent)`
            ];
            if (exactNonZeroTotal) breakdown.push(`Exact Meet Total (${sTotal}kg)`);
            if (exactBestSn) breakdown.push(`Exact Best Snatch (${sBestSn}kg)`);
            if (exactBestCj) breakdown.push(`Exact Best Clean & Jerk (${sBestCj}kg)`);
            breakdown.push(`Name Token Overlap: ${sharedNameTokens} token(s) (${nameMatch.tier})`);

            let outcome;
            if (birthYearMatches && (attemptConfirmed || (summaryOnlyConfirmed && nameMatch.tier !== 'TOKEN_SUBSET'))) {
                breakdown.push(`Birth Year Match (${sYear})`);
                outcome = {
                    status: 'MATCHED',
                    score: 100,
                    verdict: 'MATCHED',
                    matchTier: 'SHARED_MEET_PHYSICS',
                    breakdown
                };
            } else if (!sYear || !tYear) {
                if (attemptConfirmed && sharedNameTokens >= 2) {
                    breakdown.push(`Missing Birth Year (${sYear ?? 'null'} vs ${tYear ?? 'null'}) overridden by 6-attempt physics + >=2 name tokens`);
                    outcome = {
                        status: 'MATCHED',
                        score: 95,
                        verdict: 'MATCHED',
                        matchTier: 'SHARED_MEET_PHYSICS_NULL_BY',
                        breakdown
                    };
                } else {
                    breakdown.push(`Missing Birth Year (${sYear ?? 'null'} vs ${tYear ?? 'null'}): routed to manual review`);
                    outcome = {
                        status: 'REVIEW_NEEDED',
                        score: 78,
                        verdict: 'REVIEW_NEEDED',
                        matchTier: 'SHARED_MEET_PHYSICS_REVIEW',
                        breakdown
                    };
                }
            } else if (birthYearConflicts) {
                breakdown.push(`Birth Year Discrepancy (${sYear} vs ${tYear}): exact meet physics routed to manual review (79%)`);
                outcome = {
                    status: 'REVIEW_NEEDED',
                    score: 79,
                    verdict: 'REVIEW_NEEDED',
                    matchTier: 'SHARED_MEET_PHYSICS_BY_CONFLICT',
                    breakdown
                };
            } else {
                breakdown.push('Scorecard summary match with subset name: routed to manual review');
                outcome = {
                    status: 'REVIEW_NEEDED',
                    score: 78,
                    verdict: 'REVIEW_NEEDED',
                    matchTier: 'SHARED_MEET_PHYSICS_REVIEW',
                    breakdown
                };
            }

            if (!bestOutcome || outcome.score > bestOutcome.score) {
                bestOutcome = outcome;
            }
        }
    }

    return bestOutcome;
}

/**
 * Enqueue an athlete for evaluation across target federations.
 */
async function enqueueAthleteEvaluations(supabase, sourceFedId, sourceAthleteId, targetFedIds = []) {
    if (!sourceFedId || !sourceAthleteId || targetFedIds.length === 0) return [];

    const payload = targetFedIds
        .filter(tFedId => tFedId !== sourceFedId)
        .map(targetFedId => ({
            source_federation_id: sourceFedId,
            source_athlete_id: sourceAthleteId,
            target_federation_id: targetFedId,
            status: 'PENDING',
            algorithm_version: ALGORITHM_VERSION
        }));

    const { data, error } = await supabase
        .from('athlete_linking_evaluations')
        .upsert(payload, {
            onConflict: 'source_federation_id,source_athlete_id,target_federation_id',
            ignoreDuplicates: true
        })
        .select('evaluation_id, target_federation_id, status');

    if (error) {
        console.error(`[EVALUATOR] Failed to enqueue evaluations for athlete ${sourceAthleteId}:`, error.message);
        return [];
    }

    return data || [];
}

/**
 * Fetch all positive historical meet totals and career best total for an athlete in a federation.
 */
async function fetchHistoricalTotals(supabase, fedCode, athleteId) {
    if (!athleteId) return { totals: [], bestTotal: null };
    const cleanId = parseInt(athleteId, 10);
    if (isNaN(cleanId)) return { totals: [], bestTotal: null };

    let data = null;
    if (fedCode === 'IWF') {
        const res = await supabase.from('iwf_meet_results').select('total').eq('db_lifter_id', cleanId);
        data = res.data;
    } else if (fedCode === 'USAW') {
        const res = await supabase.from('usaw_meet_results').select('total').eq('lifter_id', cleanId);
        data = res.data;
    } else if (fedCode === 'OWLCMS') {
        const res = await supabase.from('owlcms_meet_results').select('total').eq('lifter_id', cleanId);
        data = res.data;
    }

    const totals = (data || []).map(r => parseLift(r.total)).filter(t => t !== null && t > 0);
    const bestTotal = totals.length > 0 ? Math.max(...totals) : null;
    return { totals, bestTotal };
}

/**
 * Fetch career best total for a specific athlete in a given federation (retained for compatibility).
 */
async function fetchCareerBestTotal(supabase, fedCode, athleteId) {
    const { bestTotal } = await fetchHistoricalTotals(supabase, fedCode, athleteId);
    return bestTotal;
}

module.exports = {
    CORE_FEDERATION_UUIDS,
    ALGORITHM_VERSION,
    NON_IDENTIFYING_TOKENS,
    MANUAL_MEET_MAP,
    normalizeRawName,
    tokenize,
    extractSubstantiveTokens,
    levenshteinDistance,
    isAdjacentTransposition,
    isFuzzyTokenMatch,
    analyzeNameMatch,
    parseLift,
    parseAttempt,
    extractCountryCode,
    calculateNameScore,
    applyTokenAsymmetryGuard,
    isPairBlacklisted,
    isPairWhitelisted,
    getWhitelistedTargetIds,
    computeMinTotalDelta,
    evaluateCandidateMatch,
    evaluateSharedMeetPhysics,
    enqueueAthleteEvaluations,
    fetchHistoricalTotals,
    fetchCareerBestTotal
};
