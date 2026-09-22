-- ============================================================================
-- VERIFICATION SCRIPT: owlcms Geography / Organizer / Competition-Scope Capture
-- Date: 2026-09-21
--
-- READ-ONLY. Companion to migrations/add_owlcms_geography_organizer_scope.sql.
-- Run each query manually and compare against the expected results in the
-- comments. This script performs no writes.
-- ============================================================================

-- 1. New columns exist on owlcms_meets with correct types
-- Expected: 7 rows (venue, host_country_code, organizer_federation_id,
-- competition_scope, scope_evidence, geography_inference, uploader_selections)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'owlcms_meets'
  AND column_name IN ('venue', 'host_country_code', 'organizer_federation_id',
                      'competition_scope', 'scope_evidence',
                      'geography_inference', 'uploader_selections')
ORDER BY column_name;

-- 2. competition_scope check constraint is in force
-- Expected: one row listing: (international,continental,national,regional,local,unknown)
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.owlcms_meets'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%competition_scope%';

-- 3. Foreign key to federation_registry exists and is ON DELETE SET NULL
-- Expected: one row referencing federation_registry(id)
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.owlcms_meets'::regclass
  AND contype = 'f'
  AND confrelid = 'public.federation_registry'::regclass;

-- 4. owlcms_meet_teams table exists with the expected columns
-- Expected: team_id, meet_id, team_code, team_name, team_kind, raw, created_at, updated_at
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'owlcms_meet_teams'
ORDER BY ordinal_position;

-- 5. team_kind check constraint and deduplication unique index exist
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.owlcms_meet_teams'::regclass
  AND contype = 'c';
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'owlcms_meet_teams';

-- 6. Row Level Security is enabled with a public read policy
-- Expected: rowsecurity = true
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'owlcms_meet_teams';
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'owlcms_meet_teams';

-- 7. Historical rows untouched (no backfill was performed)
-- Expected: 0 rows returned by BOTH queries
SELECT meet_id, meet_name, venue, host_country_code, organizer_federation_id,
       competition_scope, scope_evidence, geography_inference, uploader_selections
FROM public.owlcms_meets
WHERE venue IS NOT NULL
   OR host_country_code IS NOT NULL
   OR organizer_federation_id IS NOT NULL
   OR competition_scope IS DISTINCT FROM 'unknown'
   OR scope_evidence IS NOT NULL
   OR geography_inference IS NOT NULL
   OR uploader_selections IS NOT NULL;

SELECT COUNT(*) AS meet_teams_rows FROM public.owlcms_meet_teams; -- Expected: 0

-- 8. New indexes on owlcms_meets exist
-- Expected: 3 rows (organizer_federation_id, competition_scope, host_country_code)
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'owlcms_meets'
  AND indexname IN ('idx_owlcms_meets_organizer_federation_id',
                    'idx_owlcms_meets_competition_scope',
                    'idx_owlcms_meets_host_country_code');
