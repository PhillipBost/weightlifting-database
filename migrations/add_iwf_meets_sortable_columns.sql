-- ============================================================================
-- Migration: Add Sortable Numeric & ISO Date Columns to public.iwf_meets
-- Purpose: Enables native numeric sorting on iwf_meet_id_num and chronological
--          sorting on date_iso without altering existing TEXT columns.
-- ============================================================================

-- 1. Add columns
ALTER TABLE public.iwf_meets ADD COLUMN IF NOT EXISTS iwf_meet_id_num INTEGER;
ALTER TABLE public.iwf_meets ADD COLUMN IF NOT EXISTS date_iso DATE;

-- 2. Safe date parser for IWF date strings (ISO, "Mon DD, YYYY", or ranges like "Oct 27 - Nov 04, 2026")
CREATE OR REPLACE FUNCTION public._parse_iwf_meet_date(p_date TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    v_clean TEXT;
    v_iso_match TEXT[];
    v_mon_day_match TEXT[];
    v_year_match TEXT[];
BEGIN
    IF p_date IS NULL OR btrim(p_date) = '' THEN
        RETURN NULL;
    END IF;

    v_clean := btrim(p_date);

    -- ISO format: YYYY-MM-DD (or starting with YYYY-MM-DD)
    v_iso_match := regexp_match(v_clean, '^(\d{4}-\d{2}-\d{2})');
    IF v_iso_match IS NOT NULL THEN
        RETURN to_date(v_iso_match[1], 'YYYY-MM-DD');
    END IF;

    -- Human format: extract first Month + Day and 4-digit Year (handles ranges too)
    v_mon_day_match := regexp_match(v_clean, '([A-Za-z]{3,9})\s+(\d{1,2})');
    v_year_match := regexp_match(v_clean, '((?:19|20)\d{2})');
    IF v_mon_day_match IS NOT NULL AND v_year_match IS NOT NULL THEN
        RETURN to_date(left(v_mon_day_match[1], 3) || ' ' || v_mon_day_match[2] || ' ' || v_year_match[1], 'Mon DD YYYY');
    END IF;

    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$function$;

-- 3. Trigger function to keep sortable columns synchronized
CREATE OR REPLACE FUNCTION public.sync_iwf_meets_sortable_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.iwf_meet_id IS NOT NULL AND btrim(NEW.iwf_meet_id) ~ '^\d+$' THEN
        NEW.iwf_meet_id_num := btrim(NEW.iwf_meet_id)::INTEGER;
    ELSE
        NEW.iwf_meet_id_num := NULL;
    END IF;

    NEW.date_iso := public._parse_iwf_meet_date(NEW.date);
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_sync_iwf_meets_sortable ON public.iwf_meets;
CREATE TRIGGER trigger_sync_iwf_meets_sortable
    BEFORE INSERT OR UPDATE OF iwf_meet_id, date ON public.iwf_meets
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_iwf_meets_sortable_columns();

-- 4. Backfill existing rows
UPDATE public.iwf_meets
SET
    iwf_meet_id_num = CASE
        WHEN iwf_meet_id IS NOT NULL AND btrim(iwf_meet_id) ~ '^\d+$' THEN btrim(iwf_meet_id)::INTEGER
        ELSE NULL
    END,
    date_iso = public._parse_iwf_meet_date(date);

-- 5. Indexes for fast DESC sorting
CREATE INDEX IF NOT EXISTS idx_iwf_meets_iwf_meet_id_num_desc
    ON public.iwf_meets (iwf_meet_id_num DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_iwf_meets_date_iso_desc
    ON public.iwf_meets (date_iso DESC NULLS LAST);
