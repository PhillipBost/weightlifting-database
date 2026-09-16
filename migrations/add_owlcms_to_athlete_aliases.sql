-- ========================================================================
-- Migration: Add OWLCMS Lifters to Athlete Aliases
-- Purpose: Enable pairwise cross-federation and intra-OWLCMS athlete linking,
--          allowing multiple OWLCMS meet appearances to link to the same
--          USAW or IWF profile without data collision.
-- Date: 2026-09-14
-- ========================================================================

BEGIN;

-- 1. Add OWLCMS pointer columns
ALTER TABLE public.athlete_aliases
    ADD COLUMN IF NOT EXISTS owlcms_lifter_id BIGINT 
    REFERENCES public.owlcms_lifters(lifter_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS owlcms_lifter_id_2 BIGINT 
    REFERENCES public.owlcms_lifters(lifter_id) ON DELETE RESTRICT;

-- 2. Create indexes for OWLCMS lookups
CREATE INDEX IF NOT EXISTS idx_athlete_aliases_owlcms_id 
    ON public.athlete_aliases(owlcms_lifter_id);
CREATE INDEX IF NOT EXISTS idx_athlete_aliases_owlcms_id_2 
    ON public.athlete_aliases(owlcms_lifter_id_2);

-- 3. Replace constraint: enforces that each row is strictly a pair (exactly 2 IDs linked)
ALTER TABLE public.athlete_aliases 
    DROP CONSTRAINT IF EXISTS check_alias_type;

ALTER TABLE public.athlete_aliases 
    ADD CONSTRAINT check_alias_type CHECK (
        (
            (CASE WHEN usaw_lifter_id IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN iwf_db_lifter_id IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN iwf_db_lifter_id_2 IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN owlcms_lifter_id IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN owlcms_lifter_id_2 IS NOT NULL THEN 1 ELSE 0 END)
        ) = 2
    );

-- 4. Unique constraints for pairwise links
-- Allows an athlete to have multiple different OWLCMS instances linked to their USAW record,
-- but prevents inserting identical (usaw, owlcms) pairs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_usaw_owlcms_link 
    ON public.athlete_aliases(usaw_lifter_id, owlcms_lifter_id) 
    WHERE usaw_lifter_id IS NOT NULL AND owlcms_lifter_id IS NOT NULL;

-- Allows international non-USAW athletes to link multiple OWLCMS instances to their IWF record
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_iwf_owlcms_link 
    ON public.athlete_aliases(iwf_db_lifter_id, owlcms_lifter_id) 
    WHERE iwf_db_lifter_id IS NOT NULL AND owlcms_lifter_id IS NOT NULL;

-- Allows linking two OWLCMS profiles together (intra-OWLCMS duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_owlcms_owlcms_link 
    ON public.athlete_aliases(owlcms_lifter_id, owlcms_lifter_id_2) 
    WHERE owlcms_lifter_id_2 IS NOT NULL;

COMMIT;
