-- Migration: Drop redundant columns from usaw_meet_entries
-- These columns have been moved to usaw_meet_listings
BEGIN;
ALTER TABLE public.usaw_meet_entries DROP COLUMN IF EXISTS meet_id,
    DROP COLUMN IF EXISTS meet_type,
    DROP COLUMN IF EXISTS meet_address,
    DROP COLUMN IF EXISTS meet_organizer,
    DROP COLUMN IF EXISTS contact_phone,
    DROP COLUMN IF EXISTS contact_email,
    DROP COLUMN IF EXISTS entries_on_platform,
    DROP COLUMN IF EXISTS registration_open,
    DROP COLUMN IF EXISTS registration_close,
    DROP COLUMN IF EXISTS meet_match_status;
COMMIT;