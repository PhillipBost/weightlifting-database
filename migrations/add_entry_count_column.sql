-- Add entry_count column if it doesn't exist
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS entry_count INTEGER DEFAULT 0;
-- Backfill existing counts
WITH counts AS (
    SELECT listing_id,
        COUNT(*) as cnt
    FROM usaw_meet_entries
    GROUP BY listing_id
)
UPDATE usaw_meet_listings l
SET entry_count = c.cnt
FROM counts c
WHERE l.listing_id = c.listing_id;
-- Create function to update count
CREATE OR REPLACE FUNCTION update_listing_entry_count() RETURNS TRIGGER AS $$ BEGIN IF (TG_OP = 'DELETE') THEN
UPDATE usaw_meet_listings
SET entry_count = (
        SELECT COUNT(*)
        FROM usaw_meet_entries
        WHERE listing_id = OLD.listing_id
    )
WHERE listing_id = OLD.listing_id;
RETURN OLD;
ELSIF (TG_OP = 'INSERT') THEN
UPDATE usaw_meet_listings
SET entry_count = (
        SELECT COUNT(*)
        FROM usaw_meet_entries
        WHERE listing_id = NEW.listing_id
    )
WHERE listing_id = NEW.listing_id;
RETURN NEW;
ELSIF (TG_OP = 'UPDATE') THEN IF (
    OLD.listing_id IS DISTINCT
    FROM NEW.listing_id
) THEN -- Update old listing
UPDATE usaw_meet_listings
SET entry_count = (
        SELECT COUNT(*)
        FROM usaw_meet_entries
        WHERE listing_id = OLD.listing_id
    )
WHERE listing_id = OLD.listing_id;
-- Update new listing
UPDATE usaw_meet_listings
SET entry_count = (
        SELECT COUNT(*)
        FROM usaw_meet_entries
        WHERE listing_id = NEW.listing_id
    )
WHERE listing_id = NEW.listing_id;
END IF;
RETURN NEW;
END IF;
RETURN NULL;
END;
$$ LANGUAGE plpgsql;
-- Create trigger
DROP TRIGGER IF EXISTS trg_update_listing_entry_count ON usaw_meet_entries;
CREATE TRIGGER trg_update_listing_entry_count
AFTER
INSERT
    OR
UPDATE
    OR DELETE ON usaw_meet_entries FOR EACH ROW EXECUTE FUNCTION update_listing_entry_count();