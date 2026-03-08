-- Baseline GAMX Verification
-- This script outputs values for the math functions so you can compare BEFORE and AFTER the fix.
-- If the math breaks, these numbers will change or error.
SELECT 'gamx_erf(1.0)' as test_case,
    public.gamx_erf(1.0) as result,
    0.84270079294971486934 as expected
UNION ALL
SELECT 'gamx_norm_cdf(0.0)',
    public.gamx_norm_cdf(0.0),
    0.50000000000000000000
UNION ALL
SELECT 'gamx_norm_inv(0.5)',
    public.gamx_norm_inv(0.5),
    0.00000000000000000000
UNION ALL
SELECT 'gamx_norm_inv(0.975)',
    public.gamx_norm_inv(0.975),
    1.95996398454005423552 -- Approx value for 95% confidence interval (1.96)
;