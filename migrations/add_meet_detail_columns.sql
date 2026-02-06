-- Migration: Add detailed meet information columns to usaw_meet_entries
-- This allows storing comprehensive meet details for both matched and unmatched meets
BEGIN;
ALTER TABLE public.usaw_meet_entries
ADD COLUMN IF NOT EXISTS meet_type TEXT,
    ADD COLUMN IF NOT EXISTS meet_address TEXT,
    ADD COLUMN IF NOT EXISTS meet_organizer TEXT,
    ADD COLUMN IF NOT EXISTS contact_phone TEXT,
    ADD COLUMN IF NOT EXISTS contact_email TEXT,
    ADD COLUMN IF NOT EXISTS entries_on_platform BOOLEAN,
    ADD COLUMN IF NOT EXISTS registration_open TEXT,
    ADD COLUMN IF NOT EXISTS registration_close TEXT;
COMMIT;