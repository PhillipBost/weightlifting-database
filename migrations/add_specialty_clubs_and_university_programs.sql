-- Migration: Add specialty clubs and university programs metadata
-- Date: 2026-09-25
-- Description:
--   1. Adds contact_name, instagram, website_url, community_designation,
--      is_bipoc_owned, and is_lgbtqia_owned to public.usaw_clubs.
--   2. Creates public.usaw_university_programs for tracking collegiate weightlifting
--      teams, campus locations, social handles, and links to USAW clubs.

-- Step 1: Extend public.usaw_clubs with community & contact metadata
ALTER TABLE public.usaw_clubs
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS community_designation text,
  ADD COLUMN IF NOT EXISTS is_bipoc_owned boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_lgbtqia_owned boolean DEFAULT false;

-- Step 2: Create public.usaw_university_programs table
CREATE TABLE IF NOT EXISTS public.usaw_university_programs (
  program_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  school_name text NOT NULL,
  state text NOT NULL,
  city text,
  associated_usaw_club text REFERENCES public.usaw_clubs(club_name) ON UPDATE CASCADE ON DELETE SET NULL,
  instagram text,
  website_url text,
  source_sheet text DEFAULT 'Website Updates',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uq_usaw_university_programs UNIQUE (school_name, state)
);

-- Step 3: Indexes for performance
CREATE INDEX IF NOT EXISTS idx_usaw_university_programs_school ON public.usaw_university_programs(school_name);
CREATE INDEX IF NOT EXISTS idx_usaw_university_programs_club ON public.usaw_university_programs(associated_usaw_club);
CREATE INDEX IF NOT EXISTS idx_usaw_clubs_community ON public.usaw_clubs(is_bipoc_owned, is_lgbtqia_owned);

-- Step 4: Grant permissions
GRANT ALL ON TABLE public.usaw_university_programs TO postgres, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE usaw_university_programs_program_id_seq TO postgres, anon, authenticated, service_role;
