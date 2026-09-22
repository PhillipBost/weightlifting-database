-- ============================================================================
-- MIGRATION: Add OWLCMS Revision Curation & Status Columns
-- (Canonical copy of weightlifting-frontend/migrations/add_owlcms_revision_and_status_columns.sql,
--  relocated to the database repository so schema ownership lives here.)
-- Purpose: Supports 3-tier collision detection, staging revisions as 'pending_review',
--          linking revisions to their parent meets, and storing uploader context notes.
-- NOTE: Applied to the live database 2026-09-21 by the user from the frontend copy.
--       This file is the repository-canonical record; it is idempotent and safe to re-run.
-- ============================================================================

ALTER TABLE public.owlcms_meets
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'pending_review', 'rejected', 'superseded')),
  ADD COLUMN IF NOT EXISTS parent_meet_id bigint REFERENCES public.owlcms_meets(meet_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision_notes text;

-- Index for instant (<5ms) collision lookups by hash and by (meet_name, start_date)
CREATE INDEX IF NOT EXISTS idx_owlcms_meets_payload_hash 
  ON public.owlcms_meets(raw_payload_hash);

CREATE INDEX IF NOT EXISTS idx_owlcms_meets_name_date 
  ON public.owlcms_meets(lower(trim(meet_name)), start_date);

CREATE INDEX IF NOT EXISTS idx_owlcms_meets_status 
  ON public.owlcms_meets(status);

COMMENT ON COLUMN public.owlcms_meets.status IS 'Publication status: published, pending_review, rejected, or superseded';
COMMENT ON COLUMN public.owlcms_meets.parent_meet_id IS 'References the original meet_id if this row is a submitted revision/correction';
COMMENT ON COLUMN public.owlcms_meets.revision_notes IS 'Optional context notes from the uploader explaining what was changed or added';
