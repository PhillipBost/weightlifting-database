-- ============================================================================
-- MIGRATION: Add Coordinates and Country Codes to owlcms Meets and Results
-- Date: 2026-10-03
-- Purpose:
--   1. Add latitude and longitude to public.owlcms_meets to support frontend
--      hub-and-spoke maps (MeetHubSpokeMap).
--   2. Add canonical country_code to public.owlcms_meet_results to support direct
--      spoke vector aggregation without requiring multi-table joins.
-- ============================================================================

BEGIN;

-- 1. Add host coordinates to public.owlcms_meets
ALTER TABLE public.owlcms_meets 
    ADD COLUMN IF NOT EXISTS latitude double precision,
    ADD COLUMN IF NOT EXISTS longitude double precision;

COMMENT ON COLUMN public.owlcms_meets.latitude IS 
    'Geocoded host venue/city latitude coordinate in decimal degrees';
COMMENT ON COLUMN public.owlcms_meets.longitude IS 
    'Geocoded host venue/city longitude coordinate in decimal degrees';

CREATE INDEX IF NOT EXISTS idx_owlcms_meets_coordinates 
    ON public.owlcms_meets (latitude, longitude) 
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- 2. Add canonical country_code to public.owlcms_meet_results
ALTER TABLE public.owlcms_meet_results
    ADD COLUMN IF NOT EXISTS country_code text;

CREATE INDEX IF NOT EXISTS idx_owlcms_meet_results_country_code
    ON public.owlcms_meet_results (country_code);

COMMENT ON COLUMN public.owlcms_meet_results.country_code IS 
    'Participant athlete canonical International Olympic Committee (IOC) or International Organization for Standardization (ISO-3) country code';

COMMIT;
