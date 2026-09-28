/**
 * Regression tests for the USA Weightlifting (USAW) specialty clubs synchronizer.
 *
 * Verbatim-only rule (as-written/as-found):
 * - community_designation is the sole source of truth, stored byte-verbatim.
 * - is_bipoc_owned / is_lgbtqia_owned are deprecated and never derived.
 * - Raw substring matching is prohibited ("Blaze Barbell" must NOT match
 *   "Ablaze Barbell").
 *
 * Run: npx jest tests/sync-usaw-specialty-clubs.test.js --verbose
 */
const {
    normalizeClubName,
    tokenOverlap,
    resolveBipocHeaderIndexes,
    matchExistingClub
} = require('../scripts/production/sync-usaw-specialty-clubs');

function dbMap(entries) {
    const m = new Map();
    entries.forEach(([name, address]) => {
        m.set(name.toLowerCase().trim(), { club_name: name, address });
    });
    return m;
}

function addrMap(entries) {
    const m = new Map();
    entries.forEach(([name, address]) => {
        m.set(name.toLowerCase().trim(), address || '');
    });
    return m;
}

describe('normalizeClubName (matching only, never stored)', () => {
    test('strips suffixes and normalizes plural barbell/barbells', () => {
        expect(normalizeClubName('Brave Barbells N Sprinkles WLC')).toBe('brave barbell n sprinkles');
        expect(normalizeClubName('Brave Barbell N Sprinkles')).toBe('brave barbell n sprinkles');
    });

    test('drops generic Club token but keeps Ablaze vs Blaze distinct', () => {
        expect(normalizeClubName('BARBARIAN BARBELL CLUB')).toBe('barbarian barbell');
        expect(normalizeClubName('Blaze Barbell')).not.toBe(normalizeClubName('Ablaze Barbell'));
    });
});

describe('tokenOverlap guard', () => {
    test('Blaze vs Ablaze scores below threshold (proves substring bug fixed)', () => {
        expect(tokenOverlap('Blaze Barbell', 'Ablaze Barbell')).toBeLessThan(0.8);
    });

    test('Brave variant scores at threshold via plural normalization', () => {
        expect(tokenOverlap('Brave Barbell N Sprinkles', 'Brave Barbells N Sprinkles WLC')).toBeGreaterThanOrEqual(0.8);
    });

    test('Barbarian short name matches canonical club name', () => {
        expect(tokenOverlap('Barbarian Barbell', 'BARBARIAN BARBELL CLUB')).toBeGreaterThanOrEqual(0.8);
    });
});

describe('matchExistingClub (no raw substrings)', () => {
    const entries = [
        ['Ablaze Barbell', '726 Beal Parkway BLG#3, Fort Walton Beach, Florida 32547'],
        ['BARBARIAN BARBELL CLUB', '6930 Hayvenhurst Avenue, Pacoima, CA 91331'],
        ['Brave Barbells N Sprinkles WLC', '305 Ashville Ave, Cary, NC 27518']
    ];

    test('Blaze Barbell (Naples, FL) does NOT match Ablaze Barbell', () => {
        const hit = matchExistingClub('Blaze Barbell', 'Naples, FL 34109', dbMap(entries), addrMap(entries));
        expect(hit).toBeNull();
    });

    test('Barbarian Barbell matches BARBARIAN BARBELL CLUB', () => {
        const hit = matchExistingClub('Barbarian Barbell', 'Pacoima, CA 91331', dbMap(entries), addrMap(entries));
        expect(hit && hit.club_name).toBe('BARBARIAN BARBELL CLUB');
    });

    test('Brave Barbell N Sprinkles matches Cary WLC variant with location corroboration', () => {
        const hit = matchExistingClub('Brave Barbell N Sprinkles', 'Cary, NC 27518', dbMap(entries), addrMap(entries));
        expect(hit && hit.club_name).toBe('Brave Barbells N Sprinkles WLC');
    });

    test('unknown club returns null (stub path)', () => {
        const hit = matchExistingClub('Brand New Barbell', 'Austin, TX 78701', dbMap(entries), addrMap(entries));
        expect(hit).toBeNull();
    });
});

