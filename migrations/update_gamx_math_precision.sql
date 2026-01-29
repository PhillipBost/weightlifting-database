-- Migration: Upgrade Math Functions to High Precision
-- Replaces the approximate 'gamx_erf' with a higher-precision implementation (Abramowitz & Stegun 7.1.26 is insufficient).
-- Uses approximation with error < 1.5 * 10^-7 (A&S 26.2.17 directly for CDF) or better.
BEGIN;
-- 1. Replace gamx_norm_cdf with a direct high-precision implementation
-- We bypass 'erf' to use a specialized Normal CDF approximation (A&S 26.2.17)
-- Precision: 7.5e-8
CREATE OR REPLACE FUNCTION gamx_norm_cdf(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE -- Constants for A&S 26.2.17
    b1 NUMERIC := 0.319381530;
b2 NUMERIC := -0.356563782;
b3 NUMERIC := 1.781477937;
b4 NUMERIC := -1.821255978;
b5 NUMERIC := 1.330274429;
p NUMERIC := 0.2316419;
c2 NUMERIC := 0.39894228;
-- 1/sqrt(2*pi)
t NUMERIC;
z NUMERIC;
poly NUMERIC;
result NUMERIC;
abs_x NUMERIC;
BEGIN abs_x := ABS(x);
-- Handle extreme values (prevent underflow/overflow)
IF abs_x > 20.0 THEN IF x > 0 THEN RETURN 1.0;
ELSE RETURN 0.0;
END IF;
END IF;
t := 1.0 / (1.0 + p * abs_x);
z := EXP(-0.5 * x * x) * c2;
poly := t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
result := 1.0 - z * poly;
IF x < 0 THEN RETURN 1.0 - result;
ELSE RETURN result;
END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- 2. Update gamx_erf to use the new CDF (since erf(x) = 2*CDF(x*sqrt(2)) - 1)
-- This ensures consistency between the two.
CREATE OR REPLACE FUNCTION gamx_erf(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE sqrt2 NUMERIC := 1.414213562373095;
BEGIN RETURN 2.0 * gamx_norm_cdf(x * sqrt2) - 1.0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
COMMIT;