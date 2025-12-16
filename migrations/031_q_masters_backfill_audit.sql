-- Migration: Create audit table for surgical q_masters backfill
-- This table records original and new q_masters values per row to allow rollback
CREATE TABLE IF NOT EXISTS public.q_masters_backfill_audit (
    audit_id BIGSERIAL PRIMARY KEY,
    result_id BIGINT NOT NULL,
    lifter_name TEXT,
    gender TEXT,
    competition_age INTEGER,
    old_q_masters NUMERIC(10,3),
    new_q_masters NUMERIC(10,3),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    batch_tag TEXT
);

CREATE INDEX IF NOT EXISTS idx_q_masters_backfill_result_id ON public.q_masters_backfill_audit(result_id);
