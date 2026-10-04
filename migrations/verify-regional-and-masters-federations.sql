-- ============================================================================
-- VERIFICATION: Regional, Intercontinental & Masters Federation Ingestion
-- Date: 2026-09-24
--
-- Checks:
--   1. Distribution of entities across levels in public.federation_registry.
--   2. Verification of global_international entities (IWF, UMWF, IMWA).
--   3. Verification of intercontinental_regional entities (CWF, MWF, Arabic Weightlifting Federation).
--   4. Verification of regional entities (Pan-Am, Europe, Asia, Oceania, Africa).
--   5. Localizations for Arabic Weightlifting Federation (authentic AWF acronym, 3 names).
--   6. Verified affiliation edges (regional_confederation & intercontinental_confederation).
--   7. Remote Procedure Call (RPC) list_federation_options compatibility.
--   8. search_federations('AWF') disambiguation ranking.
-- ============================================================================

-- 1. Level Distribution
SELECT 
    level, 
    count(*) AS total_count,
    count(*) FILTER (WHERE is_verified = true) AS verified_count
FROM public.federation_registry
GROUP BY level
ORDER BY total_count DESC;

-- 2. Global International Entities
SELECT 
    canonical_name, 
    short_code, 
    level, 
    is_verified, 
    official_website
FROM public.federation_registry
WHERE level = 'global_international'
ORDER BY canonical_name;

-- 3. Intercontinental Regional Entities
SELECT 
    canonical_name, 
    short_code, 
    level, 
    is_verified
FROM public.federation_registry
WHERE level = 'intercontinental_regional'
ORDER BY canonical_name;

-- 4. Arabic Weightlifting Federation Localizations Check
SELECT 
    fl.language_code,
    fl.full_name,
    fl.acronym,
    fl.name_type,
    fl.citation
FROM public.federation_localizations fl
JOIN public.federation_registry f ON fl.federation_id = f.id
WHERE f.canonical_name = 'Arabic Weightlifting Federation'
ORDER BY fl.language_code, fl.name_type;

-- 5. Verified Affiliation Edges Summary
SELECT 
    p.short_code AS parent_short_code,
    p.canonical_name AS parent_name,
    a.relationship_type,
    count(*) AS edge_count,
    count(*) FILTER (WHERE a.is_verified = true) AS verified_edges
FROM public.federation_affiliations a
JOIN public.federation_registry p ON a.parent_id = p.id
WHERE a.relationship_type IN ('intercontinental_confederation', 'regional_confederation')
GROUP BY p.short_code, p.canonical_name, a.relationship_type
ORDER BY p.short_code, a.relationship_type;

-- 6. RPC Test: list_federation_options with 'global_international' and 'international'
SELECT 
    canonical_name, 
    short_code, 
    level, 
    total_count
FROM public.list_federation_options(p_level => 'global_international', p_limit => 10);

SELECT 
    canonical_name, 
    short_code, 
    level, 
    total_count
FROM public.list_federation_options(p_level => 'international', p_limit => 10);

-- 7. Disambiguation Test: search_federations('AWF')
SELECT 
    canonical_name,
    matched_name,
    matched_acronym,
    level,
    match_rank,
    is_temporally_exact
FROM public.search_federations('AWF')
ORDER BY match_rank DESC, canonical_name;
