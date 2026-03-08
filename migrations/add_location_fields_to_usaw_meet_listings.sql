-- Add comprehensive location fields to usaw_meet_listings table
-- This mirrors the structure of usaw_meets for compatibility with existing geocoding logic
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS street_address TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS elevation_meters NUMERIC;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS elevation_source TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS elevation_fetched_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS geocode_display_name TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS geocode_precision_score INTEGER;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS geocode_success BOOLEAN DEFAULT FALSE;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS geocode_error TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS geocode_strategy_used TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS location_text TEXT;
ALTER TABLE usaw_meet_listings
ADD COLUMN IF NOT EXISTS wso_geography TEXT;
-- Add comments to document the new fields
COMMENT ON COLUMN usaw_meet_listings.street_address IS 'Parsed street address component';
COMMENT ON COLUMN usaw_meet_listings.city IS 'Parsed city component';
COMMENT ON COLUMN usaw_meet_listings.state IS 'Parsed state/province component';
COMMENT ON COLUMN usaw_meet_listings.zip_code IS 'Parsed postal code component';
COMMENT ON COLUMN usaw_meet_listings.country IS 'Parsed country component';
COMMENT ON COLUMN usaw_meet_listings.latitude IS 'Geocoded latitude coordinate';
COMMENT ON COLUMN usaw_meet_listings.longitude IS 'Geocoded longitude coordinate';
COMMENT ON COLUMN usaw_meet_listings.elevation_meters IS 'Elevation above sea level in meters';
COMMENT ON COLUMN usaw_meet_listings.elevation_source IS 'Source of elevation data (Open-Meteo, Open-Elevation, etc.)';
COMMENT ON COLUMN usaw_meet_listings.elevation_fetched_at IS 'Timestamp when elevation was fetched';
COMMENT ON COLUMN usaw_meet_listings.geocode_display_name IS 'Full geocoded address returned by geocoding service';
COMMENT ON COLUMN usaw_meet_listings.geocode_precision_score IS 'Geocoding confidence score (higher = more precise)';
COMMENT ON COLUMN usaw_meet_listings.geocode_success IS 'Whether geocoding was successful';
COMMENT ON COLUMN usaw_meet_listings.geocode_error IS 'Error message if geocoding failed';
COMMENT ON COLUMN usaw_meet_listings.geocode_strategy_used IS 'Which geocoding strategy succeeded';
COMMENT ON COLUMN usaw_meet_listings.location_text IS 'Original location text from scraped data';
COMMENT ON COLUMN usaw_meet_listings.wso_geography IS 'WSO geographic region based on boundary definitions';