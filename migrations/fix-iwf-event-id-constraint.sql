-- Migration: Fix IWF event_id Unique Constraint
-- Purpose: Replace partial unique index with full unique constraint to support ON CONFLICT
-- Date: 2025-01-19
--
-- Issue: The partial unique index (WHERE event_id IS NOT NULL) cannot be used
-- in Supabase/PostgreSQL ON CONFLICT clauses. Need a full unique constraint instead.
--
-- References:
--   - iwf-meet-manager.js:132 uses onConflict: 'event_id'
--   - PostgreSQL docs: ON CONFLICT requires unique constraint or full unique index
--
-- IMPORTANT: Run this migration in Supabase SQL Editor before running imports

BEGIN;

-- Drop existing partial unique index
DROP INDEX IF EXISTS idx_iwf_meets_event_id_unique;

-- Create full unique constraint on event_id
-- This allows NULL values (multiple NULLs are allowed) but ensures uniqueness for non-NULL values
ALTER TABLE iwf_meets
ADD CONSTRAINT iwf_meets_event_id_key UNIQUE (event_id);

-- Keep the regular index for query performance
CREATE INDEX IF NOT EXISTS idx_iwf_meets_event_id ON iwf_meets(event_id);

COMMIT;

-- ============================================================================
-- Migration Complete
-- ============================================================================
--
-- Changes:
--   1. Dropped partial unique index: idx_iwf_meets_event_id_unique
--   2. Created unique constraint: iwf_meets_event_id_key
--   3. Maintained regular index for performance
--
-- This allows the Supabase JS client to use onConflict: 'event_id' for upserts
--
-- Verification:
--   Run: SELECT constraint_name, constraint_type
--        FROM information_schema.table_constraints
--        WHERE table_name = 'iwf_meets' AND constraint_type = 'UNIQUE';
--
-- Next Steps:
--   1. Run this migration in Supabase SQL Editor
--   2. Test import: node scripts/production/iwf-database-importer.js --event-id 661 --year 2025 --date "2025-06-01"
-- ============================================================================
