-- Verification Script for calculate_competition_age
DO $$
DECLARE rec record;
calc_age integer;
BEGIN -- 1. Create a temp table to test the trigger
CREATE TEMP TABLE IF NOT EXISTS meet_results_test (
    id serial PRIMARY KEY,
    date text,
    birth_year integer,
    competition_age integer
);
-- 2. Attach the trigger (drop if exists to be clean)
DROP TRIGGER IF EXISTS calc_comp_age ON meet_results_test;
CREATE TRIGGER calc_comp_age BEFORE
INSERT
    OR
UPDATE ON meet_results_test FOR EACH ROW EXECUTE FUNCTION public.calculate_competition_age();
-- 3. Insert a record (should calculate age)
-- Date: 2023-01-01, Birth Year: 2000 -> Age: 23
DELETE FROM meet_results_test;
INSERT INTO meet_results_test (date, birth_year)
VALUES ('2023-01-01', 2000);
-- 4. Verify calculation
SELECT competition_age INTO calc_age
FROM meet_results_test
WHERE birth_year = 2000;
IF calc_age IS DISTINCT
FROM 23 THEN RAISE EXCEPTION 'Trigger failed: Calculated age % (Expected 23)',
    calc_age;
END IF;
-- 5. Update record (change year)
UPDATE meet_results_test
SET birth_year = 1990
WHERE birth_year = 2000;
-- Age: 2023 - 1990 = 33
SELECT competition_age INTO calc_age
FROM meet_results_test
WHERE birth_year = 1990;
IF calc_age IS DISTINCT
FROM 33 THEN RAISE EXCEPTION 'Trigger failed: Updated age % (Expected 33)',
    calc_age;
END IF;
RAISE NOTICE 'SUCCESS: Competition age calculated correctly (23 -> 33)';
END $$;