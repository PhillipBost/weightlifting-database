-- Simple test: Try to clean up just ONE specific record
-- This will help us understand why the cleanup isn't working

-- First, let's see the record before cleanup
SELECT
    result_id,
    lifter_name,
    competition_age,
    q_youth,
    qpoints,
    q_masters
FROM meet_results
WHERE result_id = 248876;  -- Tyler Cox age 8 with q_masters

-- Now try to update it
UPDATE meet_results
SET q_masters = NULL,
    q_youth = NULL,
    qpoints = NULL
WHERE result_id = 248876;

-- Check if it updated
SELECT
    result_id,
    lifter_name,
    competition_age,
    q_youth,
    qpoints,
    q_masters,
    'AFTER UPDATE' as status
FROM meet_results
WHERE result_id = 248876;

-- Now try updating by age condition
UPDATE meet_results
SET q_masters = NULL,
    q_youth = NULL,
    qpoints = NULL
WHERE result_id IN (208726, 210251, 145611)  -- Tucker, Anthony, Alexandra - all age < 10
  AND (q_youth IS NOT NULL OR qpoints IS NOT NULL OR q_masters IS NOT NULL);

-- Check results
SELECT
    result_id,
    lifter_name,
    competition_age,
    q_youth,
    qpoints,
    q_masters,
    'AFTER BATCH UPDATE' as status
FROM meet_results
WHERE result_id IN (208726, 210251, 145611);
