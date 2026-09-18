#!/usr/bin/env node
/**
 * PRODUCTION: Living Federation Registry Seeder & WSO Migrator
 *
 * Populates public.federation_registry with:
 *   1. International & Continental Bodies (IWF, PAWF, EWF)
 *   2. USAW & migration of all 26 WSOs from usaw_wso_information
 *   3. Canada (WCH) and 10 Provincial Associations (OWA/ON, FHQ/QC, BCWA/BC, etc.)
 *   4. Brazil (CBLP) and State Federations (FELP/SP, FEPERJ/RJ, etc.)
 *   5. Key Latin American NGBs (Colombia, Mexico, Ecuador, Venezuela, Peru)
 *
 * Idempotent: Can be re-run safely without creating duplicates.
 *
 * Usage:
 *   node scripts/production/seed-federation-registry.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function upsertFederation(fed) {
    // Check by short_code first (if present), then by canonical_name
    let query = supabase.from('federation_registry').select('id, canonical_name, known_aliases');
    if (fed.short_code) {
        query = query.eq('short_code', fed.short_code);
    } else {
        query = query.eq('canonical_name', fed.canonical_name);
    }

    const { data: existing, error: findErr } = await query;
    if (findErr) {
        console.error(`Error querying ${fed.canonical_name}:`, findErr.message);
        return null;
    }

    if (existing && existing.length > 0) {
        // Merge known_aliases with existing
        const currentAliases = new Set(existing[0].known_aliases || []);
        for (const a of fed.known_aliases || []) {
            currentAliases.add(a);
        }

        const updatePayload = {
            canonical_name: fed.canonical_name,
            short_code: fed.short_code,
            country_code: fed.country_code,
            level: fed.level,
            parent_federation_id: fed.parent_federation_id || null,
            known_aliases: Array.from(currentAliases),
            is_verified: true,
            updated_at: new Date().toISOString()
        };

        const { data: updated, error: updErr } = await supabase
            .from('federation_registry')
            .update(updatePayload)
            .eq('id', existing[0].id)
            .select()
            .single();

        if (updErr) {
            console.error(`Error updating ${fed.canonical_name}:`, updErr.message);
            return null;
        }
        return updated;
    } else {
        const insertPayload = {
            ...fed,
            known_aliases: fed.known_aliases || [],
            is_verified: true
        };

        const { data: inserted, error: insErr } = await supabase
            .from('federation_registry')
            .insert(insertPayload)
            .select()
            .single();

        if (insErr) {
            console.error(`Error inserting ${fed.canonical_name}:`, insErr.message);
            return null;
        }
        return inserted;
    }
}

async function run() {
    console.log('\n============================================================');
    console.log('[FEDERATION REGISTRY SEEDER] Starting Seed Execution');
    console.log('============================================================\n');

    // ------------------------------------------------------------------------
    // 1. International & Continental Bodies
    // ------------------------------------------------------------------------
    console.log('[1/5] Seeding International & Continental Bodies...');
    const iwf = await upsertFederation({
        canonical_name: 'International Weightlifting Federation',
        short_code: 'IWF',
        country_code: null,
        level: 'international',
        known_aliases: [
            "Fédération Internationale d'Haltérophilie",
            'FIH',
            'IWF Weightlifting',
            'International Weightlifting'
        ]
    });
    console.log(`  ✓ IWF: ${iwf?.id}`);

    const pawf = await upsertFederation({
        canonical_name: 'Pan American Weightlifting Federation',
        short_code: 'PAWF',
        country_code: null,
        level: 'continental',
        parent_federation_id: iwf?.id,
        known_aliases: [
            'Federación Panamericana de Levantamiento de Pesas',
            'FPLP',
            'Pan American Weightlifting',
            'PanAm Weightlifting',
            'Pan-American Weightlifting Federation'
        ]
    });
    console.log(`  ✓ PAWF: ${pawf?.id}`);

    const ewf = await upsertFederation({
        canonical_name: 'European Weightlifting Federation',
        short_code: 'EWF',
        country_code: null,
        level: 'continental',
        parent_federation_id: iwf?.id,
        known_aliases: [
            "Fédération Européenne d'Haltérophilie",
            'European Weightlifting'
        ]
    });
    console.log(`  ✓ EWF: ${ewf?.id}`);

    // ------------------------------------------------------------------------
    // 2. United States & WSO Migration
    // ------------------------------------------------------------------------
    console.log('\n[2/5] Seeding USAW & Migrating WSOs from usaw_wso_information...');
    const usaw = await upsertFederation({
        canonical_name: 'USA Weightlifting',
        short_code: 'USAW',
        country_code: 'USA',
        level: 'national',
        parent_federation_id: pawf?.id,
        known_aliases: [
            'United States Weightlifting',
            'USA Weightlifting Inc.',
            'USAW Inc.',
            'US Weightlifting',
            'United States of America Weightlifting'
        ]
    });
    console.log(`  ✓ USAW: ${usaw?.id}`);

    // Fetch all rows from usaw_wso_information
    const { data: wsos, error: wsoErr } = await supabase
        .from('usaw_wso_information')
        .select('*')
        .order('name');

    if (wsoErr) {
        console.error('  ❌ Error reading usaw_wso_information:', wsoErr.message);
    } else {
        console.log(`  Found ${wsos.length} WSOs to migrate into federation_registry...`);
        let wsoCount = 0;
        for (const wso of wsos) {
            const shortCode = `USAW-WSO-${wso.wso_id}`;
            const aliases = new Set([
                wso.name,
                `${wso.name} WSO`,
                `USAW ${wso.name}`,
                `USAW ${wso.name} WSO`,
                `${wso.name} Weightlifting`
            ]);

            // Add constituent states if array
            if (Array.isArray(wso.states)) {
                for (const st of wso.states) {
                    aliases.add(st);
                    aliases.add(`${st} WSO`);
                    aliases.add(`${st} Weightlifting`);
                }
            }

            const res = await upsertFederation({
                canonical_name: `${wso.name} WSO`,
                short_code: shortCode,
                country_code: 'USA',
                level: 'regional_state_wso',
                parent_federation_id: usaw?.id,
                known_aliases: Array.from(aliases)
            });
            if (res) wsoCount++;
        }
        console.log(`  ✓ Migrated ${wsoCount}/${wsos.length} WSOs under USAW.`);
    }

    // ------------------------------------------------------------------------
    // 3. Canada & Provincial Associations
    // ------------------------------------------------------------------------
    console.log('\n[3/5] Seeding Canada & Provincial Associations...');
    const wch = await upsertFederation({
        canonical_name: 'Weightlifting Canada Haltérophilie',
        short_code: 'WCH',
        country_code: 'CAN',
        level: 'national',
        parent_federation_id: pawf?.id,
        known_aliases: [
            'CWF',
            'Canadian Weightlifting Federation',
            'Canadian Weightlifting Federation Haltérophilie Canadienne',
            'CWFHC',
            'Haltérophilie Canada',
            'Weightlifting Canada',
            'Canada Weightlifting'
        ]
    });
    console.log(`  ✓ WCH (Canada): ${wch?.id}`);

    const canadianProvinces = [
        {
            name: 'Ontario Weightlifting Association',
            code: 'CAN-ON',
            aliases: ['OWA', 'Ontario', 'ON', 'ON Weightlifting', 'Weightlifting Ontario', 'Ontario Weightlifting']
        },
        {
            name: 'Fédération haltérophile du Québec',
            code: 'CAN-QC',
            aliases: ['FHQ', 'Québec', 'Quebec', 'QC', 'Fédération d’Haltérophilie du Québec', 'Haltérophilie Québec', 'Quebec Weightlifting']
        },
        {
            name: 'British Columbia Weightlifting Association',
            code: 'CAN-BC',
            aliases: ['BCWA', 'BC Weightlifting', 'British Columbia', 'BC', 'Weightlifting BC']
        },
        {
            name: 'Alberta Weightlifting Association',
            code: 'CAN-AB',
            aliases: ['AWA', 'Alberta', 'AB', 'Alberta Weightlifting', 'AB Weightlifting']
        },
        {
            name: 'Saskatchewan Weightlifting Association',
            code: 'CAN-SK',
            aliases: ['SWA', 'Saskatchewan', 'SK', 'Saskatchewan Weightlifting']
        },
        {
            name: 'Manitoba Weightlifting Association',
            code: 'CAN-MB',
            aliases: ['MWA', 'Manitoba', 'MB', 'Manitoba Weightlifting']
        },
        {
            name: 'Nova Scotia Weightlifting Association',
            code: 'CAN-NS',
            aliases: ['NSWA', 'Nova Scotia', 'NS', 'Nova Scotia Weightlifting']
        },
        {
            name: 'New Brunswick Weightlifting Association',
            code: 'CAN-NB',
            aliases: ['NBWA', 'New Brunswick', 'Nouveau-Brunswick', 'NB', 'New Brunswick Weightlifting']
        },
        {
            name: 'Weightlifting Newfoundland and Labrador',
            code: 'CAN-NL',
            aliases: ['NLWA', 'Newfoundland', 'Newfoundland & Labrador', 'NL', 'Weightlifting NL']
        },
        {
            name: 'Prince Edward Island Weightlifting',
            code: 'CAN-PE',
            aliases: ['PEIWA', 'PEI', 'Prince Edward Island', 'PE']
        }
    ];

    for (const prov of canadianProvinces) {
        await upsertFederation({
            canonical_name: prov.name,
            short_code: prov.code,
            country_code: 'CAN',
            level: 'regional_state_wso',
            parent_federation_id: wch?.id,
            known_aliases: prov.aliases
        });
        console.log(`  ✓ ${prov.code}: ${prov.name}`);
    }

    // ------------------------------------------------------------------------
    // 4. Brazil & State Federations
    // ------------------------------------------------------------------------
    console.log('\n[4/5] Seeding Brazil & State Federations...');
    const cblp = await upsertFederation({
        canonical_name: 'Confederação Brasileira de Levantamento de Pesos',
        short_code: 'CBLP',
        country_code: 'BRA',
        level: 'national',
        parent_federation_id: pawf?.id,
        known_aliases: [
            'Confederacao Brasileira de Levantamento de Pesos',
            'CBLP Brasil',
            'Brazilian Weightlifting Federation',
            'Levantamento de Pesos Brasil'
        ]
    });
    console.log(`  ✓ CBLP (Brazil): ${cblp?.id}`);

    const brazilianStates = [
        {
            name: 'Federação Paulista de Levantamento de Pesos',
            code: 'FELP',
            aliases: ['FELP', 'Federação Paulista', 'Federacao Paulista', 'São Paulo', 'Sao Paulo', 'SP', 'CBLP - São Paulo', 'CBLP - SP']
        },
        {
            name: 'Federação de Levantamento de Pesos do Estado do Rio de Janeiro',
            code: 'FEPERJ',
            aliases: ['FEPERJ', 'Federação do Rio de Janeiro', 'Rio de Janeiro', 'RJ', 'CBLP - Rio de Janeiro', 'CBLP - RJ']
        },
        {
            name: 'Federação Mineira de Levantamento de Pesos',
            code: 'FELPM',
            aliases: ['FELPM', 'Federação Mineira', 'Minas Gerais', 'MG', 'CBLP - Minas Gerais']
        },
        {
            name: 'Federação Sul-Rio-Grandense de Levantamento de Pesos',
            code: 'FSLP',
            aliases: ['FSLP', 'Rio Grande do Sul', 'RS', 'CBLP - Rio Grande do Sul']
        },
        {
            name: 'Federação Bahiana de Levantamento de Pesos',
            code: 'FBLP',
            aliases: ['FBLP', 'Bahia', 'BA', 'CBLP - Bahia']
        },
        {
            name: 'Federação Catarinense de Levantamento de Pesos',
            code: 'FCLP',
            aliases: ['FCLP', 'Santa Catarina', 'SC', 'CBLP - Santa Catarina']
        },
        {
            name: 'Federação Paranaense de Levantamento de Pesos',
            code: 'FPLP-BR',
            aliases: ['FPLP', 'Paraná', 'Parana', 'PR', 'CBLP - Paraná']
        }
    ];

    for (const st of brazilianStates) {
        await upsertFederation({
            canonical_name: st.name,
            short_code: st.code,
            country_code: 'BRA',
            level: 'regional_state_wso',
            parent_federation_id: cblp?.id,
            known_aliases: st.aliases
        });
        console.log(`  ✓ ${st.code}: ${st.name}`);
    }

    // ------------------------------------------------------------------------
    // 5. Latin American & PanAm NGBs
    // ------------------------------------------------------------------------
    console.log('\n[5/5] Seeding Key Latin American / PanAm NGBs...');
    const latinAmericanNgbs = [
        {
            canonical_name: 'Federación Colombiana de Levantamiento de Pesas',
            short_code: 'FEDEPESAS',
            country_code: 'COL',
            known_aliases: ['FEDEPESAS', 'Federacion Colombiana de Levantamiento de Pesas', 'Colombia Weightlifting', 'Fedepesas Colombia']
        },
        {
            canonical_name: 'Federación Mexicana de Levantamiento de Pesas',
            short_code: 'FMLP',
            country_code: 'MEX',
            known_aliases: ['FMLP', 'Federacion Mexicana de Levantamiento de Pesas', 'Mexico Weightlifting', 'FMLP México']
        },
        {
            canonical_name: 'Federación Ecuatoriana de Levantamiento de Pesas',
            short_code: 'FECONAPEL',
            country_code: 'ECU',
            known_aliases: ['FECONAPEL', 'Federacion Ecuatoriana de Levantamiento de Pesas', 'Ecuador Weightlifting', 'Feconapel Ecuador']
        },
        {
            canonical_name: 'Federación Venezolana de Levantamiento de Pesas',
            short_code: 'FEVEPESAS',
            country_code: 'VEN',
            known_aliases: ['FEVEPESAS', 'Federacion Venezolana de Levantamiento de Pesas', 'Venezuela Weightlifting', 'Fevepesas Venezuela']
        },
        {
            canonical_name: 'Federación Deportiva Peruana de Levantamiento de Pesas',
            short_code: 'FDPLP',
            country_code: 'PER',
            known_aliases: ['FDPLP', 'FPLP', 'Federacion Peruana de Levantamiento de Pesas', 'Peru Weightlifting']
        }
    ];

    for (const ngb of latinAmericanNgbs) {
        await upsertFederation({
            ...ngb,
            level: 'national',
            parent_federation_id: pawf?.id
        });
        console.log(`  ✓ ${ngb.short_code}: ${ngb.canonical_name}`);
    }

    // ------------------------------------------------------------------------
    // VERIFICATION: Search RPC
    // ------------------------------------------------------------------------
    console.log('\n============================================================');
    console.log('Testing search_federations RPC resolution...');
    console.log('============================================================');

    const testQueries = [
        'WCH',
        'Federação Paulista',
        'CBLP - São Paulo',
        'Ontario',
        'California South',
        'FECONAPEL'
    ];

    for (const q of testQueries) {
        const { data: results, error } = await supabase.rpc('search_federations', { query_text: q });
        if (error) {
            console.error(`  ❌ Search error for "${q}":`, error.message);
        } else if (results && results.length > 0) {
            const top = results[0];
            console.log(`  🔍 Query: "${q}" ➔ [Rank ${top.match_rank}] ${top.canonical_name} (${top.short_code || top.country_code}) [Parent: ${top.parent_name || 'None'}]`);
        } else {
            console.log(`  ⚪ Query: "${q}" ➔ No match found.`);
        }
    }

    console.log('\n[FEDERATION REGISTRY SEEDER] Finished successfully!\n');
    process.exit(0);
}

run().catch(err => {
    console.error('Fatal error in seeder:', err);
    process.exit(1);
});
