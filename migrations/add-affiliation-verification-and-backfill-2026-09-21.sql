-- ============================================================================
-- MIGRATION: Affiliation Edge Verification Metadata + Membership Backfill
-- Date: 2026-09-21
--
-- Context: entity-level verification exists (federation_registry.is_verified) and
-- name/HQ (headquarters) citations exist (federation_localizations.citation,
-- federation_headquarters.citation), but affiliation EDGES had no verification
-- state. All 388 membership edges have now been verified:
--   - 192 international_member edges: ITA (International Testing Agency)
--     "2026 List of Categorised IWF Member Federations", in force 2026-01-01.
--   - 196 continental_member edges, verified per confederation:
--       AWF 45/45 exact; EWF exact after MKD (North Macedonia) removal;
--       OWF exact after NRF (Norfolk Island) removal; PAWF 37 confirmed +
--       GRN/GPE/LCA supplementary; WFA 39/39 via IWRP directory + African
--       championships participation (no roster on official site).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; UPDATEs are safe to re-run.
-- Note: seeders do not manage these columns; re-seeding will not erase
-- verification metadata (upserts only touch relationship/is_active fields).
-- ============================================================================

BEGIN;

-- 1. Schema: verification metadata on affiliation edges
ALTER TABLE public.federation_affiliations
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS citation TEXT,
    ADD COLUMN IF NOT EXISTS verified_on DATE;

-- 2. Integrity: a verified edge must carry a citation
ALTER TABLE public.federation_affiliations
    DROP CONSTRAINT IF EXISTS chk_affiliation_verified_citation;
ALTER TABLE public.federation_affiliations
    ADD CONSTRAINT chk_affiliation_verified_citation
    CHECK (NOT is_verified OR citation IS NOT NULL);

-- 3. Backfill: 192 international_member edges (ITA 2026 categorized list)
UPDATE public.federation_affiliations a
SET is_verified = true,
    citation = 'ITA (International Testing Agency) "2026 List of Categorised IWF Member Federations", version in force as of 1 January 2026 (https://iwf.sport)',
    verified_on = DATE '2026-09-21'
FROM public.federation_registry p
WHERE a.parent_id = p.id
  AND p.short_code = 'IWF'
  AND a.relationship_type = 'international_member'
  AND a.is_active = true;

-- 4. Backfill: 45 AWF (Asian Weightlifting Federation) continental edges
UPDATE public.federation_affiliations a
SET is_verified = true,
    citation = 'Asian Weightlifting Federation member directory (https://awf.sport/): exact 45/45 match',
    verified_on = DATE '2026-09-21'
FROM public.federation_registry p
WHERE a.parent_id = p.id
  AND p.short_code = 'AWF'
  AND a.relationship_type = 'continental_member'
  AND a.is_active = true;

-- 5. Backfill: 50 EWF (European Weightlifting Federation) continental edges
UPDATE public.federation_affiliations a
SET is_verified = true,
    citation = 'European Weightlifting Federation member directory (https://ewf.sport): exact match after North Macedonia (MKD) edge removal',
    verified_on = DATE '2026-09-21'
FROM public.federation_registry p
WHERE a.parent_id = p.id
  AND p.short_code = 'EWF'
  AND a.relationship_type = 'continental_member'
  AND a.is_active = true;

-- 6. Backfill: 22 OWF (Oceania Weightlifting Federation) continental edges
UPDATE public.federation_affiliations a
SET is_verified = true,
    citation = 'Oceania Weightlifting Federation member directory (https://oceaniaweightlifting.com): exact match after Norfolk Island (NRF) edge removal',
    verified_on = DATE '2026-09-21'
FROM public.federation_registry p
WHERE a.parent_id = p.id
  AND p.short_code = 'OWF'
  AND a.relationship_type = 'continental_member'
  AND a.is_active = true;

-- 7. Backfill: 40 PAWF (Pan American Weightlifting Federation) continental edges
UPDATE public.federation_affiliations a
SET is_verified = true,
    citation = 'Pan American Weightlifting Federation member directory (https://panampesas.org/): 37 confirmed + GRN/GPE/LCA supplementary members',
    verified_on = DATE '2026-09-21'
FROM public.federation_registry p
WHERE a.parent_id = p.id
  AND p.short_code = 'PAWF'
  AND a.relationship_type = 'continental_member'
  AND a.is_active = true;

-- 8. Backfill: 39 WFA (Weightlifting Federation of Africa) continental edges
-- No member roster is published on the official site (wfa.com.ly); verified via
-- IWRP (iwrp.net) WFA directory (36/39) union African championships participation
-- 2008-2026 (36/39, complementary coverage) — see
-- scratch/wfa-africa-verification-report.md.
UPDATE public.federation_affiliations a
SET is_verified = true,
    citation = 'Weightlifting Federation of Africa: no roster on official site (wfa.com.ly); verified via IWRP WFA directory (iwrp.net) union African championships participation 2008-2026 (see scratch/wfa-africa-verification-report.md)',
    verified_on = DATE '2026-09-21'
FROM public.federation_registry p
WHERE a.parent_id = p.id
  AND p.short_code = 'WFA'
  AND a.relationship_type = 'continental_member'
  AND a.is_active = true;

COMMIT;
