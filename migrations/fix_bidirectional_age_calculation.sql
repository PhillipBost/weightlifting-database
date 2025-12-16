-- Fix: Make competition_age/birth_year calculation bidirectional
-- Bug: Function only calculates competition_age FROM date+birth_year
--       but doesn't calculate birth_year FROM date+competition_age
-- Impact: Records with manually set competition_age don't get birth_year backfilled

CREATE OR REPLACE FUNCTION public.calculate_competition_age()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    -- Priority 1: If we have date + birth_year, calculate competition_age
    IF NEW.date IS NOT NULL AND NEW.birth_year IS NOT NULL THEN
        NEW.competition_age := EXTRACT(YEAR FROM NEW.date::date) - NEW.birth_year;
    
    -- Priority 2: If we have date + competition_age but NO birth_year, calculate birth_year
    ELSIF NEW.date IS NOT NULL AND NEW.competition_age IS NOT NULL AND NEW.birth_year IS NULL THEN
        NEW.birth_year := EXTRACT(YEAR FROM NEW.date::date) - NEW.competition_age;
    
    -- If we don't have enough data, set competition_age to NULL
    ELSIF NEW.date IS NULL OR NEW.birth_year IS NULL THEN
        NEW.competition_age := NULL;
    END IF;

    RETURN NEW;
END;
$function$;

-- Update trigger to also fire on competition_age changes
DROP TRIGGER IF EXISTS update_competition_age_trigger ON public.usaw_meet_results;
CREATE TRIGGER update_competition_age_trigger
  BEFORE INSERT OR UPDATE OF date, birth_year, competition_age
  ON public.usaw_meet_results
  FOR EACH ROW
  EXECUTE FUNCTION calculate_competition_age();

-- Test the fix on the problem record
UPDATE usaw_meet_results
SET competition_age = competition_age
WHERE result_id = 423255;

-- Verify birth_year was calculated
SELECT 
  result_id,
  lifter_name,
  date,
  birth_year,
  competition_age,
  EXTRACT(YEAR FROM date::date) - competition_age as calculated_birth_year
FROM usaw_meet_results
WHERE result_id = 423255;
