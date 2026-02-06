-- Migration: Create usaw_meet_listings table
-- Captures Sport80 meet announcements/listings, separate from actual meet results
BEGIN;
CREATE TABLE IF NOT EXISTS public.usaw_meet_listings (
    listing_id SERIAL PRIMARY KEY,
    -- Meet identification
    meet_name TEXT NOT NULL,
    event_date TEXT,
    -- Date or date range (e.g., "2026-03-08" or "Mar 08-09, 2026")
    date_range TEXT,
    -- Original "Mar 08-09, 2026" format from Sport80
    -- Meet details (from Sport80)
    meet_type TEXT,
    address TEXT,
    organizer TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    registration_open DATE,
    registration_close DATE,
    entries_on_platform TEXT,
    has_entry_list BOOLEAN DEFAULT false,
    -- Link to actual meet results (NULL if unmatched)
    meet_id INTEGER REFERENCES public.usaw_meets(meet_id) ON DELETE
    SET NULL,
        -- Discovery tracking
        first_discovered_at TIMESTAMP DEFAULT NOW(),
        last_seen_at TIMESTAMP DEFAULT NOW(),
        last_scraped_at TIMESTAMP,
        -- Ensure uniqueness
        CONSTRAINT usaw_meet_listings_unique_name_date UNIQUE(meet_name, event_date)
);
-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_meet_listings_meet_id ON public.usaw_meet_listings(meet_id);
CREATE INDEX IF NOT EXISTS idx_meet_listings_event_date ON public.usaw_meet_listings(event_date);
CREATE INDEX IF NOT EXISTS idx_meet_listings_has_entry_list ON public.usaw_meet_listings(has_entry_list);
CREATE INDEX IF NOT EXISTS idx_meet_listings_unmatched ON public.usaw_meet_listings(meet_id)
WHERE meet_id IS NULL;
-- Enable RLS
ALTER TABLE public.usaw_meet_listings ENABLE ROW LEVEL SECURITY;
-- Policy: Allow read access to authenticated users
CREATE POLICY "Allow read access to authenticated users" ON public.usaw_meet_listings FOR
SELECT TO authenticated USING (true);
-- Policy: Allow insert/update for service role
CREATE POLICY "Allow insert/update for service role" ON public.usaw_meet_listings FOR ALL TO service_role USING (true) WITH CHECK (true);
COMMIT;