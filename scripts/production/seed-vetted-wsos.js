#!/usr/bin/env node
/**
 * PRODUCTION: Seed 26 Official USAW WSOs into Living Federation Registry
 *
 * Sourced directly from public.usaw_wso_information (official USAW territory definitions).
 *
 * Populates:
 *   1. public.federation_registry (26 regional_state_wso records under USA)
 *   2. public.federation_localizations (primary WSO names & aliases with 2022-01-01 start date)
 *   3. public.federation_affiliations (child: WSO -> parent: USAW, type: 'regional_subdivision')
 *
 * Idempotent: Can be safely re-run without creating duplicate records.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function seedWsos() {
    console.log('Starting seed of 26 USAW WSOs into federation_registry...\n');

    // 1. Resolve USAW ID
    const { data: usaw, error: usawErr } = await supabase
        .from('federation_registry')
        .select('id, canonical_name')
        .eq('short_code', 'USAW')
        .single();

    if (usawErr || !usaw) {
        console.error('❌ Could not find USAW in federation_registry:', usawErr?.message);
        process.exit(1);
    }
    console.log(`Found USAW: ${usaw.canonical_name} (${usaw.id})`);

    // 2. Fetch all 26 WSOs from usaw_wso_information
    const { data: wsos, error: wsoErr } = await supabase
        .from('usaw_wso_information')
        .select('*')
        .order('wso_id');

    if (wsoErr) {
        console.error('❌ Error querying usaw_wso_information:', wsoErr.message);
        process.exit(1);
    }

    console.log(`Loaded ${wsos.length} official WSOs from usaw_wso_information.\n`);

    let count = 0;

    for (const wso of wsos) {
        const canonicalName = `${wso.name} WSO`;
        const authenticAcronym = wso.name === 'DMV' ? 'DMV' : null;
        const shortCode = null;

        // Compile aliases
        const aliases = new Set([
            canonicalName,
            wso.name,
            `USAW ${wso.name}`,
            `USAW ${wso.name} WSO`,
            `${wso.name} Weightlifting`
        ]);

        if (Array.isArray(wso.states)) {
            for (const st of wso.states) {
                aliases.add(`${st} WSO`);
                aliases.add(`${st} Weightlifting`);
            }
        }

        // Upsert federation_registry
        const regPayload = {
            canonical_name: canonicalName,
            short_code: shortCode,
            country_code: 'USA',
            level: 'regional_state_wso',
            parent_federation_id: usaw.id,
            official_website: wso.official_url,
            founded_date: '2022-01-01',
            known_aliases: Array.from(aliases),
            is_verified: true
        };

        const { data: existingReg } = await supabase
            .from('federation_registry')
            .select('id')
            .eq('canonical_name', canonicalName);

        let wsoFedId;
        if (existingReg && existingReg.length > 0) {
            wsoFedId = existingReg[0].id;
            await supabase
                .from('federation_registry')
                .update(regPayload)
                .eq('id', wsoFedId);
        } else {
            const { data: inserted, error: insErr } = await supabase
                .from('federation_registry')
                .insert(regPayload)
                .select('id')
                .single();
            if (insErr) {
                console.error(`Failed to insert ${canonicalName}:`, insErr.message);
                continue;
            }
            wsoFedId = inserted.id;
        }

        // Upsert localizations
        const locs = [
            {
                language_code: 'en',
                full_name: canonicalName,
                acronym: authenticAcronym,
                name_type: 'primary',
                valid_from: '2022-01-01',
                valid_until: null,
                is_official_in_charter: true,
                citation: wso.official_url || 'USAW WSO Directory'
            },
            {
                language_code: 'en',
                full_name: `${wso.name} Weightlifting`,
                acronym: null,
                name_type: 'common_alias',
                valid_from: '2022-01-01',
                valid_until: null,
                is_official_in_charter: false,
                citation: wso.official_url || 'USAW WSO Directory'
            }
        ];

        for (const loc of locs) {
            const locRecord = {
                federation_id: wsoFedId,
                ...loc
            };

            const { data: existLoc } = await supabase
                .from('federation_localizations')
                .select('id')
                .eq('federation_id', wsoFedId)
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

        // Upsert affiliation (child: WSO -> parent: USAW)
        const affRecord = {
            child_id: wsoFedId,
            parent_id: usaw.id,
            relationship_type: 'regional_subdivision',
            effective_start: '2022-01-01',
            is_active: true
        };

        const { data: existAff } = await supabase
            .from('federation_affiliations')
            .select('id')
            .eq('child_id', wsoFedId)
            .eq('parent_id', usaw.id)
            .eq('relationship_type', 'regional_subdivision');

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

        count++;
        console.log(`  ✓ [${count}/${wsos.length}] Synced WSO-${wso.wso_id}: ${canonicalName} (${wsoFedId})`);
    }

    console.log(`\n✅ Finished seeding ${count}/${wsos.length} USAW WSOs.`);
}

seedWsos().catch(err => {
    console.error('Fatal error in WSO seeder:', err);
    process.exit(1);
});
