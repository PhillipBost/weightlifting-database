-- Migration: Zero residual inferred flags on designated specialty rows
-- Date: 2026-09-28
-- Authority: self-hosted instance only. Run manually per project protocol.
-- Rule: as-written/as-found. community_designation (verbatim) is the sole source
-- of truth; is_bipoc_owned / is_lgbtqia_owned are DEPRECATED (frozen, never derived).
-- Background: the 2026-09-25 local run set flags via prohibited token inference
-- (/black|brown|latina|.../, /lgbtqia|lgbt/). Prior fixes froze flags (never newly
-- true) but never zeroed the 20 surviving true values; frontend verification
-- caught the gap (Barbarian still true/true live). This migration zeroes flags on
-- every row carrying a designation. Designations, contacts, base data untouched.
-- No flags set true anywhere. No row deletes.
-- Acronyms: Black, Indigenous, and People of Color (BIPOC);
-- Lesbian, Gay, Bisexual, Transgender, Queer, Intersex, Asexual plus (LGBTQIA+).

UPDATE public.usaw_clubs
SET is_bipoc_owned = false,
    is_lgbtqia_owned = false,
    updated_at = now()
WHERE community_designation IS NOT NULL
  AND (is_bipoc_owned = true OR is_lgbtqia_owned = true);
