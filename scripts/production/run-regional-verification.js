const path = require('path');
const fs = require('fs');
const https = require('https');

require('dotenv').config({ path: 'c:/Users/PB/Desktop/Bost Laboratory Services/Weightlifting/weightlifting-database/.env' });

async function runSql(sql) {
    const url = new URL(process.env.SUPABASE_URL);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: url.hostname,
            port: 443,
            path: '/pg/query',
            method: 'POST',
            headers: {
                'apikey': process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': 'Bearer ' + (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
                'Content-Type': 'application/json'
            },
            rejectUnauthorized: false
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(body);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', reject);
        req.write(JSON.stringify({ query: sql }));
        req.end();
    });
}

async function verify() {
    console.log('--- 1. Federation Registry Level Distribution ---');
    console.table(await runSql(`
        SELECT level, count(*) AS total_count, count(*) FILTER (WHERE is_verified = true) AS verified_count
        FROM public.federation_registry
        GROUP BY level ORDER BY total_count DESC;
    `));

    console.log('\n--- 2. Global International Entities ---');
    console.table(await runSql(`
        SELECT canonical_name, short_code, level, is_verified, official_website
        FROM public.federation_registry
        WHERE level = 'global_international'
        ORDER BY canonical_name;
    `));

    console.log('\n--- 3. Intercontinental Regional Entities ---');
    console.table(await runSql(`
        SELECT canonical_name, short_code, level, is_verified
        FROM public.federation_registry
        WHERE level = 'intercontinental_regional'
        ORDER BY canonical_name;
    `));

    console.log('\n--- 4. Arabic Weightlifting Federation Localizations ---');
    console.table(await runSql(`
        SELECT fl.language_code, fl.full_name, fl.acronym, fl.name_type, fl.citation
        FROM public.federation_localizations fl
        JOIN public.federation_registry f ON fl.federation_id = f.id
        WHERE f.canonical_name = 'Arabic Weightlifting Federation'
        ORDER BY fl.language_code, fl.name_type;
    `));

    console.log('\n--- 5. Verified Regional & Intercontinental Affiliation Edges ---');
    console.table(await runSql(`
        SELECT p.short_code AS parent_short_code, p.canonical_name AS parent_name,
               a.relationship_type, count(*) AS edge_count,
               count(*) FILTER (WHERE a.is_verified = true) AS verified_edges
        FROM public.federation_affiliations a
        JOIN public.federation_registry p ON a.parent_id = p.id
        WHERE a.relationship_type IN ('intercontinental_confederation', 'regional_confederation')
        GROUP BY p.short_code, p.canonical_name, a.relationship_type
        ORDER BY p.short_code, a.relationship_type;
    `));

    console.log('\n--- 6. RPC Test: list_federation_options(global_international) ---');
    console.table(await runSql(`
        SELECT canonical_name, short_code, level, total_count
        FROM public.list_federation_options(p_level => 'global_international', p_limit => 5);
    `));

    console.log('\n--- 7. RPC Test: list_federation_options(international) (backward compatibility) ---');
    console.table(await runSql(`
        SELECT canonical_name, short_code, level, total_count
        FROM public.list_federation_options(p_level => 'international', p_limit => 5);
    `));

    console.log('\n--- 8. Disambiguation Test: search_federations(\'AWF\') ---');
    console.table(await runSql(`
        SELECT canonical_name, matched_name, matched_acronym, level, match_rank, is_temporally_exact
        FROM public.search_federations('AWF')
        ORDER BY match_rank DESC, canonical_name;
    `));
}

verify().catch(err => {
    console.error('Verification error:', err);
    process.exit(1);
});
