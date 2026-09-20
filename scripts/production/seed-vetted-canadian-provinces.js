#!/usr/bin/env node
/**
 * PRODUCTION: Seed Vetted Canadian Provinces & Territories
 *
 * Populates Canadian provincial and territorial bodies under Weightlifting Canada Haltérophilie (WCH).
 * Sourced from:
 *   - Weightlifting Canada Haltérophilie (WCH) Official Provincial Directory: https://weightliftingcanada.ca/provincial-associations/
 *   - Weightlifting Canada Haltérophilie (WCH) Athletes' Council Jurisdictional Responsibilities (Jan 1, 2025)
 *
 * Architectural Standards:
 *   - short_code = NULL across all 13 Canadian regional bodies (symmetry with USAW WSOs).
 *   - Acronyms & two-letter codes stored in public.federation_localizations and known_aliases.
 *   - All 13 affiliated to WCH via public.federation_affiliations with relationship_type = 'regional_subdivision'.
 *   - Idempotent execution.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const canadianProvinces = [
    {
        canonical_name: 'Alberta Weightlifting Association',
        official_website: 'http://www.albertaweightlifting.com/',
        aliases: ['Alberta Weightlifting Association', 'Alberta', 'AB', 'Alberta Weightlifting', 'AWA'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Alberta Weightlifting Association',
                acronym: 'AWA',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Weightlifting Canada Haltérophilie Provincial Directory'
            },
            {
                language_code: 'en',
                full_name: 'Alberta',
                acronym: 'AB',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'ISO 3166-2:CA-AB / WCH Athletes Council'
            }
        ]
    },
    {
        canonical_name: 'British Columbia Weightlifting Association',
        official_website: 'https://www.bcweightlifting.ca/',
        aliases: ['British Columbia Weightlifting Association', 'British Columbia', 'BC', 'BC Weightlifting', 'BCWA', 'Weightlifting BC'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'British Columbia Weightlifting Association',
                acronym: 'BCWA',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Weightlifting Canada Haltérophilie Provincial Directory'
            },
            {
                language_code: 'en',
                full_name: 'British Columbia',
                acronym: 'BC',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'ISO 3166-2:CA-BC / WCH Athletes Council'
            }
        ]
    },
    {
        canonical_name: 'Manitoba Weightlifting Association',
        official_website: 'https://mbweightlifting.net/',
        aliases: ['Manitoba Weightlifting Association', 'Manitoba', 'MB', 'Manitoba Weightlifting', 'MWA'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Manitoba Weightlifting Association',
                acronym: 'MWA',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Weightlifting Canada Haltérophilie Provincial Directory'
            },
            {
                language_code: 'en',
                full_name: 'Manitoba',
                acronym: null,
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'ISO 3166-2:CA-MB / WCH Athletes Council'
            }
        ]
    },
    {
        canonical_name: 'New-Brunswick Weightlifting Association',
        official_website: 'https://nbweightlifting.wordpress.com/',
        aliases: ['New-Brunswick Weightlifting Association', 'New Brunswick', 'Nouveau-Brunswick', 'NB', 'New Brunswick Weightlifting', 'NBWA'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'New-Brunswick Weightlifting Association',
                acronym: 'NBWA',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Weightlifting Canada Haltérophilie Provincial Directory'
            },
            {
                language_code: 'en',
                full_name: 'New Brunswick',
                acronym: 'NB',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'ISO 3166-2:CA-NB / WCH Athletes Council'
            },
            {
                language_code: 'fr',
                full_name: 'Nouveau-Brunswick',
                acronym: 'NB',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'ISO 3166-2:CA-NB Bilingual'
            }
        ]
    },
    {
        canonical_name: 'Newfoundland Weightlifting Association',
        official_website: 'http://www.nlweightlifting.com/',
        aliases: ['Newfoundland Weightlifting Association', 'Newfoundland', 'Newfoundland and Labrador', 'NL', 'Newfoundland Weightlifting', 'NLWA'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Newfoundland Weightlifting Association',
                acronym: 'NLWA',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Weightlifting Canada Haltérophilie Provincial Directory'
            },
            {
                language_code: 'en',
                full_name: 'Newfoundland',
                acronym: null,
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WCH Athletes Council'
            }
        ]
    },
    {
        canonical_name: 'Northwest Territories',
        official_website: 'https://weightliftingcanada.ca',
        aliases: ['Northwest Territories', 'NWT', 'NT'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Northwest Territories',
                acronym: null,
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WCH Athletes Council / ISO 3166-2:CA-NT'
            }
        ]
    },
    {
        canonical_name: 'Nova Scotia Weightlifting Association',
        official_website: 'http://www.nsweightlifting.ca/',
        aliases: ['Nova Scotia Weightlifting Association', 'Nova Scotia', 'NS', 'Nova Scotia Weightlifting', 'NSWA'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Nova Scotia Weightlifting Association',
                acronym: 'NSWA',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Weightlifting Canada Haltérophilie Provincial Directory'
            },
            {
                language_code: 'en',
                full_name: 'Nova Scotia',
                acronym: 'NS',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'ISO 3166-2:CA-NS / WCH Athletes Council'
            }
        ]
    },
    {
        canonical_name: 'Nunavut',
        official_website: 'https://weightliftingcanada.ca',
        aliases: ['Nunavut', 'NU'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Nunavut',
                acronym: null,
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WCH Athletes Council / ISO 3166-2:CA-NU'
            }
        ]
    },
    {
        canonical_name: 'Ontario Weightlifting Association',
        official_website: 'https://www.onweightlifting.ca/',
        aliases: ['Ontario Weightlifting Association', 'Ontario', 'ON', 'Ontario Weightlifting', 'OWA'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Ontario Weightlifting Association',
                acronym: 'OWA',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Weightlifting Canada Haltérophilie Provincial Directory'
            },
            {
                language_code: 'en',
                full_name: 'Ontario',
                acronym: 'ON',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'ISO 3166-2:CA-ON / WCH Athletes Council'
            }
        ]
    },
    {
        canonical_name: 'Prince Edward Island',
        official_website: 'https://weightliftingcanada.ca',
        aliases: ['Prince Edward Island', 'PEI', 'PE', 'PEI Weightlifting'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Prince Edward Island',
                acronym: 'PEI',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WCH Athletes Council / ISO 3166-2:CA-PE'
            }
        ]
    },
    {
        canonical_name: 'Saskatchewan Weightlifting Association',
        official_website: 'https://saskweightlifting.com/',
        aliases: ['Saskatchewan Weightlifting Association', 'Saskatchewan', 'SK', 'Saskatchewan Weightlifting', 'SWA'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Saskatchewan Weightlifting Association',
                acronym: 'SWA',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Weightlifting Canada Haltérophilie Provincial Directory'
            },
            {
                language_code: 'en',
                full_name: 'Saskatchewan',
                acronym: 'SK',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'ISO 3166-2:CA-SK / WCH Athletes Council'
            }
        ]
    },
    {
        canonical_name: 'Yukon',
        official_website: 'http://yukonweightlift.weebly.com/',
        aliases: ['Yukon', 'YT'],
        localizations: [
            {
                language_code: 'en',
                full_name: 'Yukon',
                acronym: null,
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WCH Athletes Council / ISO 3166-2:CA-YT'
            }
        ]
    }
];

async function seedCanadianProvinces() {
    console.log('Starting seed of Canadian provinces and territories...\n');

    // 1. Resolve Weightlifting Canada Haltérophilie (WCH)
    const { data: wch, error: wchErr } = await supabase
        .from('federation_registry')
        .select('id, canonical_name')
        .eq('short_code', 'WCH')
        .single();

    if (wchErr || !wch) {
        console.error('❌ Could not find WCH in federation_registry:', wchErr?.message);
        process.exit(1);
    }
    console.log(`Found parent: ${wch.canonical_name} (${wch.id})\n`);

    // 2. Update existing Québec (FHQ) record: set short_code = NULL, add QC / Québec aliases
    console.log('Updating existing Québec (FHQ) record...');
    const { data: fhq, error: fhqFindErr } = await supabase
        .from('federation_registry')
        .select('id, known_aliases')
        .eq('canonical_name', 'Fédération d\'haltérophilie du Québec')
        .single();

    if (fhqFindErr || !fhq) {
        console.error('❌ Could not find FHQ in federation_registry:', fhqFindErr?.message);
    } else {
        const mergedAliases = new Set(fhq.known_aliases || []);
        mergedAliases.add('Québec');
        mergedAliases.add('Quebec');
        mergedAliases.add('QC');
        mergedAliases.add('FHQ');
        mergedAliases.add('Quebec Weightlifting Federation');

        await supabase
            .from('federation_registry')
            .update({
                short_code: null, // Symmetrical: all regional bodies have short_code = NULL
                parent_federation_id: wch.id,
                official_website: 'https://fedhaltero.qc.ca',
                known_aliases: Array.from(mergedAliases)
            })
            .eq('id', fhq.id);

        // Add QC alias localizations to FHQ
        const qcLocs = [
            {
                federation_id: fhq.id,
                language_code: 'fr',
                full_name: 'Québec',
                acronym: 'QC',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WCH Athletes Council / ISO 3166-2:CA-QC'
            },
            {
                federation_id: fhq.id,
                language_code: 'en',
                full_name: 'Quebec',
                acronym: 'QC',
                name_type: 'common_alias',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WCH Athletes Council / ISO 3166-2:CA-QC'
            }
        ];

        for (const loc of qcLocs) {
            const { data: existLoc } = await supabase
                .from('federation_localizations')
                .select('id')
                .eq('federation_id', fhq.id)
                .eq('language_code', loc.language_code)
                .eq('full_name', loc.full_name);

            if (existLoc && existLoc.length > 0) {
                await supabase.from('federation_localizations').update(loc).eq('id', existLoc[0].id);
            } else {
                await supabase.from('federation_localizations').insert(loc);
            }
        }

        // Affiliation
        const { data: existFhqAff } = await supabase
            .from('federation_affiliations')
            .select('id')
            .eq('child_id', fhq.id)
            .eq('parent_id', wch.id);

        if (!existFhqAff || existFhqAff.length === 0) {
            await supabase.from('federation_affiliations').insert({
                child_id: fhq.id,
                parent_id: wch.id,
                relationship_type: 'regional_subdivision',
                effective_start: '1970-01-01',
                is_active: true
            });
        }
        console.log('  ✓ Updated FHQ: short_code = NULL, parent = WCH, aliases enriched.\n');
    }

    // 3. Upsert the remaining 12 Canadian provinces and territories
    let count = 0;
    for (const prov of canadianProvinces) {
        const regPayload = {
            canonical_name: prov.canonical_name,
            short_code: null, // Symmetrical: all regional bodies have short_code = NULL
            country_code: 'CAN',
            level: 'regional_state_wso',
            parent_federation_id: wch.id,
            official_website: prov.official_website,
            known_aliases: prov.aliases,
            is_verified: true
        };

        const { data: existingReg } = await supabase
            .from('federation_registry')
            .select('id')
            .eq('canonical_name', prov.canonical_name);

        let provFedId;
        if (existingReg && existingReg.length > 0) {
            provFedId = existingReg[0].id;
            await supabase
                .from('federation_registry')
                .update(regPayload)
                .eq('id', provFedId);
        } else {
            const { data: inserted, error: insErr } = await supabase
                .from('federation_registry')
                .insert(regPayload)
                .select('id')
                .single();
            if (insErr) {
                console.error(`Error inserting ${prov.canonical_name}:`, insErr.message);
                continue;
            }
            provFedId = inserted.id;
        }

        // Localizations
        for (const loc of prov.localizations) {
            const locRecord = {
                federation_id: provFedId,
                ...loc
            };

            const { data: existLoc } = await supabase
                .from('federation_localizations')
                .select('id')
                .eq('federation_id', provFedId)
                .eq('language_code', loc.language_code)
                .eq('full_name', loc.full_name);

            if (existLoc && existLoc.length > 0) {
                await supabase.from('federation_localizations').update(locRecord).eq('id', existLoc[0].id);
            } else {
                await supabase.from('federation_localizations').insert(locRecord);
            }
        }

        // Affiliation
        const affRecord = {
            child_id: provFedId,
            parent_id: wch.id,
            relationship_type: 'regional_subdivision',
            effective_start: '1970-01-01',
            is_active: true
        };

        const { data: existAff } = await supabase
            .from('federation_affiliations')
            .select('id')
            .eq('child_id', provFedId)
            .eq('parent_id', wch.id)
            .eq('relationship_type', 'regional_subdivision');

        if (existAff && existAff.length > 0) {
            await supabase.from('federation_affiliations').update(affRecord).eq('id', existAff[0].id);
        } else {
            await supabase.from('federation_affiliations').insert(affRecord);
        }

        count++;
        console.log(`  ✓ [${count}/${canadianProvinces.length}] Synced: ${prov.canonical_name} (${provFedId})`);
    }

    console.log(`\n✅ Finished seeding Canadian provinces and territories under Weightlifting Canada Haltérophilie (WCH).`);
}

seedCanadianProvinces().catch(err => {
    console.error('Fatal error in Canadian provinces seeder:', err);
    process.exit(1);
});
