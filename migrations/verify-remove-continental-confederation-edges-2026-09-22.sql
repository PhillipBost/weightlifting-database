-- ============================================================================
-- VERIFICATION (SELECT-ONLY): Remove Continental-Confederation Parent Edges
-- Migration: remove-continental-confederation-parent-edges-2026-09-22.sql
-- Run each numbered block separately (self-hosted instances return only the
-- last statement's result set). No DML, no DDL.
-- Pre-migration state: 5 continental_confederation -> IWF edges (AWF, EWF,
-- OWF, PAWF, WFA). Post-migration: 0; each continental is a root.
-- ============================================================================

-- 1. No continental_confederation edges remain (any parent, any active flag)
SELECT count(*) AS remaining_continental_confederation_edges
FROM public.federation_affiliations
WHERE relationship_type = 'continental_confederation';
-- Expected post-migration: 0

-- 1b. Surviving-edge diagnostic: name the remaining rows (run when block 1 > 0)
SELECT r.short_code AS child, p.short_code AS parent, a.is_active, a.is_verified
FROM public.federation_affiliations a
JOIN public.federation_registry r ON r.id = a.child_id
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE a.relationship_type = 'continental_confederation'
ORDER BY r.short_code;
-- Expected post-migration: no rows. Pre-migration: 5 rows
-- (AWF, EWF, OWF, PAWF, WFA each -> IWF).

-- 2. Each continental confederation has zero outgoing active edges (root status)
SELECT r.short_code AS continental,
       count(a.child_id) FILTER (WHERE a.is_active = true) AS active_outgoing_edges
FROM public.federation_registry r
LEFT JOIN public.federation_affiliations a
  ON a.child_id = r.id AND a.is_active = true
WHERE r.short_code IN ('AWF', 'EWF', 'OWF', 'PAWF', 'WFA')
GROUP BY r.short_code
ORDER BY r.short_code;
-- Expected: 5 rows, each active_outgoing_edges = 0

-- 3. National Governing Body (NGB) dual membership intact (WCH example)
SELECT p.short_code AS parent, a.relationship_type, a.is_active, a.is_verified
FROM public.federation_affiliations a
JOIN public.federation_registry r ON r.id = a.child_id
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE r.short_code = 'WCH'
ORDER BY p.short_code;
-- Expected: WCH -> IWF international_member (active, verified) AND
-- WCH -> PAWF continental_member (active, verified). No other WCH edges.

-- 4. Lineage: FHQ full chain has no PAWF -> IWF hop (depth cap check)
-- NOTE: FHQ has short_code = NULL by design (all 13 Canadian regional bodies
-- do; see scripts/production/seed-vetted-canadian-provinces.js). The acronym
-- lives in federation_localizations / known_aliases, so resolve by
-- canonical_name here. A short_code lookup returns NULL and raises 22023.
SELECT *
FROM public.get_federation_lineage(
    (SELECT id FROM public.federation_registry
     WHERE canonical_name = 'Fédération d''haltérophilie du Québec'),
    DATE '2026-06-05'
);
-- Expected: exactly 3 rows ordered by depth:
--   depth 1: parent WCH  (regional_subdivision, is_verified = false, citation NULL)
--   depth 2: parent IWF  (international_member,  is_verified = true)
--   depth 2: parent PAWF (continental_member,    is_verified = true)
-- and NO depth-3 row. A depth-3 IWF-via-PAWF row means the 5 deleted edges
-- were resurrected (e.g. by re-running the unpatched seeder).

-- 5. Superseded expectation ledger (documents the §4 change)
SELECT p.short_code AS parent, a.relationship_type, count(*) AS edges,
       count(*) FILTER (WHERE a.is_verified) AS verified
FROM public.federation_affiliations a
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE a.relationship_type NOT IN ('international_member', 'continental_member')
  AND a.is_active = true
GROUP BY p.short_code, a.relationship_type
ORDER BY p.short_code, a.relationship_type;
-- Expected post-migration: NO IWF continental_confederation row (supersedes
-- verify-affiliation-verification-2026-09-21.sql §4 which expected 5);
-- WCH regional_subdivision=13, USAW regional_subdivision=26 (0 verified).
