-- Migration: Create IWF (International Weightlifting Federation) Database Tables
-- Purpose: Establish separate schema for international competition data
-- Date: 2025-01-16
--
-- This migration creates 4 tables for IWF international competition data:
--   1. iwf_meets - Competition/event metadata
--   2. iwf_meet_locations - Venue and geographic data
--   3. iwf_lifters - International athlete profiles
--   4. iwf_meet_results - Individual performances with analytics
--
-- Analytics calculations match USAW domestic data for consistency:
--   - Successful attempts tracking
--   - Year-to-date (YTD) best performances
--   - Bounce-back analysis (recovery after missed attempts)
--   - Age-appropriate Q-scores (youth, adult, masters)
--
-- Key Differences from USAW Schema:
--   - Athletes identified by name + country (no membership numbers)
--   - Country replaces WSO (state organization)
--   - Includes IWF-specific fields: event_id, competition_group, rank
--   - Venue-based location tracking

BEGIN;

-- ============================================================================
-- TABLE 1: iwf_meets
-- Stores metadata for IWF-sanctioned competitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS iwf_meets (
    iwf_meet_id BIGSERIAL PRIMARY KEY,
    Meet TEXT,                          -- Event name (e.g., "2025 IWF World Championships")
    Level TEXT,                         -- Competition level (e.g., "World Championships", "Continental Championships")
    Date TEXT,                          -- Competition date or date range
    Results TEXT,                       -- Results availability status (e.g., "Available")
    URL TEXT,                           -- Full URL to event results page
    batch_id TEXT,                      -- Processing batch identifier
    scraped_date TIMESTAMP,             -- When this event was scraped
    event_id VARCHAR(50),               -- IWF event ID from URL (e.g., "661")
    location_city TEXT,                 -- Host city
    location_country TEXT,              -- Host country
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- TABLE 2: iwf_meet_locations
-- Stores detailed venue and geographic information for IWF competitions
-- One location per meet (1:1 relationship)
-- ============================================================================

CREATE TABLE IF NOT EXISTS iwf_meet_locations (
    iwf_location_id BIGSERIAL PRIMARY KEY,
    iwf_meet_id BIGINT NOT NULL UNIQUE,    -- One location per meet
    address TEXT,                           -- Full venue address (if available)
    location_text TEXT,                     -- Formatted location string (e.g., "Forde, Norway")
    date_range TEXT,                        -- Date range formatted (e.g., "Oct 12-20, 2025")
    latitude NUMERIC(10, 8),                -- Geographic latitude
    longitude NUMERIC(11, 8),               -- Geographic longitude
    country TEXT,                           -- Country name
    city TEXT,                              -- City name
    venue_name TEXT,                        -- Specific venue/facility name
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (iwf_meet_id) REFERENCES iwf_meets(iwf_meet_id) ON DELETE CASCADE
);

-- ============================================================================
-- TABLE 3: iwf_lifters
-- Stores profiles for international weightlifting athletes
-- Athletes identified by name + country combination (no membership numbers)
-- ============================================================================

CREATE TABLE IF NOT EXISTS iwf_lifters (
    iwf_lifter_id BIGSERIAL PRIMARY KEY,
    athlete_name TEXT NOT NULL,             -- Full name as appears in IWF results
    gender TEXT,                            -- 'M' or 'F'
    birth_year INTEGER,                     -- Year of birth (extracted from birth date)
    country VARCHAR(100),                   -- Country code or full country name
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- TABLE 4: iwf_meet_results
-- Stores individual competition performances with complete analytics
-- Includes all attempt data, YTD tracking, bounce-back analysis, and Q-scores
-- ============================================================================

CREATE TABLE IF NOT EXISTS iwf_meet_results (
    iwf_result_id BIGSERIAL PRIMARY KEY,
    iwf_meet_id BIGINT NOT NULL,
    iwf_lifter_id BIGINT NOT NULL,

    -- Competition Context
    meet_name TEXT,
    date TEXT,
    age_category TEXT,                      -- "Senior", "Junior", "Youth"
    weight_class TEXT,                      -- "60 kg", "71 kg", "+110 kg"
    lifter_name TEXT,
    body_weight_kg TEXT,

    -- Lift Attempts (stored as text to preserve format)
    -- Positive values = successful lift, negative = missed, null = not attempted
    snatch_lift_1 TEXT,                     -- First snatch attempt
    snatch_lift_2 TEXT,                     -- Second snatch attempt
    snatch_lift_3 TEXT,                     -- Third snatch attempt
    best_snatch TEXT,                       -- Best successful snatch
    cj_lift_1 TEXT,                         -- First clean & jerk attempt
    cj_lift_2 TEXT,                         -- Second clean & jerk attempt
    cj_lift_3 TEXT,                         -- Third clean & jerk attempt
    best_cj TEXT,                           -- Best successful clean & jerk
    total TEXT,                             -- Competition total

    -- Calculated Analytics - Successful Attempts
    snatch_successful_attempts INTEGER,     -- Count of successful snatch attempts (0-3)
    cj_successful_attempts INTEGER,         -- Count of successful C&J attempts (0-3)
    total_successful_attempts INTEGER,      -- Total successful attempts (0-6)

    -- Calculated Analytics - Year-to-Date Bests
    -- Retrospective: best performance YTD at time of this competition
    best_snatch_ytd INTEGER,                -- Best snatch YTD at time of this competition
    best_cj_ytd INTEGER,                    -- Best C&J YTD at time of this competition
    best_total_ytd INTEGER,                 -- Best total YTD at time of this competition

    -- Calculated Analytics - Bounce Back
    -- Performance recovery after missed attempts
    bounce_back_snatch_2 BOOLEAN,           -- Made 2nd snatch after missing 1st
    bounce_back_snatch_3 BOOLEAN,           -- Made 3rd snatch after missing 2nd
    bounce_back_cj_2 BOOLEAN,               -- Made 2nd C&J after missing 1st
    bounce_back_cj_3 BOOLEAN,               -- Made 3rd C&J after missing 2nd

    -- Athlete Data
    gender TEXT,                            -- 'M' or 'F'
    birth_year INTEGER,                     -- Year of birth
    competition_age INTEGER,                -- Age at time of competition (calculated)
    country TEXT,                           -- Country represented (replaces USAW's WSO)
    competition_group VARCHAR(10),          -- IWF-specific: Competition session (A, B, C, D)
    rank INTEGER,                           -- IWF-specific: Placement in weight class

    -- Calculated Scoring - Age-Appropriate Q-Scores
    -- Ages ≤9: all null | Ages 10-20: q_youth only | Ages 21-30: qpoints only | Ages 31+: q_masters only
    qpoints NUMERIC(10, 3),                 -- Q-points (ages 21-30)
    q_masters NUMERIC(10, 3),               -- Masters Q-points (ages 31+)
    q_youth NUMERIC(10, 3),                 -- Youth Q-points (ages 10-20)

    -- System Fields
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    manual_override BOOLEAN DEFAULT FALSE,  -- Flag for manual data entry

    FOREIGN KEY (iwf_meet_id) REFERENCES iwf_meets(iwf_meet_id) ON DELETE CASCADE,
    FOREIGN KEY (iwf_lifter_id) REFERENCES iwf_lifters(iwf_lifter_id) ON DELETE CASCADE
);

-- ============================================================================
-- INDEXES - Foreign Keys
-- Enable fast joins between tables
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_iwf_meet_locations_meet_id ON iwf_meet_locations(iwf_meet_id);
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_meet_id ON iwf_meet_results(iwf_meet_id);
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_lifter_id ON iwf_meet_results(iwf_lifter_id);

-- ============================================================================
-- INDEXES - Query Optimization
-- Speed up common query patterns
-- ============================================================================

-- iwf_meets indexes
CREATE INDEX IF NOT EXISTS idx_iwf_meets_event_id ON iwf_meets(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_iwf_meets_event_id_unique ON iwf_meets(event_id);
CREATE INDEX IF NOT EXISTS idx_iwf_meets_date ON iwf_meets(Date);
CREATE INDEX IF NOT EXISTS idx_iwf_meets_level ON iwf_meets(Level);

-- iwf_lifters indexes
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_name ON iwf_lifters(athlete_name);
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_country ON iwf_lifters(country);
CREATE INDEX IF NOT EXISTS idx_iwf_lifters_name_country ON iwf_lifters(athlete_name, country);

-- iwf_meet_locations indexes
CREATE INDEX IF NOT EXISTS idx_iwf_meet_locations_country ON iwf_meet_locations(country);

-- iwf_meet_results indexes
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_date ON iwf_meet_results(date);
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_weight_class ON iwf_meet_results(weight_class);
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_country ON iwf_meet_results(country);
CREATE INDEX IF NOT EXISTS idx_iwf_meet_results_lifter_date ON iwf_meet_results(iwf_lifter_id, date);

-- ============================================================================
-- UNIQUE CONSTRAINT - Prevent Duplicate Results
-- Ensures one result per lifter per weight class per meet
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_iwf_meet_results_unique
    ON iwf_meet_results(iwf_meet_id, iwf_lifter_id, weight_class);

-- ============================================================================
-- TRIGGERS - Auto-Update Timestamps
-- Automatically update updated_at column when records are modified
-- ============================================================================

-- Trigger function
CREATE OR REPLACE FUNCTION update_iwf_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to iwf_meets
CREATE TRIGGER update_iwf_meets_updated_at
    BEFORE UPDATE ON iwf_meets
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_updated_at_column();

-- Apply trigger to iwf_meet_locations
CREATE TRIGGER update_iwf_meet_locations_updated_at
    BEFORE UPDATE ON iwf_meet_locations
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_updated_at_column();

-- Apply trigger to iwf_lifters
CREATE TRIGGER update_iwf_lifters_updated_at
    BEFORE UPDATE ON iwf_lifters
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_updated_at_column();

-- Apply trigger to iwf_meet_results
CREATE TRIGGER update_iwf_meet_results_updated_at
    BEFORE UPDATE ON iwf_meet_results
    FOR EACH ROW
    EXECUTE FUNCTION update_iwf_updated_at_column();

COMMIT;

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- Tables Created: 4
-- Indexes Created: 16 (3 foreign key + 11 query optimization + 2 unique)
-- Triggers Created: 4 (auto-update updated_at)
--
-- Next Steps:
--   1. Run this SQL in Supabase SQL Editor
--   2. Verify tables exist using: SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'iwf_%';
--   3. Verify indexes exist using: SELECT indexname FROM pg_indexes WHERE tablename LIKE 'iwf_%';
--   4. Test trigger by updating a record and checking updated_at changed
--   5. Proceed to Step 2: Project Structure Setup
-- ============================================================================
