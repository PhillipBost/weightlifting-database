-- Migration: Upgrade Math Functions to 'Exact' Precision - v4
-- Changes:
-- 1. Increases Series/CF crossover point from 1.5 to 6.0.
--    Taylor Series is numerically stable and faster for x < 6.
--    Continued Fraction is strictly for large x (x >= 6) where Series convergence slows.
-- 2. This ensures erf(1.96) uses the Series method (Exact).
BEGIN;
-- 1. Helper: Taylor Series for erf(x)
CREATE OR REPLACE FUNCTION gamx_erf_series(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE sum NUMERIC := 0;
term NUMERIC := x;
x2 NUMERIC := x * x;
n INTEGER := 0;
coef NUMERIC := 1.12837916709551257389615890312155;
BEGIN sum := x;
-- Increased iterations to 150 to ensure convergence for x up to 6.0
FOR n IN 1..150 LOOP term := - term * x2 * (2 * n - 1) / (n * (2 * n + 1));
sum := sum + term;
EXIT
WHEN abs(term) < '1e-25'::NUMERIC;
END LOOP;
RETURN coef * sum;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- 2. Helper: Continued Fraction (Unchanged logic, just ensure exist)
CREATE OR REPLACE FUNCTION gamx_erfc_cf(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE coef NUMERIC := 0.56418958354775628694807945156077;
x2 NUMERIC := x * x;
val NUMERIC;
n INTEGER;
BEGIN val := 0;
FOR n IN REVERSE 200..1 LOOP val := (n * 0.5) / (x + val);
END LOOP;
val := coef * exp(- x2) / (x + val);
RETURN val;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- 3. Main erf(x) Dispatcher
-- Cutoff increased to 6.0
CREATE OR REPLACE FUNCTION gamx_erf(x NUMERIC) RETURNS NUMERIC AS $$ BEGIN IF abs(x) < 6.0 THEN RETURN gamx_erf_series(x);
ELSE IF x >= 0 THEN RETURN 1.0 - gamx_erfc_cf(x);
ELSE RETURN -(1.0 - gamx_erfc_cf(abs(x)));
END IF;
END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- 4. Main Normal CDF
CREATE OR REPLACE FUNCTION gamx_norm_cdf(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE sqrt2 NUMERIC := 1.41421356237309504880;
BEGIN RETURN 0.5 * (1.0 + gamx_erf(x / sqrt2));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
COMMIT;