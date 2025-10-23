-- Migration: Rename iwf_meet_id to db_meet_id and Add Official IWF Event ID
-- Purpose: Separate auto-increment PK from IWF's official event identifiers
-- Date: 2025-01-20
--
-- Current State:
--   - iwf_meet_id is the auto-increment PRIMARY KEY
--   - event_id stores IWF's official event ID as TEXT (e.g., "661")
--
-- Target State:
--   - db_meet_id is the auto-increment PRIMARY KEY
--   - event_id remains as TEXT for official IWF event ID
--
-- WARNING: This alters the primary key and foreign key relationships!
-- Test in development first.

BEGIN;

-- ============================================================================
-- STEP 1: Drop foreign key constraints that reference iwf_meet_id
-- ============================================================================

-- Drop FK from iwf_meet_locations
ALTER TABLE iwf_meet_locations
DROP CONSTRAINT IF EXISTS iwf_meet_locations_iwf_meet_id_fkey;

-- Drop FK from iwf_meet_results
ALTER TABLE iwf_meet_results
DROP CONSTRAINT IF EXISTS iwf_meet_results_iwf_meet_id_fkey;

-- ============================================================================
-- STEP 2: Rename iwf_meet_id to db_meet_id in iwf_meets
-- ============================================================================

-- Drop the primary key constraint
ALTER TABLE iwf_meets DROP CONSTRAINT IF EXISTS iwf_meets_pkey;

-- Rename the column
ALTER TABLE iwf_meets RENAME COLUMN iwf_meet_id TO db_meet_id;

-- Re-add primary key constraint with new name
ALTER TABLE iwf_meets ADD PRIMARY KEY (db_meet_id);

-- ============================================================================
-- STEP 3: Rename iwf_meet_id to db_meet_id in iwf_meet_locations
-- ============================================================================

-- Rename the foreign key column
ALTER TABLE iwf_meet_locations RENAME COLUMN iwf_meet_id TO db_meet_id;

-- Re-add foreign key constraint with new column name
ALTER TABLE iwf_meet_locations
ADD CONSTRAINT iwf_meet_locations_db_meet_id_fkey
FOREIGN KEY (db_meet_id) REFERENCES iwf_meets(db_meet_id) ON DELETE CASCADE;

-- Re-add unique constraint (1:1 relationship)
ALTER TABLE iwf_meet_locations
ADD CONSTRAINT IF NOT EXISTS iwf_meet_locations_db_meet_id_unique
UNIQUE (db_meet_id);

-- ============================================================================
-- STEP 4: Rename iwf_meet_id to db_meet_id in iwf_meet_results
-- ============================================================================

-- Rename the foreign key column
ALTER TABLE iwf_meet_results RENAME COLUMN iwf_meet_id TO db_meet_id;

-- Re-add foreign key constraint with new column name
ALTER TABLE iwf_meet_results
ADD CONSTRAINT iwf_meet_results_db_meet_id_fkey
FOREIGN KEY (db_meet_id) REFERENCES iwf_meets(db_meet_id) ON DELETE CASCADE;

-- ============================================================================
-- STEP 5: Update indexes to use new column names
-- ============================================================================

-- Drop old indexes
DROP INDEX IF EXISTS idx_iwf_meet_locations_meet_id;
DROP INDEX IF EXISTS idx_iwf_meet_results_meet_id;

-- Create new indexes with correct column name
CREATE INDEX IF NOT EXISTS idx_iwf_meet_locations_db_meet_id
ON iwf_meet_locations(db_meet_id);

CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_db_meet_id
ON iwf_meet_results(db_meet_id);

-- ============================================================================
-- STEP 6: Update unique constraint on iwf_meet_results
-- ============================================================================

-- Drop old unique index
DROP INDEX IF EXISTS idx_iwf_meet_results_unique;

-- Create new unique index with correct column name
-- Prevents duplicate results: same lifter, same meet, same weight class
CREATE UNIQUE INDEX idx_iwf_meet_results_unique
ON iwf_meet_results(db_meet_id, db_lifter_id, weight_class);

COMMIT;

-- ============================================================================
-- Migration Complete - New Column Structure
-- ============================================================================
--
-- iwf_meets:
--   - db_meet_id (BIGSERIAL PK) - Auto-increment database primary key (renamed from iwf_meet_id)
--   - event_id (TEXT) - IWF's official event ID as text (e.g., "661")
--   - Meet (TEXT) - Event name
--   - Date (TEXT) - Event date
--
-- iwf_meet_locations:
--   - db_meet_id (BIGINT FK) - References iwf_meets.db_meet_id (renamed from iwf_meet_id)
--   - UNIQUE constraint on db_meet_id (1:1 relationship)
--
-- iwf_meet_results:
--   - db_meet_id (BIGINT FK) - References iwf_meets.db_meet_id (renamed from iwf_meet_id)
--   - db_lifter_id (BIGINT FK) - References iwf_lifters.db_lifter_id
--   - UNIQUE constraint on (db_meet_id, db_lifter_id, weight_class)
--
-- Next Steps:
--   1. Run this migration in Supabase SQL Editor
--   2. Verify: SELECT db_meet_id, event_id, Meet FROM iwf_meets LIMIT 5;
--   3. Verify FKs: SELECT * FROM iwf_meet_results LIMIT 5;
--   4. Update meet manager code to use db_meet_id
-- ============================================================================
