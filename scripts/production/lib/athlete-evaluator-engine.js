/**
 * PRODUCTION: Symmetrical Athlete Evaluator Engine
 *
 * Provides core matching, scoring, demographic gating, and enqueueing logic
 * across all federations adhering strictly to ARCHITECTURE.md:
 *   1. Universal Demographic Anchor: Strict (gender, birth_year) match gate.
 *   2. Tokenized Name Scoring: Exact, multi-token subset, and single token overlap.
 *   3. Bonus/Penalty Modifiers: Birth year, country match/divergence, performance deltas.
 *   4. Manual Overrides: Whitelist and blacklist map lookups.
 *   5. Pairwise Graph Integrity: check_alias_type = 2.
 */

const {
    MANUAL_ATHLETE_MAP,
    BLACKLIST_ATHLETE_MAP,
    OWLCMS_MANUAL_MAP,
    OWLCMS_BLACKLIST_MAP
} = require('../../shared/athlete-mappings.js');

const CORE_FEDERATION_UUIDS = {
    USAW: '558e6d2b-e5a9-4503-a9f0-2ea2336d70c9',
    IWF: '754a4b29-bdea-4754-8b00-01a7a46bc58d',
    OWLCMS: 'd3eeeb41-1eb5-43e9-89cc-80eba58c2bf5'
};

const ALGORITHM_VERSION = 'v2.2-demographic-physics-symmetrical';

/**
 * Tokenize a human name by stripping diacritics, punctuation, and short noise words
 */
function tokenize(name) {
    if (!name || typeof name !== 'string') return [];
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/-/g, ' ')
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(x => x.length >= 2);
}

/**
 * Parse numeric lift or attempt total
 */
function parseLift(val) {
    if (val === null || val === undefined || val === '' || val === '---') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
}

/**
 * Extract normalized 3-letter country code from lifter record
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
 * Calculate token overlap score between two athlete names
 */
function calculateNameScore(nameA, nameB) {
    const tokensA = tokenize(nameA);
    const tokensB = tokenize(nameB);
    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    const strA = tokensA.join(' ');
    const strB = tokensB.join(' ');
    if (strA === strB) return 80;

    const overlap = tokensA.filter(t => tokensB.includes(t));
    const overlapCount = overlap.length;

    // Strong match (2+ words overlap) -> handles middle names and compound last names
    if (overlapCount >= 2) return 65;

    // Single token overlap (e.g. unique surname)
    const isLastNameMatch = overlapCount === 1 && (
        overlap[0] === tokensA[tokensA.length - 1] || 
        overlap[0] === tokensB[tokensB.length - 1]
    );
    if (isLastNameMatch) return 35;

    return 0;
}

/**
 * Check if candidate pairing is manually blacklisted
 */
function isPairBlacklisted(sourceFedCode, sourceId, targetFedCode, targetId) {
    const sId = parseInt(sourceId, 10);
    const tId = parseInt(targetId, 10);

    // IWF <-> USAW
    if (sourceFedCode === 'IWF' && targetFedCode === 'USAW') {
        if (BLACKLIST_ATHLETE_MAP[sId]?.includes(tId)) return true;
    }
    if (sourceFedCode === 'USAW' && targetFedCode === 'IWF') {
        if (BLACKLIST_ATHLETE_MAP[tId]?.includes(sId)) return true;
    }

    // USAW <-> OWLCMS
    if (sourceFedCode === 'USAW' && targetFedCode === 'OWLCMS') {
        if (OWLCMS_BLACKLIST_MAP[sId]?.includes(tId)) return true;
    }
    if (sourceFedCode === 'OWLCMS' && targetFedCode === 'USAW') {
        if (OWLCMS_BLACKLIST_MAP[tId]?.includes(sId)) return true;
    }

    return false;
}

/**
 * Check if candidate pairing is manually whitelisted
 */
function isPairWhitelisted(sourceFedCode, sourceId, targetFedCode, targetId) {
    const sId = parseInt(sourceId, 10);
    const tId = parseInt(targetId, 10);

    if (sourceFedCode === 'IWF' && targetFedCode === 'USAW') {
        if (MANUAL_ATHLETE_MAP[sId] === tId) return true;
    }
    if (sourceFedCode === 'USAW' && targetFedCode === 'IWF') {
        if (MANUAL_ATHLETE_MAP[tId] === sId) return true;
    }
    if (sourceFedCode === 'USAW' && targetFedCode === 'OWLCMS') {
        if (OWLCMS_MANUAL_MAP[sId] === tId) return true;
    }
    if (sourceFedCode === 'OWLCMS' && targetFedCode === 'USAW') {
        if (OWLCMS_MANUAL_MAP[tId] === sId) return true;
    }

    return false;
}

/**
 * Evaluate identity match between source athlete and target candidate
 *
 * @param {Object} source Source athlete profile
 * @param {Object} target Target candidate profile
 * @param {string} sourceFedCode e.g. 'IWF', 'USAW', 'OWLCMS'
 * @param {string} targetFedCode e.g. 'IWF', 'USAW', 'OWLCMS'
 * @returns {Object} Evaluation verdict, score, evidence breakdown
 */
