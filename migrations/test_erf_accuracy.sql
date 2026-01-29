-- Diagnostic: Check Accuracy of gamx_erf and gamx_norm_cdf
-- Compare against pre-calculated high-precision values.
WITH test_values AS (
    SELECT 0.0::numeric as x,
        0.5::numeric as expected_cdf,
        0.0::numeric as expected_erf
    UNION ALL
    SELECT 1.0::numeric,
        0.8413447460685429::numeric,
        -- matches Excel NORM.S.DIST(1, TRUE)
        0.8427007929497148::numeric -- erf(1)
    UNION ALL
    SELECT -1.0::numeric,
        0.1586552539314570::numeric,
        -- matches Excel NORM.S.DIST(-1, TRUE)
        -0.8427007929497148::numeric -- erf(-1)
    UNION ALL
    SELECT 1.96::numeric,
        0.9750021048517795::numeric,
        0.9941703666258074::numeric -- erf(1.96)
)
SELECT x,
    expected_cdf,
    gamx_norm_cdf(x) as actual_cdf,
    expected_cdf - gamx_norm_cdf(x) as cdf_diff,
    expected_erf,
    gamx_erf(x) as actual_erf,
    expected_erf - gamx_erf(x) as erf_diff
FROM test_values;