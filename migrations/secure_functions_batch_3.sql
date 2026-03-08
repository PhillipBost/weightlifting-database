-- Migration: Secure Function Search Paths (Batch 3 - Safe Trigger Functions)
-- Purpose: Secure 5 trigger functions that only modify NEW/OLD records (no table access)
-- Functions:
-- 1. update_updated_at_column
-- 2. update_clubs_analytics_timestamp
-- 3. update_wso_analytics_updated_at
-- 4. handle_manual_override
-- 5. calculate_competition_age
BEGIN;
-- 1. update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
SET search_path = '' AS $function$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$function$;
-- 2. update_clubs_analytics_timestamp
CREATE OR REPLACE FUNCTION public.update_clubs_analytics_timestamp() RETURNS trigger LANGUAGE plpgsql
SET search_path = '' AS $function$ BEGIN -- Only update timestamp if analytics columns changed
    IF (
        OLD.recent_meets_count IS DISTINCT
        FROM NEW.recent_meets_count
    )
    OR (
        OLD.active_lifters_count IS DISTINCT
        FROM NEW.active_lifters_count
    )
    OR (
        OLD.total_participations IS DISTINCT
        FROM NEW.total_participations
    ) THEN NEW.analytics_updated_at = NOW();
END IF;
RETURN NEW;
END;
$function$;
-- 3. update_wso_analytics_updated_at
CREATE OR REPLACE FUNCTION public.update_wso_analytics_updated_at() RETURNS trigger LANGUAGE plpgsql
SET search_path = '' AS $function$ BEGIN -- Only update the timestamp if one of the analytics columns was changed
    IF (
        NEW.barbell_clubs_count IS DISTINCT
        FROM OLD.barbell_clubs_count
            OR NEW.recent_meets_count IS DISTINCT
        FROM OLD.recent_meets_count
            OR NEW.active_lifters_count IS DISTINCT
        FROM OLD.active_lifters_count
            OR NEW.estimated_population IS DISTINCT
        FROM OLD.estimated_population
            OR NEW.total_participations IS DISTINCT
        FROM OLD.total_participations
    ) THEN NEW.analytics_updated_at = NOW();
END IF;
RETURN NEW;
END;
$function$;
-- 4. handle_manual_override
CREATE OR REPLACE FUNCTION public.handle_manual_override() RETURNS trigger LANGUAGE plpgsql
SET search_path = '' AS $function$ BEGIN -- If manual_override is TRUE, skip automatic calculation
    IF NEW.manual_override = TRUE THEN -- Still update the updated_at timestamp
    NEW.updated_at = now();
RETURN NEW;
END IF;
-- Otherwise, proceed with normal analytics calculation
RETURN NEW;
END;
$function$;
-- 5. calculate_competition_age
CREATE OR REPLACE FUNCTION public.calculate_competition_age() RETURNS trigger LANGUAGE plpgsql
SET search_path = '' AS $function$ BEGIN -- Calculate competition_age if we have both date and birth_year
    IF NEW.date IS NOT NULL
    AND NEW.birth_year IS NOT NULL THEN NEW.competition_age = EXTRACT(
        YEAR
        FROM NEW.date::date
    ) - NEW.birth_year;
ELSIF NEW.date IS NULL
OR NEW.birth_year IS NULL THEN NEW.competition_age = NULL;
END IF;
RETURN NEW;
END;
$function$;
COMMIT;