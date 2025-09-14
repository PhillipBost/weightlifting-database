-- Add elevation columns to meet_locations table
-- Run this in your Supabase SQL editor or via psql

-- Add elevation_meters column (NUMERIC to handle decimal values)
ALTER TABLE meet_locations 
ADD COLUMN IF NOT EXISTS elevation_meters NUMERIC;

-- Add timestamp for when elevation was fetched
ALTER TABLE meet_locations 
ADD COLUMN IF NOT EXISTS elevation_fetched_at TIMESTAMP WITH TIME ZONE;

-- Add source field to track which API was used
ALTER TABLE meet_locations 
ADD COLUMN IF NOT EXISTS elevation_source VARCHAR(50);

-- Add index on elevation_meters for performance
CREATE INDEX IF NOT EXISTS idx_meet_locations_elevation 
ON meet_locations(elevation_meters);

-- Add index on elevation_fetched_at for maintenance queries
CREATE INDEX IF NOT EXISTS idx_meet_locations_elevation_fetched 
ON meet_locations(elevation_fetched_at);

-- Add comments for documentation
COMMENT ON COLUMN meet_locations.elevation_meters IS 'Elevation in meters above sea level';
COMMENT ON COLUMN meet_locations.elevation_fetched_at IS 'Timestamp when elevation data was last fetched';
COMMENT ON COLUMN meet_locations.elevation_source IS 'API source used to fetch elevation (open-meteo, open-elevation, etc.)';