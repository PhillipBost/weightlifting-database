-- Migration: Temporarily Disable Triggers for Backfill
-- Purpose: Prevent timeouts by pausing YTD/Analytics/Count calculations during heavy updates.
BEGIN;
-- Disable Heavy Triggers
ALTER TABLE iwf_meet_results DISABLE TRIGGER iwf_meet_results_ytd_calculation_trigger;
ALTER TABLE iwf_meet_results DISABLE TRIGGER trg_update_iwf_meet_results_count;
ALTER TABLE iwf_meet_results DISABLE TRIGGER iwf_meet_results_analytics_update_trigger;
ALTER TABLE iwf_meet_results DISABLE TRIGGER iwf_meet_results_qpoints_auto_update;
-- Disable GAMX trigger too (since backfill calculates specific values manually)
ALTER TABLE iwf_meet_results DISABLE TRIGGER trigger_update_gamx_iwf;
COMMIT;