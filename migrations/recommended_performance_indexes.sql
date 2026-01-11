-- Recommended Additional Indexes based on Codebase Analysis
-- 1. usaw_meet_results: Optimize filtering by filtering columns
CREATE INDEX IF NOT EXISTS idx_usaw_meet_results_lifter_name ON public.usaw_meet_results USING btree (lifter_name);
CREATE INDEX IF NOT EXISTS idx_usaw_meet_results_total ON public.usaw_meet_results USING btree (total);
-- 2. usaw_meet_results: Optimize "missing metadata" backfill queries
-- These allow the scraper to instantly find rows with missing data (NULLs)
CREATE INDEX IF NOT EXISTS idx_usaw_meet_results_wso ON public.usaw_meet_results USING btree (wso)
WHERE wso IS NULL;
CREATE INDEX IF NOT EXISTS idx_usaw_meet_results_club_name ON public.usaw_meet_results USING btree (club_name)
WHERE club_name IS NULL;
CREATE INDEX IF NOT EXISTS idx_usaw_meet_results_competition_age ON public.usaw_meet_results USING btree (competition_age)
WHERE competition_age IS NULL;
-- 3. usaw_lifters: Optimize Joins and Lookups
-- Crucial for WSO backfill which joins on these columns to check for existing metadata
CREATE INDEX IF NOT EXISTS idx_usaw_lifters_membership_number ON public.usaw_lifters USING btree (membership_number);
CREATE INDEX IF NOT EXISTS idx_usaw_lifters_internal_id ON public.usaw_lifters USING btree (internal_id);
-- Note: usaw_meet_results should already have indexes on meet_id, lifter_id, and date from initial migration.