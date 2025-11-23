CREATE OR REPLACE FUNCTION public.update_qpoints_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
  DECLARE
      lifter_gender TEXT;
      total_numeric DECIMAL;
      bodyweight_numeric DECIMAL;
      competition_age INTEGER;
      masters_age_factor DECIMAL;
      youth_age_factor DECIMAL;
      calculated_qpoints DECIMAL;
  BEGIN
      -- Only recalculate if the input columns have changed OR if any Q-score is missing
      IF (TG_OP = 'INSERT') OR
         (OLD.total IS DISTINCT FROM NEW.total) OR
         (OLD.body_weight_kg IS DISTINCT FROM NEW.body_weight_kg) OR
         (OLD.competition_age IS DISTINCT FROM NEW.competition_age) OR
         (OLD.gender IS DISTINCT FROM NEW.gender) OR
         (OLD.qpoints IS NULL) OR
         (OLD.q_youth IS NULL AND (EXTRACT(YEAR FROM NEW.date::date) - NEW.birth_year) BETWEEN 10 AND 20) OR
         (OLD.q_masters IS NULL AND (EXTRACT(YEAR FROM NEW.date::date) - NEW.birth_year) >= 31) THEN

          -- Get gender from the meet_results record being inserted/updated (NEW.gender)
          lifter_gender := NEW.gender;

          -- Convert text fields to numeric
          BEGIN
              total_numeric := CAST(NEW.total AS DECIMAL);
          EXCEPTION WHEN OTHERS THEN
              total_numeric := 0;
          END;

          BEGIN
              bodyweight_numeric := CAST(NEW.body_weight_kg AS DECIMAL);
          EXCEPTION WHEN OTHERS THEN
              bodyweight_numeric := 0;
          END;

          -- Calculate competition_age explicitly (to avoid dependency on other triggers)
          IF NEW.date IS NOT NULL AND NEW.birth_year IS NOT NULL THEN
              competition_age := EXTRACT(YEAR FROM NEW.date::date) - NEW.birth_year;
          ELSE
              competition_age := NULL;
          END IF;

          -- Calculate Base Q-Points (needed for Masters calculation too)
          calculated_qpoints := NULL;
          IF total_numeric > 0 AND bodyweight_numeric > 0 AND lifter_gender IS NOT NULL THEN
              BEGIN
                  calculated_qpoints := calculate_qpoints_from_row(
                      total_numeric,
                      bodyweight_numeric,
                      lifter_gender
                  );
              EXCEPTION WHEN numeric_value_out_of_range THEN
                  calculated_qpoints := NULL;
                  RAISE NOTICE 'Q-point calculation overflow for % (Age: %, BW: %kg)', NEW.lifter_name, competition_age, bodyweight_numeric;
              END;
          END IF;

          -- 1. Set qpoints (ONLY for ages 21-30)
          IF competition_age IS NOT NULL AND competition_age BETWEEN 21 AND 30 THEN
              NEW.qpoints := calculated_qpoints;
          ELSE
              NEW.qpoints := NULL;
          END IF;

          -- 2. Set q_masters (ONLY for ages >= 31, uses base qpoints)
          -- Note: We use calculated_qpoints here, even if NEW.qpoints is NULL (because age > 30)
          IF calculated_qpoints IS NOT NULL AND calculated_qpoints > 0 AND
             competition_age IS NOT NULL AND competition_age >= 31 AND
             lifter_gender IS NOT NULL THEN
              masters_age_factor := get_age_factor(competition_age, lifter_gender);
              NEW.q_masters := ROUND(calculated_qpoints * masters_age_factor, 2);
          ELSE
              NEW.q_masters := NULL;
          END IF;

          -- 3. Set q_youth (ONLY for ages 10-20, formula: total * youth_coefficient)
          IF competition_age IS NOT NULL AND competition_age BETWEEN 10 AND 20 AND
             lifter_gender IS NOT NULL AND bodyweight_numeric > 0 AND total_numeric > 0 THEN
              youth_age_factor := get_youth_age_factor_interpolated(competition_age, bodyweight_numeric,
  lifter_gender);
              NEW.q_youth := ROUND(total_numeric * youth_age_factor, 2);
          ELSE
              NEW.q_youth := NULL;
          END IF;

          -- Log the change
          RAISE NOTICE 'Recalculated for % (Age: %, BW: %kg): Q-points=%, Q-masters=%, Q-youth=%',
              NEW.lifter_name,
              competition_age,
              bodyweight_numeric,
              NEW.qpoints,
              NEW.q_masters,
              NEW.q_youth;
      END IF;

      RETURN NEW;
  END;
  $function$
