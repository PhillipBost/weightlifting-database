-- Diagnostic: Check Accuracy of gamx_erf and gamx_norm_cdf (High Precision Refs)
WITH test_values AS (
    SELECT 0.0::numeric as x,
        0.5::numeric as expected_cdf,
        0.0::numeric as expected_erf
    UNION ALL
    SELECT 1.0::numeric,
        0.84134474606854294858::numeric,
        0.84270079294971486934::numeric
    UNION ALL
    SELECT -1.0::numeric,
        0.15865525393145705141::numeric,
        -0.84270079294971486934::numeric
    UNION ALL
    SELECT 1.96::numeric,
        0.97500210485177952821::numeric,
        -- CORRECTED VALUE (Wolfram), previous was 0.99417...
        0.99441942488661642236::numeric
)
SELECT x,
    expected_cdf,
    gamx_norm_cdf(x) as actual_cdf,
    expected_cdf - gamx_norm_cdf(x) as cdf_diff,
    expected_erf,
    gamx_erf(x) as actual_erf,
    expected_erf - gamx_erf(x) as erf_diff
FROM test_values;