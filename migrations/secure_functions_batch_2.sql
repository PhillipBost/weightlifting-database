-- Migration: Secure Function Search Paths (Batch 2 - Read-Only Functions)
-- Includes:
-- 1. get_age_factor (Pure logic / lookup via CASE)
-- 2. get_youth_factor_exact (Reads public.youth_factors)
-- 3. is_admin (Reads public.profiles)
-- 4. search_athletes (Reads public.lifters, public.meet_results, calls extensions.similarity)
BEGIN;
-- 1. get_age_factor
CREATE OR REPLACE FUNCTION public.get_age_factor(age integer, gender text) RETURNS numeric LANGUAGE plpgsql
SET search_path = '' AS $function$ BEGIN -- Return 1.000 for ages under 30 (no age factor applied)
    IF age < 30 THEN RETURN 1.000;
END IF;
-- Female age factors
IF UPPER(gender) = 'F'
OR UPPER(gender) = 'FEMALE' THEN RETURN CASE
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
IF UPPER(gender) = 'M'
OR UPPER(gender) = 'MALE' THEN RETURN CASE
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
$function$;
-- 2. get_youth_factor_exact
CREATE OR REPLACE FUNCTION public.get_youth_factor_exact(
        input_age integer,
        input_bodyweight integer,
        input_gender text
    ) RETURNS numeric LANGUAGE plpgsql
SET search_path = '' AS $function$
DECLARE factor_value DECIMAL;
BEGIN -- Clamp bodyweight to valid range
IF input_bodyweight < 30 THEN input_bodyweight := 30;
END IF;
IF input_bodyweight > 115 THEN input_bodyweight := 115;
END IF;
-- Query the public.youth_factors table (Explicit Qualification)
SELECT factor INTO factor_value
FROM public.youth_factors
WHERE public.youth_factors.gender = UPPER(SUBSTRING(input_gender, 1, 1))
    AND public.youth_factors.bodyweight_kg = input_bodyweight
    AND public.youth_factors.age = input_age;
-- Return the factor if found, otherwise return 1.000 (no adjustment)
RETURN COALESCE(factor_value, 1.000);
END;
$function$;
-- 3. is_admin
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' AS $function$ BEGIN RETURN EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = user_id
            AND role = 'admin'
    );
END;
$function$;
-- 4. search_athletes
CREATE OR REPLACE FUNCTION public.search_athletes(search_term text) RETURNS TABLE(
        lifter_id bigint,
        athlete_name text,
        membership_number text,
        gender text,
        club_name text,
        wso text
    ) LANGUAGE plpgsql
SET search_path = '' AS $function$ BEGIN RETURN QUERY
SELECT l.lifter_id,
    l.athlete_name::text,
    l.membership_number::text,
    COALESCE(recent.recent_gender, 'Unknown')::text as gender,
    COALESCE(recent.recent_club, 'Unknown')::text as club_name,
    COALESCE(recent.recent_wso, 'Unknown')::text as wso
FROM public.lifters l
    LEFT JOIN LATERAL (
        SELECT mr.club_name::text as recent_club,
            mr.wso::text as recent_wso,
            mr.gender::text as recent_gender
        FROM public.meet_results mr
        WHERE mr.lifter_id = l.lifter_id
            AND (
                (
                    mr.club_name IS NOT NULL
                    AND trim(mr.club_name::text) != ''
                )
                OR (
                    mr.wso IS NOT NULL
                    AND trim(mr.wso::text) != ''
                )
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
ORDER BY CASE
        WHEN l.membership_number::text = search_term THEN 1
        WHEN LOWER(l.athlete_name) = LOWER(search_term) THEN 2
        ELSE 3
    END,
    extensions.similarity(l.athlete_name, search_term) DESC,
    l.athlete_name
LIMIT 50;
END;
$function$;
COMMIT;