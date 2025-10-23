-- Migration: Recreate IWF Tables with Official IDs
-- Purpose: Fresh schema with proper separation of auto-increment PKs and IWF official IDs
-- Date: 2025-01-19
--
-- WARNING: This will DROP and recreate all IWF tables, deleting existing data!
-- Only run this in development or after backing up data.

BEGIN;

-- ============================================================================
-- DROP existing tables (cascade to remove dependencies)
-- ============================================================================

DROP TABLE IF EXISTS iwf_meet_results CASCADE;
DROP TABLE IF EXISTS iwf_meet_locations CASCADE;
DROP TABLE IF EXISTS iwf_lifters CASCADE;
DROP TABLE IF EXISTS iwf_meets CASCADE;

-- Drop the trigger function
DROP FUNCTION IF EXISTS update_iwf_updated_at_column() CASCADE;

-- ============================================================================
-- TABLE 1: iwf_meets
-- Stores metadata for IWF-sanctioned competitions
-- ============================================================================

CREATE TABLE iwf_meets (
    db_meet_id BIGSERIAL PRIMARY KEY,          -- Auto-increment database PK
    event_id TEXT,                             -- IWF's official event ID (e.g., "661")
    Meet TEXT,                                 -- Event name (e.g., "2025 IWF World Championships")
    Level TEXT,                                -- Competition level
    Date TEXT,                                 -- Competition date or date range
    Results TEXT,                              -- Results availability status
    URL TEXT,                                  -- Full URL to event results page
    batch_id TEXT,                             -- Processing batch identifier
    scraped_date TIMESTAMP,                    -- When this event was scraped
    location_city TEXT,                        -- Host city
    location_country TEXT,                     -- Host country
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- TABLE 2: iwf_meet_locations
-- Stores detailed venue and geographic information
-- ============================================================================

CREATE TABLE iwf_meet_locations (
    iwf_location_id BIGSERIAL PRIMARY KEY,
    iwf_meet_id BIGINT NOT NULL UNIQUE,       -- FK to iwf_meets.db_meet_id (1:1 relationship)
    address TEXT,
    location_text TEXT,
    date_range TEXT,
    latitude NUMERIC(10, 8),
    longitude NUMERIC(11, 8),
    country TEXT,
    city TEXT,
    venue_name TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (iwf_meet_id) REFERENCES iwf_meets(db_meet_id) ON DELETE CASCADE
);

-- ============================================================================
-- TABLE 3: iwf_lifters
-- Stores profiles for international weightlifting athletes
-- ============================================================================

CREATE TABLE iwf_lifters (
    db_lifter_id BIGSERIAL PRIMARY KEY,       -- Auto-increment database PK
    iwf_lifter_id BIGINT,                     -- IWF's official athlete ID (e.g., 16119)
    iwf_athlete_url TEXT,                     -- Full URL to athlete bio page
    athlete_name TEXT NOT NULL,               -- Full name in "Firstname LASTNAME" format
    gender TEXT,                              -- 'M' or 'F'
    birth_year INTEGER,                       -- Year of birth
    country VARCHAR(100),                     -- Country code or full country name
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- TABLE 4: iwf_meet_results
-- Stores individual competition performances with complete analytics
-- ============================================================================

CREATE TABLE iwf_meet_results (
    iwf_result_id BIGSERIAL PRIMARY KEY,
    iwf_meet_id BIGINT NOT NULL,              -- FK to iwf_meets.db_meet_id
    iwf_lifter_id BIGINT NOT NULL,            -- FK to iwf_lifters.db_lifter_id

    -- Competition Context
    meet_name TEXT,
    date TEXT,
    age_category TEXT,
    weight_class TEXT,
    lifter_name TEXT,
    body_weight_kg TEXT,

    -- Lift Attempts (stored as text)
    -- Positive values = successful, negative = missed, null = not attempted
    snatch_lift_1 TEXT,
    snatch_lift_2 TEXT,
    snatch_lift_3 TEXT,
    best_snatch TEXT,
    cj_lift_1 TEXT,
    cj_lift_2 TEXT,
    cj_lift_3 TEXT,
    best_cj TEXT,
    total TEXT,

    -- Calculated Analytics - Successful Attempts
    snatch_successful_attempts INTEGER,
    cj_successful_attempts INTEGER,
    total_successful_attempts INTEGER,

    -- Calculated Analytics - Year-to-Date Bests
    best_snatch_ytd INTEGER,
    best_cj_ytd INTEGER,
    best_total_ytd INTEGER,

    -- Calculated Analytics - Bounce Back
    bounce_back_snatch_2 BOOLEAN,
    bounce_back_snatch_3 BOOLEAN,
    bounce_back_cj_2 BOOLEAN,
    bounce_back_cj_3 BOOLEAN,

    -- Athlete Data
    gender TEXT,
    birth_year INTEGER,
    competition_age INTEGER,
    country TEXT,
    competition_group VARCHAR(10),
    rank INTEGER,                             -- Placement in weight class (NULL for DNF)

    -- Calculated Scoring - Age-Appropriate Q-Scores
    qpoints NUMERIC(10, 3),
    q_masters NUMERIC(10, 3),
    q_youth NUMERIC(10, 3),

    -- System Fields
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    manual_override BOOLEAN DEFAULT FALSE,

    FOREIGN KEY (iwf_meet_id) REFERENCES iwf_meets(db_meet_id) ON DELETE CASCADE,
    FOREIGN KEY (iwf_lifter_id) REFERENCES iwf_lifters(db_lifter_id) ON DELETE CASCADE
);

-- ============================================================================
-- INDEXES - Foreign Keys
-- ============================================================================

CREATE INDEX idx_iwf_meet_locations_meet_id ON iwf_meet_locations(iwf_meet_id);
CREATE INDEX idx_iwf_meet_results_meet_id ON iwf_meet_results(iwf_meet_id);
CREATE INDEX idx_iwf_meet_results_lifter_id ON iwf_meet_results(iwf_lifter_id);

-- ============================================================================
-- INDEXES - Query Optimization
-- ============================================================================

-- iwf_meets indexes
CREATE INDEX idx_iwf_meets_event_id ON iwf_meets(event_id);
-- Use unique constraint instead of partial index to support ON CONFLICT in upserts
ALTER TABLE iwf_meets ADD CONSTRAINT iwf_meets_event_id_key UNIQUE (event_id);
CREATE INDEX idx_iwf_meets_date ON iwf_meets(date);
CREATE INDEX idx_iwf_meets_level ON iwf_meets(level);

-- iwf_lifters indexes
CREATE INDEX idx_iwf_lifters_iwf_lifter_id ON iwf_lifters(iwf_lifter_id) WHERE iwf_lifter_id IS NOT NULL;
CREATE INDEX idx_iwf_lifters_name ON iwf_lifters(athlete_name);
CREATE INDEX idx_iwf_lifters_country ON iwf_lifters(country);
CREATE INDEX idx_iwf_lifters_name_country ON iwf_lifters(athlete_name, country);

-- iwf_meet_locations indexes
CREATE INDEX idx_iwf_meet_locations_country ON iwf_meet_locations(country);

-- iwf_meet_results indexes
CREATE INDEX idx_iwf_meet_results_date ON iwf_meet_results(date);
CREATE INDEX idx_iwf_meet_results_weight_class ON iwf_meet_results(weight_class);
CREATE INDEX idx_iwf_meet_results_country ON iwf_meet_results(country);
CREATE INDEX idx_iwf_meet_results_lifter_date ON iwf_meet_results(iwf_lifter_id, date);

-- ============================================================================
-- UNIQUE CONSTRAINT - Prevent Duplicate Results
-- ============================================================================

CREATE UNIQUE INDEX idx_iwf_meet_results_unique
    ON iwf_meet_results(iwf_meet_id, iwf_lifter_id, weight_class);

-- ============================================================================
-- TRIGGERS - Auto-Update Timestamps
-- ============================================================================

-- Trigger function
CREATE OR REPLACE FUNCTION update_iwf_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER update_iwf_meets_updated_at
    BEFORE UPDATE ON iwf_meets
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_updated_at_column();

CREATE TRIGGER update_iwf_meet_locations_updated_at
    BEFORE UPDATE ON iwf_meet_locations
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_updated_at_column();

CREATE TRIGGER update_iwf_lifters_updated_at
    BEFORE UPDATE ON iwf_lifters
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_updated_at_column();

CREATE TRIGGER update_iwf_meet_results_updated_at
    BEFORE UPDATE ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_updated_at_column();

COMMIT;

-- ============================================================================
-- Migration Complete - New Schema Structure
-- ============================================================================
--
-- iwf_meets:
--   - db_meet_id (BIGSERIAL PK) - Auto-increment database primary key
--   - event_id (TEXT) - IWF's official event ID (e.g., "661")
--   - Meet (TEXT) - Event name (e.g., "2025 IWF World Championships")
--
-- iwf_lifters:
--   - db_lifter_id (BIGSERIAL PK) - Auto-increment database primary key
--   - iwf_lifter_id (BIGINT) - IWF's official athlete ID (e.g., 16119)
--   - iwf_athlete_url (TEXT) - Full URL to athlete bio page
--   - athlete_name (TEXT) - Athlete name in "Firstname LASTNAME" format
--
-- iwf_meet_results:
--   - iwf_meet_id (BIGINT FK) - References iwf_meets.db_meet_id
--   - iwf_lifter_id (BIGINT FK) - References iwf_lifters.db_lifter_id
--   - rank (INTEGER) - NULL for DNF athletes
--
-- Next Steps:
--   1. Run this migration in Supabase SQL Editor
--   2. Update code to use new column names
--   3. Test with event 661 import
-- ============================================================================
