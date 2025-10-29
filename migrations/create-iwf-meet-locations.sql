-- Create iwf_meet_locations table
-- Stores location information for IWF meets with geocoded coordinates

-- Drop old table and constraints if they exist
DROP TABLE IF EXISTS public.iwf_meet_locations CASCADE;

CREATE TABLE IF NOT EXISTS public.iwf_meet_locations (
    db_location_id BIGSERIAL NOT NULL PRIMARY KEY,
    iwf_meet_id TEXT NOT NULL UNIQUE,
    db_meet_id BIGINT NULL,
    address TEXT NULL,
    location_text TEXT NULL,
    date_range TEXT NULL,
    latitude NUMERIC(10, 8) NULL,
    longitude NUMERIC(11, 8) NULL,
    country TEXT NULL,
    city TEXT NULL,
    venue_name TEXT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT now(),
    
    CONSTRAINT iwf_meet_locations_iwf_meet_id_fkey FOREIGN KEY (iwf_meet_id) REFERENCES public.iwf_meets (iwf_meet_id)
) TABLESPACE pg_default;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_iwf_meet_locations_country ON public.iwf_meet_locations USING BTREE (country) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_iwf_meet_locations_meet_id ON public.iwf_meet_locations USING BTREE (iwf_meet_id) TABLESPACE pg_default;

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_iwf_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_iwf_meet_locations_updated_at BEFORE UPDATE ON iwf_meet_locations
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_updated_at_column();
