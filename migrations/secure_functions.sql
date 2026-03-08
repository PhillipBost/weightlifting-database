-- Migration: Secure Function Search Paths
-- Purpose: Set search_path to 'public' for all functions identified with mutable search_path warnings
-- This prevents potential security issues where functions could be tricked into using malicious objects from other schemas
BEGIN;
-- 1. Analytics Functions
ALTER FUNCTION public.calculate_and_set_analytics()
SET search_path = public;
ALTER FUNCTION public.calculate_bounce_back(text, text)
SET search_path = public;
ALTER FUNCTION public.calculate_competition_age()
SET search_path = public;
ALTER FUNCTION public.calculate_meet_result_analytics(
    bigint,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text,
    text
)
SET search_path = public;
-- 2. Q-Points and Ranking Functions
ALTER FUNCTION public.calculate_qpoints_from_row(numeric, numeric, text)
SET search_path = public;
ALTER FUNCTION public.recalculate_all_qpoints()
SET search_path = public;
ALTER FUNCTION public.recalculate_lifter_analytics(bigint, integer)
SET search_path = public;
ALTER FUNCTION public.calculate_ytd_best(bigint, text, text, text)
SET search_path = public;
ALTER FUNCTION public.update_qpoints_on_change()
SET search_path = public;
ALTER FUNCTION public.update_listing_entry_count()
SET search_path = public;
-- 3. GAMX Calculation Functions
ALTER FUNCTION public.calculate_gamx_raw(numeric, numeric, numeric, numeric)
SET search_path = public;
ALTER FUNCTION public.gamx_erf(numeric)
SET search_path = public;
ALTER FUNCTION public.gamx_erf_series(numeric)
SET search_path = public;
ALTER FUNCTION public.gamx_erfc_cf(numeric)
SET search_path = public;
ALTER FUNCTION public.gamx_norm_cdf(numeric)
SET search_path = public;
ALTER FUNCTION public.gamx_norm_inv(numeric)
SET search_path = public;
ALTER FUNCTION public.get_gamx_score(text, text, numeric, numeric, numeric)
SET search_path = public;
ALTER FUNCTION public.update_gamx_scores()
SET search_path = public;
-- 4. IWF Analytics Functions
ALTER FUNCTION public.calculate_iwf_analytics()
SET search_path = public;
ALTER FUNCTION public.calculate_iwf_competition_age()
SET search_path = public;
ALTER FUNCTION public.calculate_iwf_duration()
SET search_path = public;
ALTER FUNCTION public.calculate_iwf_ytd_bests()
SET search_path = public;
ALTER FUNCTION public.handle_iwf_manual_override()
SET search_path = public;
ALTER FUNCTION public.update_iwf_meet_results_count()
SET search_path = public;
ALTER FUNCTION public.update_iwf_qpoints_on_change()
SET search_path = public;
ALTER FUNCTION public.update_iwf_updated_at_column()
SET search_path = public;
-- 5. Backfill & Maintenance Functions
ALTER FUNCTION public.backfill_gamx_batch(integer)
SET search_path = public;
ALTER FUNCTION public.backfill_gamx_by_range(bigint, bigint, text)
SET search_path = public;
-- Note: 'backfill_q_masters_batched' was reported but signature not confirmed.
-- Attempting to alter by name if unique, otherwise this line may fail if overloaded.
DO $$ BEGIN -- Check if function exists without arguments first
IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'backfill_q_masters_batched'
) THEN -- try with integer argument as typical backfill pattern
BEGIN ALTER FUNCTION public.backfill_q_masters_batched(integer)
SET search_path = public;
EXCEPTION
WHEN OTHERS THEN -- Fallback or ignore if signature mismatch
RAISE NOTICE 'Could not secure backfill_q_masters_batched(int): %',
SQLERRM;
END;
END IF;
END $$;
-- 6. Helper & Utility Functions
ALTER FUNCTION public.count_successful_attempts(text, text, text)
SET search_path = public;
ALTER FUNCTION public.get_age_factor(integer, text)
SET search_path = public;
ALTER FUNCTION public.get_youth_age_factor_interpolated(integer, numeric, text)
SET search_path = public;
ALTER FUNCTION public.get_youth_factor_exact(integer, integer, text)
SET search_path = public;
ALTER FUNCTION public.get_wso_from_state(text)
SET search_path = public;
ALTER FUNCTION public.handle_manual_override()
SET search_path = public;
ALTER FUNCTION public.handle_new_user()
SET search_path = public;
ALTER FUNCTION public.is_admin(uuid)
SET search_path = public;
ALTER FUNCTION public.is_master_age(text, integer)
SET search_path = public;
ALTER FUNCTION public.parse_usaw_listing_dates()
SET search_path = public;
ALTER FUNCTION public.search_athletes(text)
SET search_path = public;
ALTER FUNCTION public.text_to_numeric_safe(text)
SET search_path = public;
ALTER FUNCTION public.update_clubs_analytics_timestamp()
SET search_path = public;
ALTER FUNCTION public.update_updated_at_column()
SET search_path = public;
ALTER FUNCTION public.update_wso_analytics_updated_at()
SET search_path = public;
COMMIT;