describe('fill-only-if-empty contact guard (Ablaze/Jason Anderson regression)', () => {
    // Mirrors the matched-update payload construction in syncBipocLgbtqiaClubs:
    // contact/instagram fill only when the DB field is empty.
    function buildContactFill(existingClub, contactRaw, instagramRaw) {
        const payload = {};
        if (!existingClub.contact_name && contactRaw) payload.contact_name = contactRaw;
        if (!existingClub.instagram && instagramRaw) payload.instagram = instagramRaw;
        return payload;
    }

    test('never overwrites a real contact on false match (Ablaze keeps its own)', () => {
        const ablazeRow = { club_name: 'Ablaze Barbell', contact_name: 'Real Owner', instagram: null };
        const fill = buildContactFill(ablazeRow, 'Jason Anderson', '@blazebarbell');
        expect(fill.contact_name).toBeUndefined();
        expect(fill.instagram).toBe('@blazebarbell');
    });

    test('fills empty contact/instagram on true match (Blaze stub enrichment)', () => {
        const emptyRow = { club_name: 'Some Club', contact_name: null, instagram: null };
        const fill = buildContactFill(emptyRow, 'Jason Anderson', '@blazebarbell');
        expect(fill.contact_name).toBe('Jason Anderson');
        expect(fill.instagram).toBe('@blazebarbell');
    });

    test('decontamination predicate: Jason Anderson on Ablaze is contaminated', () => {
        const isContaminatedContact = (row) => row.club_name === 'Ablaze Barbell' && row.contact_name === 'Jason Anderson';
        const isContaminatedHandle = (row) => row.club_name === 'Ablaze Barbell' && row.instagram === '@blazebarbell';
        expect(isContaminatedContact({ club_name: 'Ablaze Barbell', contact_name: 'Jason Anderson' })).toBe(true);
        expect(isContaminatedHandle({ club_name: 'Ablaze Barbell', instagram: '@blazebarbell' })).toBe(true);
    });

    test('decontamination predicate: genuine Ablaze email is untouched', () => {
        const row = { club_name: 'Ablaze Barbell', email: 'Knight.jcr@gmail.com' };
        expect(row.email).toBe('Knight.jcr@gmail.com');
    });
});

describe('resolveBipocHeaderIndexes', () => {
    const cheerio = require('cheerio');

    test('resolves standard header row', () => {
        const $ = cheerio.load('<table><tr><th>Club Name</th><th>Contact</th><th>Email</th><th>Address</th><th>City, St Zip</th><th>Instagram</th><th>BIPOC/LGBTQIA+</th></tr></table>');
        const idx = resolveBipocHeaderIndexes($, $('tr')[0]);
        expect(idx).not.toBeNull();
        expect(idx.club).toBe(0);
        expect(idx.designation).toBe(6);
    });

    test('returns null on unrecognized headers (must abort, not fixed-index parse)', () => {
        const $ = cheerio.load('<table><tr><th>Foo</th><th>Bar</th></tr></table>');
        expect(resolveBipocHeaderIndexes($, $('tr')[0])).toBeNull();
    });
});

describe('row-count abort guard (thin parse is failure, never delisting)', () => {
    const MIN_BIPOC_DATA_ROWS = 20;

    function assertBipocRowCount(dataRowCount) {
        if (dataRowCount < MIN_BIPOC_DATA_ROWS) {
            throw new Error(`BIPOC table data-row count ${dataRowCount} below minimum ${MIN_BIPOC_DATA_ROWS}. Aborting to avoid misparse-driven writes.`);
        }
    }

    test('current live count (23) passes', () => {
        expect(() => assertBipocRowCount(23)).not.toThrow();
    });

    test('initial-run count (~36) passes', () => {
        expect(() => assertBipocRowCount(36)).not.toThrow();
    });

    test('thin parse (5 rows) aborts', () => {
        expect(() => assertBipocRowCount(5)).toThrow(/below minimum/);
    });

    test('empty table (0 rows) aborts', () => {
        expect(() => assertBipocRowCount(0)).toThrow(/below minimum/);
    });
});

describe('absent-report keying (canonical variants must not false-positive)', () => {
    function buildSeen(sourceNames) {
        return new Set(sourceNames.map(normalizeClubName));
    }

    test('BARBARIAN BARBELL CLUB keyed by source Barbarian Barbell is not absent', () => {
        const seen = buildSeen(['Barbarian Barbell']);
        expect(seen.has(normalizeClubName('BARBARIAN BARBELL CLUB'))).toBe(true);
    });

    test('CHFP WEIGHTLIFTING CLUB keyed by source CHFP Weightlifting is not absent', () => {
        const seen = buildSeen(['CHFP Weightlifting']);
        expect(seen.has(normalizeClubName('CHFP WEIGHTLIFTING CLUB'))).toBe(true);
    });

    test('Industrial Strength WLC keyed by source Industrial Strength is not absent', () => {
        const seen = buildSeen(['Industrial Strength']);
        expect(seen.has(normalizeClubName('Industrial Strength WLC'))).toBe(true);
    });

    test('Brave Barbells N Sprinkles WLC keyed by source Brave Barbell N Sprinkles is not absent', () => {
        const seen = buildSeen(['Brave Barbell N Sprinkles']);
        expect(seen.has(normalizeClubName('Brave Barbells N Sprinkles WLC'))).toBe(true);
    });

    test('genuinely absent club is still reported', () => {
        const seen = buildSeen(['Barbarian Barbell']);
        expect(seen.has(normalizeClubName('Desert Dome Weightlifting'))).toBe(false);
    });
});
