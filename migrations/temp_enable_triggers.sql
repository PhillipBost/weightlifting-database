-- Migration: Re-Enable Triggers after Backfill
-- Purpose: Restore normal system functionality.
BEGIN;
-- Enable Heavy Triggers
ALTER TABLE iwf_meet_results ENABLE TRIGGER iwf_meet_results_ytd_calculation_trigger;
ALTER TABLE iwf_meet_results ENABLE TRIGGER trg_update_iwf_meet_results_count;
ALTER TABLE iwf_meet_results ENABLE TRIGGER iwf_meet_results_analytics_update_trigger;
ALTER TABLE iwf_meet_results ENABLE TRIGGER iwf_meet_results_qpoints_auto_update;
-- Enable GAMX trigger (for future inserts/updates)
ALTER TABLE iwf_meet_results ENABLE TRIGGER trigger_update_gamx_iwf;
COMMIT;