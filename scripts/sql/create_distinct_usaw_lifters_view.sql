CREATE OR REPLACE VIEW distinct_usaw_lifters_view AS
SELECT DISTINCT ON (lifter_id) 
       lifter_id, 
       lifter_name, 
       birth_year, 
       gender
FROM usaw_meet_results
WHERE birth_year IS NOT NULL
  AND lifter_name IS NOT NULL
ORDER BY lifter_id, date DESC;

-- Required permissions to expose the view to the Supabase APIs
GRANT SELECT ON public.distinct_usaw_lifters_view TO anon;
GRANT SELECT ON public.distinct_usaw_lifters_view TO service_role;
GRANT SELECT ON public.distinct_usaw_lifters_view TO authenticated;
