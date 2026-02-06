-- Migration: Fix Constraints for USAW Meet Entries
-- 1. Ensure meet_id is NULLABLE.
-- 2. Create partial unique indexes to handle duplication logic for both matched (meet_id) and unmatched (meet_name) entries.
BEGIN;
-- 1. Make meet_id nullable if not already
ALTER TABLE public.usaw_meet_entries
ALTER COLUMN meet_id DROP NOT NULL;
-- 2. Rename member_id to membership_number (User Request)
DO $$ BEGIN IF EXISTS(
    SELECT *
    FROM information_schema.columns
    WHERE table_name = 'usaw_meet_entries'
        AND column_name = 'member_id'
) THEN
ALTER TABLE public.usaw_meet_entries
    RENAME COLUMN member_id TO membership_number;
END IF;
END $$;
-- 3. Drop existing constraint if it exists
ALTER TABLE public.usaw_meet_entries DROP CONSTRAINT IF EXISTS usaw_meet_entries_meet_id_member_id_key;
-- 3. Create Partial Index for MATCHED meets
-- Prevents duplicates for same meet_id + membership_number
DROP INDEX IF EXISTS idx_meet_entries_unique;
DROP INDEX IF EXISTS idx_meet_entries_matched_unique;
CREATE UNIQUE INDEX idx_meet_entries_matched_unique ON public.usaw_meet_entries (meet_id, membership_number)
WHERE meet_id IS NOT NULL;
-- 4. Create Partial Index for UNMATCHED meets
-- Prevents duplicates for same meet_name + event_date + membership_number (when meet_id is null)
-- This allows same-named meets from different dates to coexist.
DROP INDEX IF EXISTS idx_meet_entries_unmatched_unique;
CREATE UNIQUE INDEX idx_meet_entries_unmatched_unique ON public.usaw_meet_entries (meet_name, event_date, membership_number)
WHERE meet_id IS NULL;
COMMIT;