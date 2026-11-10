-- ==============================================================================
-- Migration: Add IWF Pipeline Runs Audit Table
-- Description: Persists execution history, status, parameters, outcome telemetry,
--              and full console logs for Puppeteer IWF scraper runs.
-- Target: Supabase PostgreSQL (public schema)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.iwf_pipeline_runs (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_seconds NUMERIC(8, 2),
    status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')),
    mode TEXT NOT NULL DEFAULT 'single_event' CHECK (mode IN ('single_event', 'full_year')),
    event_id TEXT,
    url TEXT,
    year INTEGER,
    athlete_name TEXT,
    dry_run BOOLEAN NOT NULL DEFAULT false,
    force BOOLEAN NOT NULL DEFAULT false,
    exit_code INTEGER,
    error_message TEXT,
    import_stats JSONB DEFAULT '{}'::jsonb,
    logs TEXT,
    linker_logs TEXT,
    db_meet_id BIGINT,
    triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Comments documenting architecture and schema intentions
COMMENT ON TABLE public.iwf_pipeline_runs IS 'Historical run ledger and console log archive for IWF competition ingestion pipelines';
COMMENT ON COLUMN public.iwf_pipeline_runs.db_meet_id IS 'Database meet ID (unconstrained BIGINT to decouple audit log persistence from meet record lifecycle states and allow dry runs)';

-- Indexes for responsive dashboard pagination and filtering
CREATE INDEX IF NOT EXISTS idx_iwf_pipeline_runs_created_at ON public.iwf_pipeline_runs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iwf_pipeline_runs_db_meet_id ON public.iwf_pipeline_runs USING btree (db_meet_id);
CREATE INDEX IF NOT EXISTS idx_iwf_pipeline_runs_event_id ON public.iwf_pipeline_runs USING btree (event_id);
CREATE INDEX IF NOT EXISTS idx_iwf_pipeline_runs_status ON public.iwf_pipeline_runs USING btree (status);

-- Discretionary Access Control (DAC) Table and Identity Sequence Grants
GRANT ALL ON TABLE public.iwf_pipeline_runs TO service_role;
GRANT ALL ON TABLE public.iwf_pipeline_runs TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.iwf_pipeline_runs_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.iwf_pipeline_runs_id_seq TO authenticated;

-- Enable Row-Level Security (RLS)
ALTER TABLE public.iwf_pipeline_runs ENABLE ROW LEVEL SECURITY;

-- Service role full access policy
CREATE POLICY "Service role full access on iwf_pipeline_runs"
    ON public.iwf_pipeline_runs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated administrator read/write policy
CREATE POLICY "Admins can view and manage iwf_pipeline_runs"
    ON public.iwf_pipeline_runs
    FOR ALL
    TO authenticated
    USING (
        public.is_admin(auth.uid())
    )
    WITH CHECK (
        public.is_admin(auth.uid())
    );

