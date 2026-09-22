#!/usr/bin/env node
/**
 * PRODUCTION: Seed Vetted IWF Member Federations (2026 ITA categorization)
 *
 * Source: scripts/production/iwf-2026-members.json
 *         (parsed from the ITA "2026 List of Categorised Member Federations",
 *          version in force as of 1 January 2026 — 192 members:
 *          Category A=28, B=30, C=134.)
 *
 * Populates:
 *   1. public.federation_registry   (national-level NGBs; USAW/WCH enriched, not duplicated)
 *   2. public.federation_localizations (official name + English country alias)
 *   3. public.federation_affiliations  (international_member -> IWF, continental_member -> parent)
 *   4. public.federation_iwf_categorizations (Category A/B/C, valid_from 2026-01-01)
 *
 * Idempotent: safe to re-run; upserts by short_code / canonical_name /
 * unique keys. Run ONLY after migrations/create_federation_iwf_categorizations.sql.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const itaMembers = require('./iwf-2026-members.json');
const homeNations = require('./iwf-home-nations.json');
const panAmericanSupplementary = require('./iwf-pawf-supplementary.json');
// ITA 2026 roster first (is_verified=true, cited to the ITA document);
// Supplementary entities are independent of international membership and categorization.
const members = itaMembers.concat(homeNations, panAmericanSupplementary);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CITE_2026 = 'ITA 2026 List of Categorised Member Federations, version in force as of 1 January 2026';
const CATEG_FROM = '2026-01-01';
const citationFor = (m) => m.source || CITE_2026;

function languageFor(name) {
    if (/Federaci[oó]n|Confederaci/i.test(name)) return 'es';
    if (/Fédération|Comité|Ligue /i.test(name)) return 'fr';
    if (/Verband|Deutscher|Österreich/i.test(name)) return 'de';
    if (/Federazione/i.test(name)) return 'it';
    if (/Federacao/i.test(name)) return 'pt';
    if (/Polski/i.test(name)) return 'pl';
    if (/Magyar/i.test(name)) return 'hu';
    if (/Cesky|Svaz/i.test(name)) return 'cs';
    if (/Horvatski/i.test(name)) return 'hr';
    if (/Savez/i.test(name)) return 'sr';
    if (/Dutch/i.test(name)) return 'nl';
    return 'en';
}

async function resolveIdByShortCode(shortCode) {
    const { data, error } = await supabase
        .from('federation_registry')
        .select('id, canonical_name, known_aliases')
        .eq('short_code', shortCode);
    if (error) throw error;
    return data && data.length ? data[0] : null;
}

async function resolveNationalByCountryCode(countryCode) {
    const { data, error } = await supabase
        .from('federation_registry')
        .select('id, canonical_name, known_aliases')
        .eq('level', 'national')
        .eq('country_code', countryCode);
    if (error) throw error;
    return data && data.length ? data[0] : null;
}

async function resolveIdByCanonical(canonicalName) {
    const { data, error } = await supabase
        .from('federation_registry')
        .select('id, canonical_name, known_aliases')
        .eq('canonical_name', canonicalName);
    if (error) throw error;
    return data && data.length ? data[0] : null;
}

async function upsertLocalization(fedId, loc) {
    const { data: existing } = await supabase
        .from('federation_localizations')
        .select('id')
        .eq('federation_id', fedId)
        .eq('language_code', loc.language_code)
        .eq('full_name', loc.full_name);
    if (existing && existing.length) {
        const { error } = await supabase
            .from('federation_localizations').update(loc).eq('id', existing[0].id);
        if (error) throw error;
    } else {
        const { error } = await supabase.from('federation_localizations').insert(
            Object.assign({ federation_id: fedId }, loc)
        );
        if (error) throw error;
    }
}

async function upsertAffiliation(childId, parentId, relationshipType) {
    const { data: existing } = await supabase
        .from('federation_affiliations')
        .select('id')
        .eq('child_id', childId)
        .eq('parent_id', parentId)
        .eq('relationship_type', relationshipType);
    if (existing && existing.length) {
        const { error } = await supabase
            .from('federation_affiliations')
            .update({ is_active: true })
            .eq('id', existing[0].id);
        if (error) throw error;
    } else {
        const { error } = await supabase.from('federation_affiliations').insert({
            child_id: childId, parent_id: parentId,
            relationship_type: relationshipType, is_active: true
        });
        if (error) throw error;
    }
}

async function upsertCategorization(fedId, category) {
    const { data: existing } = await supabase
        .from('federation_iwf_categorizations')
        .select('id')
        .eq('federation_id', fedId)
        .eq('valid_from', CATEG_FROM);
    const record = {
        federation_id: fedId, category,
        valid_from: CATEG_FROM, valid_until: null, citation: CITE_2026
    };
    if (existing && existing.length) {
        const { error } = await supabase
            .from('federation_iwf_categorizations').update(record).eq('id', existing[0].id);
        if (error) throw error;
    } else {
        const { error } = await supabase
            .from('federation_iwf_categorizations').insert(record);
        if (error) throw error;
    }
}

async function seed() {
    console.log(`Seeding ${members.length} federation entities: ${itaMembers.length} categorized entities, ${homeNations.length} Home Nations, ${panAmericanSupplementary.length} supplementary Pan American entities.\n`);

    // 1. Resolve IWF and continental parents
    const iwf = await resolveIdByShortCode('IWF');
    if (!iwf) throw new Error('IWF not found in federation_registry');
    const parents = {};
    for (const sc of ['EWF', 'AWF', 'WFA', 'PAWF', 'OWF']) {
        const p = await resolveIdByShortCode(sc);
        if (!p) throw new Error(`Continental parent ${sc} not found`);
        parents[sc] = p.id;
    }
    const existingByCode = {
        CAN: await resolveNationalByCountryCode('CAN'),
        USA: await resolveNationalByCountryCode('USA')
    };

    let created = 0, updated = 0, skipped = 0;

    for (const m of members) {
        let fedId, fed;

        if (m.code === 'CAN' || m.code === 'USA') {
            // Existing entities: USA Weightlifting / Weightlifting Canada Haltérophilie
            fed = existingByCode[m.code];
            if (!fed) throw new Error(`Existing national entity for ${m.code} not found`);
            fedId = fed.id;
            // Enrich known_aliases with the ITA code + country if missing
            const aliases = new Set(fed.known_aliases || []);
            aliases.add(m.code);
            aliases.add(m.country);
            const nextAliases = [...aliases];
            if (JSON.stringify(nextAliases) !== JSON.stringify(fed.known_aliases || [])) {
                const { error } = await supabase
                    .from('federation_registry')
                    .update({ known_aliases: nextAliases })
                    .eq('id', fedId);
                if (error) throw error;
                updated++;
            } else skipped++;
        } else {
            // New national entity
            fed = (await resolveIdByShortCode(m.code)) || (await resolveIdByCanonical(m.official_name));
            const regPayload = {
                canonical_name: m.official_name,
                short_code: m.code,
                level: 'national',
                country_code: m.code,
                known_aliases: [...new Set([...(fed?.known_aliases || []), m.code, m.country, m.official_name, ...(m.known_aliases || [])])],
                is_verified: m.is_verified !== undefined ? m.is_verified : true
            };
            if (fed) {
                const { error } = await supabase
                    .from('federation_registry').update(regPayload).eq('id', fed.id);
                if (error) throw error;
                fedId = fed.id;
                updated++;
            } else {
                const { data: inserted, error } = await supabase
                    .from('federation_registry').insert(regPayload).select('id');
                if (error) throw error;
                fedId = inserted[0].id;
                created++;
            }
        }

        // 2. Localizations: primary official name + English country alias
        await upsertLocalization(fedId, {
            language_code: languageFor(m.official_name),
            full_name: m.official_name,
            acronym: m.code,
            name_type: 'primary',
            valid_from: null, valid_until: null,
            is_official_in_charter: m.is_verified !== false && !m.name_is_provisional, citation: citationFor(m)
        });
        await upsertLocalization(fedId, {
            language_code: 'en',
            full_name: m.country,
            acronym: m.code,
            name_type: 'common_alias',
            valid_from: null, valid_until: null,
            is_official_in_charter: false, citation: citationFor(m)
        });

        // 3. Only explicitly supported affiliations; registry inclusion alone is not membership.
        if (m.iwf_member !== false) await upsertAffiliation(fedId, iwf.id, 'international_member');
        if (m.continent) await upsertAffiliation(fedId, parents[m.continent], 'continental_member');

        // 4. 2026 categorization (in force: valid_until NULL).
        // Supplementary entities have no categorization row.
        if (m.category) await upsertCategorization(fedId, m.category);
    }

    console.log(`\nDone. created=${created} updated=${updated} skipped=${skipped}`);
    console.log(`Processed ${created + updated + skipped}/${members.length} entities. Existing-row updates are included; creation counts depend on prior runs.`);
}

seed().catch(err => {
    console.error('Seed error:', err);
    process.exit(1);
});
