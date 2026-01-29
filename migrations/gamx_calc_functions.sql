-- Migration: Add GAMX Calculation Functions
-- Purpose: Implement exact GAMX formula in Postgres using PL/PGSQL
BEGIN;
--------------------------------------------------------------------------------
-- 0. Error Function Approximation (erf)
--    Abramowitz and Stegun 7.1.26
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gamx_erf(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE -- constants
    a1 DOUBLE PRECISION := 0.254829592;
a2 DOUBLE PRECISION := -0.284496736;
a3 DOUBLE PRECISION := 1.421413741;
a4 DOUBLE PRECISION := -1.453152027;
a5 DOUBLE PRECISION := 1.061405429;
p DOUBLE PRECISION := 0.3275911;
-- variables
sign DOUBLE PRECISION := 1.0;
t DOUBLE PRECISION;
y DOUBLE PRECISION;
z DOUBLE PRECISION;
val DOUBLE PRECISION;
BEGIN val := x::DOUBLE PRECISION;
z := abs(val);
-- Safety clamp to prevent underflow in exp(-z*z)
-- If z > 20, erf is essentially 1.0.
IF z > 20.0 THEN RETURN (sign * 1.0)::NUMERIC;
END IF;
-- t = 1 / (1 + p*x)
t := 1.0 / (1.0 + p * z);
-- Formula
y := 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * exp(- z * z);
IF val < 0 THEN sign := -1.0;
END IF;
RETURN (sign * y)::NUMERIC;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--------------------------------------------------------------------------------
-- 1. Standard Normal CDF (Cumulative Distribution Function)
--    Phi(x) = 0.5 * (1 + erf(x / sqrt(2)))
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gamx_norm_cdf(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE -- Constants
    sqrt2 NUMERIC := 1.41421356237309504880;
BEGIN -- Use custom gamx_erf
RETURN 0.5 * (1.0 + gamx_erf(x / sqrt2));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--------------------------------------------------------------------------------
-- 2. Inverse Standard Normal CDF (Probit Function)
--    Approximation using Acklam's algorithm (or similar high-precision rational approx)
--    Since Postgres doesn't have a built-in PROBIT/NORM.S.INV
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gamx_norm_inv(p_in NUMERIC) RETURNS NUMERIC AS $$
DECLARE p DOUBLE PRECISION := p_in::DOUBLE PRECISION;
t DOUBLE PRECISION;
q DOUBLE PRECISION;
x DOUBLE PRECISION;
-- Coefficients for p_low (p < 0.02425) - Converted from sci notation to avoid spaces
a1 CONSTANT DOUBLE PRECISION := -39.69683028665376;
a2 CONSTANT DOUBLE PRECISION := 220.9460984245205;
a3 CONSTANT DOUBLE PRECISION := -275.9285104469687;
a4 CONSTANT DOUBLE PRECISION := 138.3577518672690;
a5 CONSTANT DOUBLE PRECISION := -30.66479806614716;
a6 CONSTANT DOUBLE PRECISION := 2.506628277459239;
b1 CONSTANT DOUBLE PRECISION := -54.47609879822406;
b2 CONSTANT DOUBLE PRECISION := 161.5858368580409;
b3 CONSTANT DOUBLE PRECISION := -155.6989798598866;
b4 CONSTANT DOUBLE PRECISION := 66.80131188771972;
b5 CONSTANT DOUBLE PRECISION := -13.28068155288572;
-- Coefficients for p_central
c1 CONSTANT DOUBLE PRECISION := -0.007784894002430293;
c2 CONSTANT DOUBLE PRECISION := -0.3223964580411365;
c3 CONSTANT DOUBLE PRECISION := -2.400758277161838;
c4 CONSTANT DOUBLE PRECISION := -2.549732539343734;
c5 CONSTANT DOUBLE PRECISION := 4.374664141464968;
c6 CONSTANT DOUBLE PRECISION := 2.938163982698783;
d1 CONSTANT DOUBLE PRECISION := 0.007784695709041462;
d2 CONSTANT DOUBLE PRECISION := 0.3224671290700398;
d3 CONSTANT DOUBLE PRECISION := 2.445134137142996;
d4 CONSTANT DOUBLE PRECISION := 3.754408661907416;
-- Breakpoints
p_low CONSTANT DOUBLE PRECISION := 0.02425;
p_high CONSTANT DOUBLE PRECISION := 1.0 - 0.02425;
BEGIN IF p < 0.0
OR p > 1.0 THEN RAISE EXCEPTION 'Argument p must be between 0 and 1';
END IF;
IF p = 0.0 THEN RETURN '-Infinity';
END IF;
IF p = 1.0 THEN RETURN 'Infinity';
END IF;
IF p < p_low THEN -- Rational approximation for lower region
t := sqrt(-2.0 * ln(p));
x := (
    ((((c1 * t + c2) * t + c3) * t + c4) * t + c5) * t + c6
) / ((((d1 * t + d2) * t + d3) * t + d4) * t + 1.0);
ELSIF p > p_high THEN -- Rational approximation for upper region
t := sqrt(-2.0 * ln(1.0 - p));
x := -(
    ((((c1 * t + c2) * t + c3) * t + c4) * t + c5) * t + c6
) / ((((d1 * t + d2) * t + d3) * t + d4) * t + 1.0);
ELSE -- Rational approximation for central region
q := p - 0.5;
t := q * q;
x := (
    ((((a1 * t + a2) * t + a3) * t + a4) * t + a5) * t + a6
) * q / (
    ((((b1 * t + b2) * t + b3) * t + b4) * t + b5) * t + 1.0
);
END IF;
RETURN x::NUMERIC;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--------------------------------------------------------------------------------
-- 3. Main GAMX Logic
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
begin -- Handle edge cases
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
-- Clamp P_val to (0,1) exclusive to avoid infinity in NormInv
IF p_val <= 0 THEN p_val := 0.0000001;
END IF;
IF p_val >= 1 THEN p_val := 0.9999999;
END IF;
result_score := 400.0 + 50.0 * gamx_norm_inv(p_val);
RETURN result_score;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--------------------------------------------------------------------------------
-- 4. Context-Aware Calculation Function
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_gamx_score(
        p_type TEXT,
        -- 'u', 'a', 'masters', 'total', 's', 'j'
        p_gender TEXT,
        -- 'm', 'f'
        p_age NUMERIC,
        -- Age (can be null for some types)
        p_bw NUMERIC,
        -- Bodyweight
        p_result NUMERIC -- The total or lift result
    ) RETURNS NUMERIC AS $$
DECLARE rec RECORD;
score NUMERIC;
BEGIN IF p_gender IS NULL
OR p_bw IS NULL
OR p_result IS NULL THEN RETURN NULL;
END IF;
-- 1. Normalize Inputs
-- Gender: Force lowercase to match 'm'/'f' in factor tables
p_gender := LOWER(p_gender);
-- Handle full word cases just in case ('Male' -> 'm')
IF p_gender LIKE 'm%' THEN p_gender := 'm';
ELSIF p_gender LIKE 'f%'
OR p_gender LIKE 'w%' THEN p_gender := 'f';
END IF;
-- 2. Lookup Factors (Mu, Sigma, Nu)
-- Round bodyweight to nearest 0.1kg to match factor table granularity
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
ELSIF p_type = 'a' THEN
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