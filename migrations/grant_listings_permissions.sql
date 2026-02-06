-- Grant permissions for usaw_meet_listings table
BEGIN;
-- Grant usage on sequence
GRANT USAGE,
    SELECT ON SEQUENCE usaw_meet_listings_listing_id_seq TO postgres,
    anon,
    authenticated,
    service_role;
-- Grant all permissions on table
GRANT ALL ON TABLE public.usaw_meet_listings TO postgres,
    anon,
    authenticated,
    service_role;
COMMIT;