-- Add index to usaw_lifters on athlete_name to optimize lookups
CREATE INDEX IF NOT EXISTS idx_usaw_lifters_athlete_name ON public.usaw_lifters USING btree (athlete_name);