const {
    ALGORITHM_VERSION,
    tokenize,
    extractSubstantiveTokens,
    levenshteinDistance,
    isAdjacentTransposition,
    isFuzzyTokenMatch,
    analyzeNameMatch,
    isPairBlacklisted,
    isPairWhitelisted,
    getWhitelistedTargetIds,
    evaluateCandidateMatch,
    evaluateSharedMeetPhysics
} = require('../scripts/production/lib/athlete-evaluator-engine.js');

describe('athlete-evaluator-engine v3.0 Strict Policy & Shared-Meet Physics', () => {
    test('exposes v3.0 algorithm version', () => {
        expect(ALGORITHM_VERSION).toBe('v3.0-strict-physics-symmetrical');
    });

    describe('Name normalization, deduplication, and particle filtering', () => {
        test('folds diacritics and non-NFD Latin characters', () => {
            expect(tokenize('José García-López')).toEqual(['jose', 'garcia', 'lopez']);
            expect(tokenize('Łukasz Żółć')).toEqual(['lukasz', 'zolc']);
            expect(tokenize('Søren Weiß')).toEqual(['soren', 'weiss']);
        });

        test('retains 2-character surnames and drops 1-letter initials', () => {
            expect(tokenize('Hao WU')).toEqual(['hao', 'wu']);
            expect(tokenize('Fabin LI')).toEqual(['fabin', 'li']);
            expect(tokenize('John A. Smith')).toEqual(['john', 'smith']);
        });

        test('merges spaced Mc surname prefixes', () => {
            expect(tokenize('Shala Sherina MC MILLAN')).toEqual(['shala', 'sherina', 'mcmillan']);
            expect(tokenize('Shannon L MC NAMES')).toEqual(['shannon', 'mcnames']);
            expect(analyzeNameMatch('Shannon L MC NAMES', 'Shannon McNames').tier).toBe('EXACT_ORDERED');
        });

        test('deduplicates repeated tokens and excludes non-identifying particles/suffixes', () => {
            expect(extractSubstantiveTokens(tokenize('Ahmed Ahmed'))).toEqual(['ahmed']);
            expect(extractSubstantiveTokens(tokenize('Carlos DE LA CRUZ'))).toEqual(['carlos', 'cruz']);
            expect(extractSubstantiveTokens(tokenize('John SMITH Jr'))).toEqual(['john', 'smith']);
        });

        test('handles LAST FIRST inversions symmetrically as EXACT_SET_REORDERED', () => {
            const forward = analyzeNameMatch('WU Hao', 'Hao WU');
            const reverse = analyzeNameMatch('Hao WU', 'WU Hao');
            expect(forward.tier).toBe('EXACT_SET_REORDERED');
            expect(reverse.tier).toBe('EXACT_SET_REORDERED');
            expect(forward.score).toBe(80);
        });

        test('detects Levenshtein typos and adjacent transpositions', () => {
            expect(isAdjacentTransposition('denies', 'deines')).toBe(true);
            expect(levenshteinDistance('castllo', 'castillo')).toBe(1);
            expect(isFuzzyTokenMatch('dagostino', 'agostino')).toBe(true);
            expect(analyzeNameMatch('Darius Castllo', 'Darius Castillo').tier).toBe('FUZZY_EXACT_OR_SUBSET');
            expect(analyzeNameMatch('Nicole Brittanie DENIES', 'Nicole Deines').tier).toBe('FUZZY_EXACT_OR_SUBSET');
            expect(analyzeNameMatch("Chrisanto D'Agostino", 'D AGOSTINO Mangosong Chrisanto').tier).toBe('FUZZY_EXACT_OR_SUBSET');
        });
    });

    describe('Strict false-positive guards', () => {
        test('blocks single-surname-only auto-linking (John Smith vs Robert Smith)', () => {
            const source = { id: 1, name: 'John Smith', gender: 'M', birth_year: 1998, country_code: 'USA', historical_totals: [250] };
            const targetClose = { id: 2, name: 'Robert Smith', gender: 'M', birth_year: 1998, country_code: 'USA', historical_totals: [255] };
            const targetFar = { id: 3, name: 'Robert Smith', gender: 'M', birth_year: 1998, country_code: 'USA', historical_totals: [310] };

            const resClose = evaluateCandidateMatch(source, targetClose, 'USAW', 'IWF');
            expect(resClose.status).toBe('REVIEW_NEEDED');
            expect(resClose.score).toBe(65);

            const resFar = evaluateCandidateMatch(source, targetFar, 'USAW', 'IWF');
            expect(resFar.status).toBe('NO_MATCH');
            expect(resFar.score).toBe(0);
        });

        test('blocks unrelated DE LA / Jr particle collisions', () => {
            const a = { id: 10, name: 'Carlos DE LA CRUZ', gender: 'M', birth_year: 2000, country_code: 'MEX', historical_totals: [260] };
            const b = { id: 11, name: 'Juan DE LA ROSA', gender: 'M', birth_year: 2000, country_code: 'MEX', historical_totals: [260] };
            expect(evaluateCandidateMatch(a, b, 'IWF', 'OWLCMS').status).toBe('NO_MATCH');

            const jrA = { id: 12, name: 'John SMITH Jr', gender: 'M', birth_year: 1999, country_code: 'USA', historical_totals: [200] };
            const jrB = { id: 13, name: 'Mike SMITH Jr', gender: 'M', birth_year: 1999, country_code: 'USA', historical_totals: [280] };
            expect(evaluateCandidateMatch(jrA, jrB, 'USAW', 'IWF').status).toBe('NO_MATCH');
        });

        test('blocks Ahmed Ahmed duplicate-token inflation while allowing genuine exact doubled name', () => {
            const usawAhmed = { id: 999999, name: 'Ahmed Ahmed', gender: 'M', birth_year: 1997, country_code: 'USA', historical_totals: [220] };
            const iwfOther = { id: 888888, name: 'Ahmed Valdy NJOYA', gender: 'M', birth_year: 1997, country_code: 'CMR', historical_totals: [220] };
            expect(evaluateCandidateMatch(usawAhmed, iwfOther, 'USAW', 'IWF').status).toBe('NO_MATCH');

            const iwfExact = { id: 888889, name: 'Ahmed AHMED', gender: 'M', birth_year: 1997, country_code: 'USA', historical_totals: [220] };
            expect(evaluateCandidateMatch(usawAhmed, iwfExact, 'USAW', 'IWF').status).toBe('MATCHED');
        });

        test('blocks non-subset multi-token collisions (Thi Hong NGUYEN vs Thi Hoa NGUYEN)', () => {
            const a = { id: 20, name: 'Thi Hong NGUYEN', gender: 'F', birth_year: 2001, country_code: 'VIE', historical_totals: [170] };
            const b = { id: 21, name: 'Thi Hoa NGUYEN', gender: 'F', birth_year: 2001, country_code: 'VIE', historical_totals: [210] };
            expect(evaluateCandidateMatch(a, b, 'IWF', 'OWLCMS').status).toBe('NO_MATCH');
        });

        test('caps exact-name country divergence to REVIEW_NEEDED unless historical total matches within <=15kg', () => {
            const iwfCan = { id: 30, name: 'Jonathan JOHNSON', gender: 'M', birth_year: 1996, country_code: 'CAN', historical_totals: [280] };
            const usawDiffTotal = { id: 31, name: 'Jonathan Johnson', gender: 'M', birth_year: 1996, country_code: 'USA', historical_totals: [210] };
            const usawSameTotal = { id: 32, name: 'Jonathan Johnson', gender: 'M', birth_year: 1996, country_code: 'USA', historical_totals: [270] };

            const resUnverified = evaluateCandidateMatch(iwfCan, usawDiffTotal, 'IWF', 'USAW');
            expect(resUnverified.status).toBe('REVIEW_NEEDED');
            expect(resUnverified.score).toBe(75);

            const resCorroborated = evaluateCandidateMatch(iwfCan, usawSameTotal, 'IWF', 'USAW');
            expect(resCorroborated.status).toBe('MATCHED');
            expect(resCorroborated.score).toBeGreaterThanOrEqual(80);
        });

        test('caps exact-name same-country match when historical totals diverge by >25kg across all meets', () => {
            const a = { id: 40, name: 'David Miller', gender: 'M', birth_year: 1995, country_code: 'USA', historical_totals: [180, 190] };
            const b = { id: 41, name: 'David MILLER', gender: 'M', birth_year: 1995, country_code: 'USA', historical_totals: [310, 325] };
            const res = evaluateCandidateMatch(a, b, 'USAW', 'IWF');
            expect(res.status).toBe('REVIEW_NEEDED');
            expect(res.score).toBe(75);
        });

        test('uses full historical totals so career growth (Youth -> Senior) still matches', () => {
            const iwfYouth = { id: 42, name: 'Jordan Lee', gender: 'M', birth_year: 2002, country_code: 'USA', historical_totals: [180] };
            const usawCareer = { id: 43, name: 'Jordan Lee', gender: 'M', birth_year: 2002, country_code: 'USA', historical_totals: [178, 215, 260] };
            const res = evaluateCandidateMatch(iwfYouth, usawCareer, 'IWF', 'USAW');
            expect(res.status).toBe('MATCHED');
            expect(res.score).toBe(100);
        });
    });

    describe('Strict review routing for middle names, typos, and bad/missing birth years', () => {
        test('routes longer IWF name containing shorter USAW name to REVIEW_NEEDED (never auto-link)', () => {
            const iwf = { id: 50, name: 'John Michael SMITH', gender: 'M', birth_year: 1998, country_code: 'USA', historical_totals: [300] };
            const usaw = { id: 51, name: 'John Smith', gender: 'M', birth_year: 1998, country_code: 'USA', historical_totals: [300] };
            const res = evaluateCandidateMatch(iwf, usaw, 'IWF', 'USAW');
            expect(res.status).toBe('REVIEW_NEEDED');
            expect(res.score).toBe(75);
            expect(res.matchTier).toBe('TOKEN_SUBSET');
        });

        test('routes 1-2 character typo match to REVIEW_NEEDED (never auto-link)', () => {
            const iwf = { id: 52, name: 'Darius CASTLLO', gender: 'M', birth_year: 1998, country_code: 'USA', historical_totals: [290] };
            const usaw = { id: 53, name: 'Darius Castillo', gender: 'M', birth_year: 1998, country_code: 'USA', historical_totals: [290] };
            const res = evaluateCandidateMatch(iwf, usaw, 'IWF', 'USAW');
            expect(res.status).toBe('REVIEW_NEEDED');
            expect(res.score).toBe(74);
            expect(res.matchTier).toBe('FUZZY_EXACT_OR_SUBSET');
        });

        test('routes +/-2 year and NULL birth-year exact-name matches to REVIEW_NEEDED in fallback mode', () => {
            const iwfBadYear = { id: 60, name: 'Sarah Connor', gender: 'F', birth_year: 1999, country_code: 'USA', historical_totals: [210] };
            const usawRealYear = { id: 61, name: 'Sarah Connor', gender: 'F', birth_year: 1998, country_code: 'USA', historical_totals: [210] };

            // Strict exact cohort rejects differing birth year
            expect(evaluateCandidateMatch(iwfBadYear, usawRealYear, 'IWF', 'USAW').status).toBe('NO_MATCH');

            // Fallback mode routes to REVIEW_NEEDED
            const fb = evaluateCandidateMatch(iwfBadYear, usawRealYear, 'IWF', 'USAW', { allowBirthYearFallback: true });
            expect(fb.status).toBe('REVIEW_NEEDED');
            expect(fb.score).toBe(74);
            expect(fb.matchTier).toBe('BIRTH_YEAR_FALLBACK');

            // >2 years difference still rejected in fallback mode
            const usawTooFar = { id: 62, name: 'Sarah Connor', gender: 'F', birth_year: 1994, country_code: 'USA', historical_totals: [210] };
            expect(evaluateCandidateMatch(iwfBadYear, usawTooFar, 'IWF', 'USAW', { allowBirthYearFallback: true }).status).toBe('NO_MATCH');

            // NULL birth year routed to REVIEW_NEEDED in fallback mode
            const iwfNullYear = { id: 63, name: 'Sarah Connor', gender: 'F', birth_year: null, country_code: 'USA', historical_totals: [210] };
            const fbNull = evaluateCandidateMatch(iwfNullYear, usawRealYear, 'IWF', 'USAW', { allowBirthYearFallback: true });
            expect(fbNull.status).toBe('REVIEW_NEEDED');
            expect(fbNull.matchTier).toBe('BIRTH_YEAR_FALLBACK');
        });
    });

    describe('Shared-meet 6-attempt physics verification (Option 1)', () => {
        const meetMap = new Map([[1509, new Set([3760])]]);

        test('auto-links at 100% on exact 6-attempt scorecard + matching birth year even after surname change', () => {
            const iwf = { id: 70, name: 'Anna SIERRA', gender: 'F', birth_year: 1996, country_code: 'USA' };
            const usaw = { id: 71, name: 'Anna Rucker', gender: 'F', birth_year: 1996, country_code: 'USA' };
            const sRes = [{
                db_meet_id: 1509, gender: 'F', birth_year: 1996,
                snatch_lift_1: '85', snatch_lift_2: '-88', snatch_lift_3: '89', best_snatch: '89',
                cj_lift_1: '105', cj_lift_2: '109', cj_lift_3: '-112', best_cj: '109', total: '198'
            }];
            const tRes = [{
                meet_id: 3760, gender: 'F', birth_year: 1996,
                snatch_lift_1: '85', snatch_lift_2: '-88', snatch_lift_3: '89', best_snatch: '89',
                cj_lift_1: '105', cj_lift_2: '109', cj_lift_3: '-112', best_cj: '109', total: '198'
            }];

            const res = evaluateSharedMeetPhysics(iwf, sRes, usaw, tRes, meetMap, 'IWF', 'USAW');
            expect(res.status).toBe('MATCHED');
            expect(res.score).toBe(100);
            expect(res.matchTier).toBe('SHARED_MEET_PHYSICS');
        });

        test('routes exact 6-attempt scorecard with conflicting birth year to REVIEW_NEEDED (79%)', () => {
            const iwf = { id: 72, name: 'Alex Morgan', gender: 'F', birth_year: 1999, country_code: 'USA' };
            const usaw = { id: 73, name: 'Alex Morgan', gender: 'F', birth_year: 1998, country_code: 'USA' };
            const sRes = [{
                db_meet_id: 1509, gender: 'F', birth_year: 1999,
                snatch_lift_1: '90', snatch_lift_2: '93', snatch_lift_3: '-95', best_snatch: '93',
                cj_lift_1: '115', cj_lift_2: '118', cj_lift_3: '120', best_cj: '120', total: '213'
            }];
            const tRes = [{
                meet_id: 3760, gender: 'F', birth_year: 1998,
                snatch_lift_1: '90', snatch_lift_2: '93', snatch_lift_3: '-95', best_snatch: '93',
                cj_lift_1: '115', cj_lift_2: '118', cj_lift_3: '120', best_cj: '120', total: '213'
            }];

            const res = evaluateSharedMeetPhysics(iwf, sRes, usaw, tRes, meetMap, 'IWF', 'USAW');
            expect(res.status).toBe('REVIEW_NEEDED');
            expect(res.score).toBe(79);
            expect(res.matchTier).toBe('SHARED_MEET_PHYSICS_BY_CONFLICT');
        });

        test('rejects scorecard when any signed attempt mismatches or gender disagrees', () => {
            const iwf = { id: 74, name: 'Alex Morgan', gender: 'F', birth_year: 1998 };
            const usaw = { id: 75, name: 'Alex Morgan', gender: 'F', birth_year: 1998 };
            const sRes = [{
                db_meet_id: 1509, gender: 'F', birth_year: 1998,
                snatch_lift_1: '90', snatch_lift_2: '93', snatch_lift_3: '-95', best_snatch: '93',
                cj_lift_1: '115', cj_lift_2: '118', cj_lift_3: '120', best_cj: '120', total: '213'
            }];
            const tResMismatch = [{
                meet_id: 3760, gender: 'F', birth_year: 1998,
                snatch_lift_1: '90', snatch_lift_2: '-93', snatch_lift_3: '95', best_snatch: '95',
                cj_lift_1: '115', cj_lift_2: '118', cj_lift_3: '120', best_cj: '120', total: '215'
            }];
            expect(evaluateSharedMeetPhysics(iwf, sRes, usaw, tResMismatch, meetMap, 'IWF', 'USAW')).toBeNull();

            const usawWrongGender = { id: 76, name: 'Alex Morgan', gender: 'M', birth_year: 1998 };
            expect(evaluateSharedMeetPhysics(iwf, sRes, usawWrongGender, sRes.map(r => ({ ...r, meet_id: 3760, gender: 'M' })), meetMap, 'IWF', 'USAW')).toBeNull();
        });
    });

    describe('Manual whitelist & blacklist lookup integrity', () => {
        test('resolves IWF <-> USAW whitelists and blacklists symmetrically', () => {
            // Known entries in scripts/shared/athlete-mappings.js
            expect(isPairWhitelisted('IWF', 55229, 'USAW', 29088)).toBe(true);
            expect(isPairWhitelisted('USAW', 29088, 'IWF', 55229)).toBe(true);
            expect(getWhitelistedTargetIds('IWF', 55229, 'USAW')).toEqual([29088]);
            expect(getWhitelistedTargetIds('USAW', 29088, 'IWF')).toEqual([55229]);

            expect(isPairBlacklisted('IWF', 52118, 'USAW', 23719)).toBe(true);
            expect(isPairBlacklisted('USAW', 23719, 'IWF', 52118)).toBe(true);
            expect(isPairWhitelisted('IWF', 52680, 'IWF', 58978)).toBe(true);
        });
    });
});
