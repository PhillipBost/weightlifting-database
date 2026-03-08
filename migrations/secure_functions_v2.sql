-- Migration: Secure Function Search Paths (v2)
-- Purpose: Fully qualify all object references and set search_path = ''

BEGIN;

CREATE OR REPLACE FUNCTION public.calculate_and_set_analytics()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
    analytics_result RECORD;
BEGIN
    -- Calculate analytics for the new/updated record
    SELECT * INTO analytics_result
    FROM public.calculate_meet_result_analytics(
        NEW.lifter_id,
        NEW.date,
        NEW.snatch_lift_1,
        NEW.snatch_lift_2,
        NEW.snatch_lift_3,
        NEW.best_snatch,
        NEW.cj_lift_1,
        NEW.cj_lift_2,
        NEW.cj_lift_3,
        NEW.best_cj,
        NEW.total
    );
    
    -- Set the calculated analytics fields
    NEW.snatch_successful_attempts := analytics_result.snatch_successful_attempts;
    NEW.cj_successful_attempts := analytics_result.cj_successful_attempts;
    NEW.total_successful_attempts := analytics_result.total_successful_attempts;
    NEW.best_snatch_ytd := analytics_result.best_snatch_ytd;
    NEW.best_cj_ytd := analytics_result.best_cj_ytd;
    NEW.best_total_ytd := analytics_result.best_total_ytd;
    NEW.bounce_back_snatch_2 := analytics_result.bounce_back_snatch_2;
    NEW.bounce_back_snatch_3 := analytics_result.bounce_back_snatch_3;
    NEW.bounce_back_cj_2 := analytics_result.bounce_back_cj_2;
    NEW.bounce_back_cj_3 := analytics_result.bounce_back_cj_3;
    
    -- Set updated_at timestamp for updates
    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := now();
    END IF;
    
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail the insert/update
    RAISE WARNING 'Analytics calculation failed for result_id %: %', 
        COALESCE(NEW.result_id, 0), SQLERRM;
    
    -- Return NEW to allow the operation to continue
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_bounce_back(prev_lift text, current_lift text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
    prev_val INTEGER;
    current_val INTEGER;
BEGIN
    -- Convert lifts to integers
    BEGIN
        prev_val := prev_lift::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE; -- Can't determine bounce-back without valid previous lift
    END;
    
    BEGIN
        current_val := current_lift::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        RETURN FALSE; -- Can't determine bounce-back without valid current lift
    END;
    
    -- Bounce-back occurs when previous lift was missed (negative/zero) 
    -- and current lift was successful (positive)
    RETURN (prev_val <= 0 AND current_val > 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_competition_age()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
  BEGIN
      -- Calculate competition_age if we have both date and birth_year
      IF NEW.date IS NOT NULL AND NEW.birth_year IS NOT NULL THEN
          NEW.competition_age = EXTRACT(YEAR FROM NEW.date::date) - NEW.birth_year;
      ELSIF NEW.date IS NULL OR NEW.birth_year IS NULL THEN
          NEW.competition_age = NULL;
      END IF;

      RETURN NEW;
  END;
  $function$
;

CREATE OR REPLACE FUNCTION public.calculate_meet_result_analytics(p_lifter_id bigint, p_date text, p_snatch_1 text, p_snatch_2 text, p_snatch_3 text, p_best_snatch text, p_cj_1 text, p_cj_2 text, p_cj_3 text, p_best_cj text, p_total text)
 RETURNS TABLE(snatch_successful_attempts integer, cj_successful_attempts integer, total_successful_attempts integer, best_snatch_ytd integer, best_cj_ytd integer, best_total_ytd integer, bounce_back_snatch_2 boolean, bounce_back_snatch_3 boolean, bounce_back_cj_2 boolean, bounce_back_cj_3 boolean)
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
    snatch_success INTEGER;
    cj_success INTEGER;
    total_success INTEGER;
    snatch_ytd INTEGER;
    cj_ytd INTEGER;
    total_ytd INTEGER;
    bb_snatch_2 BOOLEAN;
    bb_snatch_3 BOOLEAN;
    bb_cj_2 BOOLEAN;
    bb_cj_3 BOOLEAN;
BEGIN
    -- Calculate successful attempts
    snatch_success := public.count_successful_attempts(p_snatch_1, p_snatch_2, p_snatch_3);
    cj_success := public.count_successful_attempts(p_cj_1, p_cj_2, p_cj_3);
    total_success := snatch_success + cj_success;
    
    -- Calculate YTD bests
    snatch_ytd := public.calculate_ytd_best(p_lifter_id, p_date, p_best_snatch, 'snatch');
    cj_ytd := public.calculate_ytd_best(p_lifter_id, p_date, p_best_cj, 'cj');
    total_ytd := public.calculate_ytd_best(p_lifter_id, p_date, p_total, 'total');
    
    -- Calculate bounce-backs
    bb_snatch_2 := public.calculate_bounce_back(p_snatch_1, p_snatch_2);
    bb_snatch_3 := public.calculate_bounce_back(p_snatch_2, p_snatch_3);
    bb_cj_2 := public.calculate_bounce_back(p_cj_1, p_cj_2);
    bb_cj_3 := public.calculate_bounce_back(p_cj_2, p_cj_3);
    
    -- Return all calculated values
    RETURN QUERY SELECT 
        snatch_success,
        cj_success,
        total_success,
        snatch_ytd,
        cj_ytd,
        total_ytd,
        bb_snatch_2,
        bb_snatch_3,
        bb_cj_2,
        bb_cj_3;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_qpoints_from_row(total_lifted numeric, bodyweight numeric, gender text)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path = ''
 
AS $function$
DECLARE
    qpoints_result DECIMAL := 0;
    bodyweight_ratio DECIMAL;
    coefficient DECIMAL;
BEGIN
    -- Safety checks
    IF total_lifted IS NULL OR total_lifted = 0 OR 
       bodyweight IS NULL OR bodyweight = 0 OR
       gender IS NULL THEN
        RETURN 0;
    END IF;
    
    -- Convert bodyweight to the ratio used in formula (bodyweight/100)
    bodyweight_ratio := bodyweight / 100.0;
    
    -- Calculate q-points coefficient based on gender
    IF UPPER(gender) = 'F' OR UPPER(gender) = 'FEMALE' THEN
        -- Female q-points formula: 306.54/(266.5 - 19.44*(bw/100)^(-2) + 18.61*(bw/100)^2)
        coefficient := 306.54 / (
            266.5 - 19.44 * POWER(bodyweight_ratio, -2) + 18.61 * POWER(bodyweight_ratio, 2)
        );
    ELSIF UPPER(gender) = 'M' OR UPPER(gender) = 'MALE' THEN
        -- Male q-points formula: 463.26/(416.7 - 47.87*(bw/100)^(-2) + 18.93*(bw/100)^2)
        coefficient := 463.26 / (
            416.7 - 47.87 * POWER(bodyweight_ratio, -2) + 18.93 * POWER(bodyweight_ratio, 2)
        );
    ELSE
        -- Unknown gender, return 0
        RETURN 0;
    END IF;
    
    -- Calculate final q-points: total_lifted * coefficient
    qpoints_result := total_lifted * coefficient;
    
    -- Round to 2 decimal places
    RETURN ROUND(qpoints_result, 2);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_ytd_best(p_lifter_id bigint, p_date text, p_current_best text, p_lift_type text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
    competition_year INTEGER;
    ytd_best INTEGER := 0;
    current_best_val INTEGER;
    result_record RECORD;
    parsed_date DATE;
BEGIN
    -- Extract year from date with robust error handling
    BEGIN
        -- Try to parse as date first
        parsed_date := p_date::DATE;
        competition_year := EXTRACT(YEAR FROM parsed_date);
        
        -- Check if year is valid (reasonable range)
        IF competition_year < 1900 OR competition_year > 2100 THEN
            RAISE EXCEPTION 'Invalid year: %', competition_year;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- If date parsing fails, try to extract year from string
        BEGIN
            competition_year := substring(p_date FROM 1 FOR 4)::INTEGER;
            -- Validate extracted year
            IF competition_year < 1900 OR competition_year > 2100 THEN
                -- Use current year as fallback for invalid dates
                competition_year := EXTRACT(YEAR FROM CURRENT_DATE);
            END IF;
            -- Create a fallback date for comparison
            parsed_date := (competition_year || '-01-01')::DATE;
        EXCEPTION WHEN OTHERS THEN
            -- Ultimate fallback: use current year and date
            competition_year := EXTRACT(YEAR FROM CURRENT_DATE);
            parsed_date := CURRENT_DATE;
        END;
    END;
    
    -- Convert current best to integer
    BEGIN
        current_best_val := p_current_best::INTEGER;
        IF current_best_val IS NULL THEN current_best_val := 0; END IF;
    EXCEPTION WHEN OTHERS THEN
        current_best_val := 0;
    END;
    
    -- Query all results for this lifter in the same year up to this date
    -- Use safe date parsing for comparison
    FOR result_record IN
        SELECT 
            best_snatch,
            best_cj,
            total,
            date
        FROM public.meet_results 
        WHERE lifter_id = p_lifter_id 
            AND CASE 
                WHEN date ~ '^\d{4}-\d{2}-\d{2}$' AND date::DATE >= '1900-01-01' AND date::DATE <= '2100-12-31'
                THEN EXTRACT(YEAR FROM date::DATE) = competition_year 
                     AND date::DATE <= parsed_date
                WHEN date ~ '^\d{4}'
                THEN substring(date FROM 1 FOR 4)::INTEGER = competition_year
                ELSE FALSE
            END
        ORDER BY 
            CASE 
                WHEN date ~ '^\d{4}-\d{2}-\d{2}$' AND date::DATE >= '1900-01-01' AND date::DATE <= '2100-12-31'
                THEN date::DATE
                ELSE '1900-01-01'::DATE
            END ASC
    LOOP
        DECLARE
            lift_value INTEGER;
        BEGIN
            -- Get the appropriate lift value based on lift_type
            IF p_lift_type = 'snatch' THEN
                lift_value := result_record.best_snatch::INTEGER;
            ELSIF p_lift_type = 'cj' THEN
                lift_value := result_record.best_cj::INTEGER;
            ELSIF p_lift_type = 'total' THEN
                lift_value := result_record.total::INTEGER;
            END IF;
            
            -- Update YTD best if this lift is better
            IF lift_value > ytd_best THEN
                ytd_best := lift_value;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            -- Skip invalid values
        END;
    END LOOP;
    
    -- Include current competition result
    IF current_best_val > ytd_best THEN
        ytd_best := current_best_val;
    END IF;
    
    RETURN ytd_best;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.count_successful_attempts(lift1 text, lift2 text, lift3 text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
    count INTEGER := 0;
    lift1_val INTEGER;
    lift2_val INTEGER;
    lift3_val INTEGER;
BEGIN
    -- Convert text to integer, handle NULL and non-numeric values
    BEGIN
        lift1_val := lift1::INTEGER;
        IF lift1_val > 0 THEN count := count + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Skip invalid values
    END;
    
    BEGIN
        lift2_val := lift2::INTEGER;
        IF lift2_val > 0 THEN count := count + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Skip invalid values
    END;
    
    BEGIN
        lift3_val := lift3::INTEGER;
        IF lift3_val > 0 THEN count := count + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Skip invalid values
    END;
    
    RETURN count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_age_factor(age integer, gender text)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path = ''
 
AS $function$
BEGIN
    -- Return 1.000 for ages under 30 (no age factor applied)
    IF age < 30 THEN
        RETURN 1.000;
    END IF;
    
    -- Female age factors
    IF UPPER(gender) = 'F' OR UPPER(gender) = 'FEMALE' THEN
        RETURN CASE 
            WHEN age = 30 THEN 1.000
            WHEN age = 31 THEN 1.010
            WHEN age = 32 THEN 1.021
            WHEN age = 33 THEN 1.031
            WHEN age = 34 THEN 1.042
            WHEN age = 35 THEN 1.052
            WHEN age = 36 THEN 1.063
            WHEN age = 37 THEN 1.073
            WHEN age = 38 THEN 1.084
            WHEN age = 39 THEN 1.096
            WHEN age = 40 THEN 1.108
            WHEN age = 41 THEN 1.122
            WHEN age = 42 THEN 1.138
            WHEN age = 43 THEN 1.155
            WHEN age = 44 THEN 1.173
            WHEN age = 45 THEN 1.194
            WHEN age = 46 THEN 1.216
            WHEN age = 47 THEN 1.240
            WHEN age = 48 THEN 1.265
            WHEN age = 49 THEN 1.292
            WHEN age = 50 THEN 1.321
            WHEN age = 51 THEN 1.352
            WHEN age = 52 THEN 1.384
            WHEN age = 53 THEN 1.419
            WHEN age = 54 THEN 1.456
            WHEN age = 55 THEN 1.494
            WHEN age = 56 THEN 1.534
            WHEN age = 57 THEN 1.575
            WHEN age = 58 THEN 1.617
            WHEN age = 59 THEN 1.660
            WHEN age = 60 THEN 1.704
            WHEN age = 61 THEN 1.748
            WHEN age = 62 THEN 1.794
            WHEN age = 63 THEN 1.841
            WHEN age = 64 THEN 1.890
            WHEN age = 65 THEN 1.942
            WHEN age = 66 THEN 1.996
            WHEN age = 67 THEN 2.052
            WHEN age = 68 THEN 2.109
            WHEN age = 69 THEN 2.168
            WHEN age = 70 THEN 2.226
            WHEN age = 71 THEN 2.285
            WHEN age = 72 THEN 2.343
            WHEN age = 73 THEN 2.402
            WHEN age = 74 THEN 2.464
            WHEN age = 75 THEN 2.528
            WHEN age = 76 THEN 2.597
            WHEN age = 77 THEN 2.670
            WHEN age = 78 THEN 2.749
            WHEN age = 79 THEN 2.831
            WHEN age = 80 THEN 2.918
            WHEN age = 81 THEN 3.009
            WHEN age = 82 THEN 3.104
            WHEN age = 83 THEN 3.201
            WHEN age = 84 THEN 3.301
            WHEN age = 85 THEN 3.403
            WHEN age = 86 THEN 3.507
            WHEN age = 87 THEN 3.613
            WHEN age = 88 THEN 3.720
            WHEN age = 89 THEN 3.827
            WHEN age = 90 THEN 3.935
            WHEN age >= 91 THEN 3.935
            ELSE 1.000
        END;
    END IF;
    
    -- Male age factors
    IF UPPER(gender) = 'M' OR UPPER(gender) = 'MALE' THEN
        RETURN CASE 
            WHEN age = 30 THEN 1.000
            WHEN age = 31 THEN 1.010
            WHEN age = 32 THEN 1.018
            WHEN age = 33 THEN 1.026
            WHEN age = 34 THEN 1.038
            WHEN age = 35 THEN 1.052
            WHEN age = 36 THEN 1.064
            WHEN age = 37 THEN 1.076
            WHEN age = 38 THEN 1.088
            WHEN age = 39 THEN 1.100
            WHEN age = 40 THEN 1.112
            WHEN age = 41 THEN 1.124
            WHEN age = 42 THEN 1.136
            WHEN age = 43 THEN 1.148
            WHEN age = 44 THEN 1.160
            WHEN age = 45 THEN 1.173
            WHEN age = 46 THEN 1.187
            WHEN age = 47 THEN 1.201
            WHEN age = 48 THEN 1.215
            WHEN age = 49 THEN 1.230
            WHEN age = 50 THEN 1.247
            WHEN age = 51 THEN 1.264
            WHEN age = 52 THEN 1.283
            WHEN age = 53 THEN 1.304
            WHEN age = 54 THEN 1.327
            WHEN age = 55 THEN 1.351
            WHEN age = 56 THEN 1.376
            WHEN age = 57 THEN 1.401
            WHEN age = 58 THEN 1.425
            WHEN age = 59 THEN 1.451
            WHEN age = 60 THEN 1.477
            WHEN age = 61 THEN 1.504
            WHEN age = 62 THEN 1.531
            WHEN age = 63 THEN 1.560
            WHEN age = 64 THEN 1.589
            WHEN age = 65 THEN 1.620
            WHEN age = 66 THEN 1.654
            WHEN age = 67 THEN 1.693
            WHEN age = 68 THEN 1.736
            WHEN age = 69 THEN 1.784
            WHEN age = 70 THEN 1.833
            WHEN age = 71 THEN 1.883
            WHEN age = 72 THEN 1.932
            WHEN age = 73 THEN 1.981
            WHEN age = 74 THEN 2.031
            WHEN age = 75 THEN 2.083
            WHEN age = 76 THEN 2.139
            WHEN age = 77 THEN 2.202
            WHEN age = 78 THEN 2.271
            WHEN age = 79 THEN 2.348
            WHEN age = 80 THEN 2.430
            WHEN age = 81 THEN 2.524
            WHEN age = 82 THEN 2.635
            WHEN age = 83 THEN 2.755
            WHEN age = 84 THEN 2.877
            WHEN age = 85 THEN 3.008
            WHEN age = 86 THEN 3.168
            WHEN age = 87 THEN 3.356
            WHEN age = 88 THEN 3.545
            WHEN age = 89 THEN 3.709
            WHEN age = 90 THEN 3.880
            WHEN age = 91 THEN 4.059
            WHEN age = 92 THEN 4.247
            WHEN age = 93 THEN 4.443
            WHEN age = 94 THEN 4.648
            WHEN age >= 95 THEN 4.863
            ELSE 1.000
        END;
    END IF;
    
    -- Default case (unknown gender)
    RETURN 1.000;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_youth_age_factor_interpolated(age integer, bodyweight numeric, gender text)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path = ''
 
AS $function$
DECLARE
    floor_weight INTEGER;
    ceiling_weight INTEGER;
    floor_factor DECIMAL;
    ceiling_factor DECIMAL;
    interpolated_factor DECIMAL;
    weight_fraction DECIMAL;
BEGIN
    -- Only apply youth factors for ages 8-20
    IF age < 8 OR age > 20 THEN
        RETURN 1.000;
    END IF;
    
    -- Clamp bodyweight to valid range (30-115kg)
    IF bodyweight < 30 THEN
        bodyweight := 30;
    ELSIF bodyweight > 115 THEN
        bodyweight := 115;
    END IF;
    
    -- Calculate floor and ceiling weights
    floor_weight := FLOOR(bodyweight);
    ceiling_weight := CEILING(bodyweight);
    
    -- If bodyweight is exactly an integer, no interpolation needed
    IF floor_weight = ceiling_weight THEN
        RETURN ROUND(public.get_youth_factor_exact(age, floor_weight, gender), 4);
    END IF;
    
    -- Get floor factor
    floor_factor := public.get_youth_factor_exact(age, floor_weight, gender);
    
    -- Get ceiling factor  
    ceiling_factor := public.get_youth_factor_exact(age, ceiling_weight, gender);
    
    -- If floor and ceiling are the same, return floor factor
    IF floor_factor = ceiling_factor THEN
        RETURN ROUND(floor_factor, 4);
    END IF;
    
    -- Linear interpolation
    weight_fraction := bodyweight - floor_weight;
    interpolated_factor := floor_factor + weight_fraction * (ceiling_factor - floor_factor) / (ceiling_weight - floor_weight);
    
    RETURN ROUND(interpolated_factor, 4);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_youth_factor_exact(input_age integer, input_bodyweight integer, input_gender text)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path = ''
 
AS $function$
DECLARE
    factor_value DECIMAL;
BEGIN
    -- Clamp bodyweight to valid range
    IF input_bodyweight < 30 THEN input_bodyweight := 30; END IF;
    IF input_bodyweight > 115 THEN input_bodyweight := 115; END IF;
    
    -- Query the public.youth_factors table
    SELECT factor INTO factor_value
    FROM public.youth_factors
    WHERE 
        public.youth_factors.gender = UPPER(SUBSTRING(input_gender, 1, 1)) AND
        public.youth_factors.bodyweight_kg = input_bodyweight AND
        public.youth_factors.age = input_age;
    
    -- Return the factor if found, otherwise return 1.000 (no adjustment)
    RETURN COALESCE(factor_value, 1.000);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_manual_override()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
BEGIN
    -- If manual_override is TRUE, skip automatic calculation
    IF NEW.manual_override = TRUE THEN
        -- Still update the updated_at timestamp
        NEW.updated_at := now();
        RETURN NEW;
    END IF;
    
    -- Otherwise, proceed with normal analytics calculation
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    'default'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_id AND role = 'admin'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_all_qpoints()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
 
AS $function$
DECLARE
    rows_updated integer;
BEGIN
    UPDATE public.meet_results 
    SET qpoints = public.calculate_qpoints_from_row(
        CAST(total AS DECIMAL), 
        CAST(body_weight_kg AS DECIMAL), 
        (SELECT gender FROM public.lifters WHERE athlete_name = public.meet_results.lifter_name)
    )
    WHERE total IS NOT NULL 
      AND total != ''
      AND total != '0'
      AND body_weight_kg IS NOT NULL 
      AND body_weight_kg != ''
      AND body_weight_kg != '0'
      AND EXISTS (SELECT 1 FROM public.lifters WHERE athlete_name = public.meet_results.lifter_name AND gender IS NOT NULL)
      AND total ~ '^[0-9]+\.?[0-9]*$'
      AND body_weight_kg ~ '^[0-9]+\.?[0-9]*$';
    
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    
    RAISE NOTICE 'Recalculated qpoints for % rows', rows_updated;
    RETURN rows_updated;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalculate_lifter_analytics(p_lifter_id bigint, p_year integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
    records_updated INTEGER := 0;
    analytics_result RECORD;
    result_record RECORD;
BEGIN
    -- If no year specified, recalculate for all years
    FOR result_record IN
        SELECT 
            result_id,
            lifter_id,
            date,
            snatch_lift_1, snatch_lift_2, snatch_lift_3, best_snatch,
            cj_lift_1, cj_lift_2, cj_lift_3, best_cj,
            total
        FROM public.meet_results 
        WHERE lifter_id = p_lifter_id 
            AND (p_year IS NULL OR EXTRACT(YEAR FROM date::DATE) = p_year)
        ORDER BY date::DATE
    LOOP
        -- Calculate analytics for this record
        SELECT * INTO analytics_result
        FROM public.calculate_meet_result_analytics(
            result_record.lifter_id,
            result_record.date,
            result_record.snatch_lift_1,
            result_record.snatch_lift_2,
            result_record.snatch_lift_3,
            result_record.best_snatch,
            result_record.cj_lift_1,
            result_record.cj_lift_2,
            result_record.cj_lift_3,
            result_record.best_cj,
            result_record.total
        );
        
        -- Update the record
        UPDATE public.meet_results
        SET 
            snatch_successful_attempts = analytics_result.snatch_successful_attempts,
            cj_successful_attempts = analytics_result.cj_successful_attempts,
            total_successful_attempts = analytics_result.total_successful_attempts,
            best_snatch_ytd = analytics_result.best_snatch_ytd,
            best_cj_ytd = analytics_result.best_cj_ytd,
            best_total_ytd = analytics_result.best_total_ytd,
            bounce_back_snatch_2 = analytics_result.bounce_back_snatch_2,
            bounce_back_snatch_3 = analytics_result.bounce_back_snatch_3,
            bounce_back_cj_2 = analytics_result.bounce_back_cj_2,
            bounce_back_cj_3 = analytics_result.bounce_back_cj_3,
            updated_at = now()
        WHERE result_id = result_record.result_id;
        
        records_updated := records_updated + 1;
    END LOOP;
    
    RETURN records_updated;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_athletes(search_term text)
 RETURNS TABLE(lifter_id bigint, athlete_name text, membership_number text, gender text, club_name text, wso text)
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
  BEGIN
    RETURN QUERY
    SELECT
      l.lifter_id,
      l.athlete_name::text,
      l.membership_number::text,
      COALESCE(recent.recent_gender, 'Unknown')::text as gender,
      COALESCE(recent.recent_club, 'Unknown')::text as club_name,
      COALESCE(recent.recent_wso, 'Unknown')::text as wso
    FROM public.lifters l
    LEFT JOIN LATERAL (
      SELECT
        mr.club_name::text as recent_club,
        mr.wso::text as recent_wso,
        mr.gender::text as recent_gender
      FROM public.meet_results mr
      WHERE mr.lifter_id = l.lifter_id
        AND (
          (mr.club_name IS NOT NULL AND trim(mr.club_name::text) != '')
          OR (mr.wso IS NOT NULL AND trim(mr.wso::text) != '')
        )
      ORDER BY mr.date DESC
      LIMIT 1
    ) recent ON true
    WHERE (
      l.athlete_name ILIKE '%' || search_term || '%'
      OR l.membership_number::text = search_term
      OR extensions.similarity(l.athlete_name, search_term) > 0.2
    )
    AND recent.recent_club IS NOT NULL
    ORDER BY
      CASE WHEN l.membership_number::text = search_term THEN 1
           WHEN LOWER(l.athlete_name) = LOWER(search_term) THEN 2
           ELSE 3 END,
      extensions.similarity(l.athlete_name, search_term) DESC,
      l.athlete_name
    LIMIT 50;
  END;
  $function$
;

CREATE OR REPLACE FUNCTION public.update_clubs_analytics_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
  BEGIN
      -- Only update timestamp if analytics columns changed
      IF (OLD.recent_meets_count IS DISTINCT FROM NEW.recent_meets_count) OR
         (OLD.active_lifters_count IS DISTINCT FROM NEW.active_lifters_count) OR
         (OLD.total_participations IS DISTINCT FROM NEW.total_participations) THEN
          NEW.analytics_updated_at = NOW();
      END IF;
      RETURN NEW;
  END;
  $function$
;

CREATE OR REPLACE FUNCTION public.update_qpoints_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
 
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

          -- Get gender from the public.meet_results record being inserted/updated (NEW.gender)
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
                  calculated_qpoints := public.calculate_qpoints_from_row(
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
              masters_age_factor := public.get_age_factor(competition_age, lifter_gender);
              NEW.q_masters := ROUND(calculated_qpoints * masters_age_factor, 2);
          ELSE
              NEW.q_masters := NULL;
          END IF;

          -- 3. Set q_youth (ONLY for ages 10-20, formula: total * youth_coefficient)
          IF competition_age IS NOT NULL AND competition_age BETWEEN 10 AND 20 AND
             lifter_gender IS NOT NULL AND bodyweight_numeric > 0 AND total_numeric > 0 THEN
              youth_age_factor := public.get_youth_age_factor_interpolated(competition_age, bodyweight_numeric,
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
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
  BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
  END;
  $function$
;

CREATE OR REPLACE FUNCTION public.update_wso_analytics_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
  BEGIN
      -- Only update the timestamp if one of the analytics columns was changed
      IF (NEW.barbell_clubs_count IS DISTINCT FROM OLD.barbell_clubs_count OR
          NEW.recent_meets_count IS DISTINCT FROM OLD.recent_meets_count OR
          NEW.active_lifters_count IS DISTINCT FROM OLD.active_lifters_count OR
          NEW.estimated_population IS DISTINCT FROM OLD.estimated_population OR
          NEW.total_participations IS DISTINCT FROM OLD.total_participations) THEN
          NEW.analytics_updated_at = NOW();
      END IF;
      RETURN NEW;
  END;
  $function$
;

COMMIT;
