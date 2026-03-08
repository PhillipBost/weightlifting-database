-- ROLLBACK: Batch 2 Migration
-- This removes the search_path = '' setting from the 4 functions in Batch 2
-- Returns them to their original state (mutable search_path)
BEGIN;
-- 1. get_age_factor - Remove search_path setting
ALTER FUNCTION public.get_age_factor(integer, text) RESET search_path;
-- 2. get_youth_factor_exact - Remove search_path setting  
ALTER FUNCTION public.get_youth_factor_exact(integer, integer, text) RESET search_path;
-- 3. is_admin - Remove search_path setting
ALTER FUNCTION public.is_admin(uuid) RESET search_path;
-- 4. search_athletes - Remove search_path setting
ALTER FUNCTION public.search_athletes(text) RESET search_path;
COMMIT;
-- After running this, the 4 warnings will return, but the functions will work correctly.