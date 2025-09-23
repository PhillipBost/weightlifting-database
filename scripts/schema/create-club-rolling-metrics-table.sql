-- Create table for club rolling membership metrics
-- This table stores monthly snapshots of 12-month rolling active member counts
-- Provides 164+ data points per club from 2012-01-01 to present

BEGIN;

-- Create the rolling metrics table
CREATE TABLE IF NOT EXISTS club_rolling_metrics (
    id BIGSERIAL PRIMARY KEY,
    club_name VARCHAR NOT NULL,
    snapshot_month DATE NOT NULL, -- YYYY-MM-01 format (first day of month)
    active_members_12mo INTEGER DEFAULT 0,
    total_competitions_12mo INTEGER DEFAULT 0,
    unique_lifters_12mo INTEGER DEFAULT 0,
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one record per club per month
    UNIQUE(club_name, snapshot_month)
);

-- Add comments for documentation
COMMENT ON TABLE club_rolling_metrics IS 'Monthly snapshots of 12-month rolling club membership metrics';
COMMENT ON COLUMN club_rolling_metrics.club_name IS 'Club name as it appears in meet_results';
COMMENT ON COLUMN club_rolling_metrics.snapshot_month IS 'Month for which the rolling metrics are calculated (YYYY-MM-01)';
COMMENT ON COLUMN club_rolling_metrics.active_members_12mo IS 'Number of unique lifters who competed for this club in the 12 months ending at snapshot_month';
COMMENT ON COLUMN club_rolling_metrics.total_competitions_12mo IS 'Total number of competition participations by this club in the 12-month window';
COMMENT ON COLUMN club_rolling_metrics.unique_lifters_12mo IS 'Number of unique lifters (same as active_members_12mo, kept for clarity)';
COMMENT ON COLUMN club_rolling_metrics.calculated_at IS 'Timestamp when this record was calculated';

-- Create indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_club_rolling_metrics_club_month 
    ON club_rolling_metrics (club_name, snapshot_month);
CREATE INDEX IF NOT EXISTS idx_club_rolling_metrics_month 
    ON club_rolling_metrics (snapshot_month);
CREATE INDEX IF NOT EXISTS idx_club_rolling_metrics_club 
    ON club_rolling_metrics (club_name);

-- Create trigger to update calculated_at on updates
CREATE OR REPLACE FUNCTION update_club_rolling_metrics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.calculated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_club_rolling_metrics_calculated_at ON club_rolling_metrics;
CREATE TRIGGER update_club_rolling_metrics_calculated_at
    BEFORE UPDATE ON club_rolling_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_club_rolling_metrics_timestamp();

COMMIT;