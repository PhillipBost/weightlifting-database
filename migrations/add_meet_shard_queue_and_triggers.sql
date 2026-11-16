-- ============================================================================
-- Migration: Add Meet Shard Queue & Database Mutation Triggers
-- Purpose: Guarantees that ANY insert, update, or delete of a meet, venue
--          location/listing, meet result, linked athlete metadata, or OWLCMS
--          athlete alias enqueues the affected meet for static .json.gz shard
--          compilation on disk.
-- Date: 2026-11-16
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Create Outbox Queue Table: public.meet_shard_queue
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meet_shard_queue (
    federation      TEXT NOT NULL CHECK (federation IN ('usaw', 'iwf', 'owlcms')),
    meet_id         TEXT NOT NULL,
    enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (federation, meet_id)
);

CREATE INDEX IF NOT EXISTS idx_meet_shard_queue_enqueued_at
    ON public.meet_shard_queue (enqueued_at ASC);

ALTER TABLE public.meet_shard_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.meet_shard_queue TO service_role;
GRANT ALL ON public.meet_shard_queue TO postgres;

-- ----------------------------------------------------------------------------
-- 2. Helper to Upsert Meet Queue Entry
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enqueue_meet_shard(p_federation TEXT, p_meet_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    IF p_meet_id IS NULL OR btrim(p_meet_id) = '' THEN
        RETURN;
    END IF;

    INSERT INTO public.meet_shard_queue (federation, meet_id, enqueued_at)
    VALUES (p_federation, p_meet_id, clock_timestamp())
    ON CONFLICT (federation, meet_id)
    DO UPDATE SET enqueued_at = clock_timestamp();
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Row-Level Enqueue Function (Captures OLD and NEW)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_meet_shard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_iwf_meet_id TEXT;
    v_meet_row RECORD;
BEGIN
    -- USAW Meets & Meet Listings
    IF TG_TABLE_NAME = 'usaw_meets' OR TG_TABLE_NAME = 'usaw_meet_listings' OR TG_TABLE_NAME = 'usaw_meet_results' THEN
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.meet_id IS NOT NULL THEN
            PERFORM public._enqueue_meet_shard('usaw', NEW.meet_id::text);
        END IF;
        IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.meet_id IS NOT NULL
           AND (TG_OP = 'DELETE' OR OLD.meet_id IS DISTINCT FROM NEW.meet_id) THEN
            PERFORM public._enqueue_meet_shard('usaw', OLD.meet_id::text);
        END IF;

    -- USAW Lifters (membership_number is joined into meet shard results)
    ELSIF TG_TABLE_NAME = 'usaw_lifters' THEN
        IF TG_OP = 'UPDATE' AND (OLD.membership_number IS DISTINCT FROM NEW.membership_number OR OLD.athlete_name IS DISTINCT FROM NEW.athlete_name) THEN
            FOR v_meet_row IN
                SELECT DISTINCT meet_id FROM public.usaw_meet_results WHERE lifter_id = NEW.lifter_id AND meet_id IS NOT NULL
            LOOP
                PERFORM public._enqueue_meet_shard('usaw', v_meet_row.meet_id::text);
            END LOOP;
        END IF;

    -- IWF Meets & Locations (keyed by canonical iwf_meet_id)
    ELSIF TG_TABLE_NAME = 'iwf_meets' OR TG_TABLE_NAME = 'iwf_meet_locations' THEN
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.iwf_meet_id IS NOT NULL THEN
            PERFORM public._enqueue_meet_shard('iwf', NEW.iwf_meet_id::text);
        END IF;
        IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.iwf_meet_id IS NOT NULL
           AND (TG_OP = 'DELETE' OR OLD.iwf_meet_id IS DISTINCT FROM NEW.iwf_meet_id) THEN
            PERFORM public._enqueue_meet_shard('iwf', OLD.iwf_meet_id::text);
        END IF;

    -- IWF Meet Results (references iwf_meets.db_meet_id)
    ELSIF TG_TABLE_NAME = 'iwf_meet_results' THEN
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.db_meet_id IS NOT NULL THEN
            SELECT m.iwf_meet_id INTO v_iwf_meet_id FROM public.iwf_meets m WHERE m.db_meet_id = NEW.db_meet_id LIMIT 1;
            PERFORM public._enqueue_meet_shard('iwf', v_iwf_meet_id);
        END IF;
        IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.db_meet_id IS NOT NULL
           AND (TG_OP = 'DELETE' OR OLD.db_meet_id IS DISTINCT FROM NEW.db_meet_id) THEN
            SELECT m.iwf_meet_id INTO v_iwf_meet_id FROM public.iwf_meets m WHERE m.db_meet_id = OLD.db_meet_id LIMIT 1;
            PERFORM public._enqueue_meet_shard('iwf', v_iwf_meet_id);
        END IF;

    -- IWF Lifters (iwf_lifter_id is joined into meet shard results)
    ELSIF TG_TABLE_NAME = 'iwf_lifters' THEN
        IF TG_OP = 'UPDATE' AND (OLD.iwf_lifter_id IS DISTINCT FROM NEW.iwf_lifter_id OR OLD.athlete_name IS DISTINCT FROM NEW.athlete_name) THEN
            FOR v_meet_row IN
                SELECT DISTINCT m.iwf_meet_id
                FROM public.iwf_meet_results r
                JOIN public.iwf_meets m ON r.db_meet_id = m.db_meet_id
                WHERE r.db_lifter_id = NEW.db_lifter_id AND m.iwf_meet_id IS NOT NULL
            LOOP
                PERFORM public._enqueue_meet_shard('iwf', v_meet_row.iwf_meet_id::text);
            END LOOP;
        END IF;

    -- OWLCMS Meets & Results
    ELSIF TG_TABLE_NAME = 'owlcms_meets' OR TG_TABLE_NAME = 'owlcms_meet_results' THEN
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.meet_id IS NOT NULL THEN
            PERFORM public._enqueue_meet_shard('owlcms', NEW.meet_id::text);
        END IF;
        IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.meet_id IS NOT NULL
           AND (TG_OP = 'DELETE' OR OLD.meet_id IS DISTINCT FROM NEW.meet_id) THEN
            PERFORM public._enqueue_meet_shard('owlcms', OLD.meet_id::text);
        END IF;

    -- OWLCMS Lifters (enriched fields in meet shards)
    ELSIF TG_TABLE_NAME = 'owlcms_lifters' THEN
        IF TG_OP = 'UPDATE' AND (
            OLD.athlete_name IS DISTINCT FROM NEW.athlete_name OR
            OLD.first_name IS DISTINCT FROM NEW.first_name OR
            OLD.last_name IS DISTINCT FROM NEW.last_name OR
            OLD.gender IS DISTINCT FROM NEW.gender OR
            OLD.birth_year IS DISTINCT FROM NEW.birth_year OR
            OLD.club_name IS DISTINCT FROM NEW.club_name OR
            OLD.country_code IS DISTINCT FROM NEW.country_code OR
            OLD.membership_number IS DISTINCT FROM NEW.membership_number
        ) THEN
            FOR v_meet_row IN
                SELECT DISTINCT meet_id FROM public.owlcms_meet_results WHERE lifter_id = NEW.lifter_id AND meet_id IS NOT NULL
            LOOP
                PERFORM public._enqueue_meet_shard('owlcms', v_meet_row.meet_id::text);
            END LOOP;
        END IF;

    -- Athlete Aliases (linked_federation in OWLCMS meet shards)
    ELSIF TG_TABLE_NAME = 'athlete_aliases' THEN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            IF NEW.owlcms_lifter_id IS NOT NULL THEN
                FOR v_meet_row IN
                    SELECT DISTINCT meet_id FROM public.owlcms_meet_results WHERE lifter_id = NEW.owlcms_lifter_id AND meet_id IS NOT NULL
                LOOP
                    PERFORM public._enqueue_meet_shard('owlcms', v_meet_row.meet_id::text);
                END LOOP;
            END IF;
            IF NEW.owlcms_lifter_id_2 IS NOT NULL THEN
                FOR v_meet_row IN
                    SELECT DISTINCT meet_id FROM public.owlcms_meet_results WHERE lifter_id = NEW.owlcms_lifter_id_2 AND meet_id IS NOT NULL
                LOOP
                    PERFORM public._enqueue_meet_shard('owlcms', v_meet_row.meet_id::text);
                END LOOP;
            END IF;
        END IF;

        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            IF OLD.owlcms_lifter_id IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.owlcms_lifter_id IS DISTINCT FROM NEW.owlcms_lifter_id) THEN
                FOR v_meet_row IN
                    SELECT DISTINCT meet_id FROM public.owlcms_meet_results WHERE lifter_id = OLD.owlcms_lifter_id AND meet_id IS NOT NULL
                LOOP
                    PERFORM public._enqueue_meet_shard('owlcms', v_meet_row.meet_id::text);
                END LOOP;
            END IF;
            IF OLD.owlcms_lifter_id_2 IS NOT NULL AND (TG_OP = 'DELETE' OR OLD.owlcms_lifter_id_2 IS DISTINCT FROM NEW.owlcms_lifter_id_2) THEN
                FOR v_meet_row IN
                    SELECT DISTINCT meet_id FROM public.owlcms_meet_results WHERE lifter_id = OLD.owlcms_lifter_id_2 AND meet_id IS NOT NULL
                LOOP
                    PERFORM public._enqueue_meet_shard('owlcms', v_meet_row.meet_id::text);
                END LOOP;
            END IF;
        END IF;
    END IF;

    RETURN NULL;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Statement-Level Notification Function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_meet_shard_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    PERFORM pg_notify('meet_shard_event', '');
    RETURN NULL;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Attach Row-Level Outbox Triggers
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_usaw_meets ON public.usaw_meets;
CREATE TRIGGER trigger_enqueue_meet_shard_usaw_meets
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_meets
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_usaw_meet_listings ON public.usaw_meet_listings;
CREATE TRIGGER trigger_enqueue_meet_shard_usaw_meet_listings
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_meet_listings
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_usaw_meet_results ON public.usaw_meet_results;
CREATE TRIGGER trigger_enqueue_meet_shard_usaw_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_usaw_lifters ON public.usaw_lifters;
CREATE TRIGGER trigger_enqueue_meet_shard_usaw_lifters
    AFTER UPDATE OF membership_number, athlete_name ON public.usaw_lifters
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_iwf_meets ON public.iwf_meets;
CREATE TRIGGER trigger_enqueue_meet_shard_iwf_meets
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_meets
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_iwf_meet_locations ON public.iwf_meet_locations;
CREATE TRIGGER trigger_enqueue_meet_shard_iwf_meet_locations
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_meet_locations
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_iwf_meet_results ON public.iwf_meet_results;
CREATE TRIGGER trigger_enqueue_meet_shard_iwf_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_iwf_lifters ON public.iwf_lifters;
CREATE TRIGGER trigger_enqueue_meet_shard_iwf_lifters
    AFTER UPDATE OF iwf_lifter_id, athlete_name ON public.iwf_lifters
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_owlcms_meets ON public.owlcms_meets;
CREATE TRIGGER trigger_enqueue_meet_shard_owlcms_meets
    AFTER INSERT OR UPDATE OR DELETE ON public.owlcms_meets
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_owlcms_meet_results ON public.owlcms_meet_results;
CREATE TRIGGER trigger_enqueue_meet_shard_owlcms_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.owlcms_meet_results
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_owlcms_lifters ON public.owlcms_lifters;
CREATE TRIGGER trigger_enqueue_meet_shard_owlcms_lifters
    AFTER UPDATE OF athlete_name, first_name, last_name, gender, birth_year, club_name, country_code, membership_number ON public.owlcms_lifters
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