function evaluateCandidateMatch(source, target, sourceFedCode, targetFedCode) {
    // 0. Manual Blacklist Check
    if (isPairBlacklisted(sourceFedCode, source.id, targetFedCode, target.id)) {
        return {
            status: 'NO_MATCH',
            score: 0,
            verdict: 'BLACKLISTED',
            breakdown: ['Candidate explicitly blacklisted in shared mappings']
        };
    }

    // 0. Manual Whitelist Check
    if (isPairWhitelisted(sourceFedCode, source.id, targetFedCode, target.id)) {
        return {
            status: 'MATCHED',
            score: 100,
            verdict: 'MANUAL_WHITELIST',
            breakdown: ['Candidate explicitly whitelisted in shared mappings']
        };
    }

    // 1. Universal Demographic Anchor: Strict Gender Gate
    if (source.gender && target.gender) {
        if (source.gender.trim().toUpperCase() !== target.gender.trim().toUpperCase()) {
            return {
                status: 'NO_MATCH',
                score: 0,
                verdict: 'GENDER_MISMATCH',
                breakdown: [`Gender divergence: ${source.gender} vs ${target.gender}`]
            };
        }
    }

    // 2. Universal Demographic Anchor: Strict Birth Year Gate
    if (source.birth_year && target.birth_year) {
        if (parseInt(source.birth_year, 10) !== parseInt(target.birth_year, 10)) {
            return {
                status: 'NO_MATCH',
                score: 0,
                verdict: 'BIRTH_YEAR_MISMATCH',
                breakdown: [`Birth year divergence: ${source.birth_year} vs ${target.birth_year}`]
            };
        }
    }

    let score = 0;
    const breakdown = [];

    // 3. Tokenized Name Scoring
    const nameScore = calculateNameScore(source.name, target.name);
    if (nameScore === 0) {
        return {
            status: 'NO_MATCH',
            score: 0,
            verdict: 'NO_TOKEN_OVERLAP',
            breakdown: [`Names share 0 tokens: "${source.name}" vs "${target.name}"`]
        };
    }
    score += nameScore;
    breakdown.push(`Name Overlap: +${nameScore}`);

    // 4. Exact Birth Year Bonus
    if (source.birth_year && target.birth_year && parseInt(source.birth_year, 10) === parseInt(target.birth_year, 10)) {
        score += 20;
        breakdown.push('Birth Year Match: +20');
    }

    // 5. Country / Federation Code Verification
    const sCountry = extractCountryCode(source) || (sourceFedCode === 'USAW' ? 'USA' : null);
    const tCountry = extractCountryCode(target) || (targetFedCode === 'USAW' ? 'USA' : null);
    if (sCountry && tCountry) {
        if (sCountry === tCountry) {
            score += 15;
            breakdown.push(`Country Match (${sCountry}): +15`);
        } else {
            score -= 15;
            breakdown.push(`Country Divergence (${sCountry} vs ${tCountry}): -15`);
        }
    }

    // 6. Career Performance Delta (if totals exist)
    const sTotal = parseLift(source.best_total || source.total);
    const tTotals = (target.results || [])
        .map(r => parseLift(r.total))
        .filter(t => t !== null && t > 0);

    if (tTotals.length === 0 && parseLift(target.best_total || target.total)) {
        tTotals.push(parseLift(target.best_total || target.total));
    }

    if (sTotal && tTotals.length > 0) {
        const deltas = tTotals.map(t => Math.abs(sTotal - t));
        const minDelta = Math.min(...deltas);

        if (minDelta <= 10) {
            score += 15;
            breakdown.push(`Performance Delta (${minDelta}kg): +15`);
        } else if (minDelta <= 25) {
            score += 5;
            breakdown.push(`Performance Delta (${minDelta}kg): +5`);
        } else {
            score -= 10;
            breakdown.push(`Performance Divergence (${minDelta}kg): -10`);
        }
    }

    const finalScore = Math.min(Math.max(score, 0), 100);

    let status = 'NO_MATCH';
    if (finalScore >= 80) status = 'MATCHED';
    else if (finalScore >= 60) status = 'REVIEW_NEEDED';

    return {
        status,
        score: finalScore,
        verdict: status,
        breakdown
    };
}

/**
 * Enqueue an athlete for evaluation across target federations
 *
 * @param {Object} supabase Supabase client
 * @param {string} sourceFedId UUID of source federation
 * @param {number} sourceAthleteId Source athlete DB ID
 * @param {Array<string>} targetFedIds Target federation UUIDs
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

module.exports = {
    CORE_FEDERATION_UUIDS,
    ALGORITHM_VERSION,
    tokenize,
    parseLift,
    extractCountryCode,
    calculateNameScore,
    evaluateCandidateMatch,
    enqueueAthleteEvaluations
};

