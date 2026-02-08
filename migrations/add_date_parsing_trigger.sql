-- Migration: Add trigger to automatically parse event_date into start_date and end_date
-- Purpose: Ensure data consistency regardless of insertion method
BEGIN;
-- 1. Create a function to parse the date string
CREATE OR REPLACE FUNCTION public.parse_usaw_listing_dates() RETURNS TRIGGER AS $$
DECLARE clean_date_str text;
parts text [];
start_str text;
end_str text;
parsed_start date;
parsed_end date;
BEGIN -- Only proceed if event_date is not null and (new record OR event_date changed)
IF NEW.event_date IS NOT NULL
AND (
    TG_OP = 'INSERT'
    OR NEW.event_date <> OLD.event_date
) THEN -- Clean the string: remove time pattern (roughly) and timezone
-- Regex replacement in SQL is a bit more verbose
-- Remove time: \d{1,2}:\d{2}\s+(AM|PM)
-- Remove timezone: \([A-Z]+\)
clean_date_str := REGEXP_REPLACE(
    NEW.event_date,
    '\d{1,2}:\d{2}\s+(AM|PM)',
    '',
    'gi'
);
clean_date_str := REGEXP_REPLACE(clean_date_str, '\([A-Z]+\)', '', 'g');
clean_date_str := TRIM(clean_date_str);
-- Split by ' - '
-- string_to_array is useful here
parts := string_to_array(clean_date_str, ' - ');
BEGIN IF array_length(parts, 1) = 2 THEN -- Range: "May 20th 2023 - May 21st 2023"
-- We need to strip ordinals (st, nd, rd, th) for casting to DATE to work in some contexts,
-- although PostgreSQL ISODate parser is quite good, it might stumble on "20th".
-- Let's try to strip them.
start_str := REGEXP_REPLACE(parts [1], '(\d+)(st|nd|rd|th)', '\1', 'gi');
end_str := REGEXP_REPLACE(parts [2], '(\d+)(st|nd|rd|th)', '\1', 'gi');
-- Try to cast to date
parsed_start := TO_DATE(start_str, 'Month DD, YYYY');
-- TO_DATE might vary, let's trust simple casting if format is standard
-- Actually, straightforward casting 'YYYY-MM-DD' or 'Month DD YYYY' often works automatically
-- via ::DATE if the format is clean.
-- Let's use a safer approach if possible, but for now simple assignment.
-- Attempt to parse. formatting varies widely (Abbreviated months, full months).
-- Postgres is smart enough for 'May 20 2023'::date
-- We'll try to let Postgres cast it. If it fails, we catch it?
-- PL/PGSQL exception handling blocks are heavy, but safe.
parsed_start := start_str::DATE;
parsed_end := end_str::DATE;
ELSIF array_length(parts, 1) = 1 THEN -- Single date
start_str := REGEXP_REPLACE(parts [1], '(\d+)(st|nd|rd|th)', '\1', 'gi');
parsed_start := start_str::DATE;
parsed_end := parsed_start;
-- Same day
END IF;
-- Assign to NEW row
NEW.start_date := parsed_start;
NEW.end_date := parsed_end;
EXCEPTION
WHEN OTHERS THEN -- If parsing fails, just leave columns as NULL or whatever was passed
-- We don't want to block the insert/update just because date parsing failed
-- Log a notice?
RAISE NOTICE 'Failed to auto-parse date for listing %: %',
NEW.meet_name,
SQLERRM;
END;
END IF;
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- 2. Create the trigger
DROP TRIGGER IF EXISTS trigger_parse_usaw_listing_dates ON public.usaw_meet_listings;
CREATE TRIGGER trigger_parse_usaw_listing_dates BEFORE
INSERT
    OR
UPDATE OF event_date ON public.usaw_meet_listings FOR EACH ROW EXECUTE FUNCTION public.parse_usaw_listing_dates();
COMMIT;