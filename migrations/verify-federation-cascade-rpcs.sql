-- ========================================================================
-- Read-only verification for create_federation_cascade_rpcs.sql
-- Run manually AFTER the migration. Performs SELECTs and function EXECUTE
-- calls only. Expected results are noted inline.
-- Date: 2026-09-22
-- ========================================================================

-- 1. Functions exist with expected signatures and volatility
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_args,
       p.provolatile
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('list_federation_options', 'get_federation_lineage')
ORDER BY p.proname;
-- Expected: exactly 2 rows.
--   list_federation_options | p_level text, p_parent_id uuid, p_query text, p_as_of_date date, p_limit integer, p_offset integer | s
--   get_federation_lineage  | p_entity_id uuid, p_as_of_date date                                                                | s

-- 2. EXECUTE privileges mirror the search_federations convention
-- NOTE: filter on routine_name — role_routine_grants stores the bare routine
-- name there; specific_name holds the internal signature string
-- (e.g. 'list_federation_options(text,uuid,text,date,int,int)'), so a
-- specific_name IN (...) predicate matches nothing (0 rows, corrected 2026-09-22).
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE specific_schema = 'public'
  AND routine_name IN ('list_federation_options', 'get_federation_lineage')
ORDER BY routine_name, grantee;
-- Expected: EXECUTE for anon, authenticated, service_role on BOTH functions (6 rows).

-- 3. Option counts match the underlying registry (total_count integrity)
SELECT 'options(national)' AS source, max(total_count) AS n
FROM public.list_federation_options(p_level => 'national')
UNION ALL
SELECT 'registry(national)', count(*)
FROM public.federation_registry WHERE level = 'national'
UNION ALL
SELECT 'options(continental)', max(total_count)
FROM public.list_federation_options(p_level => 'continental')
UNION ALL
SELECT 'registry(continental)', count(*)
FROM public.federation_registry WHERE level = 'continental';
-- Expected: rows pair up with EQUAL n (options vs registry for each level).

-- 4. Parent constraint works (Canada: WCH children)
SELECT canonical_name, short_code, level, total_count
FROM public.list_federation_options(
    p_level => 'regional_state_wso',
    p_parent_id => (SELECT id FROM public.federation_registry WHERE short_code = 'WCH'),
    p_limit => 200
);
-- Expected: 13 rows (Canadian provincial/territorial bodies incl. FHQ), total_count = 13.

-- 5. PIT display-name filtering works (WCH historical name)
SELECT id, canonical_name, display_names
FROM public.list_federation_options(
    p_level => 'national',
    p_query => 'CWFHC',
    p_as_of_date => DATE '2015-01-01'
);
-- Expected: 1 row, WCH, display_names containing 'Canadian Weightlifting Federation'/'CWFHC'
-- but NOT the 2021 primary name (not yet valid on 2015-01-01).

-- 6. Lineage: FHQ full chain with PIT filtering
-- NOTE: FHQ has short_code = NULL by design (all 13 Canadian regional bodies
-- do; see scripts/production/seed-vetted-canadian-provinces.js). Resolve by
-- canonical_name; a short_code lookup returns NULL and raises 22023.
SELECT *
FROM public.get_federation_lineage(
    (SELECT id FROM public.federation_registry
     WHERE canonical_name = 'Fédération d''haltérophilie du Québec'),
    DATE '2026-06-05'
);
-- Expected: 3 rows ordered by depth:
--   depth 1: parent WCH   (regional_subdivision,  is_verified = false, citation NULL)
--   depth 2: parent IWF   (international_member,  is_verified = true)
--   depth 2: parent PAWF  (continental_member,    is_verified = true)

-- 7. Lineage: entity with no affiliations returns EMPTY (not an error)
-- NOTE: the original club subselect can return NULL (no clubs exist), which
-- raises 22023. AWF (Asian Weightlifting Federation) is a deterministic leaf
-- post-migration: zero outgoing active edges under the recognised-autonomy
-- model (verified: AWF/EWF/OWF/PAWF/WFA/IWF all resolve by short_code).
SELECT *
FROM public.get_federation_lineage(
    (SELECT id FROM public.federation_registry WHERE short_code = 'AWF')
);
-- Expected: 0 rows (missing association, not an error).

-- 8. Lineage: unknown id RAISES an error (HTTP route returns 404 instead)
-- SELECT * FROM public.get_federation_lineage(gen_random_uuid());
-- Expected: ERROR. (Commented out; uncomment to confirm the error path.)

-- 9. Pagination math sanity (limit/offset clamp)
SELECT count(*) AS page_rows, max(total_count) AS total
FROM public.list_federation_options(p_level => 'national', p_limit => 5);
-- Expected: page_rows = 5, total = 198 (has_more = 0 + 5 < 198 => true).

-- 10. Affiliations-aware parent filter (Ecuador under PAWF)
-- Pre-fix behaviour: 0 rows (NGBs carry parent_federation_id = NULL, so the
-- legacy-column-only filter missed all 40 Pan American Weightlifting
-- Federation (PAWF) members). The option count must equal the count of
-- active continental_member edges to PAWF, and Ecuador must be present.
-- Presence check: Ecuador's canonical name is Spanish ("Federación Ecuatoriana
-- de Levantamiento de Pesas") — LIKE '%ecuador%' never matches it; identify
-- by short_code/alias instead (first manual run 2026-09-22: counts 40/40,
-- assertion corrected).
SELECT 'pawf_national_options' AS source, count(*) AS n,
       bool_or(short_code = 'ECU'
               OR EXISTS (SELECT 1 FROM unnest(known_aliases) a
                          WHERE lower(trim(a)) = 'ecuador')) AS has_ecuador
FROM public.list_federation_options(
    p_level => 'national',
    p_parent_id => (SELECT id FROM public.federation_registry WHERE short_code = 'PAWF'),
    p_limit => 200
)
UNION ALL
SELECT 'pawf_continental_member_edges', count(*), NULL
FROM public.federation_affiliations fa
JOIN public.federation_registry p ON p.id = fa.parent_id
WHERE p.short_code = 'PAWF'
  AND fa.relationship_type = 'continental_member'
  AND fa.is_active = true;
-- Expected: both n values EQUAL (40); has_ecuador = true.

-- 11. Affiliations-aware parent filter with Point-in-Time (PIT) date
SELECT count(*) AS n,
       bool_or(short_code = 'ECU'
               OR EXISTS (SELECT 1 FROM unnest(known_aliases) a
                          WHERE lower(trim(a)) = 'ecuador')) AS has_ecuador
FROM public.list_federation_options(
    p_level => 'national',
    p_parent_id => (SELECT id FROM public.federation_registry WHERE short_code = 'PAWF'),
    p_as_of_date => DATE '2026-06-05',
    p_limit => 200
);
-- Expected: n = 40 (edges have NULL effective windows and always qualify), has_ecuador = true.
