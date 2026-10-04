-- ============================================================================
-- MIGRATION: Add state_provincial to owlcms_meets competition_scope
-- Date: 2026-09-24
--
-- Status: GENERATED FOR MANUAL EXECUTION. Per project protocol this file is
--         NEVER auto-applied; the user runs it manually after review.
--
-- Purpose:
--   Update public.owlcms_meets.competition_scope CHECK constraint to include
--   'state_provincial'. This permanently prevents conflation between:
--     1. 'regional': Multi-nation regional competitions (e.g. Nordic, South American,
--        Visegrad Four, Arab Championships) that sit between Continental and National.
--     2. 'state_provincial': Domestic state/provincial subdivision competitions
--        (e.g. USAW WSO Championships, Canadian Provincial Championships).
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.owlcms_meets'::regclass 
          AND contype = 'c' 
          AND pg_get_constraintdef(oid) LIKE '%competition_scope%'
    ) LOOP
        EXECUTE 'ALTER TABLE public.owlcms_meets DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

ALTER TABLE public.owlcms_meets
    ADD CONSTRAINT owlcms_meets_competition_scope_check
    CHECK (competition_scope IN (
        'international',
        'continental',
        'regional',
        'national',
        'state_provincial',
        'local',
        'unknown'
    ));

COMMENT ON COLUMN public.owlcms_meets.competition_scope IS
    'Suggested competition scope derived from the sanctioning federation registry level: international (global), continental, regional (multi-nation regional bodies), national, state_provincial (domestic WSO/provincial bodies), or local (clubs).';

COMMIT;
