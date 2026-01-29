-- Migration: Fix Underflow in calculate_gamx_raw
-- Purpose: The 'Exact' CDF can return values smaller than 1e-308 (Postgres DOUBLE PRECISION limit).
-- When passed to gamx_norm_inv (which uses doubles), this causes a crash.
-- Fix: Clamp p_val to a safe DP range (1e-100 is plenty sufficient for weighting) before calling inverse.
BEGIN;
CREATE OR REPLACE FUNCTION calculate_gamx_raw(
        q_val NUMERIC,
        mu NUMERIC,
        sigma NUMERIC,
        nu NUMERIC
    ) RETURNS NUMERIC AS $$
DECLARE ratio NUMERIC;
z_val NUMERIC;
term_inv_sigma_nu NUMERIC;
correction NUMERIC := 0;
scale_denom NUMERIC;
cdf_z NUMERIC;
p_val NUMERIC;
result_score NUMERIC;
BEGIN -- Handle edge cases
IF q_val IS NULL
OR q_val <= 0 THEN RETURN NULL;
END IF;
IF mu IS NULL
OR mu <= 0 THEN RETURN NULL;
END IF;
IF sigma IS NULL
OR sigma <= 0 THEN RETURN NULL;
END IF;
IF nu IS NULL THEN RETURN NULL;
END IF;
ratio := q_val / mu;
-- Calculate z_val (Box-Cox transformation)
IF nu <> 0 THEN z_val := (power(ratio, nu) - 1.0) / (nu * sigma);
ELSE z_val := ln(ratio) / sigma;
END IF;
-- Calculate Truncation Terms
if nu <> 0 then term_inv_sigma_nu := 1.0 / (sigma * abs(nu));
-- Correction (L)
IF nu > 0 THEN correction := gamx_norm_cdf(- term_inv_sigma_nu);
ELSE correction := 0;
END IF;
-- Scale (R)
scale_denom := gamx_norm_cdf(term_inv_sigma_nu);
else correction := 0;
scale_denom := 1;
end if;
cdf_z := gamx_norm_cdf(z_val);
-- P_val for NormInv
IF scale_denom = 0 THEN RETURN NULL;
END IF;
p_val := (cdf_z - correction) / scale_denom;
-- SAFETY CLAMP for gamx_norm_inv (Double Precision Limits)
-- Postgres Double Precision smallest is ~1e-307. 
-- If p_val is smaller, it crashes when cast. 
-- We clamp to 1e-20 which is effectively 0 points anyway.
-- Using explicit casts to avoid parser errors with scientific notation
IF p_val < '1e-20'::NUMERIC THEN p_val := '1e-20'::NUMERIC;
END IF;
IF p_val > (1.0 - '1e-15'::NUMERIC) THEN p_val := (1.0 - '1e-15'::NUMERIC);
END IF;
result_score := 400.0 + 50.0 * gamx_norm_inv(p_val);
RETURN result_score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
COMMIT;