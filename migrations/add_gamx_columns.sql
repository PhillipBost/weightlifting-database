-- Migration: Add GAMX Columns
-- Purpose: Add columns to store GAMX scores in meet results tables.
BEGIN;
-- Add columns to usaw_meet_results
ALTER TABLE usaw_meet_results
ADD COLUMN IF NOT EXISTS gamx_u NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_a NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_masters NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_total NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_s NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_j NUMERIC;
-- Add columns to iwf_meet_results
ALTER TABLE iwf_meet_results
ADD COLUMN IF NOT EXISTS gamx_u NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_a NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_masters NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_total NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_s NUMERIC,
    ADD COLUMN IF NOT EXISTS gamx_j NUMERIC;
COMMIT;