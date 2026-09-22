-- ============================================================================
-- MIGRATION: Add Submitter Attribution Columns for Anonymous Uploads
-- Date: 2026-09-21
--
-- Product requirement: humans upload meets WITHOUT accounts, both on-site
-- (public uploader) and via the external API (collaborator website).
-- Therefore:
--   * public.owlcms_meets.uploaded_by (uuid, FK to users.id) stays NULLABLE
--     and is populated ONLY when a logged-in account holder submits.
--     It must never receive submitter names or the legacy 'owlcms_external_api'
--     label (both violate the uuid format and would crash the insert).
--   * submitter_name   -> the submitting human's name (required, both channels)
--   * submission_source-> 'site' (this website's uploader) | 'api' (external site)
--   * uploader_email   -> the submitting human's contact email (required)
--   * uploader_ip     -> network origin (already deployed)
--
-- Historical rows are left NULL for the new columns: those meets simply did
-- not record these facts. No backfill, no data rewrite.
--
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE public.owlcms_meets
  ADD COLUMN IF NOT EXISTS submitter_name text,
  ADD COLUMN IF NOT EXISTS submission_source text
    CHECK (submission_source IN ('site', 'api'));

CREATE INDEX IF NOT EXISTS idx_owlcms_meets_submitter_email
  ON public.owlcms_meets (uploader_email);

COMMENT ON COLUMN public.owlcms_meets.submitter_name IS 'Human submitter name; required for anonymous public and external-API uploads';
COMMENT ON COLUMN public.owlcms_meets.submission_source IS 'Upload channel: site (this website uploader) or api (external collaborator website)';
