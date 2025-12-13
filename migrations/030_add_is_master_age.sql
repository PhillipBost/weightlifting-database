-- Migration: add is_master_age predicate
-- Purpose: centralize masters definition: Men 31-75, Women 31-110, always exclude ages >110
CREATE OR REPLACE FUNCTION public.is_master_age(gender_text TEXT, competition_age INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN competition_age IS NULL THEN FALSE
    WHEN competition_age > 110 THEN FALSE
    WHEN upper(coalesce(gender_text, '')) = 'M' THEN competition_age BETWEEN 31 AND 75
    WHEN upper(coalesce(gender_text, '')) = 'F' THEN competition_age BETWEEN 31 AND 110
    ELSE FALSE
  END;
$$;

COMMENT ON FUNCTION public.is_master_age(TEXT, INTEGER) IS
  'Returns true when the provided (gender,competition_age) should be considered masters for q_masters calculation: M:31-75, F:31-110; excludes ages >110.';
