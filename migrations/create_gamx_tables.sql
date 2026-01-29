-- Migration: Create GAMX Tables
-- Purpose: Create tables to store GAMX parameters (mu, sigma, nu) for various age groups and lift types.
-- All tables rely on gender and bodyweight. Some rely on age.
BEGIN;
-- 1. GAMX-U Factors (Source: params_U_men/wom) - Age 7-20
CREATE TABLE gamx_u_factors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gender TEXT NOT NULL CHECK (gender IN ('m', 'f')),
    age INTEGER NOT NULL,
    bodyweight NUMERIC NOT NULL,
    mu NUMERIC NOT NULL,
    sigma NUMERIC NOT NULL,
    nu NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_gamx_u_factors_lookup ON gamx_u_factors(gender, age, bodyweight);
-- 2. GAMX-A Factors (Source: params_iwf_men/wom) - Age 13-30
CREATE TABLE gamx_a_factors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gender TEXT NOT NULL CHECK (gender IN ('m', 'f')),
    age INTEGER NOT NULL,
    bodyweight NUMERIC NOT NULL,
    mu NUMERIC NOT NULL,
    sigma NUMERIC NOT NULL,
    nu NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_gamx_a_factors_lookup ON gamx_a_factors(gender, age, bodyweight);
-- 3. GAMX-Masters Factors (Source: params_mas_men/wom) - Age 30-95
CREATE TABLE gamx_masters_factors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gender TEXT NOT NULL CHECK (gender IN ('m', 'f')),
    age INTEGER NOT NULL,
    bodyweight NUMERIC NOT NULL,
    mu NUMERIC NOT NULL,
    sigma NUMERIC NOT NULL,
    nu NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_gamx_masters_factors_lookup ON gamx_masters_factors(gender, age, bodyweight);
-- 4. GAMX Points Factors (Total) (Source: params_sen_men/women) - Senior (Weight based only)
CREATE TABLE gamx_points_factors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gender TEXT NOT NULL CHECK (gender IN ('m', 'f')),
    bodyweight NUMERIC NOT NULL,
    mu NUMERIC NOT NULL,
    sigma NUMERIC NOT NULL,
    nu NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_gamx_points_factors_lookup ON gamx_points_factors(gender, bodyweight);
-- 5. GAMX-S Factors (Snatch) (Source: snatch_sen_men/wom) - Senior (Weight based only)
CREATE TABLE gamx_s_factors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gender TEXT NOT NULL CHECK (gender IN ('m', 'f')),
    bodyweight NUMERIC NOT NULL,
    mu NUMERIC NOT NULL,
    sigma NUMERIC NOT NULL,
    nu NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_gamx_s_factors_lookup ON gamx_s_factors(gender, bodyweight);
-- 6. GAMX-J Factors (Clean & Jerk) (Source: cj_sen_men/wom) - Senior (Weight based only)
CREATE TABLE gamx_j_factors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gender TEXT NOT NULL CHECK (gender IN ('m', 'f')),
    bodyweight NUMERIC NOT NULL,
    mu NUMERIC NOT NULL,
    sigma NUMERIC NOT NULL,
    nu NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_gamx_j_factors_lookup ON gamx_j_factors(gender, bodyweight);
COMMIT;