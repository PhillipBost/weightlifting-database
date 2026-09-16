-- ========================================================================
-- Migration: Grant OWLCMS Table Permissions & Enable RLS
-- Purpose: Grant necessary permissions to service_role and public roles,
--          and enable Row Level Security with public read policies.
-- Date: 2026-09-13
-- ========================================================================

BEGIN;

-- 1. Enable Row Level Security (RLS)
ALTER TABLE Public.owlcms_meets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owlcms_lifters ENABLE ROW LEVEL SECURITY;
ALTER TABLE Public.owlcms_meet_results ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies if already created
DROP POLICY IF EXISTS "Allow public read access" ON public.owlcms_meets;
DROP POLICY IF EXISTS "Allow public read access" ON public.owlcms_lifters;
DROP POLICY IF EXISTS "Allow public read access" ON public.owlcms_meet_results;

-- 3. Create Public Read Policies
CREATE POLICY "Allow public read access" ON public.owlcms_meets FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.owlcms_lifters FOR SELECT USING (true);
CREATE POLICY "Allow public read access" ON public.owlcms_meet_results FOR SELECT USING (true);

-- 4. Role Grants
GRANT ALL ON TABLE public.owlcms_meets TO service_role, postgres;
GRANT ALL ON TABLE public.owlcms_lifters TO service_role, postgres;
GRANT ALL ON TABLE public.owlcms_meet_results TO service_role, postgres;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role, postgres;

GRANT SELECT ON TABLE public.owlcms_meets TO anon, authenticated;
GRANT SELECT ON TABLE public.owlcms_lifters TO anon, authenticated;
GRANT SELECT ON TABLE public.owlcms_meet_results TO anon, authenticated;

COMMIT;
