-- ============================================================================
-- Migration: Add link_status Column to OWLCMS Lifters
-- Purpose: Track athlete linking lifecycle (PENDING, LINKED, REVIEW_NEEDED, ISOLATED)
--          so routine linking runs immediately skip vetted isolated athletes.
-- Date: 2026-09-14
-- ============================================================================

BEGIN;

-- 1. Add link_status column to owlcms_lifters
ALTER TABLE public.owlcms_lifters 
    ADD COLUMN IF NOT EXISTS link_status VARCHAR(20) DEFAULT 'PENDING';

-- 2. Create index for fast status lookups
CREATE INDEX IF NOT EXISTS idx_owlcms_lifters_link_status 
    ON public.owlcms_lifters (link_status);

-- 3. Backfill lifters already linked in athlete_aliases as 'LINKED'
UPDATE public.owlcms_lifters
SET link_status = 'LINKED'
WHERE lifter_id IN (
    SELECT owlcms_lifter_id FROM public.athlete_aliases WHERE owlcms_lifter_id IS NOT NULL
    UNION
    SELECT owlcms_lifter_id_2 FROM public.athlete_aliases WHERE owlcms_lifter_id_2 IS NOT NULL
);

COMMIT;
