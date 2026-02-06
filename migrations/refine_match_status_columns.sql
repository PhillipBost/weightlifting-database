-- Migration: Refine match status tracking
-- Split match_status into athlete_match_status and meet_match_status
BEGIN;
-- 1. Add new column for meet matching
ALTER TABLE public.usaw_meet_entries
ADD COLUMN IF NOT EXISTS meet_match_status TEXT;
-- 2. Rename existing match_status to athlete_match_status
ALTER TABLE public.usaw_meet_entries
    RENAME COLUMN match_status TO athlete_match_status;
-- 3. Backfill meet_match_status based on meet_id
UPDATE public.usaw_meet_entries
SET meet_match_status = CASE
        WHEN meet_id IS NOT NULL THEN 'matched'
        ELSE 'unmatched'
    END
WHERE meet_match_status IS NULL;
-- 4. Add check constraints for valid values
ALTER TABLE public.usaw_meet_entries DROP CONSTRAINT IF EXISTS chk_athlete_match_status;
ALTER TABLE public.usaw_meet_entries
ADD CONSTRAINT chk_athlete_match_status CHECK (athlete_match_status IN ('matched', 'unmatched'));
ALTER TABLE public.usaw_meet_entries
ADD CONSTRAINT chk_meet_match_status CHECK (meet_match_status IN ('matched', 'unmatched'));
-- 5. Create indexes for filtering
CREATE INDEX IF NOT EXISTS idx_meet_entries_athlete_match ON public.usaw_meet_entries(athlete_match_status);
CREATE INDEX IF NOT EXISTS idx_meet_entries_meet_match ON public.usaw_meet_entries(meet_match_status);
-- 6. Add comments
COMMENT ON COLUMN public.usaw_meet_entries.athlete_match_status IS 'Indicates whether the athlete/lifter was matched to usaw_lifters table: matched or unmatched';
COMMENT ON COLUMN public.usaw_meet_entries.meet_match_status IS 'Indicates whether the meet was matched to usaw_meets table: matched or unmatched';
COMMIT;