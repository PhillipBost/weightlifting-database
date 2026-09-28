-- Migration: Ablaze Barbell contact/instagram decontamination
-- Date: 2026-09-28
-- Authority: self-hosted instance only. Run manually per project protocol.
-- Rule: as-written/as-found. community_designation verbatim is sole source of truth;
-- is_bipoc_owned / is_lgbtqia_owned are DEPRECATED (frozen, never derived).
--
-- Forensics (user-provided full-row dump, 2026-09-28):
--   Ablaze Barbell: contact_name='Jason Anderson' (Blaze's contact), instagram='@blazebarbell'
--     (Blaze's handle), email='Knight.jcr@gmail.com' (genuine Ablaze, preserved),
--     address='726 Beal Parkway BLG#3, Fort Walton Beach, Florida, ...' (genuine Ablaze,
--     ~500 miles from Naples, preserved), state='Florida'/wso='Florida'/coords set
--     (genuine Ablaze, preserved).
--   Blaze Barbell: contact_name='Jason Anderson', email='Jason@crossfitblaze.com',
--     instagram='@blazebarbell', address Naples FL (all correct, untouched).
-- Root cause: pre-patch synchronizer wrote contact_name/instagram with overwrite
-- semantics (contactRaw || existing) on the false substring match
-- ("ablaze barbell".includes("blaze barbell")). Designation/flags were cleared by
-- migrations/fix-usaw-specialty-verbatim-2026-09-28.sql Step 3; this file clears the
-- two remaining contaminated fields. Null = honestly unknown (true value destroyed
-- by overwrite); restoration requires Sport80 re-scrape, never invention.
-- No base rows deleted. No flags written.

-- Step 1: Clear proven Blaze-contaminated contact on the wrong row.
UPDATE public.usaw_clubs
SET contact_name = NULL,
    updated_at = now()
WHERE club_name = 'Ablaze Barbell'
  AND contact_name = 'Jason Anderson';

-- Step 2: Clear proven Blaze-contaminated handle on the wrong row.
UPDATE public.usaw_clubs
SET instagram = NULL,
    updated_at = now()
WHERE club_name = 'Ablaze Barbell'
  AND instagram = '@blazebarbell';
