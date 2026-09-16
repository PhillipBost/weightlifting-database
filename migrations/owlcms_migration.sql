-- ============================================================================
-- Migration: Create OWLCMS Database Tables
-- Purpose: Establish schema for importing owlcms competition JSON exports
-- Date: 2026-09-12
--
-- Architecture:
--   1. owlcms_meets        - Competition / meet event metadata + raw meet config
--   2. owlcms_lifters      - Unique human athlete profiles (no demographic unique constraint)
--   3. owlcms_meet_results - Individual platform performances, attempt metrics,
--                            timestamps, multi-championship rankings (JSONB),
--                            and complete source payload (JSONB)
-- ============================================================================

BEGIN;

-- ============================================================================
-- TABLE 1: owlcms_meets
-- Stores metadata and full configuration for owlcms competition events
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.owlcms_meets (
    meet_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meet_name           TEXT NOT NULL,
    start_date          DATE,
    end_date            DATE,
    city                TEXT,
    country             TEXT,
    organizer           TEXT,
    format_version      TEXT,
    source_file_name    TEXT,
    raw_payload         JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owlcms_meets_start_date 
    ON public.owlcms_meets (start_date);
CREATE INDEX IF NOT EXISTS idx_owlcms_meets_name 
    ON public.owlcms_meets (meet_name);

-- ============================================================================
-- TABLE 2: owlcms_lifters
-- Stores athlete career profiles.
-- NOTE: Does NOT enforce a demographic unique constraint on name/gender/birth_year
-- to prevent accidental merge corruption of distinct lifters who share demographics.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.owlcms_lifters (
    lifter_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    athlete_name        TEXT NOT NULL,
    first_name          TEXT,
    last_name           TEXT,
    gender              TEXT,
    birth_year          INTEGER,
    exact_birth_date    DATE,
    country_code        VARCHAR(10),
    club_name           TEXT,
    membership_number   TEXT,
    raw_payload         JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owlcms_lifters_name 
    ON public.owlcms_lifters (athlete_name);
CREATE INDEX IF NOT EXISTS idx_owlcms_lifters_membership 
    ON public.owlcms_lifters (membership_number);

-- ============================================================================
-- TABLE 3: owlcms_meet_results
-- Stores individual competition results and attempt metrics.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.owlcms_meet_results (
    result_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    meet_id             BIGINT NOT NULL REFERENCES public.owlcms_meets(meet_id) ON DELETE CASCADE,
    lifter_id           BIGINT NOT NULL REFERENCES public.owlcms_lifters(lifter_id) ON DELETE CASCADE,
    
    -- Platform Demographics & Category
    body_weight_kg      NUMERIC(5,2),
    scale_weight_kg     NUMERIC(5,2),
    category            TEXT NOT NULL,
    session_name        TEXT,
    lot_number          INTEGER,
    start_number        INTEGER,
    
    -- Snatch Attempts (+ = make, - = miss, 0/null = pass)
    snatch_1            NUMERIC(5,1),
    snatch_2            NUMERIC(5,1),
    snatch_3            NUMERIC(5,1),
    best_snatch         NUMERIC(5,1),
    snatch_1_time       TIMESTAMPTZ,
    snatch_2_time       TIMESTAMPTZ,
    snatch_3_time       TIMESTAMPTZ,
    
    -- Clean & Jerk Attempts
    cj_1                NUMERIC(5,1),
    cj_2                NUMERIC(5,1),
    cj_3                NUMERIC(5,1),
    best_cj             NUMERIC(5,1),
    cj_1_time           TIMESTAMPTZ,
    cj_2_time           TIMESTAMPTZ,
    cj_3_time           TIMESTAMPTZ,
    
    -- Totals & Coefficients
    total               NUMERIC(5,1),
    sinclair            NUMERIC(6,2),
    robi                NUMERIC(6,2),
    gamx                NUMERIC(6,2),
    
    -- Eligibility & Status
    eligible_for_individual_ranking BOOLEAN DEFAULT TRUE,
    ranking_status_reason           TEXT,
    
    -- Multi-Championship Ranking Array (preserves all ranking metadata)
    participations      JSONB,
    
    -- Complete Original Entity Payload
    raw_payload         JSONB,
    
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT uq_owlcms_result_entry 
        UNIQUE (meet_id, lifter_id, category)
);

CREATE INDEX IF NOT EXISTS idx_owlcms_results_meet 
    ON public.owlcms_meet_results (meet_id);
CREATE INDEX IF NOT EXISTS idx_owlcms_results_lifter 
    ON public.owlcms_meet_results (lifter_id);
CREATE INDEX IF NOT EXISTS idx_owlcms_results_category 
    ON public.owlcms_meet_results (category);
CREATE INDEX IF NOT EXISTS idx_owlcms_results_total 
    ON public.owlcms_meet_results (total DESC);
CREATE INDEX IF NOT EXISTS idx_owlcms_results_participations 
    ON public.owlcms_meet_results USING GIN (participations);

COMMIT;
