-- FORCE update of get_gamx_score to strictly enforce Age 15-40 for Senior types.
-- Run this to fix "Calculating for all ages" bug.
BEGIN;
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
IF p_type = 'u' THEN -- GAMX U: No database restriction on Age (uses factor table existence)
IF p_age IS NULL THEN RETURN NULL;
END IF;
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_u_factors
WHERE gender = p_gender
    AND age = p_age::INT
    AND bodyweight = p_bw;
ELSIF p_type = 'a' THEN -- GAMX A: No database restriction on Age (uses factor table existence)
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_a_factors
WHERE gender = p_gender
    AND age = p_age::INT
    AND bodyweight = p_bw;
ELSIF p_type = 'masters' THEN -- GAMX Masters: No database restriction on Age (uses factor table existence)
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_masters_factors
WHERE gender = p_gender
    AND age = p_age::INT
    AND bodyweight = p_bw;
ELSIF p_type = 'total' THEN -- Senior Total: STRICT AGE 15-40 RESTRICTION
IF p_age < 15
OR p_age > 40 THEN RETURN NULL;
END IF;
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_points_factors
WHERE gender = p_gender
    AND bodyweight = p_bw;
ELSIF p_type = 's' THEN -- Snatch: STRICT AGE 15-40 RESTRICTION
IF p_age < 15
OR p_age > 40 THEN RETURN NULL;
END IF;
SELECT mu,
    sigma,
    nu INTO rec
FROM gamx_s_factors
WHERE gender = p_gender
    AND bodyweight = p_bw;
ELSIF p_type = 'j' THEN -- C&J: STRICT AGE 15-40 RESTRICTION
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