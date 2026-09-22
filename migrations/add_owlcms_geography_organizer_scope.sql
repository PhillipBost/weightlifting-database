-- ============================================================================
-- MIGRATION: owlcms Geography / Organizer / Competition-Scope Capture
-- Date: 2026-09-21
--
-- Status: GENERATED FOR MANUAL EXECUTION. Per project protocol this file is
--         NEVER auto-applied; the user runs it manually after review.
--
-- Purpose (approved proposal, 2026-09-21):
--   1. Stop conflating host geography, organizer identity, and competition
--      scope on public.owlcms_meets (the legacy text columns `country` and
--      `organizer` currently hold venue strings and club names).
--   2. Add evidence-provenance JSONB columns so server-side inferences remain
--      permanently distinguishable from uploader-confirmed selections/overrides.
--   3. Create public.owlcms_meet_teams to capture per-competition team /
--      delegation representation (nation, province/state, or club) instead of
--      overloading the permanent owlcms_lifters.club_name column.
--
-- Verified deployed context (2026-09-21 live queries):
--   * owlcms_meets.country holds venue strings in 4/4 rows (importer mapped
--     competition.competitionSite — the venue free-text — into it).
--   * owlcms_lifters.club_name holds provinces (meet 1), club names (meets
--     2-3), or delegation codes (meet 4) depending on the meet.
--   * The owlcms export format has NO host-country, continent, subdivision, or
--     explicit competition-level field.
--   * federation_registry classification column is `level` (check-constrained
--     to international | continental | national | regional_state_wso | club).
--
-- Policy:
--   * Historical rows are NOT rewritten and NOT backfilled. New columns stay
--     NULL for all existing meets; they simply did not record these facts.
--   * No federation_registry rows are seeded or synthesized by this migration.
--   * Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Host geography, organizer identity, and competition scope on owlcms_meets
-- ============================================================================

ALTER TABLE public.owlcms_meets
    ADD COLUMN IF NOT EXISTS venue TEXT,
    ADD COLUMN IF NOT EXISTS host_country_code TEXT,
    ADD COLUMN IF NOT EXISTS organizer_federation_id UUID
        REFERENCES public.federation_registry(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS competition_scope TEXT NOT NULL DEFAULT 'unknown'
        CHECK (competition_scope IN
            ('international', 'continental', 'national', 'regional', 'local', 'unknown')),
    ADD COLUMN IF NOT EXISTS scope_evidence JSONB,
    ADD COLUMN IF NOT EXISTS geography_inference JSONB,
    ADD COLUMN IF NOT EXISTS uploader_selections JSONB;

COMMENT ON COLUMN public.owlcms_meets.venue IS
    'Venue/site free-text from competition.competitionSite (observed values: school names, street addresses, city names). Distinct from city and from any country.';
COMMENT ON COLUMN public.owlcms_meets.host_country_code IS
    'Host country code (registry/IWF member code system, e.g. CAN, USA). Inferred conservatively or set by uploader; NULL means not established. Distinct from organizer jurisdiction and record jurisdiction.';
COMMENT ON COLUMN public.owlcms_meets.organizer_federation_id IS
    'Registry link for the organizing body (competition.competitionOrganizer), separate from the sanctioning federation_id. Search-only resolution; never auto-seeded.';
COMMENT ON COLUMN public.owlcms_meets.competition_scope IS
    'Suggested competition scope derived from the sanctioning federation registry level; unknown is explicit and never silently defaulted from team/record evidence. Club organizers and club team names never prove a local event.';
COMMENT ON COLUMN public.owlcms_meets.scope_evidence IS
    'Evidence behind competition_scope: sanction federation level, deduplicated (recordFederation, recordName) sets, team analysis, caveats. Written once at import; never overwritten by uploader actions.';
COMMENT ON COLUMN public.owlcms_meets.geography_inference IS
    'Server-side inference evidence (raw source values, candidate matches, match_rank, statuses). Never overwritten; distinguishes machine suggestions from human choices.';
COMMENT ON COLUMN public.owlcms_meets.uploader_selections IS
    'Explicit uploader cascade selections and overrides (continent/country/organizer/scope, including cleared values). Only written from uploader input; NULL means no uploader input was recorded.';

CREATE INDEX IF NOT EXISTS idx_owlcms_meets_organizer_federation_id
    ON public.owlcms_meets (organizer_federation_id);
CREATE INDEX IF NOT EXISTS idx_owlcms_meets_competition_scope
    ON public.owlcms_meets (competition_scope);
CREATE INDEX IF NOT EXISTS idx_owlcms_meets_host_country_code
    ON public.owlcms_meets (host_country_code);

-- (Section 2: meet teams table follows below.)

-- ============================================================================
-- 2. Per-competition team / delegation representation
--    (moves meet-specific representation off permanent athlete identity)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.owlcms_meet_teams (
    team_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meet_id     BIGINT NOT NULL REFERENCES public.owlcms_meets(meet_id) ON DELETE CASCADE,
    team_code   TEXT,                              -- v2: numeric team id from teams[]; legacy: NULL
    team_name   TEXT NOT NULL,                     -- v2: teams[].name; legacy: athlete.team string
    team_kind   TEXT NOT NULL DEFAULT 'unknown'
        CHECK (team_kind IN ('delegation', 'subdivision', 'club', 'unknown')),
    raw         JSONB,                             -- original teams[] entry (v2) or NULL (legacy)
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Deduplication key tolerant of NULL codes (legacy exports have no team code)
CREATE UNIQUE INDEX IF NOT EXISTS uq_owlcms_meet_teams_entry
    ON public.owlcms_meet_teams (meet_id, COALESCE(team_code, ''), team_name);

CREATE INDEX IF NOT EXISTS idx_owlcms_meet_teams_meet
    ON public.owlcms_meet_teams (meet_id);
CREATE INDEX IF NOT EXISTS idx_owlcms_meet_teams_kind
    ON public.owlcms_meet_teams (team_kind);

-- ============================================================================
-- 3. Access policy (mirrors the deployed owlcms_grants.sql pattern)
-- ============================================================================

ALTER TABLE public.owlcms_meet_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access" ON public.owlcms_meet_teams;
CREATE POLICY "Allow public read access" ON public.owlcms_meet_teams
    FOR SELECT USING (true);

GRANT ALL ON TABLE public.owlcms_meet_teams TO service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role, postgres;
GRANT SELECT ON TABLE public.owlcms_meet_teams TO anon, authenticated;

COMMIT;

