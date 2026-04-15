-- Migration: Adapt athlete_aliases to support IWF-to-IWF duplicate tracking

-- 1. Relax the strict cross-federation requirement
ALTER TABLE public.athlete_aliases ALTER COLUMN usaw_lifter_id DROP NOT NULL;

-- 2. Add pointer to the duplicate IWF profile
ALTER TABLE public.athlete_aliases ADD COLUMN IF NOT EXISTS iwf_db_lifter_id_2 BIGINT REFERENCES public.iwf_lifters(db_lifter_id) ON DELETE RESTRICT;

-- 3. Enforce valid data shape:
--    A row must EITHER be a cross-federation link (usaw is set, iwf_2 is null)
--    OR it must be an IWF duplicate link (usaw is null, iwf_2 is set)
ALTER TABLE public.athlete_aliases ADD CONSTRAINT check_alias_type 
CHECK (
  (usaw_lifter_id IS NOT NULL AND iwf_db_lifter_id_2 IS NULL) OR 
  (usaw_lifter_id IS NULL AND iwf_db_lifter_id_2 IS NOT NULL)
);

-- 4. Create an index to enforce uniqueness of the duplicate link
CREATE UNIQUE INDEX IF NOT EXISTS idx_iwf_iwf_link ON public.athlete_aliases(iwf_db_lifter_id, iwf_db_lifter_id_2) WHERE iwf_db_lifter_id_2 IS NOT NULL;
