-- ============================================================================
-- MIGRATION: Add Regional, Intercontinental & Masters Federation Levels
-- Date: 2026-09-24
--
-- Purpose:
--   1. Expand public.federation_registry.level CHECK constraint to support:
--      'global_international', 'international', 'continental',
--      'intercontinental_regional', 'regional', 'national',
--      'regional_state_wso', 'club'.
--   2. Reclassify the International Weightlifting Federation (IWF) to
--      level = 'global_international'.
--   3. Update public.list_federation_options RPC parameter validation and
--      parent/level matching to support the new levels and preserve
--      bidirectional compatibility between 'international' and 'global_international'.
--
-- Idempotent: Safe to re-run.
-- ============================================================================

BEGIN;

-- 1. Drop existing check constraints on level in public.federation_registry
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.federation_registry'::regclass 
          AND contype = 'c' 
          AND pg_get_constraintdef(oid) LIKE '%level%'
    ) LOOP
        EXECUTE 'ALTER TABLE public.federation_registry DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

-- 2. Add updated CHECK constraint on level
ALTER TABLE public.federation_registry
    ADD CONSTRAINT federation_registry_level_check
    CHECK (level IN (
        'global_international',
        'international',
        'continental',
        'intercontinental_regional',
        'regional',
        'national',
        'regional_state_wso',
        'club'
    ));

-- 3. Re-classify International Weightlifting Federation (IWF) to global_international
UPDATE public.federation_registry
SET level = 'global_international',
    updated_at = now()
WHERE short_code = 'IWF'
  AND level = 'international';

-- 4. Update relationship_type CHECK constraint on public.federation_affiliations
ALTER TABLE public.federation_affiliations
    DROP CONSTRAINT IF EXISTS federation_affiliations_relationship_type_check;

ALTER TABLE public.federation_affiliations
    ADD CONSTRAINT federation_affiliations_relationship_type_check
    CHECK (relationship_type IN (
        'continental_confederation',
        'intercontinental_confederation',
        'regional_confederation',
        'international_member',
        'continental_member',
        'regional_member',
        'regional_subdivision',
        'club_member'
    ));

-- 5. Update list_federation_options RPC
DROP FUNCTION IF EXISTS public.list_federation_options(TEXT, UUID, TEXT, DATE, INT, INT);

CREATE OR REPLACE FUNCTION public.list_federation_options(
    p_level TEXT DEFAULT NULL,
    p_parent_id UUID DEFAULT NULL,
    p_query TEXT DEFAULT NULL,
    p_as_of_date DATE DEFAULT CURRENT_DATE,
    p_limit INT DEFAULT 50,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    canonical_name TEXT,
    short_code VARCHAR(15),
    country_code VARCHAR(3),
    level TEXT,
    parent_federation_id UUID,
    is_verified BOOLEAN,
    known_aliases TEXT[],
    display_names JSONB,
    total_count BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_target DATE := COALESCE(p_as_of_date, CURRENT_DATE);
    v_clean_query TEXT := NULLIF(trim(COALESCE(p_query, '')), '');
BEGIN
    IF p_level IS NOT NULL
       AND p_level NOT IN (
           'global_international', 'international', 'continental',
           'intercontinental_regional', 'regional', 'national',
           'regional_state_wso', 'club'
       ) THEN
        RAISE EXCEPTION 'Invalid level "%". Allowed: global_international, international, continental, intercontinental_regional, regional, national, regional_state_wso, club', p_level
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH base AS (
        SELECT
            f.id,
            f.canonical_name,
            f.short_code,
            f.country_code,
            f.level,
            f.parent_federation_id,
            f.is_verified,
            f.known_aliases,
            COALESCE(loc.display_names, '[]'::jsonb) AS display_names,
            count(*) OVER () AS total_count
        FROM public.federation_registry f
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                       jsonb_build_object(
                           'language_code', fl.language_code,
                           'full_name', fl.full_name,
                           'acronym', fl.acronym,
                           'name_type', fl.name_type
                       )
                       ORDER BY
                           CASE fl.name_type
                               WHEN 'primary' THEN 0
                               WHEN 'official_translation' THEN 1
                               WHEN 'common_alias' THEN 2
                               ELSE 3
                           END,
                           fl.full_name
                   ) AS display_names
            FROM public.federation_localizations fl
            WHERE fl.federation_id = f.id
              AND (fl.valid_from IS NULL OR fl.valid_from <= v_target)
              AND (fl.valid_until IS NULL OR fl.valid_until >= v_target)
        ) loc ON true
        WHERE (
            p_level IS NULL
            OR f.level = p_level
            OR (p_level = 'international' AND f.level = 'global_international')
            OR (p_level = 'global_international' AND f.level = 'international')
        )
          AND (
              p_parent_id IS NULL
              OR f.parent_federation_id = p_parent_id
              OR EXISTS (
                  SELECT 1
                  FROM public.federation_affiliations fa
                  WHERE fa.child_id = f.id
                    AND fa.parent_id = p_parent_id
                    AND fa.is_active = true
                    AND (fa.effective_start IS NULL OR fa.effective_start <= v_target)
                    AND (fa.effective_end IS NULL OR fa.effective_end >= v_target)
              )
          )
          AND (
                v_clean_query IS NULL
             OR lower(f.canonical_name) LIKE '%' || lower(v_clean_query) || '%'
             OR lower(COALESCE(f.short_code, '')) = lower(v_clean_query)
             OR EXISTS (SELECT 1 FROM unnest(f.known_aliases) a
                        WHERE lower(trim(a)) = lower(v_clean_query))
             OR (length(v_clean_query) >= 3 AND EXISTS (
                    SELECT 1 FROM public.federation_localizations q
                    WHERE q.federation_id = f.id
                      AND (q.valid_from IS NULL OR q.valid_from <= v_target)
                      AND (q.valid_until IS NULL OR q.valid_until >= v_target)
                      AND (lower(q.full_name) LIKE '%' || lower(v_clean_query) || '%'
                           OR upper(COALESCE(q.acronym, '')) = upper(v_clean_query))))
             )
    )
    SELECT
        b.id,
        b.canonical_name,
        b.short_code,
        b.country_code,
        b.level,
        b.parent_federation_id,
        b.is_verified,
        b.known_aliases,
        b.display_names,
        b.total_count
    FROM base b
    ORDER BY b.canonical_name ASC
    LIMIT v_limit OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_federation_options(TEXT, UUID, TEXT, DATE, INT, INT)
TO anon, authenticated, service_role;

COMMIT;
