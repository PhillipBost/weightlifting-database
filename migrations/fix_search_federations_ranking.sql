-- Migration: Fix search_federations ordering and short-query substring matching
-- Purpose:
-- 1. Ensure DISTINCT ON (c.id) results are wrapped and sorted by match_rank DESC in outer query
-- 2. Restrict ILIKE substring matching to query strings of 3 or more characters (avoiding noisy 2-letter substring matches)
-- 3. Maintain explicit casting to match RETURNS TABLE signature

DROP FUNCTION IF EXISTS public.search_federations(TEXT, DATE);

CREATE OR REPLACE FUNCTION public.search_federations(
    query_text TEXT,
    as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    id UUID,
    canonical_name TEXT,
    matched_name TEXT,
    matched_acronym VARCHAR(15),
    matched_language VARCHAR(5),
    matched_name_type TEXT,
    level TEXT,
    country_code VARCHAR(3),
    is_verified BOOLEAN,
    is_temporally_exact BOOLEAN,
    match_rank INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    clean_query TEXT := trim(query_text);
    upper_query TEXT := upper(trim(query_text));
    target_date DATE := COALESCE(as_of_date, CURRENT_DATE);
    is_short_query BOOLEAN := length(trim(query_text)) < 3;
BEGIN
    IF clean_query = '' OR clean_query IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH candidate_matches AS (
        -- Matches on localized names & acronyms
        SELECT 
            f.id,
            f.canonical_name,
            fl.full_name AS matched_name,
            fl.acronym AS matched_acronym,
            fl.language_code AS matched_language,
            fl.name_type AS matched_name_type,
            f.level,
            f.country_code,
            f.is_verified,
            -- Check if actively valid on target_date
            CASE 
                WHEN (fl.valid_from IS NULL OR fl.valid_from <= target_date)
                 AND (fl.valid_until IS NULL OR fl.valid_until >= target_date)
                THEN true
                ELSE false
            END AS is_temporally_exact,
            CASE
                -- Rank 100: Exact match on full name or acronym AND temporally valid
                WHEN (lower(fl.full_name) = lower(clean_query) OR upper(fl.acronym) = upper_query)
                 AND (fl.valid_from IS NULL OR fl.valid_from <= target_date)
                 AND (fl.valid_until IS NULL OR fl.valid_until >= target_date)
                THEN 100

                -- Rank 85: Exact match on authentic localized name, but outside meet's date range
                WHEN (lower(fl.full_name) = lower(clean_query) OR upper(fl.acronym) = upper_query)
                THEN 85

                -- Rank 75: Substring match on localized full_name (only for queries >= 3 characters)
                WHEN NOT is_short_query AND fl.full_name ILIKE '%' || clean_query || '%'
                THEN 75

                ELSE 0
            END AS match_rank
        FROM public.federation_localizations fl
        JOIN public.federation_registry f ON fl.federation_id = f.id
        WHERE lower(fl.full_name) = lower(clean_query)
           OR upper(fl.acronym) = upper_query
           OR (NOT is_short_query AND fl.full_name ILIKE '%' || clean_query || '%')

        UNION ALL

        -- Matches directly on federation_registry (canonical_name or short_code)
        SELECT 
            f.id,
            f.canonical_name,
            f.canonical_name AS matched_name,
            f.short_code AS matched_acronym,
            'en'::VARCHAR(5) AS matched_language,
            'canonical'::TEXT AS matched_name_type,
            f.level,
            f.country_code,
            f.is_verified,
            true AS is_temporally_exact,
            CASE
                -- Rank 95: Exact short_code match
                WHEN upper(f.short_code) = upper_query THEN 95
                -- Rank 90: Exact canonical_name match
                WHEN lower(f.canonical_name) = lower(clean_query) THEN 90
                -- Rank 70: Substring ILIKE on canonical_name (only for queries >= 3 characters)
                WHEN NOT is_short_query AND f.canonical_name ILIKE '%' || clean_query || '%' THEN 70
                -- Rank 65: Match inside legacy known_aliases array
                WHEN EXISTS (
                    SELECT 1 FROM unnest(f.known_aliases) alias 
                    WHERE lower(trim(alias)) = lower(clean_query)
                ) THEN 65
                ELSE 0
            END AS match_rank
        FROM public.federation_registry f
        WHERE upper(f.short_code) = upper_query
           OR lower(f.canonical_name) = lower(clean_query)
           OR (NOT is_short_query AND f.canonical_name ILIKE '%' || clean_query || '%')
           OR EXISTS (
               SELECT 1 FROM unnest(f.known_aliases) alias 
               WHERE lower(trim(alias)) = lower(clean_query)
           )
    ),
    deduped_candidates AS (
        SELECT DISTINCT ON (c.id)
            c.id,
            c.canonical_name,
            c.matched_name,
            c.matched_acronym,
            c.matched_language,
            c.matched_name_type,
            c.level,
            c.country_code,
            c.is_verified,
            c.is_temporally_exact,
            c.match_rank
        FROM candidate_matches c
        WHERE c.match_rank > 0
        ORDER BY c.id, c.match_rank DESC, c.is_temporally_exact DESC, c.is_verified DESC
    )
    SELECT 
        d.id,
        d.canonical_name::TEXT,
        d.matched_name::TEXT,
        d.matched_acronym::VARCHAR(15),
        d.matched_language::VARCHAR(5),
        d.matched_name_type::TEXT,
        d.level::TEXT,
        d.country_code::VARCHAR(3),
        d.is_verified,
        d.is_temporally_exact,
        d.match_rank
    FROM deduped_candidates d
    ORDER BY d.match_rank DESC, d.is_temporally_exact DESC, d.is_verified DESC, d.canonical_name ASC
    LIMIT 10;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_federations(TEXT, DATE) TO anon, authenticated, service_role;
