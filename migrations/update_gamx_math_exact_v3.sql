-- Migration: Upgrade Math Functions to 'Exact' Precision (Series/CF) - v3
-- Replaces polynomial approximations with iterative algorithms for maximum precision.
-- v3: Increased iterations for Continued Fraction (200) to ensure convergence at x=1.0
BEGIN;
-- 1. Helper: Taylor Series for erf(x) (small x)
CREATE OR REPLACE FUNCTION gamx_erf_series(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE sum NUMERIC := 0;
term NUMERIC := x;
x2 NUMERIC := x * x;
n INTEGER := 0;
-- 2/sqrt(pi)
coef NUMERIC := 1.12837916709551257389615890312155;
BEGIN -- Series: 2/sqrt(pi) * sum( (-1)^n * x^(2n+1) / (n! * (2n+1)) )
sum := x;
-- First term (n=0): x / 1
FOR n IN 1..100 LOOP term := - term * x2 * (2 * n - 1) / (n * (2 * n + 1));
sum := sum + term;
EXIT
WHEN abs(term) < '1e-25'::NUMERIC;
END LOOP;
RETURN coef * sum;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- 2. Helper: Continued Fraction for erfc(x) (large x)
CREATE OR REPLACE FUNCTION gamx_erfc_cf(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE -- 1/sqrt(pi)
    coef NUMERIC := 0.56418958354775628694807945156077;
x2 NUMERIC := x * x;
val NUMERIC;
n INTEGER;
BEGIN -- Continued Fraction for erfc(x) * exp(x^2):
-- 1 / (x + (1/2) / (x + (1) / (x + (3/2) / ... )))
-- Evaluated backwards
val := 0;
-- increased from 60 to 200 to ensure convergence at x=1.0
FOR n IN REVERSE 200..1 LOOP val := (n * 0.5) / (x + val);
END LOOP;
val := coef * exp(- x2) / (x + val);
RETURN val;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- 3. Main erf(x) Dispatcher
-- Use Series slightly higher (up to 1.5) as it converges well there
CREATE OR REPLACE FUNCTION gamx_erf(x NUMERIC) RETURNS NUMERIC AS $$ BEGIN -- Expanded range for series as it is very stable
    IF abs(x) < 1.5 THEN RETURN gamx_erf_series(x);
ELSE IF x >= 0 THEN RETURN 1.0 - gamx_erfc_cf(x);
ELSE RETURN -(1.0 - gamx_erfc_cf(abs(x)));
END IF;
END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- 4. Main Normal CDF
CREATE OR REPLACE FUNCTION gamx_norm_cdf(x NUMERIC) RETURNS NUMERIC AS $$
DECLARE sqrt2 NUMERIC := 1.41421356237309504880;
BEGIN -- phi(x) = 0.5 * erfc(-x / sqrt(2))
RETURN 0.5 * (1.0 + gamx_erf(x / sqrt2));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
COMMIT;