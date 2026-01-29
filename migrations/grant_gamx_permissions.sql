-- Grant permissions for GAMX tables
-- Run this in Supabase SQL Editor to fix "permission denied" errors
GRANT ALL ON TABLE gamx_u_factors TO postgres,
    anon,
    service_role;
GRANT ALL ON TABLE gamx_a_factors TO postgres,
    anon,
    service_role;
GRANT ALL ON TABLE gamx_masters_factors TO postgres,
    anon,
    service_role;
GRANT ALL ON TABLE gamx_points_factors TO postgres,
    anon,
    service_role;
GRANT ALL ON TABLE gamx_s_factors TO postgres,
    anon,
    service_role;
GRANT ALL ON TABLE gamx_j_factors TO postgres,
    anon,
    service_role;