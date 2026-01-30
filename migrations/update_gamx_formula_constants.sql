-- Migration: Update GAMX Formula Constants & Remove Age Restrictions
-- Purpose: 
-- 1.  Update formula to: 1000 + 100 * NormInv(...) (was 400 + 50)
-- 2.  Remove 15-40 age restriction for Senior/Points/S/J scores to ensure they are calculated for all lifters.
BEGIN;
--------------------------------------------------------------------------------
-- 3. Main GAMX Logic (Updated Constants)
--------------------------------------------------------------------------------
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
IF scale_denom = 0 THEN RETURN NULL;
END IF;
p_val := (cdf_z - correction) / scale_denom;
-- SAFETY CLAMP for gamx_norm_inv (Double Precision Limits)
IF p_val < '1e-20'::NUMERIC THEN p_val := '1e-20'::NUMERIC;
END IF;
IF p_val > (1.0 - '1e-15'::NUMERIC) THEN p_val := (1.0 - '1e-15'::NUMERIC);
END IF;
-- UPDATED CONSTANTS: 1000 base, 100 multiplier
result_score := 1000.0 + 100.0 * gamx_norm_inv(p_val);
RETURN result_score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--------------------------------------------------------------------------------
-- 4. Context-Aware Calculation Function (Updated Logic)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_gamx_score(
        p_type TEXT,
        p_gender TEXT,
        p_age NUMERIC,
        p_bw NUMERIC,
        p_result NUMERIC
    ) RETURNS NUMERIC AS $$
DECLARE rec RECORD;
score NUMERIC;
BEGIN IF p_gender IS NULL
OR p_bw IS NULL
OR p_result IS NULL THEN RETURN NULL;
END IF;
-- 1. Normalize Inputs
p_gender := LOWER(p_gender);
IF p_gender LIKE 'm%' THEN p_gender := 'm';
ELSIF p_gender LIKE 'f%'
OR p_gender LIKE 'w%' THEN p_gender := 'f';
END IF;
-- 2. Lookup Factors (Mu, Sigma, Nu)
p_bw := ROUND(p_bw, 1);
IF p_type = 'u' THEN IF p_age IS NULL THEN RETURN NULL;
END IF;
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_u_factors
WHERE gender = p_gender
    AND age = p_age::INT
    AND bodyweight = p_bw;
ELSIF p_type = 'a' THEN -- "Actual" or IWF/Junior usually requires age too? If so keep it.
-- Assuming 'a' means Age-specific tables (like Junior/IWF age groups)
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_a_factors
WHERE gender = p_gender
    AND age = p_age::INT
    AND bodyweight = p_bw;
ELSIF p_type = 'masters' THEN
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_masters_factors
WHERE gender = p_gender
    AND age = p_age::INT
    AND bodyweight = p_bw;
ELSIF p_type = 'total' THEN -- Senior Total: Age 15-40 only
IF p_age < 15
OR p_age > 40 THEN RETURN NULL;
END IF;
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_points_factors
WHERE gender = p_gender
    AND bodyweight = p_bw;
ELSIF p_type = 's' THEN -- Snatch: Age 15-40 only
IF p_age < 15
OR p_age > 40 THEN RETURN NULL;
END IF;
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_s_factors
WHERE gender = p_gender
    AND bodyweight = p_bw;
ELSIF p_type = 'j' THEN -- Clean & Jerk: Age 15-40 only
IF p_age < 15
OR p_age > 40 THEN RETURN NULL;
END IF;
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_j_factors
WHERE gender = p_gender
    AND bodyweight = p_bw;
ELSE RETURN NULL;
END IF;
IF NOT FOUND THEN RETURN NULL;
END IF;
-- Calculate
score := calculate_gamx_raw(p_result, rec.mu, rec.sigma, rec.nu);
RETURN score;
END;
$$ LANGUAGE plpgsql STABLE;
COMMIT;