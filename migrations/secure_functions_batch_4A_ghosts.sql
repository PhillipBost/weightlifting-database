-- Secure Functions Batch 4A: Safe & Calculation Functions
-- These functions do not access tables OR contain fully qualified references already.
-- Action: Set search_path = '' to enforce security.
BEGIN;
-- 1. Triggers (Safe, use NEW/OLD)
ALTER FUNCTION public.update_updated_at_column()
SET search_path = '';
ALTER FUNCTION public.calculate_competition_age()
SET search_path = '';
-- 2. GAMX Math Functions (Safe, pure math)
ALTER FUNCTION public.gamx_erf_series(numeric)
SET search_path = '';
ALTER FUNCTION public.gamx_erfc_cf(numeric)
SET search_path = '';
ALTER FUNCTION public.gamx_norm_inv(numeric)
SET search_path = '';
-- 3. IWF Calculation Functions (Safe, use NEW or system functions)
ALTER FUNCTION public.calculate_iwf_analytics()
SET search_path = '';
ALTER FUNCTION public.calculate_iwf_competition_age()
SET search_path = '';
ALTER FUNCTION public.calculate_iwf_duration()
SET search_path = '';
COMMIT;