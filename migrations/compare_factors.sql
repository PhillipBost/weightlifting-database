-- Diagnostic: Compare DB Factors to Screenshot
SELECT 'Senior' as cat,
    mu,
    sigma,
    nu
FROM gamx_points_factors
WHERE gender = 'f'
    AND bodyweight = 77.1
UNION ALL
SELECT 'U17',
    mu,
    sigma,
    nu
FROM gamx_u_factors
WHERE gender = 'f'
    AND age = 16
    AND bodyweight = 77.1;