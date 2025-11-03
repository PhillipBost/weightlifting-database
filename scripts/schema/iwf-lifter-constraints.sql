-- ============================================================================
-- IWF LIFTER CONSTRAINTS AND INDEXES
-- ============================================================================
--
-- Purpose: Prevent duplicate IWF lifter IDs and optimize matching by
-- name + country + birth_year
--
-- Changes:
-- 1. Add UNIQUE constraint on iwf_lifter_id (allowing multiple NULLs)
-- 2. Create composite index for efficient name+country+birth_year matching
-- 3. Enable enhanced lifter deduplication logic
--
-- Background: Two lifters named "Tigran MARTIROSYAN" from Armenia with
-- different IWF IDs were being merged because the fallback matching only
-- used name + country, ignoring birth year.
--
-- With these constraints:
-- - IWF ID is enforced as globally unique (primary key)
-- - Birth year is available as a distinguishing factor
-- - Queries for name+country+birth_year matching are optimized
--
-- ============================================================================

-- Step 1: Check if constraint already exists, if not add it
-- PostgreSQL allows multiple NULL values in UNIQUE constraints by default (NULLS DISTINCT)
-- This is the desired behavior since not all athletes have IWF IDs
DO $$
BEGIN
    -- Add unique constraint on iwf_lifter_id if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_iwf_lifters_iwf_lifter_id'
    ) THEN
        ALTER TABLE iwf_lifters
        ADD CONSTRAINT uq_iwf_lifters_iwf_lifter_id
        UNIQUE (iwf_lifter_id);

        RAISE NOTICE 'Created UNIQUE constraint on iwf_lifter_id';
    ELSE
        RAISE NOTICE 'UNIQUE constraint on iwf_lifter_id already exists';
    END IF;
END $$;

-- Step 2: Create composite index for efficient matching on name + country + birth_year
-- This speeds up the fallback matching logic when IWF ID is not available
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'idx_iwf_lifters_name_country_birthyear'
    ) THEN
        CREATE INDEX idx_iwf_lifters_name_country_birthyear
        ON iwf_lifters (athlete_name, country_code, birth_year);

        RAISE NOTICE 'Created composite index on (athlete_name, country_code, birth_year)';
    ELSE
        RAISE NOTICE 'Composite index already exists';
    END IF;
END $$;

-- Step 3: Verify existing indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'iwf_lifters'
AND (indexname LIKE '%iwf_lifter_id%' OR indexname LIKE '%name_country%');
