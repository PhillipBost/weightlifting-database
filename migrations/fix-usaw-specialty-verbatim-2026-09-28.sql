-- Migration: Verbatim-only fix for USA Weightlifting (USAW) specialty clubs
-- Date: 2026-09-28
-- Authority: self-hosted instance only. Run manually per project protocol.
-- Rule adopted: as-written/as-found. public.usaw_clubs.community_designation is the
-- sole source of truth, stored byte-verbatim from the source table column.
-- is_bipoc_owned / is_lgbtqia_owned are DEPRECATED: frozen, never re-derived,
-- never set from token inference. This migration only clears one proven
-- misattribution (Ablaze Barbell) and backfills/inserts two proven gaps.
-- No base directory rows are deleted. No flags are newly set to true.
--
-- Acronyms: Black, Indigenous, and People of Color (BIPOC);
-- Lesbian, Gay, Bisexual, Transgender, Queer, Intersex, Asexual plus (LGBTQIA+).
--
-- Provenance (static-page assumption: source unchanged since initial scrape):
--   1. Brightside Barbell (Oakland, CA): row exists from Sport80 directory import,
--      specialty backfill missed (NULL designation). Fix: verbatim backfill.
--   2. Blaze Barbell (Naples, FL, Jason Anderson): distinct from Ablaze Barbell,
--      never inserted. Root cause: substring fallback
--      ("ablaze barbell".includes("blaze barbell") === true) enriched the wrong row.
--      Fix: insert stub; geocode + Weightlifting State Organization (WSO) left null
--      for the overnight daily geocoder/assigner.
--   3. Ablaze Barbell: false-positive enrichment via the same substring collision.
--      Never on the source page under the static assumption. Fix: clear specialty
--      fields only; preserve base directory row.
-- Remaining 14 extras from the audit (B3 Better Sport Performance, Bearproof
-- Weightlifting Club, Desert Dome Weightlifting, Diamond Fit Weightlifting Club,
-- Golden State Barbell, ISA Barbell Club, Liberation Barbell Club, Liberty Barbell,
-- Olde City Barbell, Olympus Weightlifting and Fitness Center, Set Fire Barbell,
-- Team Kansas City Barbell, Tri Peak Athlete, Urban Power House) are NOT touched
-- here. They require the full forensic SELECT output before any clearing.

-- Step 0: Deprecate flag columns (comment only, no type/behavior change).
COMMENT ON COLUMN public.usaw_clubs.is_bipoc_owned IS 'DEPRECATED 2026-09-28: frozen. Do not derive from community_designation. community_designation (verbatim) is the sole source of truth.';
COMMENT ON COLUMN public.usaw_clubs.is_lgbtqia_owned IS 'DEPRECATED 2026-09-28: frozen. Do not derive from community_designation. community_designation (verbatim) is the sole source of truth.';
COMMENT ON COLUMN public.usaw_clubs.community_designation IS 'Verbatim community label exactly as printed on the USAW BIPOC/LGBTQIA+ page (casing, owned suffix, slashes preserved). Sole source of truth; boolean flags are deprecated.';

-- Step 1: Brightside Barbell backfill (verbatim, flags frozen — do NOT set flags true).
UPDATE public.usaw_clubs
SET community_designation = 'LGBTQIA+',
    contact_name = COALESCE(contact_name, 'C. E. Brooks'),
    instagram = COALESCE(instagram, '@brightsidebarbell'),
    updated_at = now()
WHERE club_name = 'Brightside Barbell'
  AND community_designation IS NULL;

-- Step 2: Blaze Barbell insert (distinct club; do NOT merge with Ablaze Barbell).
-- Flags intentionally left at DEFAULT false (retired, never inferred).
INSERT INTO public.usaw_clubs (
  club_name, contact_name, email, address, state, instagram, community_designation
) VALUES (
  'Blaze Barbell',
  'Jason Anderson',
  'Jason@crossfitblaze.com',
  '6563 Taylor Rd, Unit 8, Naples, Florida 34109',
  'FL',
  '@blazebarbell',
  'LGBTQIA+'
)
ON CONFLICT (club_name) DO UPDATE SET
  community_designation = EXCLUDED.community_designation,
  contact_name = COALESCE(public.usaw_clubs.contact_name, EXCLUDED.contact_name),
  email = COALESCE(public.usaw_clubs.email, EXCLUDED.email),
  address = COALESCE(public.usaw_clubs.address, EXCLUDED.address),
  state = COALESCE(public.usaw_clubs.state, EXCLUDED.state),
  instagram = COALESCE(public.usaw_clubs.instagram, EXCLUDED.instagram),
  updated_at = now();

-- Step 3: Ablaze Barbell specialty clear (proven substring-collision misattribution).
-- Base directory columns (address/phone/email) are preserved.
UPDATE public.usaw_clubs
SET community_designation = NULL,
    is_bipoc_owned = false,
    is_lgbtqia_owned = false,
    updated_at = now()
WHERE club_name = 'Ablaze Barbell';
