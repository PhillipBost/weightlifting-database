-- ============================================================================
-- MIGRATION: Federation-Agnostic Athlete Linking & Evaluation Ledger
-- Description: Creates public.athlete_linking_evaluations table to decouple 
--              identity edges (athlete_aliases) from task lifecycle states.
-- Date: 2026-11-10 (Eastern Standard Time)
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.athlete_linking_evaluations (
    evaluation_id BIGSERIAL PRIMARY KEY,
    
    -- Source athlete identity
    source_federation_id UUID NOT NULL REFERENCES public.federation_registry(id) ON DELETE CASCADE,
    source_athlete_id BIGINT NOT NULL,
    
    -- Target evaluation context
    target_federation_id UUID NOT NULL REFERENCES public.federation_registry(id) ON DELETE CASCADE,
    target_athlete_id BIGINT,                  -- Nullable until a candidate match/review is identified
    
    -- State machine status
    status VARCHAR(25) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'MATCHED', 'REVIEW_NEEDED', 'VETTED_ISOLATED')),
    
    -- Audit & Telemetry
    confidence_score NUMERIC(5, 2),
    evidence_breakdown JSONB,                  -- Full scoring breakdown and candidate comparison
    algorithm_version VARCHAR(50) NOT NULL,   -- e.g. 'v2.1-demographic-physics'
    
    -- Triage & Blacklisting
    reviewer_notes TEXT,
    is_blacklisted BOOLEAN NOT NULL DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    evaluated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Strict uniqueness: exactly one evaluation state per source athlete per target federation
    CONSTRAINT uq_athlete_evaluation_pair UNIQUE (source_federation_id, source_athlete_id, target_federation_id)
);

-- Fast lookup of all evaluations for a specific athlete
CREATE INDEX IF NOT EXISTS idx_linking_eval_lookup 
    ON public.athlete_linking_evaluations (source_federation_id, source_athlete_id);

-- Queue index for pending and review work items
CREATE INDEX IF NOT EXISTS idx_linking_eval_queue 
    ON public.athlete_linking_evaluations (target_federation_id, status)
    WHERE status IN ('PENDING', 'REVIEW_NEEDED');

-- Reverse lookup for target athlete matches
CREATE INDEX IF NOT EXISTS idx_linking_eval_target_athlete 
    ON public.athlete_linking_evaluations (target_federation_id, target_athlete_id)
    WHERE target_athlete_id IS NOT NULL;

-- Trigger to maintain updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_athlete_linking_evaluations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_athlete_linking_evaluations_updated_at ON public.athlete_linking_evaluations;

CREATE TRIGGER trigger_update_athlete_linking_evaluations_updated_at
BEFORE UPDATE ON public.athlete_linking_evaluations
FOR EACH ROW
EXECUTE FUNCTION public.update_athlete_linking_evaluations_updated_at();

-- Discretionary Access Control (DAC) Table and Identity Sequence Grants
GRANT ALL ON TABLE public.athlete_linking_evaluations TO service_role;
GRANT ALL ON TABLE public.athlete_linking_evaluations TO authenticated;
GRANT SELECT ON TABLE public.athlete_linking_evaluations TO anon;

GRANT USAGE, SELECT ON SEQUENCE public.athlete_linking_evaluations_evaluation_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.athlete_linking_evaluations_evaluation_id_seq TO authenticated;

COMMIT;

