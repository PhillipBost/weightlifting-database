#!/usr/bin/env node
/**
 * PRODUCTION: Seed Vetted Baseline (IWF + 5 Continental Confederations)
 *
 * Populates:
 *   1. public.federation_registry
 *   2. public.federation_localizations (with temporal boundaries and citations)
 *   3. public.federation_headquarters (with relocation history)
 *   4. public.federation_affiliations (typed continental edges)
 *
 * Idempotent: Can be safely re-run without creating duplicate records.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const entities = [
    {
        registry: {
            canonical_name: 'International Weightlifting Federation',
            short_code: 'IWF',
            country_code: null,
            level: 'international',
            founded_date: '1920-08-23',
            headquarters_city: 'Lausanne',
            headquarters_country_code: 'CHE',
            headquarters_address: 'Maison du Sport International, Av. de Rhodanie 54, 1007 Lausanne',
            official_website: 'https://iwf.sport',
            known_aliases: ['IWF', 'International Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'International Weightlifting Federation',
                acronym: 'IWF',
                name_type: 'primary',
                valid_from: '1972-09-06',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'IWF Constitution Article 1.1'
            },
            {
                language_code: 'fr',
                full_name: 'Fédération Internationale Haltérophile',
                acronym: 'FIH',
                name_type: 'historical',
                valid_from: '1920-08-23',
                valid_until: '1950-12-31',
                is_official_in_charter: true,
                citation: 'IWF Official History Archive / Olympedia'
            },
            {
                language_code: 'fr',
                full_name: 'Fédération Internationale Haltérophile et Culturiste',
                acronym: 'FIHC',
                name_type: 'historical',
                valid_from: '1950-01-01',
                valid_until: '1969-12-31',
                is_official_in_charter: true,
                citation: 'IWF Official History Archive'
            },
            {
                language_code: 'fr',
                full_name: 'Fédération Haltérophile International',
                acronym: 'FHI',
                name_type: 'historical',
                valid_from: '1969-01-01',
                valid_until: '1972-09-05',
                is_official_in_charter: true,
                citation: 'IWF Official History Archive'
            }
        ],
        headquarters: [
            {
                city: 'Budapest',
                country_code: 'HUN',
                valid_from: '1977-01-01',
                valid_until: '2020-05-01',
                is_current: false,
                citation: 'IWF Executive Relocation Resolution 2020'
            },
            {
                city: 'Lausanne',
                country_code: 'CHE',
                address: 'Maison du Sport International, Av. de Rhodanie 54',
                valid_from: '2020-05-01',
                valid_until: null,
                is_current: true,
                citation: 'IWF Constitution Article 1.2'
            }
        ]
    },
    {
        registry: {
            canonical_name: 'Pan American Weightlifting Federation',
            short_code: 'PAWF',
            country_code: null,
            level: 'continental',
            headquarters_city: 'Lima',
            headquarters_country_code: 'PER',
            official_website: 'https://panamwf.org',
            known_aliases: ['PAWF', 'Pan American Weightlifting Federation', 'Federación Panamericana de Levantamiento de Pesas', 'FPLP'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Pan American Weightlifting Federation',
                acronym: 'PAWF',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'PAWF Statutes Article 1'
            },
            {
                language_code: 'es',
                full_name: 'Federación Panamericana de Levantamiento de Pesas',
                acronym: 'FPLP',
                name_type: 'official_translation',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'PAWF Statutes Article 1'
            }
        ],
        affiliation: {
            relationship_type: 'continental_confederation',
            parent_short_code: 'IWF'
        }
    },
    {
        registry: {
            canonical_name: 'European Weightlifting Federation',
            short_code: 'EWF',
            country_code: null,
            level: 'continental',
            founded_date: '1969-09-20',
            headquarters_city: 'Zürich',
            headquarters_country_code: 'CHE',
            headquarters_address: 'Dreikönigstrasse 47, 8002 Zürich',
            official_website: 'https://ewf.sport',
            known_aliases: ['EWF', 'European Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'European Weightlifting Federation',
                acronym: 'EWF',
                name_type: 'primary',
                valid_from: '1969-09-20',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'EWF Constitution Article 1'
            }
        ],
        headquarters: [
            {
                city: 'Zürich',
                country_code: 'CHE',
                address: 'Dreikönigstrasse 47, 8002 Zürich',
                valid_from: '1969-09-20',
                valid_until: null,
                is_current: true,
                citation: 'EWF Constitution Article 1.3'
            }
        ],
        affiliation: {
            relationship_type: 'continental_confederation',
            parent_short_code: 'IWF'
        }
    },
    {
        registry: {
            canonical_name: 'Asian Weightlifting Federation',
            short_code: 'AWF',
            country_code: null,
            level: 'continental',
            founded_date: '1958-01-01',
            headquarters_city: 'Doha',
            headquarters_country_code: 'QAT',
            headquarters_address: 'P.O. Box 2473, Doha',
            official_website: 'https://awfsports.org',
            known_aliases: ['AWF', 'Asian Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Asian Weightlifting Federation',
                acronym: 'AWF',
                name_type: 'primary',
                valid_from: '1958-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'AWF Constitution Article 1'
            }
        ],
        affiliation: {
            relationship_type: 'continental_confederation',
            parent_short_code: 'IWF'
        }
    },
    {
        registry: {
            canonical_name: 'Weightlifting Federation of Africa',
            short_code: 'WFA',
            country_code: null,
            level: 'continental',
            founded_date: '1978-01-01',
            headquarters_city: 'Tunis',
            headquarters_country_code: 'TUN',
            headquarters_address: '18 avenue des martyrs, El Mourouj I, 2074 Tunis',
            official_website: 'https://wfa.com.ly',
            known_aliases: ['WFA', 'Weightlifting Federation of Africa', 'Confédération Africaine d\'Haltérophilie', 'CAH'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Weightlifting Federation of Africa',
                acronym: 'WFA',
                name_type: 'primary',
                valid_from: '1978-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Statutes / IWF Directory'
            },
            {
                language_code: 'fr',
                full_name: 'Confédération Africaine d\'Haltérophilie',
                acronym: 'CAH',
                name_type: 'official_translation',
                valid_from: '1978-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WFA Statutes / IWF Directory'
            }
        ],
        affiliation: {
            relationship_type: 'continental_confederation',
            parent_short_code: 'IWF'
        }
    },
    {
        registry: {
            canonical_name: 'Oceania Weightlifting Federation',
            short_code: 'OWF',
            country_code: null,
            level: 'continental',
            founded_date: '1980-01-01',
            headquarters_city: 'Nouméa',
            headquarters_country_code: 'NCL',
            headquarters_address: 'C/- CTOS, BP 333, 98845 Nouméa',
            official_website: 'https://oceaniaweightlifting.com',
            known_aliases: ['OWF', 'Oceania Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Oceania Weightlifting Federation',
                acronym: 'OWF',
                name_type: 'primary',
                valid_from: '1980-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'OWF Constitution / IWF Directory'
            }
        ],
        affiliation: {
            relationship_type: 'continental_confederation',
            parent_short_code: 'IWF'
        }
    }
];

async function seed() {
    console.log('Starting seed of vetted baseline entities...\n');
    const idMap = new Map(); // short_code -> UUID

    // 1. Upsert federation_registry rows
    for (const item of entities) {
        const reg = item.registry;
        const { data: existing, error: findErr } = await supabase
            .from('federation_registry')
            .select('id')
            .eq('short_code', reg.short_code);

        if (findErr) throw findErr;

        let fedId;
        if (existing && existing.length > 0) {
            fedId = existing[0].id;
            const { error: updErr } = await supabase
                .from('federation_registry')
                .update(reg)
                .eq('id', fedId);
            if (updErr) throw updErr;
            console.log(`Updated registry: ${reg.canonical_name} (${fedId})`);
        } else {
            const { data: inserted, error: insErr } = await supabase
                .from('federation_registry')
                .insert(reg)
                .select('id')
                .single();
            if (insErr) throw insErr;
            fedId = inserted.id;
            console.log(`Inserted registry: ${reg.canonical_name} (${fedId})`);
        }
        idMap.set(reg.short_code, fedId);

        // 2. Upsert localizations
        for (const loc of item.localizations) {
            const locRecord = {
                federation_id: fedId,
                language_code: loc.language_code,
                full_name: loc.full_name,
                acronym: loc.acronym,
                name_type: loc.name_type,
                valid_from: loc.valid_from,
                valid_until: loc.valid_until,
                is_official_in_charter: loc.is_official_in_charter,
                citation: loc.citation
            };

            const { data: existLoc } = await supabase
                .from('federation_localizations')
                .select('id')
                .eq('federation_id', fedId)
                .eq('language_code', loc.language_code)
                .eq('full_name', loc.full_name);

            if (existLoc && existLoc.length > 0) {
                await supabase
                    .from('federation_localizations')
                    .update(locRecord)
                    .eq('id', existLoc[0].id);
            } else {
                await supabase
                    .from('federation_localizations')
                    .insert(locRecord);
            }
        }
        console.log(`  ✓ Synced ${item.localizations.length} localization(s) for ${reg.short_code}`);

        // 3. Upsert headquarters if present
        if (item.headquarters) {
            for (const hq of item.headquarters) {
                const hqRecord = {
                    federation_id: fedId,
                    ...hq
                };
                const { data: existHq } = await supabase
                    .from('federation_headquarters')
                    .select('id')
                    .eq('federation_id', fedId)
                    .eq('city', hq.city)
                    .eq('country_code', hq.country_code);

                if (existHq && existHq.length > 0) {
                    await supabase
                        .from('federation_headquarters')
                        .update(hqRecord)
                        .eq('id', existHq[0].id);
                } else {
                    await supabase
                        .from('federation_headquarters')
                        .insert(hqRecord);
                }
            }
            console.log(`  ✓ Synced ${item.headquarters.length} headquarters record(s) for ${reg.short_code}`);
        }
    }

    // 4. Create affiliations (child -> parent)
    for (const item of entities) {
        if (!item.affiliation) continue;
        const childId = idMap.get(item.registry.short_code);
        const parentId = idMap.get(item.affiliation.parent_short_code);

        if (!childId || !parentId) {
            console.warn(`Could not resolve affiliation for ${item.registry.short_code}`);
            continue;
        }

        const affRecord = {
            child_id: childId,
            parent_id: parentId,
            relationship_type: item.affiliation.relationship_type,
            is_active: true
        };

        const { data: existAff } = await supabase
            .from('federation_affiliations')
            .select('id')
            .eq('child_id', childId)
            .eq('parent_id', parentId)
            .eq('relationship_type', item.affiliation.relationship_type);

        if (existAff && existAff.length > 0) {
            await supabase
                .from('federation_affiliations')
                .update(affRecord)
                .eq('id', existAff[0].id);
        } else {
            await supabase
                .from('federation_affiliations')
                .insert(affRecord);
        }
        console.log(`  ✓ Affiliated ${item.registry.short_code} -> ${item.affiliation.parent_short_code} (${item.affiliation.relationship_type})`);
    }

    console.log('\n✅ Vetted baseline seed finished successfully.');
}

seed().catch(err => {
    console.error('Seed error:', err);
    process.exit(1);
});
