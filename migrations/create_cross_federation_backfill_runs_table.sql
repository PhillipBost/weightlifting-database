-- ==============================================================================
-- Migration: Add Cross-Federation Backfill Runs Audit Table
-- Description: Persists chronological logs of manual cross-federation athlete
--              backfill enqueue runs triggered from the Admin User Interface
--              (/api/admin/pipeline/seed-backfill) into
--              public.athlete_linking_evaluations.
-- Target: Supabase PostgreSQL (public schema)
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cross_federation_backfill_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    triggered_by TEXT,
    source_federation TEXT NOT NULL
        CHECK (source_federation IN ('IWF', 'USAW', 'OWLCMS')),
    target_federations TEXT[] NOT NULL
        CHECK (target_federations <@ ARRAY['IWF', 'USAW', 'OWLCMS']::TEXT[]),
    scope_mode TEXT NOT NULL
        CHECK (scope_mode IN ('date_range', 'year', 'meet', 'full')),
    start_date DATE,
    end_date DATE,
    year INTEGER,
    meet_id INTEGER,
    unlinked_only BOOLEAN NOT NULL DEFAULT true,
    source_athletes_found INTEGER NOT NULL DEFAULT 0,
    enqueued_count INTEGER NOT NULL DEFAULT 0,
    already_linked_skipped INTEGER NOT NULL DEFAULT 0,
    already_evaluated_skipped INTEGER NOT NULL DEFAULT 0,
    breakdown_by_target JSONB
);

COMMENT ON TABLE public.cross_federation_backfill_runs IS
    'Chronological audit log of live cross-federation athlete backfill enqueue runs into athlete_linking_evaluations';
COMMENT ON COLUMN public.cross_federation_backfill_runs.triggered_by IS
    'Admin user email or Universally Unique Identifier (UUID) that triggered the backfill run';
COMMENT ON COLUMN public.cross_federation_backfill_runs.breakdown_by_target IS
    'Optional JavaScript Object Notation Binary (JSONB) array summarizing per-target federation counts';

-- Indexes for chronological Admin dashboard pagination and federation filtering
CREATE INDEX IF NOT EXISTS idx_cross_federation_backfill_runs_created_at
    ON public.cross_federation_backfill_runs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_federation_backfill_runs_source_federation
    ON public.cross_federation_backfill_runs USING btree (source_federation);

-- Discretionary Access Control (DAC) table and identity sequence grants
GRANT ALL ON TABLE public.cross_federation_backfill_runs TO service_role;
GRANT ALL ON TABLE public.cross_federation_backfill_runs TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.cross_federation_backfill_runs_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cross_federation_backfill_runs_id_seq TO authenticated;

-- Enable Row-Level Security (RLS)
ALTER TABLE public.cross_federation_backfill_runs ENABLE ROW LEVEL SECURITY;

-- Service role full access policy (matching public.iwf_pipeline_runs)
DROP POLICY IF EXISTS "Service role full access on cross_federation_backfill_runs"
    ON public.cross_federation_backfill_runs;
CREATE POLICY "Service role full access on cross_federation_backfill_runs"
    ON public.cross_federation_backfill_runs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated administrator read/write policy (matching public.iwf_pipeline_runs)
DROP POLICY IF EXISTS "Admins can view and manage cross_federation_backfill_runs"
    ON public.cross_federation_backfill_runs;
CREATE POLICY "Admins can view and manage cross_federation_backfill_runs"
    ON public.cross_federation_backfill_runs
    FOR ALL
    TO authenticated
    USING (
        public.is_admin(auth.uid())
    )
    WITH CHECK (
        public.is_admin(auth.uid())
    );

COMMIT;
