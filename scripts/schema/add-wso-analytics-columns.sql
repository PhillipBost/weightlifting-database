-- Add analytics columns to wso_information table
-- These columns will be calculated weekly via automated job

ALTER TABLE wso_information ADD COLUMN IF NOT EXISTS barbell_clubs_count INTEGER DEFAULT 0;
ALTER TABLE wso_information ADD COLUMN IF NOT EXISTS recent_meets_count INTEGER DEFAULT 0;
ALTER TABLE wso_information ADD COLUMN IF NOT EXISTS active_lifters_count INTEGER DEFAULT 0;
ALTER TABLE wso_information ADD COLUMN IF NOT EXISTS estimated_population BIGINT DEFAULT 0;
ALTER TABLE wso_information ADD COLUMN IF NOT EXISTS analytics_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add comments to document the new fields
COMMENT ON COLUMN wso_information.barbell_clubs_count IS 'Number of barbell clubs associated with this WSO region';
COMMENT ON COLUMN wso_information.recent_meets_count IS 'Number of meets held in past 2 years within WSO boundaries';
COMMENT ON COLUMN wso_information.active_lifters_count IS 'Number of lifters who competed in past 2 years within WSO region';
COMMENT ON COLUMN wso_information.estimated_population IS 'Total population within WSO geographic boundaries';
COMMENT ON COLUMN wso_information.analytics_updated_at IS 'Timestamp of last analytics calculation update';

-- Create or update trigger function for analytics_updated_at
CREATE OR REPLACE FUNCTION update_wso_analytics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update the timestamp if one of the analytics columns was changed
    IF (NEW.barbell_clubs_count IS DISTINCT FROM OLD.barbell_clubs_count OR
        NEW.recent_meets_count IS DISTINCT FROM OLD.recent_meets_count OR
        NEW.active_lifters_count IS DISTINCT FROM OLD.active_lifters_count OR
        NEW.estimated_population IS DISTINCT FROM OLD.estimated_population) THEN
        NEW.analytics_updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing trigger if it exists and create new one
DROP TRIGGER IF EXISTS update_wso_information_analytics_updated_at ON wso_information;
CREATE TRIGGER update_wso_information_analytics_updated_at
    BEFORE UPDATE ON wso_information
    FOR EACH ROW
    EXECUTE FUNCTION update_wso_analytics_updated_at();