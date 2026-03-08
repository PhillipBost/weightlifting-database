-- Secure update_updated_at_column
-- Setting search_path = public to prevent search_path mutability warnings
BEGIN;
ALTER FUNCTION public.update_updated_at_column()
SET search_path = public;
COMMIT;