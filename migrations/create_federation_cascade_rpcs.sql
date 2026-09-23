-- ========================================================================
-- Migration: Federation Cascade RPCs (Supabase-native surface)
-- Purpose:
--   Expose the geography/organizer cascade lookups as SQL functions so
--   direct service-role callers (frontend gateway owanalytics.org) can use
--   supabase.rpc() instead of proxying through the upload server (port 8890).
--   The HTTP routes on scripts/production/owlcms-upload-server.js remain for
--   the import pipeline; field-for-field parity with
--   docs/GEOGRAPHY_ORGANIZER_CASCADE_API.md sections 2 and 3.
-- Conventions mirror public.search_federations(TEXT, DATE) (see
--   migrations/fix_search_federations_ranking.sql): plpgsql, STABLE, EXECUTE
--   granted to anon, authenticated, service_role.
-- READ-ONLY functions: neither function writes to any table.
-- Per project protocol: run manually after review, then run
--   migrations/verify-federation-cascade-rpcs.sql
-- Date: 2026-09-22
-- ========================================================================

BEGIN;

-- ------------------------------------------------------------------
-- 1. list_federation_options
-- Equivalent of GET /api/federations/options
-- ------------------------------------------------------------------
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
       AND p_level NOT IN ('international', 'continental', 'national', 'regional_state_wso', 'club') THEN
        RAISE EXCEPTION 'Invalid level "%". Allowed: international, continental, national, regional_state_wso, club', p_level
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
        WHERE (p_level IS NULL OR f.level = p_level)
          AND (
              p_parent_id IS NULL
              OR f.parent_federation_id = p_parent_id
              -- National Governing Bodies (NGBs) carry parent_federation_id = NULL
              -- with dual membership via affiliation edges (international_member to
              -- the International Weightlifting Federation (IWF) plus
              -- continental_member to their confederation). A legacy-column-only
              -- filter returns 0 rows for e.g. level=national under PAWF (Pan
              -- American Weightlifting Federation) — reported 2026-09-22: Ecuador
              -- missing. The EXISTS clause below is the authoritative parent
              -- check at every level; the legacy column is a fast-path only.
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

-- ------------------------------------------------------------------
-- 2. get_federation_lineage
-- Equivalent of GET /api/federations/lineage/:id?as_of_date=
-- Affiliation walk over federation_affiliations (NOT a chain of command).
-- Recognised-autonomy model (2026-09-22): a hop means "affiliated with /
-- recognised by", never "subordinate to", unless the edge type is explicitly
-- hierarchical (e.g. regional_subdivision). Continental confederations are
-- autonomous roots alongside the International Weightlifting Federation (IWF).
-- No continental -> IWF edge exists, so no PAWF -> IWF hop should appear.
-- Depth cap 6, cycle-guarded via visited-array. Edges are filtered to
-- those active on p_as_of_date (PIT), mirroring the HTTP contract.
-- Unknown id -> RAISES (HTTP route maps this to 404).
-- No affiliations -> empty result set (missing association, not an error).
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_federation_lineage(UUID, DATE);

CREATE OR REPLACE FUNCTION public.get_federation_lineage(
    p_entity_id UUID,
    p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    depth INT,
    parent_id UUID,
    parent_canonical_name TEXT,
    parent_short_code VARCHAR(15),
    parent_level TEXT,
    relationship_type TEXT,
    is_verified BOOLEAN,
    citation TEXT,
    effective_start DATE,
    effective_end DATE,
    is_root BOOLEAN
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_target DATE := COALESCE(p_as_of_date, CURRENT_DATE);
    v_exists BOOLEAN;
BEGIN
    IF p_entity_id IS NULL THEN
        RAISE EXCEPTION 'p_entity_id is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.federation_registry f WHERE f.id = p_entity_id)
    INTO v_exists;
    IF NOT v_exists THEN
        RAISE EXCEPTION 'Federation % not found', p_entity_id
            USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY
    WITH RECURSIVE walk AS (
        -- Base: direct parents of the requested entity
        SELECT
            1 AS depth,
            fa.parent_id,
            fa.relationship_type,
            fa.is_verified,
            fa.citation,
            fa.effective_start,
            fa.effective_end,
            ARRAY[fa.child_id, fa.parent_id] AS visited
        FROM public.federation_affiliations fa
        WHERE fa.child_id = p_entity_id
          AND fa.is_active = true
          AND (fa.effective_start IS NULL OR fa.effective_start <= v_target)
          AND (fa.effective_end IS NULL OR fa.effective_end >= v_target)

        UNION ALL

        -- Recursive: parents of parents (stops on depth cap or cycle)
        SELECT
            w.depth + 1,
            fa.parent_id,
            fa.relationship_type,
            fa.is_verified,
            fa.citation,
            fa.effective_start,
            fa.effective_end,
            w.visited || fa.parent_id
        FROM walk w
        JOIN public.federation_affiliations fa ON fa.child_id = w.parent_id
        WHERE w.depth < 6
          AND NOT fa.parent_id = ANY(w.visited)
          AND fa.is_active = true
          AND (fa.effective_start IS NULL OR fa.effective_start <= v_target)
          AND (fa.effective_end IS NULL OR fa.effective_end >= v_target)
    )
    SELECT
        w.depth,
        w.parent_id,
        f.canonical_name::TEXT,
        f.short_code,
        f.level::TEXT,
        w.relationship_type::TEXT,
        w.is_verified,
        w.citation,
        w.effective_start,
        w.effective_end,
        NOT EXISTS (
            SELECT 1
            FROM public.federation_affiliations fa2
            WHERE fa2.child_id = w.parent_id
              AND fa2.is_active = true
              AND (fa2.effective_start IS NULL OR fa2.effective_start <= v_target)
              AND (fa2.effective_end IS NULL OR fa2.effective_end >= v_target)
        ) AS is_root
    FROM walk w
    JOIN public.federation_registry f ON f.id = w.parent_id
    ORDER BY w.depth, f.canonical_name;
END;
$$;

-- ------------------------------------------------------------------
-- 3. EXECUTE grants — mirrors public.search_federations convention
-- (migrations/fix_search_federations_ranking.sql line 154)
-- ------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.list_federation_options(TEXT, UUID, TEXT, DATE, INT, INT)
    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_federation_lineage(UUID, DATE)
    TO anon, authenticated, service_role;

COMMIT;

