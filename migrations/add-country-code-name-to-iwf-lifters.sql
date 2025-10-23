-- Migration: Add Country Code and Country Name Columns to IWF Lifters
-- Purpose: Separate country 3-letter codes from full country names for better data structure
-- Date: 2025-01-20
--
-- Changes:
--   1. Add country_code column (3-letter codes: USA, CHN, GBR, etc.)
--   2. Add country_name column (full names: United States, China, etc.)
--   3. Migrate existing country data
--   4. Add indexes for performance
--   5. Update composite indexes

BEGIN;

-- ============================================================================
-- STEP 1: Add new columns to iwf_lifters
-- ============================================================================

ALTER TABLE iwf_lifters ADD COLUMN IF NOT EXISTS country_code VARCHAR(3);
ALTER TABLE iwf_lifters ADD COLUMN IF NOT EXISTS country_name TEXT;

-- ============================================================================
-- STEP 2: Migrate existing data from country column
-- ============================================================================

-- For now, copy existing country data to country_name
-- The application will populate country_code on next upsert
UPDATE iwf_lifters
SET country_name = country
WHERE country IS NOT NULL AND country_name IS NULL;

-- ============================================================================
-- STEP 3: Add indexes for performance
-- ============================================================================

-- Index on country_code for fast lookups
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_country_code ON iwf_lifters(country_code);

-- Index on country_name for full text searches
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_country_name ON iwf_lifters(country_name);

-- Composite index for name + country_code matching (primary lifter identification)
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_name_country_code ON iwf_lifters(athlete_name, country_code);

-- ============================================================================
-- STEP 4: Add same columns to iwf_meet_results for denormalization
-- ============================================================================

ALTER TABLE iwf_meet_results ADD COLUMN IF NOT EXISTS country_code VARCHAR(3);
ALTER TABLE iwf_meet_results ADD COLUMN IF NOT EXISTS country_name TEXT;

-- Migrate existing country data
UPDATE iwf_meet_results
SET country_name = country
WHERE country IS NOT NULL AND country_name IS NULL;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_country_code ON iwf_meet_results(country_code);
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_country_name ON iwf_meet_results(country_name);

COMMIT;

-- ============================================================================
-- Migration Complete - New Schema Structure
-- ============================================================================
--
-- iwf_lifters columns:
--   - db_lifter_id (BIGSERIAL PK) - Auto-increment database primary key
--   - iwf_lifter_id (BIGINT) - IWF's official athlete ID (nullable)
--   - athlete_name (TEXT) - Athlete name in "Firstname LASTNAME" format
--   - country_code (VARCHAR(3)) - 3-letter country code (USA, CHN, GBR)
--   - country_name (TEXT) - Full country name (United States, China, United Kingdom)
--   - country (VARCHAR(100)) - Legacy column (kept for backward compatibility)
--
-- Matching strategy:
--   - Primary: athlete_name + country_code
--   - Fallback: athlete_name + country (for old data)
--
-- Next Steps:
--   1. Run this migration in Supabase SQL Editor
--   2. Update iwf-lifter-manager.js to use country_code and country_name
--   3. Test with event import
-- ============================================================================
