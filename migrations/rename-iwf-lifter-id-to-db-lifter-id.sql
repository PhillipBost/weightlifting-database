-- Migration: Rename iwf_lifter_id to db_lifter_id and Add Official IWF ID
-- Purpose: Separate auto-increment PK from IWF's official athlete identifiers
-- Date: 2025-01-20
--
-- Current State:
--   - iwf_lifter_id is the auto-increment PRIMARY KEY
--   - No column for IWF's official athlete ID
--
-- Target State:
--   - db_lifter_id is the auto-increment PRIMARY KEY
--   - iwf_lifter_id stores IWF's official athlete ID (nullable)
--
-- WARNING: This alters the primary key and foreign key relationships!
-- Test in development first.

BEGIN;

-- ============================================================================
-- STEP 1: Add new nullable iwf_lifter_id column for official IWF IDs
-- ============================================================================

-- Add column for IWF's official athlete ID (will be populated later from scraper)
ALTER TABLE iwf_lifters ADD COLUMN IF NOT EXISTS iwf_lifter_id_official BIGINT;

-- Add index for lookups by official ID
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_official_id
ON iwf_lifters(iwf_lifter_id_official)
WHERE iwf_lifter_id_official IS NOT NULL;

-- ============================================================================
-- STEP 2: Drop foreign key constraints that reference iwf_lifter_id
-- ============================================================================

-- Drop FK from iwf_meet_results
ALTER TABLE iwf_meet_results
DROP CONSTRAINT IF EXISTS iwf_meet_results_iwf_lifter_id_fkey;

-- ============================================================================
-- STEP 3: Rename iwf_lifter_id to db_lifter_id in iwf_lifters
-- ============================================================================

-- Drop the primary key constraint
ALTER TABLE iwf_lifters DROP CONSTRAINT IF EXISTS iwf_lifters_pkey;

-- Rename the column
ALTER TABLE iwf_lifters RENAME COLUMN iwf_lifter_id TO db_lifter_id;

-- Re-add primary key constraint with new name
ALTER TABLE iwf_lifters ADD PRIMARY KEY (db_lifter_id);

-- ============================================================================
-- STEP 4: Rename iwf_lifter_id to db_lifter_id in iwf_meet_results
-- ============================================================================

-- Rename the foreign key column
ALTER TABLE iwf_meet_results RENAME COLUMN iwf_lifter_id TO db_lifter_id;

-- Re-add foreign key constraint with new column name
ALTER TABLE iwf_meet_results
ADD CONSTRAINT iwf_meet_results_db_lifter_id_fkey
FOREIGN KEY (db_lifter_id) REFERENCES iwf_lifters(db_lifter_id) ON DELETE CASCADE;

-- ============================================================================
-- STEP 5: Rename temporary column to iwf_lifter_id (for official IDs)
-- ============================================================================

-- Now that the FK column is renamed, we can use iwf_lifter_id for official IDs
ALTER TABLE iwf_lifters RENAME COLUMN iwf_lifter_id_official TO iwf_lifter_id;

-- ============================================================================
-- STEP 6: Update indexes to use new column names
-- ============================================================================

-- Drop old index if exists
DROP INDEX IF EXISTS idx_iwf_meet_results_lifter_id;

-- Create new index with correct column name
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_db_lifter_id
ON iwf_meet_results(db_lifter_id);

-- Update composite index for YTD calculations
DROP INDEX IF EXISTS idx_iwf_meet_results_lifter_date;
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_db_lifter_date
ON iwf_meet_results(db_lifter_id, date);

-- Update index on iwf_lifters
DROP INDEX IF EXISTS idx_iwf_lifters_db_lifter_id;
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_db_lifter_id
ON iwf_lifters(db_lifter_id);

COMMIT;

-- ============================================================================
-- Migration Complete - New Column Structure
-- ============================================================================
--
-- iwf_lifters:
--   - db_lifter_id (BIGSERIAL PK) - Auto-increment database primary key (renamed from iwf_lifter_id)
--   - iwf_lifter_id (BIGINT) - IWF's official athlete ID (nullable, for future use)
--   - athlete_name (TEXT)
--   - country_code (VARCHAR(3)) - After running add-country-code-name migration
--   - country_name (TEXT) - After running add-country-code-name migration
--
-- iwf_meet_results:
--   - db_lifter_id (BIGINT FK) - References iwf_lifters.db_lifter_id (renamed from iwf_lifter_id)
--
-- Next Steps:
--   1. Run this migration in Supabase SQL Editor
--   2. Verify: SELECT db_lifter_id, iwf_lifter_id, athlete_name FROM iwf_lifters LIMIT 5;
--   3. Run add-country-code-name-to-iwf-lifters.sql
--   4. Test with: node scripts/production/iwf-lifter-manager.js --test
-- ============================================================================
