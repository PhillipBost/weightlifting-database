-- Migration: Change registration dates to TEXT to capture full timestamp with timezone
-- e.g. "01/05/26 12:00 (MST)"
BEGIN;
ALTER TABLE public.usaw_meet_listings
ALTER COLUMN registration_open TYPE TEXT,
    ALTER COLUMN registration_close TYPE TEXT;
COMMIT;