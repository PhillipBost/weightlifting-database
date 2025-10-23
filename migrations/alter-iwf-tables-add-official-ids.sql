-- Migration: Add IWF Official IDs to Tables
-- Purpose: Separate auto-increment PKs from IWF's official identifiers
-- Date: 2025-01-19
--
-- Changes:
--   1. iwf_meets: Add db_meet_id as new PK, rename iwf_meet_id to store IWF event_id
--   2. iwf_lifters: Rename PK to db_lifter_id, add iwf_lifter_id and iwf_athlete_url
--   3. iwf_meet_results: Update FK references to use new column names

BEGIN;

-- ============================================================================
-- STEP 1: Alter iwf_meets table
-- ============================================================================

-- Add new auto-increment primary key column
ALTER TABLE iwf_meets ADD COLUMN db_meet_id BIGSERIAL;

-- Add new column to store IWF event ID (will replace event_id)
ALTER TABLE iwf_meets ADD COLUMN iwf_event_id BIGINT;

-- Copy data from event_id to iwf_event_id (convert text to bigint)
UPDATE iwf_meets SET iwf_event_id = CAST(event_id AS BIGINT) WHERE event_id IS NOT NULL AND event_id ~ '^\d+$';

-- Add index on iwf_event_id
CREATE INDEX IF NOT EXISTS idx_iwf_meets_iwf_event_id ON iwf_meets(iwf_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_iwf_meets_iwf_event_id_unique ON iwf_meets(iwf_event_id) WHERE iwf_event_id IS NOT NULL;

-- Note: We'll keep the old event_id column for now as a backup
-- Note: We'll switch primary key after updating foreign keys

-- ============================================================================
-- STEP 2: Alter iwf_lifters table
-- ============================================================================

-- Add new auto-increment primary key column
ALTER TABLE iwf_lifters ADD COLUMN db_lifter_id BIGSERIAL;

-- Add new columns for IWF official data
ALTER TABLE iwf_lifters ADD COLUMN iwf_lifter_id BIGINT;
ALTER TABLE iwf_lifters ADD COLUMN iwf_athlete_url TEXT;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_iwf_lifter_id ON iwf_lifters(iwf_lifter_id) WHERE iwf_lifter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_db_lifter_id ON iwf_lifters(db_lifter_id);

-- Note: We'll keep the old iwf_lifter_id column (currently auto-increment) as backup
-- Note: We'll rename it after updating foreign keys

-- ============================================================================
-- STEP 3: Alter iwf_meet_results table
-- ============================================================================

-- Add new foreign key columns (will replace existing ones)
ALTER TABLE iwf_meet_results ADD COLUMN db_meet_id BIGINT;
ALTER TABLE iwf_meet_results ADD COLUMN db_lifter_id BIGINT;

-- Copy FK data from old columns to new columns
UPDATE iwf_meet_results mr
SET db_meet_id = m.db_meet_id
FROM iwf_meets m
WHERE mr.iwf_meet_id = m.iwf_meet_id;

UPDATE iwf_meet_results mr
SET db_lifter_id = l.db_lifter_id
FROM iwf_lifters l
WHERE mr.iwf_lifter_id = l.iwf_lifter_id;

-- Add indexes on new FK columns
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_db_meet_id ON iwf_meet_results(db_meet_id);
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_db_lifter_id ON iwf_meet_results(db_lifter_id);

-- Note: We'll add foreign key constraints after switching primary keys

-- ============================================================================
-- STEP 4: Drop old constraints and switch primary keys
-- ============================================================================

-- Drop old foreign key constraints on iwf_meet_results
ALTER TABLE iwf_meet_results DROP CONSTRAINT IF EXISTS iwf_meet_results_iwf_meet_id_fkey;
ALTER TABLE iwf_meet_results DROP CONSTRAINT IF EXISTS iwf_meet_results_iwf_lifter_id_fkey;

-- Drop old foreign key constraint on iwf_meet_locations
ALTER TABLE iwf_meet_locations DROP CONSTRAINT IF EXISTS iwf_meet_locations_iwf_meet_id_fkey;

-- iwf_meets: Rename old PK column, switch to new PK
ALTER TABLE iwf_meets DROP CONSTRAINT IF EXISTS iwf_meets_pkey;
ALTER TABLE iwf_meets RENAME COLUMN iwf_meet_id TO old_meet_id;
ALTER TABLE iwf_meets ADD PRIMARY KEY (db_meet_id);

-- iwf_lifters: Rename old PK column, switch to new PK
ALTER TABLE iwf_lifters DROP CONSTRAINT IF EXISTS iwf_lifters_pkey;
ALTER TABLE iwf_lifters RENAME COLUMN iwf_lifter_id TO old_lifter_id;
ALTER TABLE iwf_lifters ADD PRIMARY KEY (db_lifter_id);

-- ============================================================================
-- STEP 5: Update iwf_meet_locations to use new FK
-- ============================================================================

-- Add new FK column
ALTER TABLE iwf_meet_locations ADD COLUMN db_meet_id BIGINT;

-- Copy data
UPDATE iwf_meet_locations ml
SET db_meet_id = m.db_meet_id
FROM iwf_meets m
WHERE ml.iwf_meet_id = m.old_meet_id;

-- Drop old FK column and rename
ALTER TABLE iwf_meet_locations DROP COLUMN iwf_meet_id;
ALTER TABLE iwf_meet_locations RENAME COLUMN db_meet_id TO iwf_meet_id;

-- Add FK constraint
ALTER TABLE iwf_meet_locations
ADD CONSTRAINT iwf_meet_locations_iwf_meet_id_fkey
FOREIGN KEY (iwf_meet_id) REFERENCES iwf_meets(db_meet_id) ON DELETE CASCADE;

-- Make it unique (1:1 relationship)
ALTER TABLE iwf_meet_locations ADD CONSTRAINT iwf_meet_locations_iwf_meet_id_unique UNIQUE (iwf_meet_id);

-- ============================================================================
-- STEP 6: Update iwf_meet_results to use new FKs
-- ============================================================================

-- Rename old FK columns (keep as backup for now)
ALTER TABLE iwf_meet_results RENAME COLUMN iwf_meet_id TO old_meet_fk;
ALTER TABLE iwf_meet_results RENAME COLUMN iwf_lifter_id TO old_lifter_fk;

-- Rename new FK columns to standard names
ALTER TABLE iwf_meet_results RENAME COLUMN db_meet_id TO iwf_meet_id;
ALTER TABLE iwf_meet_results RENAME COLUMN db_lifter_id TO iwf_lifter_id;

-- Add foreign key constraints
ALTER TABLE iwf_meet_results
ADD CONSTRAINT iwf_meet_results_iwf_meet_id_fkey
FOREIGN KEY (iwf_meet_id) REFERENCES iwf_meets(db_meet_id) ON DELETE CASCADE;

ALTER TABLE iwf_meet_results
ADD CONSTRAINT iwf_meet_results_iwf_lifter_id_fkey
FOREIGN KEY (iwf_lifter_id) REFERENCES iwf_lifters(db_lifter_id) ON DELETE CASCADE;

-- ============================================================================
-- STEP 7: Clean up old columns (optional - can keep as backup)
-- ============================================================================

-- Uncomment these lines if you want to drop the backup columns:
-- ALTER TABLE iwf_meets DROP COLUMN old_meet_id;
-- ALTER TABLE iwf_meets DROP COLUMN event_id;
-- ALTER TABLE iwf_lifters DROP COLUMN old_lifter_id;
-- ALTER TABLE iwf_meet_results DROP COLUMN old_meet_fk;
-- ALTER TABLE iwf_meet_results DROP COLUMN old_lifter_fk;

COMMIT;

-- ============================================================================
-- Migration Complete - New Schema Structure
-- ============================================================================
--
-- iwf_meets:
--   - db_meet_id (BIGSERIAL PK) - Auto-increment database primary key
--   - iwf_event_id (BIGINT) - IWF's official event ID (e.g., 661)
--   - Meet (TEXT) - Event name (e.g., "2025 IWF World Championships")
--
-- iwf_lifters:
--   - db_lifter_id (BIGSERIAL PK) - Auto-increment database primary key
--   - iwf_lifter_id (BIGINT) - IWF's official athlete ID (e.g., 16119)
--   - iwf_athlete_url (TEXT) - Full URL to athlete bio page
--   - athlete_name (TEXT) - Athlete name in "Firstname LASTNAME" format
--
-- iwf_meet_results:
--   - iwf_meet_id (BIGINT FK) - References iwf_meets.db_meet_id
--   - iwf_lifter_id (BIGINT FK) - References iwf_lifters.db_lifter_id
--
-- Next Steps:
--   1. Run this migration in Supabase SQL Editor
--   2. Update code to use new column names
--   3. Test with event 661 import
-- ============================================================================
