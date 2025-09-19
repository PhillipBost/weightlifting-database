-- Add comprehensive location fields to meets table
-- This consolidates location data that was previously split between meets and meet_locations tables

ALTER TABLE meets ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS street_address TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS elevation_meters NUMERIC;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS elevation_source TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS elevation_fetched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS geocode_display_name TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS geocode_precision_score INTEGER;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS geocode_success BOOLEAN DEFAULT FALSE;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS geocode_error TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS geocode_strategy_used TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS location_text TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS date_range TEXT;
ALTER TABLE meets ADD COLUMN IF NOT EXISTS wso_geography TEXT;

-- Add comments to document the new fields
COMMENT ON COLUMN meets.address IS 'Raw scraped address from meet listings';
COMMENT ON COLUMN meets.street_address IS 'Parsed street address component';
COMMENT ON COLUMN meets.city IS 'Parsed city component';
COMMENT ON COLUMN meets.state IS 'Parsed state/province component';
COMMENT ON COLUMN meets.zip_code IS 'Parsed postal code component';
COMMENT ON COLUMN meets.country IS 'Parsed country component';
COMMENT ON COLUMN meets.latitude IS 'Geocoded latitude coordinate';
COMMENT ON COLUMN meets.longitude IS 'Geocoded longitude coordinate';
COMMENT ON COLUMN meets.elevation_meters IS 'Elevation above sea level in meters';
COMMENT ON COLUMN meets.elevation_source IS 'Source of elevation data (Open-Meteo, Open-Elevation, etc.)';
COMMENT ON COLUMN meets.elevation_fetched_at IS 'Timestamp when elevation was fetched';
COMMENT ON COLUMN meets.geocode_display_name IS 'Full geocoded address returned by geocoding service';
COMMENT ON COLUMN meets.geocode_precision_score IS 'Geocoding confidence score (higher = more precise)';
COMMENT ON COLUMN meets.geocode_success IS 'Whether geocoding was successful';
COMMENT ON COLUMN meets.geocode_error IS 'Error message if geocoding failed';
COMMENT ON COLUMN meets.geocode_strategy_used IS 'Which geocoding strategy succeeded (original, suite-removed, street-only, etc.)';
COMMENT ON COLUMN meets.location_text IS 'Original location text from scraped data';
COMMENT ON COLUMN meets.date_range IS 'Date range from scraped meet data';
COMMENT ON COLUMN meets.wso_geography IS 'WSO geographic region based on boundary definitions';