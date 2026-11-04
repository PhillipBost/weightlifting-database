-- ============================================================================
-- Migration: Add Athlete Shard Queue & Database Mutation Triggers
-- Purpose: Guarantees that ANY insert, update, or delete of an athlete profile,
--          competition result, division ranking, or alias edge enqueues the
--          affected athlete for static shard compilation on disk.
-- Date: 2026-11-04
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Create Outbox Queue Table: public.athlete_shard_queue
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.athlete_shard_queue (
    federation      TEXT NOT NULL,
    entity_id       BIGINT NOT NULL,
    enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (federation, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_athlete_shard_queue_enqueued_at 
    ON public.athlete_shard_queue (enqueued_at ASC);

ALTER TABLE public.athlete_shard_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.athlete_shard_queue TO service_role;
GRANT ALL ON public.athlete_shard_queue TO postgres;

-- ----------------------------------------------------------------------------
-- 2. Drop Legacy Webhook Triggers & Function (With CASCADE)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_refresh_athlete ON public.usaw_meet_results;
DROP TRIGGER IF EXISTS trigger_refresh_athlete_lifter ON public.usaw_lifters;
DROP TRIGGER IF EXISTS trigger_refresh_athlete_iwf ON public.iwf_meet_results;
DROP TRIGGER IF EXISTS trigger_refresh_athlete_iwf_lifter ON public.iwf_lifters;
DROP TRIGGER IF EXISTS trigger_refresh_athlete_json_usaw ON public.usaw_meet_results;
DROP TRIGGER IF EXISTS trigger_refresh_athlete_json_usaw_lifters ON public.usaw_lifters;
DROP TRIGGER IF EXISTS trigger_refresh_athlete_json_iwf ON public.iwf_meet_results;
DROP TRIGGER IF EXISTS trigger_refresh_athlete_json_iwf_lifters ON public.iwf_lifters;
DROP TRIGGER IF EXISTS usaw_meet_results_refresh_athlete_trigger ON public.usaw_meet_results;
DROP TRIGGER IF EXISTS usaw_lifters_refresh_athlete_trigger ON public.usaw_lifters;
DROP TRIGGER IF EXISTS iwf_meet_results_refresh_athlete_trigger ON public.iwf_meet_results;
DROP TRIGGER IF EXISTS iwf_lifters_refresh_athlete_trigger ON public.iwf_lifters;

DROP FUNCTION IF EXISTS public.refresh_athlete_json_trigger() CASCADE;

-- ----------------------------------------------------------------------------
-- 3. Row-Level Enqueue Function (Captures OLD and NEW)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_athlete_shard_update()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    -- United States of America Weightlifting (USAW) Results or Lifters
    IF TG_TABLE_NAME = 'usaw_meet_results' OR TG_TABLE_NAME = 'usaw_lifters' THEN
        -- Handle NEW lifter_id
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.lifter_id IS NOT NULL THEN
            INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
            VALUES ('usaw', NEW.lifter_id, clock_timestamp())
            ON CONFLICT (federation, entity_id) 
            DO UPDATE SET enqueued_at = clock_timestamp();
        END IF;

        -- Handle OLD lifter_id (Deletions or Reassignments)
        IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.lifter_id IS NOT NULL 
           AND (TG_OP = 'DELETE' OR OLD.lifter_id IS DISTINCT FROM NEW.lifter_id) THEN
            INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
            VALUES ('usaw', OLD.lifter_id, clock_timestamp())
            ON CONFLICT (federation, entity_id) 
            DO UPDATE SET enqueued_at = clock_timestamp();
        END IF;

    -- USAW Division Rankings (Medal & Podium Changes)
    ELSIF TG_TABLE_NAME = 'usaw_division_rankings' THEN
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.athlete_id IS NOT NULL THEN
            INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
            VALUES ('usaw', NEW.athlete_id, clock_timestamp())
            ON CONFLICT (federation, entity_id) 
            DO UPDATE SET enqueued_at = clock_timestamp();
        END IF;

        IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.athlete_id IS NOT NULL 
           AND (TG_OP = 'DELETE' OR OLD.athlete_id IS DISTINCT FROM NEW.athlete_id) THEN
            INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
            VALUES ('usaw', OLD.athlete_id, clock_timestamp())
            ON CONFLICT (federation, entity_id) 
            DO UPDATE SET enqueued_at = clock_timestamp();
        END IF;

    -- International Weightlifting Federation (IWF) Results or Lifters
    ELSIF TG_TABLE_NAME = 'iwf_meet_results' OR TG_TABLE_NAME = 'iwf_lifters' THEN
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.db_lifter_id IS NOT NULL THEN
            INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
            VALUES ('iwf', NEW.db_lifter_id, clock_timestamp())
            ON CONFLICT (federation, entity_id) 
            DO UPDATE SET enqueued_at = clock_timestamp();
        END IF;

        IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.db_lifter_id IS NOT NULL 
           AND (TG_OP = 'DELETE' OR OLD.db_lifter_id IS DISTINCT FROM NEW.db_lifter_id) THEN
            INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
            VALUES ('iwf', OLD.db_lifter_id, clock_timestamp())
            ON CONFLICT (federation, entity_id) 
            DO UPDATE SET enqueued_at = clock_timestamp();
        END IF;

    -- Open Weightlifting Competition Management System (OWLCMS) Results or Lifters
    ELSIF TG_TABLE_NAME = 'owlcms_meet_results' OR TG_TABLE_NAME = 'owlcms_lifters' THEN
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.lifter_id IS NOT NULL THEN
            INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
            VALUES ('owlcms', NEW.lifter_id, clock_timestamp())
            ON CONFLICT (federation, entity_id) 
            DO UPDATE SET enqueued_at = clock_timestamp();
        END IF;

        IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.lifter_id IS NOT NULL 
           AND (TG_OP = 'DELETE' OR OLD.lifter_id IS DISTINCT FROM NEW.lifter_id) THEN
            INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
            VALUES ('owlcms', OLD.lifter_id, clock_timestamp())
            ON CONFLICT (federation, entity_id) 
            DO UPDATE SET enqueued_at = clock_timestamp();
        END IF;

    -- Cross-Federation Athlete Aliases (Link Creation, Modification, or Severance)
    ELSIF TG_TABLE_NAME = 'athlete_aliases' THEN
        -- Handle NEW alias nodes
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            IF NEW.usaw_lifter_id IS NOT NULL THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('usaw', NEW.usaw_lifter_id, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;

            IF NEW.iwf_db_lifter_id IS NOT NULL THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('iwf', NEW.iwf_db_lifter_id, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;

            IF NEW.iwf_db_lifter_id_2 IS NOT NULL THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('iwf', NEW.iwf_db_lifter_id_2, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;

            IF NEW.owlcms_lifter_id IS NOT NULL THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('owlcms', NEW.owlcms_lifter_id, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;

            IF NEW.owlcms_lifter_id_2 IS NOT NULL THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('owlcms', NEW.owlcms_lifter_id_2, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;
        END IF;

        -- Handle OLD alias nodes (Unlinking or Deletion)
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            IF OLD.usaw_lifter_id IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.usaw_lifter_id IS DISTINCT FROM NEW.usaw_lifter_id) THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('usaw', OLD.usaw_lifter_id, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;

            IF OLD.iwf_db_lifter_id IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.iwf_db_lifter_id IS DISTINCT FROM NEW.iwf_db_lifter_id) THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('iwf', OLD.iwf_db_lifter_id, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;

            IF OLD.iwf_db_lifter_id_2 IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.iwf_db_lifter_id_2 IS DISTINCT FROM NEW.iwf_db_lifter_id_2) THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('iwf', OLD.iwf_db_lifter_id_2, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;

            IF OLD.owlcms_lifter_id IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.owlcms_lifter_id IS DISTINCT FROM NEW.owlcms_lifter_id) THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('owlcms', OLD.owlcms_lifter_id, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;

            IF OLD.owlcms_lifter_id_2 IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.owlcms_lifter_id_2 IS DISTINCT FROM NEW.owlcms_lifter_id_2) THEN
                INSERT INTO public.athlete_shard_queue (federation, entity_id, enqueued_at)
                VALUES ('owlcms', OLD.owlcms_lifter_id_2, clock_timestamp())
                ON CONFLICT (federation, entity_id) DO UPDATE SET enqueued_at = clock_timestamp();
            END IF;
        END IF;
    END IF;

    RETURN NULL;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Statement-Level Notification Function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_athlete_shard_event()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    PERFORM pg_notify('athlete_shard_event', '');
    RETURN NULL;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Attach Row-Level Outbox Triggers
-- ----------------------------------------------------------------------------

-- USAW Meet Results
DROP TRIGGER IF EXISTS trigger_enqueue_shard_usaw_meet_results ON public.usaw_meet_results;
CREATE TRIGGER trigger_enqueue_shard_usaw_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_athlete_shard_update();

-- USAW Lifters
DROP TRIGGER IF EXISTS trigger_enqueue_shard_usaw_lifters ON public.usaw_lifters;
CREATE TRIGGER trigger_enqueue_shard_usaw_lifters
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_lifters
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_athlete_shard_update();

-- USAW Division Rankings
DROP TRIGGER IF EXISTS trigger_enqueue_shard_usaw_division_rankings ON public.usaw_division_rankings;
CREATE TRIGGER trigger_enqueue_shard_usaw_division_rankings
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_division_rankings
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_athlete_shard_update();

-- IWF Meet Results
DROP TRIGGER IF EXISTS trigger_enqueue_shard_iwf_meet_results ON public.iwf_meet_results;
CREATE TRIGGER trigger_enqueue_shard_iwf_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_athlete_shard_update();

-- IWF Lifters
DROP TRIGGER IF EXISTS trigger_enqueue_shard_iwf_lifters ON public.iwf_lifters;
CREATE TRIGGER trigger_enqueue_shard_iwf_lifters
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_lifters
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_athlete_shard_update();

-- OWLCMS Meet Results
DROP TRIGGER IF EXISTS trigger_enqueue_shard_owlcms_meet_results ON public.owlcms_meet_results;
CREATE TRIGGER trigger_enqueue_shard_owlcms_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.owlcms_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_athlete_shard_update();

-- OWLCMS Lifters
DROP TRIGGER IF EXISTS trigger_enqueue_shard_owlcms_lifters ON public.owlcms_lifters;
CREATE TRIGGER trigger_enqueue_shard_owlcms_lifters
    AFTER INSERT OR UPDATE OR DELETE ON public.owlcms_lifters
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_athlete_shard_update();

-- Athlete Aliases
DROP TRIGGER IF EXISTS trigger_enqueue_shard_athlete_aliases ON public.athlete_aliases;
CREATE TRIGGER trigger_enqueue_shard_athlete_aliases
    AFTER INSERT OR UPDATE OR DELETE ON public.athlete_aliases
    FOR EACH ROW
    EXECUTE FUNCTION public.enqueue_athlete_shard_update();

-- ----------------------------------------------------------------------------
-- 6. Attach Statement-Level Notification Triggers
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trigger_notify_shard_usaw_meet_results ON public.usaw_meet_results;
CREATE TRIGGER trigger_notify_shard_usaw_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_meet_results
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.notify_athlete_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_shard_usaw_lifters ON public.usaw_lifters;
CREATE TRIGGER trigger_notify_shard_usaw_lifters
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_lifters
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.notify_athlete_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_shard_usaw_division_rankings ON public.usaw_division_rankings;
CREATE TRIGGER trigger_notify_shard_usaw_division_rankings
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_division_rankings
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.notify_athlete_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_shard_iwf_meet_results ON public.iwf_meet_results;
CREATE TRIGGER trigger_notify_shard_iwf_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_meet_results
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.notify_athlete_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_shard_iwf_lifters ON public.iwf_lifters;
CREATE TRIGGER trigger_notify_shard_iwf_lifters
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_lifters
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.notify_athlete_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_shard_owlcms_meet_results ON public.owlcms_meet_results;
CREATE TRIGGER trigger_notify_shard_owlcms_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.owlcms_meet_results
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.notify_athlete_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_shard_owlcms_lifters ON public.owlcms_lifters;
CREATE TRIGGER trigger_notify_shard_owlcms_lifters
    AFTER INSERT OR UPDATE OR DELETE ON public.owlcms_lifters
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.notify_athlete_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_shard_athlete_aliases ON public.athlete_aliases;
CREATE TRIGGER trigger_notify_shard_athlete_aliases
    AFTER INSERT OR UPDATE OR DELETE ON public.athlete_aliases
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.notify_athlete_shard_event();

COMMIT;
