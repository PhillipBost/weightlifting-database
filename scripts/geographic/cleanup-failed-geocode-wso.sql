-- Clean up WSO geography assignments for meets with failed geocoding
-- This script sets meets.wso_geography to NULL where geocode_success = FALSE
-- to prevent inaccurate WSO assignments based on bad location data

-- First, let's see how many records will be affected
SELECT 
    COUNT(*) as total_meets,
    COUNT(CASE WHEN geocode_success = FALSE THEN 1 END) as failed_geocode_meets,
    COUNT(CASE WHEN geocode_success = FALSE AND wso_geography IS NOT NULL THEN 1 END) as failed_geocode_with_wso,
    ROUND(
        (COUNT(CASE WHEN geocode_success = FALSE AND wso_geography IS NOT NULL THEN 1 END) * 100.0) / 
        COUNT(CASE WHEN wso_geography IS NOT NULL THEN 1 END), 2
    ) as percent_incorrect_assignments
FROM meets;

-- Show some examples of problematic assignments before cleanup
SELECT 
    meet_name,
    address,
    city,
    state,
    country,
    wso_geography,
    geocode_success,
    geocode_error
FROM meets 
WHERE geocode_success = FALSE 
  AND wso_geography IS NOT NULL
ORDER BY meet_name
LIMIT 10;

-- Update: Set wso_geography to NULL for meets with failed geocoding
UPDATE meets 
SET 
    wso_geography = NULL,
    updated_at = NOW()
WHERE geocode_success = FALSE 
  AND wso_geography IS NOT NULL;

-- Show the results after cleanup
SELECT 
    COUNT(*) as total_meets,
    COUNT(CASE WHEN geocode_success = FALSE THEN 1 END) as failed_geocode_meets,
    COUNT(CASE WHEN geocode_success = FALSE AND wso_geography IS NOT NULL THEN 1 END) as failed_geocode_with_wso_after,
    COUNT(CASE WHEN wso_geography IS NOT NULL THEN 1 END) as total_with_wso_after
FROM meets;

-- Optional: Show geographic distribution after cleanup
SELECT 
    wso_geography,
    COUNT(*) as meet_count,
    COUNT(CASE WHEN geocode_success = TRUE THEN 1 END) as successful_geocode_count,
    COUNT(CASE WHEN geocode_success = FALSE OR geocode_success IS NULL THEN 1 END) as failed_or_null_geocode_count
FROM meets 
WHERE wso_geography IS NOT NULL
GROUP BY wso_geography
ORDER BY meet_count DESC;