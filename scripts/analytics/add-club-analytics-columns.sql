-- Add analytics columns to clubs table
-- This adds recent_meets_count, active_lifters_count, and analytics_updated_at columns

BEGIN;

-- Add new columns to clubs table
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS recent_meets_count INTEGER DEFAULT 0;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS active_lifters_count INTEGER DEFAULT 0;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS analytics_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add comment for documentation
COMMENT ON COLUMN clubs.recent_meets_count IS 'Number of meets this club participated in during the past 3 years (current year + previous 2 full years)';
COMMENT ON COLUMN clubs.active_lifters_count IS 'Number of unique lifters associated with this club who competed during the past 3 years';
COMMENT ON COLUMN clubs.analytics_updated_at IS 'Last time analytics were calculated for this club';

-- Create trigger to update analytics_updated_at when analytics columns are modified
DROP TRIGGER IF EXISTS update_clubs_analytics_timestamp ON clubs;

CREATE OR REPLACE FUNCTION update_clubs_analytics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update timestamp if analytics columns changed
    IF (OLD.recent_meets_count IS DISTINCT FROM NEW.recent_meets_count) OR 
       (OLD.active_lifters_count IS DISTINCT FROM NEW.active_lifters_count) THEN
        NEW.analytics_updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_clubs_analytics_timestamp
    BEFORE UPDATE ON clubs
    FOR EACH ROW
    EXECUTE FUNCTION update_clubs_analytics_timestamp();

COMMIT;