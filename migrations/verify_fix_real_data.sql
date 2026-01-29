-- Final Verification: Real Data Test
-- We verify the calculation matches the Excel screenshot exactly.
WITH test_cases AS (
    SELECT 'Senior F 77.1' as description,
        64::numeric as total,
        225.696923129094::numeric as mu,
        0.105595116117929::numeric as sigma,
        2.27503319494156::numeric as nu,
        198.3187452::numeric as expected_score
    UNION ALL
    SELECT 'U17 F 16 77.1' as description,
        64::numeric as total,
        138.352844217598::numeric as mu,
        0.166408037198671::numeric as sigma,
        -0.335016927198294::numeric as nu,
        135.7001235::numeric as expected_score
)
SELECT description,
    expected_score,
    calculate_gamx_raw(total, mu, sigma, nu) as db_score,
    expected_score - calculate_gamx_raw(total, mu, sigma, nu) as diff
FROM test_cases;