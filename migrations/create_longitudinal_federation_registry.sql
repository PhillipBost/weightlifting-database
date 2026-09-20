-- ============================================================================
-- MIGRATION: Longitudinal Living Federation Registry
-- Description:
--   1. Grants permissions on federation_localizations and federation_affiliations
--   2. Adds longitudinal fields to federation_registry (HQ, website, founded/dissolved dates)
--   3. Adds temporal range columns (valid_from, valid_until, name_type, citation) to federation_localizations
--   4. Creates public.federation_headquarters for historical relocations
--   5. Creates Point-in-Time (PIT) search_federations(query_text, as_of_date) RPC
-- ============================================================================

-- 1. Table Permissions for Supabase client & PostgREST roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.federation_localizations TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.federation_affiliations TO anon, authenticated, service_role;

-- 2. Longitudinal & Headquarters Attributes on public.federation_registry
ALTER TABLE public.federation_registry
    ADD COLUMN IF NOT EXISTS headquarters_city TEXT,
    ADD COLUMN IF NOT EXISTS headquarters_country_code VARCHAR(3),
    ADD COLUMN IF NOT EXISTS headquarters_address TEXT,
    ADD COLUMN IF NOT EXISTS official_website TEXT,
    ADD COLUMN IF NOT EXISTS founded_date DATE,
    ADD COLUMN IF NOT EXISTS dissolved_date DATE;

-- 3. Temporal validity and classification on public.federation_localizations
ALTER TABLE public.federation_localizations
    ADD COLUMN IF NOT EXISTS valid_from DATE,
    ADD COLUMN IF NOT EXISTS valid_until DATE,
    ADD COLUMN IF NOT EXISTS name_type TEXT NOT NULL DEFAULT 'primary' 
        CHECK (name_type IN ('primary', 'official_translation', 'historical', 'common_alias')),
    ADD COLUMN IF NOT EXISTS citation TEXT;

CREATE INDEX IF NOT EXISTS idx_federation_localizations_dates 
ON public.federation_localizations (federation_id, valid_from, valid_until);

CREATE INDEX IF NOT EXISTS idx_federation_localizations_names 
ON public.federation_localizations (lower(full_name), upper(acronym));

-- 4. Longitudinal Headquarters Relocations Table
CREATE TABLE IF NOT EXISTS public.federation_headquarters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    federation_id UUID NOT NULL REFERENCES public.federation_registry(id) ON DELETE CASCADE,
    city TEXT NOT NULL,
    country_code VARCHAR(3) NOT NULL,
    address TEXT,
    valid_from DATE,
    valid_until DATE,                          -- NULL indicates current seat
    is_current BOOLEAN NOT NULL DEFAULT false,
    citation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_federation_headquarters_lookup 
ON public.federation_headquarters (federation_id, is_current);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.federation_headquarters TO anon, authenticated, service_role;

-- 5. Drop legacy single-argument search RPC to prevent signature ambiguity
DROP FUNCTION IF EXISTS public.search_federations(TEXT);

-- 6. Point-in-Time (PIT) search_federations RPC
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

                -- Rank 75: Substring match on localized full_name
                WHEN fl.full_name ILIKE '%' || clean_query || '%'
                THEN 75

                ELSE 0
            END AS match_rank
        FROM public.federation_localizations fl
        JOIN public.federation_registry f ON fl.federation_id = f.id
        WHERE lower(fl.full_name) = lower(clean_query)
           OR upper(fl.acronym) = upper_query
           OR fl.full_name ILIKE '%' || clean_query || '%'

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
                -- Rank 70: Substring ILIKE on canonical_name
                WHEN f.canonical_name ILIKE '%' || clean_query || '%' THEN 70
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
           OR f.canonical_name ILIKE '%' || clean_query || '%'
           OR EXISTS (
               SELECT 1 FROM unnest(f.known_aliases) alias 
               WHERE lower(trim(alias)) = lower(clean_query)
           )
    )
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
    LIMIT 10;
END;
$$;

-- 7. Grant search RPC execution
GRANT EXECUTE ON FUNCTION public.search_federations(TEXT, DATE) TO anon, authenticated, service_role;
