-- ==============================================================================
-- Migration: Add Cross-Federation Drain Runs Audit Table
-- Description: Persists execution history, status, parameters, outcome telemetry,
--              and archived console logs for Admin User Interface Step 2 queue
--              drains (/api/admin/pipeline/drain -> run-athlete-linking-evaluator.js).
-- Target: Supabase PostgreSQL (public schema)
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cross_federation_drain_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    triggered_by TEXT,
    status TEXT NOT NULL DEFAULT 'RUNNING'
        CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED')),
    exit_code INTEGER,
    dry_run BOOLEAN NOT NULL DEFAULT false,
    re_evaluate BOOLEAN NOT NULL DEFAULT false,
    batch_limit INTEGER NOT NULL DEFAULT 100,
    source_federation TEXT
        CHECK (source_federation IS NULL OR source_federation IN ('ALL', 'IWF', 'USAW', 'OWLCMS')),
    target_federation TEXT
        CHECK (target_federation IS NULL OR target_federation IN ('ALL', 'IWF', 'USAW', 'OWLCMS')),
    evaluations_processed INTEGER NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    review_needed_count INTEGER NOT NULL DEFAULT 0,
    isolated_count INTEGER NOT NULL DEFAULT 0,
    summary_json JSONB,
    console_logs TEXT,
    error_message TEXT
);

COMMENT ON TABLE public.cross_federation_drain_runs IS
    'Chronological audit log and console log archive for cross-federation athlete linking queue drain runs';
COMMENT ON COLUMN public.cross_federation_drain_runs.triggered_by IS
    'Admin user email or Universally Unique Identifier (UUID) that triggered the drain run';
COMMENT ON COLUMN public.cross_federation_drain_runs.summary_json IS
    'Parsed __ATHLETE_EVALUATOR_SUMMARY_JSON__ JavaScript Object Notation Binary (JSONB) payload from the worker';
COMMENT ON COLUMN public.cross_federation_drain_runs.console_logs IS
    'Full standard output and standard error console log archive captured during the drain run';

-- Indexes for chronological Admin dashboard pagination and active-run filtering
CREATE INDEX IF NOT EXISTS idx_cross_federation_drain_runs_created_at
    ON public.cross_federation_drain_runs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_federation_drain_runs_status
    ON public.cross_federation_drain_runs USING btree (status);

-- Discretionary Access Control (DAC) table and identity sequence grants
GRANT ALL ON TABLE public.cross_federation_drain_runs TO service_role;
GRANT ALL ON TABLE public.cross_federation_drain_runs TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.cross_federation_drain_runs_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cross_federation_drain_runs_id_seq TO authenticated;

-- Enable Row-Level Security (RLS)
ALTER TABLE public.cross_federation_drain_runs ENABLE ROW LEVEL SECURITY;

-- Service role full access policy (matching public.iwf_pipeline_runs and public.cross_federation_backfill_runs)
DROP POLICY IF EXISTS "Service role full access on cross_federation_drain_runs"
    ON public.cross_federation_drain_runs;
CREATE POLICY "Service role full access on cross_federation_drain_runs"
    ON public.cross_federation_drain_runs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated administrator read/write policy (matching public.iwf_pipeline_runs and public.cross_federation_backfill_runs)
DROP POLICY IF EXISTS "Admins can view and manage cross_federation_drain_runs"
    ON public.cross_federation_drain_runs;
CREATE POLICY "Admins can view and manage cross_federation_drain_runs"
    ON public.cross_federation_drain_runs
    FOR ALL
    TO authenticated
    USING (
        public.is_admin(auth.uid())
    )
    WITH CHECK (
        public.is_admin(auth.uid())
    );

COMMIT;
