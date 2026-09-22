-- ============================================================================
-- VERIFICATION (SELECT-ONLY): Affiliation Edge Verification Backfill
-- Migration: add-affiliation-verification-and-backfill-2026-09-21.sql
-- Run each numbered block separately (self-hosted instances return only the
-- last statement's result set). No DML, no DDL.
-- Expected: 388 verified membership edges (192 international + 196 continental);
-- every verified edge carries a citation and verified_on date.
-- ============================================================================

-- 1. Membership edge verification totals by parent and relationship type
SELECT p.short_code AS parent, a.relationship_type,
       count(*) AS total,
       count(*) FILTER (WHERE a.is_verified) AS verified
FROM public.federation_affiliations a
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE a.relationship_type IN ('international_member','continental_member')
  AND a.is_active = true
GROUP BY p.short_code, a.relationship_type
ORDER BY p.short_code, a.relationship_type;
-- Expected: AWF=45, EWF=50, OWF=22, PAWF=40, WFA=39 (continental, all verified);
-- IWF=192 (international, all verified). Total 388.

-- 2. Verified membership edges missing a citation or date (integrity check)
SELECT count(*) AS invalid_verified_edges
FROM public.federation_affiliations
WHERE is_verified = true
  AND (citation IS NULL OR verified_on IS NULL);
-- Expected: 0

-- 3. Unverified membership edges remaining (should be none)
SELECT p.short_code AS parent, a.relationship_type, count(*) AS unverified
FROM public.federation_affiliations a
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE a.relationship_type IN ('international_member','continental_member')
  AND a.is_active = true
  AND a.is_verified = false
GROUP BY p.short_code, a.relationship_type;
-- Expected: no rows

-- 4. Edge types intentionally left unverified (out of scope)
SELECT p.short_code AS parent, a.relationship_type, count(*) AS edges,
       count(*) FILTER (WHERE a.is_verified) AS verified
FROM public.federation_affiliations a
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE a.relationship_type NOT IN ('international_member','continental_member')
  AND a.is_active = true
GROUP BY p.short_code, a.relationship_type
ORDER BY p.short_code, a.relationship_type;
-- Expected: IWF continental_confederation=5 (0 verified);
-- WCH regional_subdivision=13, USAW regional_subdivision=26 (0 verified)

-- 5. Spot check: WFA edges carry the Africa citation
SELECT r.short_code AS child, a.is_verified, a.verified_on,
       left(a.citation, 60) AS citation_excerpt
FROM public.federation_affiliations a
JOIN public.federation_registry r ON r.id = a.child_id
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE p.short_code = 'WFA'
  AND a.relationship_type = 'continental_member'
  AND a.is_active = true
ORDER BY r.short_code;
-- Expected: 39 rows, all is_verified=true, verified_on=2026-09-21

-- 6. Spot check: MKD and NRF retain exactly one verified international edge each
SELECT r.short_code AS child, p.short_code AS parent, a.relationship_type, a.is_verified
FROM public.federation_affiliations a
JOIN public.federation_registry r ON r.id = a.child_id
JOIN public.federation_registry p ON p.id = a.parent_id
WHERE r.short_code IN ('MKD','NRF')
ORDER BY r.short_code;
-- Expected: MKD -> IWF international_member verified; NRF -> IWF international_member verified
