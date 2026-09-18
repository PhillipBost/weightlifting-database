-- ============================================================================
-- MIGRATION: Living Federation & Regional Registry
-- Description: Creates public.federation_registry, search RPC, and links owlcms_meets
-- ============================================================================

-- 1. Create table public.federation_registry
CREATE TABLE IF NOT EXISTS public.federation_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name TEXT NOT NULL,
    short_code VARCHAR(15),                    -- e.g. 'WCH', 'CBLP', 'USAW', 'FELP', 'CAN-ON'
    country_code VARCHAR(3),                   -- ISO-3 code (e.g. 'CAN', 'BRA', 'USA', 'ECU')
    level TEXT NOT NULL CHECK (level IN ('international', 'continental', 'national', 'regional_state_wso', 'club')),
    parent_federation_id UUID REFERENCES public.federation_registry(id) ON DELETE SET NULL,
    known_aliases TEXT[] NOT NULL DEFAULT '{}',
    is_verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes for rapid lookups
CREATE INDEX IF NOT EXISTS idx_federation_aliases_gin ON public.federation_registry USING GIN (known_aliases);
CREATE INDEX IF NOT EXISTS idx_federation_country ON public.federation_registry(country_code);
CREATE INDEX IF NOT EXISTS idx_federation_parent ON public.federation_registry(parent_federation_id);
CREATE INDEX IF NOT EXISTS idx_federation_short_code ON public.federation_registry(short_code);
CREATE INDEX IF NOT EXISTS idx_federation_canonical_name ON public.federation_registry(canonical_name);
CREATE INDEX IF NOT EXISTS idx_federation_level ON public.federation_registry(level);

-- 3. Trigger for updated_at
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_federation_registry_updated_at'
    ) THEN
        CREATE TRIGGER trigger_update_federation_registry_updated_at
        BEFORE UPDATE ON public.federation_registry
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
    END IF;
END $$;

-- 4. Add federation_id to public.owlcms_meets
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'owlcms_meets' 
          AND column_name = 'federation_id'
    ) THEN
        ALTER TABLE public.owlcms_meets 
        ADD COLUMN federation_id UUID REFERENCES public.federation_registry(id) ON DELETE SET NULL;

        CREATE INDEX IF NOT EXISTS idx_owlcms_meets_federation_id ON public.owlcms_meets(federation_id);
    END IF;
END $$;

-- 5. Search RPC: public.search_federations(query_text TEXT)
-- Ranked matching:
--   Rank 100: Exact match in known_aliases (case-insensitive)
--   Rank 90:  Exact match on short_code (case-insensitive)
--   Rank 80:  Exact match or ILIKE on canonical_name
--   Rank 70:  Partial substring match inside any known_aliases element
CREATE OR REPLACE FUNCTION public.search_federations(query_text TEXT)
RETURNS TABLE (
    id UUID,
    canonical_name TEXT,
    short_code VARCHAR(15),
    country_code VARCHAR(3),
    level TEXT,
    parent_federation_id UUID,
    parent_name TEXT,
    known_aliases TEXT[],
    is_verified BOOLEAN,
    match_rank INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    clean_query TEXT := trim(query_text);
    upper_query TEXT := upper(trim(query_text));
BEGIN
    IF clean_query = '' OR clean_query IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH ranked AS (
        SELECT 
            f.id,
            f.canonical_name,
            f.short_code,
            f.country_code,
            f.level,
            f.parent_federation_id,
            p.canonical_name AS parent_name,
            f.known_aliases,
            f.is_verified,
            CASE 
                -- Rank 100: Exact match in known_aliases array (case-insensitive)
                WHEN EXISTS (
                    SELECT 1 FROM unnest(f.known_aliases) alias 
                    WHERE lower(trim(alias)) = lower(clean_query)
                ) THEN 100

                -- Rank 90: Exact short_code match (case-insensitive)
                WHEN upper(f.short_code) = upper_query THEN 90

                -- Rank 85: Exact canonical_name match (case-insensitive)
                WHEN lower(f.canonical_name) = lower(clean_query) THEN 85

                -- Rank 80: Substring ILIKE on canonical_name
                WHEN f.canonical_name ILIKE '%' || clean_query || '%' THEN 80

                -- Rank 70: Substring ILIKE inside any alias element
                WHEN EXISTS (
                    SELECT 1 FROM unnest(f.known_aliases) alias 
                    WHERE alias ILIKE '%' || clean_query || '%'
                ) THEN 70

                ELSE 0
            END AS match_rank
        FROM public.federation_registry f
        LEFT JOIN public.federation_registry p ON f.parent_federation_id = p.id
    )
    SELECT 
        r.id,
        r.canonical_name,
        r.short_code,
        r.country_code,
        r.level,
        r.parent_federation_id,
        r.parent_name,
        r.known_aliases,
        r.is_verified,
        r.match_rank
    FROM ranked r
    WHERE r.match_rank > 0
    ORDER BY r.match_rank DESC, r.is_verified DESC, r.canonical_name ASC
    LIMIT 10;
END;
$$;

-- 6. Permissions
GRANT SELECT, INSERT, UPDATE ON public.federation_registry TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_federations(TEXT) TO anon, authenticated, service_role;