DROP TRIGGER IF EXISTS trigger_enqueue_meet_shard_athlete_aliases ON public.athlete_aliases;
CREATE TRIGGER trigger_enqueue_meet_shard_athlete_aliases
    AFTER INSERT OR UPDATE OR DELETE ON public.athlete_aliases
    FOR EACH ROW EXECUTE FUNCTION public.enqueue_meet_shard_update();

-- ----------------------------------------------------------------------------
-- 6. Attach Statement-Level Notification Triggers
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_notify_meet_shard_usaw_meets ON public.usaw_meets;
CREATE TRIGGER trigger_notify_meet_shard_usaw_meets
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_meets
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_usaw_meet_listings ON public.usaw_meet_listings;
CREATE TRIGGER trigger_notify_meet_shard_usaw_meet_listings
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_meet_listings
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_usaw_meet_results ON public.usaw_meet_results;
CREATE TRIGGER trigger_notify_meet_shard_usaw_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.usaw_meet_results
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_usaw_lifters ON public.usaw_lifters;
CREATE TRIGGER trigger_notify_meet_shard_usaw_lifters
    AFTER UPDATE OF membership_number, athlete_name ON public.usaw_lifters
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_iwf_meets ON public.iwf_meets;
CREATE TRIGGER trigger_notify_meet_shard_iwf_meets
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_meets
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_iwf_meet_locations ON public.iwf_meet_locations;
CREATE TRIGGER trigger_notify_meet_shard_iwf_meet_locations
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_meet_locations
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_iwf_meet_results ON public.iwf_meet_results;
CREATE TRIGGER trigger_notify_meet_shard_iwf_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.iwf_meet_results
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_iwf_lifters ON public.iwf_lifters;
CREATE TRIGGER trigger_notify_meet_shard_iwf_lifters
    AFTER UPDATE OF iwf_lifter_id, athlete_name ON public.iwf_lifters
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_owlcms_meets ON public.owlcms_meets;
CREATE TRIGGER trigger_notify_meet_shard_owlcms_meets
    AFTER INSERT OR UPDATE OR DELETE ON public.owlcms_meets
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_owlcms_meet_results ON public.owlcms_meet_results;
CREATE TRIGGER trigger_notify_meet_shard_owlcms_meet_results
    AFTER INSERT OR UPDATE OR DELETE ON public.owlcms_meet_results
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_owlcms_lifters ON public.owlcms_lifters;
CREATE TRIGGER trigger_notify_meet_shard_owlcms_lifters
    AFTER UPDATE OF athlete_name, first_name, last_name, gender, birth_year, club_name, country_code, membership_number ON public.owlcms_lifters
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

DROP TRIGGER IF EXISTS trigger_notify_meet_shard_athlete_aliases ON public.athlete_aliases;
CREATE TRIGGER trigger_notify_meet_shard_athlete_aliases
    AFTER INSERT OR UPDATE OR DELETE ON public.athlete_aliases
    FOR EACH STATEMENT EXECUTE FUNCTION public.notify_meet_shard_event();

COMMIT;
