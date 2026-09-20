#!/usr/bin/env node
/**
 * PRODUCTION: Seed Vetted Batch 2 (USAW, WCH, FHQ) & Link Active OWLCMS Meets
 *
 * Populates:
 *   1. USA Weightlifting (USAW) with historical USWF localization & dual affiliation (IWF + PAWF)
 *   2. Weightlifting Canada Haltérophilie (WCH) with historical CWFHC localization & dual affiliation (IWF + PAWF)
 *   3. Fédération d'haltérophilie du Québec (FHQ) with English/French localizations & subdivision under WCH
 *   4. Links active OWLCMS meets (Meets 1, 2, 3) to their canonical federation IDs
 *
 * Idempotent: Can be safely re-run without creating duplicates.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const batch2 = [
    {
        registry: {
            canonical_name: 'USA Weightlifting',
            short_code: 'USAW',
            country_code: 'USA',
            level: 'national',
            founded_date: '1979-01-01',
            headquarters_city: 'Colorado Springs',
            headquarters_country_code: 'USA',
            headquarters_address: '1 Olympic Plaza, Colorado Springs, CO 80909',
            official_website: 'https://www.usaweightlifting.org',
            known_aliases: ['USAW', 'USA Weightlifting', 'USA Weightlifting Inc.', 'United States Weightlifting Federation', 'USWF'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'USA Weightlifting',
                acronym: 'USAW',
                name_type: 'primary',
                valid_from: '1990-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'USAW Bylaws Article 1'
            },
            {
                language_code: 'en',
                full_name: 'United States Weightlifting Federation',
                acronym: 'USWF',
                name_type: 'historical',
                valid_from: '1979-01-01',
                valid_until: '1989-12-31',
                is_official_in_charter: true,
                citation: 'Amateur Sports Act of 1978 / USAW Corporate Charter'
            }
        ],
        headquarters: [
            {
                city: 'Colorado Springs',
                country_code: 'USA',
                address: '1 Olympic Plaza, Colorado Springs, CO 80909',
                valid_from: '1979-01-01',
                valid_until: null,
                is_current: true,
                citation: 'USAW Bylaws Article 1'
            }
        ],
        affiliations: [
            { parent_short_code: 'IWF', relationship_type: 'international_member' },
            { parent_short_code: 'PAWF', relationship_type: 'continental_member' }
        ]
    },
    {
        registry: {
            canonical_name: 'Weightlifting Canada Haltérophilie',
            short_code: 'WCH',
            country_code: 'CAN',
            level: 'national',
            official_website: 'https://weightliftingcanada.ca',
            known_aliases: ['WCH', 'Weightlifting Canada Haltérophilie', 'Canadian Weightlifting Federation', 'CWFHC', 'Haltérophilie Canada'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'en',
                full_name: 'Weightlifting Canada Haltérophilie',
                acronym: 'WCH',
                name_type: 'primary',
                valid_from: '2021-08-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WCH Code of Conduct & Ethics Rebranding (Aug 1, 2021)'
            },
            {
                language_code: 'en',
                full_name: 'Canadian Weightlifting Federation',
                acronym: 'CWFHC',
                name_type: 'historical',
                valid_from: '1970-01-01',
                valid_until: '2021-07-31',
                is_official_in_charter: true,
                citation: 'Industry Canada Corporate Registry'
            },
            {
                language_code: 'fr',
                full_name: 'Haltérophilie Canada',
                acronym: 'HC',
                name_type: 'official_translation',
                valid_from: '2021-08-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'WCH Bilingual Charter'
            }
        ],
        affiliations: [
            { parent_short_code: 'IWF', relationship_type: 'international_member' },
            { parent_short_code: 'PAWF', relationship_type: 'continental_member' }
        ]
    },
    {
        registry: {
            canonical_name: 'Fédération d\'haltérophilie du Québec',
            short_code: 'FHQ',
            country_code: 'CAN',
            level: 'regional_state_wso',
            headquarters_city: 'Montréal',
            headquarters_country_code: 'CAN',
            official_website: 'https://fedhaltero.qc.ca',
            known_aliases: ['FHQ', 'Fédération d\'haltérophilie du Québec', 'Fédération Haltérophilie du québec', 'FHQ Fédération d\'haltérophilie du Québec', 'Quebec Weightlifting Federation'],
            is_verified: true
        },
        localizations: [
            {
                language_code: 'fr',
                full_name: 'Fédération d\'haltérophilie du Québec',
                acronym: 'FHQ',
                name_type: 'primary',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'Registraire des entreprises du Québec'
            },
            {
                language_code: 'en',
                full_name: 'Quebec Weightlifting Federation',
                acronym: 'QWF',
                name_type: 'official_translation',
                valid_from: '1970-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: 'FHQ English Translation'
            }
        ],
        headquarters: [
            {
                city: 'Montréal',
                country_code: 'CAN',
                valid_from: '1970-01-01',
                valid_until: null,
                is_current: true,
                citation: 'Registraire des entreprises du Québec'
            }
        ],
        affiliations: [
            { parent_short_code: 'WCH', relationship_type: 'regional_subdivision' }
        ]
    }
];

async function seedBatch2() {
    console.log('Starting seed of Vetted Batch 2 (USAW, WCH, FHQ)...\n');

    // Fetch existing bodies to resolve parent short_codes (IWF, PAWF)
    const { data: allFeds, error: fedErr } = await supabase
        .from('federation_registry')
        .select('id, short_code');
    if (fedErr) throw fedErr;

    const idMap = new Map();
    for (const f of allFeds) {
        idMap.set(f.short_code, f.id);
    }

    // 1. Upsert registry records
    for (const item of batch2) {
        const reg = item.registry;
        const { data: existing } = await supabase
            .from('federation_registry')
            .select('id')
            .eq('short_code', reg.short_code);

        let fedId;
        if (existing && existing.length > 0) {
            fedId = existing[0].id;
            await supabase
                .from('federation_registry')
                .update(reg)
                .eq('id', fedId);
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
                ...loc
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

        // 3. Upsert headquarters
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

        // 4. Upsert affiliations
        if (item.affiliations) {
            for (const aff of item.affiliations) {
                const parentId = idMap.get(aff.parent_short_code);
                if (!parentId) {
                    console.warn(`  ⚠️ Could not find parent ID for ${aff.parent_short_code}`);
                    continue;
                }
                const affRecord = {
                    child_id: fedId,
                    parent_id: parentId,
                    relationship_type: aff.relationship_type,
                    is_active: true
                };
                const { data: existAff } = await supabase
                    .from('federation_affiliations')
                    .select('id')
                    .eq('child_id', fedId)
                    .eq('parent_id', parentId)
                    .eq('relationship_type', aff.relationship_type);

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
                console.log(`  ✓ Affiliated ${reg.short_code} -> ${aff.parent_short_code} (${aff.relationship_type})`);
            }
        }
    }

    // 5. Link Active OWLCMS Meets
    console.log('\nLinking active OWLCMS meets to canonical federations...');
    const wchId = idMap.get('WCH');
    const fhqId = idMap.get('FHQ');

    // Meet 1: Championnats canadiens junior -> WCH
    const { error: m1Err } = await supabase
        .from('owlcms_meets')
        .update({ federation_id: wchId })
        .eq('meet_id', 1);
    if (m1Err) console.error('Error linking meet 1:', m1Err.message);
    else console.log(`  ✓ Meet 1 (Championnats canadiens junior) linked to WCH (${wchId})`);

    // Meet 2: Québec Open d'été -> FHQ
    const { error: m2Err } = await supabase
        .from('owlcms_meets')
        .update({ federation_id: fhqId })
        .eq('meet_id', 2);
    if (m2Err) console.error('Error linking meet 2:', m2Err.message);
    else console.log(`  ✓ Meet 2 (Québec Open d'été) linked to FHQ (${fhqId})`);

    // Meet 3: Mini Louis-Cyr & Louis-Cyr -> FHQ
    const { error: m3Err } = await supabase
        .from('owlcms_meets')
        .update({ federation_id: fhqId })
        .eq('meet_id', 3);
    if (m3Err) console.error('Error linking meet 3:', m3Err.message);
    else console.log(`  ✓ Meet 3 (Mini Louis-Cyr & Louis-Cyr) linked to FHQ (${fhqId})`);

    console.log('\n✅ Batch 2 seed and meet linking completed successfully.');
}

seedBatch2().catch(err => {
    console.error('Batch 2 seed error:', err);
    process.exit(1);
});
