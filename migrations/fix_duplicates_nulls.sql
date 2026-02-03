-- Drop the old constraint which didn't handle NULLs correctly for uniqueness
ALTER TABLE iwf_sanctions DROP CONSTRAINT IF EXISTS unique_sanction;
-- Create a unique index treating NULLs as empty strings so they conflict
CREATE UNIQUE INDEX IF NOT EXISTS idx_iwf_sanctions_unique_coalesce ON iwf_sanctions (
    name,
    COALESCE(start_date, ''),
    COALESCE(substance, '')
);