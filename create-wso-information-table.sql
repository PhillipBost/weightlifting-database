-- Create WSO Information Table
-- This table stores comprehensive information about Weightlifting State Organizations (WSOs)
-- including geographic boundaries, contact information, and territorial data

CREATE TABLE wso_information (
    name VARCHAR(100) PRIMARY KEY,         -- WSO name as it appears in meet_results (e.g., "Tennessee-Kentucky", "Mountain North")
    official_url VARCHAR(500),              -- Official WSO website URL
    contact_email VARCHAR(255),             -- Primary contact email
    geographic_type VARCHAR(50),            -- Type: "state", "multi_state", "county_subdivision"
    states TEXT[],                          -- Array of state names covered by this WSO
    counties TEXT[],                        -- Array of county names for subdivided states
    geographic_center_lat DECIMAL(10, 8),   -- Centroid latitude of WSO territory
    geographic_center_lng DECIMAL(11, 8),   -- Centroid longitude of WSO territory
    territory_geojson JSONB,               -- GeoJSON polygon/multipolygon defining territory boundaries
    population_estimate INTEGER,           -- Estimated population served by this WSO
    active_status BOOLEAN DEFAULT true,    -- Whether WSO is currently active
    notes TEXT,                           -- Additional notes about territory or organization
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_wso_information_active ON wso_information(active_status);
CREATE INDEX idx_wso_information_geographic_type ON wso_information(geographic_type);

-- Create a GIN index for the JSONB GeoJSON data if using PostGIS
-- CREATE INDEX idx_wso_information_geojson ON wso_information USING GIN (territory_geojson);

-- Add comments for documentation
COMMENT ON TABLE wso_information IS 'Comprehensive information about Weightlifting State Organizations including geographic territories';
COMMENT ON COLUMN wso_information.name IS 'WSO name as it appears in existing data (matches meet_results.wso field)';
COMMENT ON COLUMN wso_information.geographic_type IS 'Territory type: state, multi_state, or county_subdivision';
COMMENT ON COLUMN wso_information.territory_geojson IS 'GeoJSON polygon defining precise WSO territory boundaries';
COMMENT ON COLUMN wso_information.population_estimate IS 'Estimated population served by this WSO for participation analysis';