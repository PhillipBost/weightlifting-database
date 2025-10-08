-- Migration: Add state column to clubs table
-- Purpose: Enable explicit state field for high-confidence WSO assignment
-- Date: 2025-10-08
--
-- This mirrors the meet_locations.state field that provides 98% confidence
-- WSO assignments. Without this field, clubs rely on address parsing (85% confidence)
-- which leads to misassignments like Catalyst Athletics (Oregon) → California South.

-- Add state column
ALTER TABLE clubs
ADD COLUMN IF NOT EXISTS state VARCHAR(50);

-- Add index for faster state-based queries
CREATE INDEX IF NOT EXISTS idx_clubs_state ON clubs(state);

-- Add comment documenting the column
COMMENT ON COLUMN clubs.state IS 'US state name (full or abbreviation) for WSO geography assignment. Extracted from address or coordinates.';
