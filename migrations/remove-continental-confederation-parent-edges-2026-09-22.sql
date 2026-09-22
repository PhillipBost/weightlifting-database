-- ============================================================================
-- MIGRATION: Remove Continental-Confederation Parent Edges (Recognised-Autonomy)
-- Date: 2026-09-22
--
-- Context: the five continental confederations — Asian Weightlifting Federation
-- (AWF), European Weightlifting Federation (EWF), Oceania Weightlifting
-- Federation (OWF), Pan American Weightlifting Federation (PAWF), and
-- Weightlifting Federation of Africa (WFA) — were seeded with
-- relationship_type = 'continental_confederation' pointing at the International
-- Weightlifting Federation (IWF) as parent. That edge mis-models an autonomous
-- recognition relationship as subordination. No continental federation is
-- subordinate to the International Weightlifting Federation (IWF); National
-- Governing Bodies (NGBs) carry dual direct membership (international_member
-- to the International Weightlifting Federation (IWF) plus continental_member
-- to their confederation), which would be redundant under transitivity.
--
-- Recognised-autonomy model: a hop in public.federation_affiliations means
-- "affiliated with / recognised by", never "subordinate to", unless the edge
-- type is explicitly hierarchical (e.g. regional_subdivision). Continentals
-- become roots alongside the International Weightlifting Federation (IWF).
--
-- Effect: deletes the 5 continental_confederation -> International Weightlifting
-- Federation (IWF) edges. Idempotent: safe to re-run (deletes zero rows when
-- already applied). Follows the DELETE ... USING public.federation_registry
-- pattern of migrations/fix-continental-assignments-2026-09-21.sql.
-- The seeder (scripts/production/seed-vetted-baseline.js) is updated separately
-- so re-seeding does not resurrect these edges.
--
-- Note: migrations/verify-affiliation-verification-2026-09-21.sql §4 expected
-- "IWF continental_confederation=5" — that expectation is superseded by this
-- migration (expected after: 0).
--
-- Per project protocol: run manually after review, then run
-- migrations/verify-remove-continental-confederation-edges-2026-09-22.sql.
-- ============================================================================

BEGIN;

DELETE FROM public.federation_affiliations a
USING public.federation_registry r, public.federation_registry p
WHERE a.child_id = r.id
  AND a.parent_id = p.id
  AND p.short_code = 'IWF'
  AND a.relationship_type = 'continental_confederation';

COMMIT;
