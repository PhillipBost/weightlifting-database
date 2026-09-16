-- ========================================================================
-- Migration: Create OWLCMS Storage Bucket & Archival Metadata Columns
-- Purpose: Set up the private 'owlcms-archives' storage bucket on Hetzner
--          and add archival path, size, and hash columns to public.owlcms_meets.
-- Date: 2026-09-14
-- ========================================================================

BEGIN;

-- 1. Create the private Supabase Storage bucket for compressed archives
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'owlcms-archives',
    'owlcms-archives',
    false,
    15728640, -- 15 MB limit
    ARRAY[
        'application/gzip',
        'application/x-gzip',
        'application/octet-stream'
    ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 15728640,
    allowed_mime_types = ARRAY[
        'application/gzip',
        'application/x-gzip',
        'application/octet-stream'
    ]::text[];

-- 2. Add archival metadata columns to public.owlcms_meets
ALTER TABLE public.owlcms_meets
    ADD COLUMN IF NOT EXISTS raw_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS raw_storage_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS raw_storage_hash TEXT,
    ADD COLUMN IF NOT EXISTS raw_payload_hash TEXT;

COMMENT ON COLUMN public.owlcms_meets.raw_storage_path IS 'Storage object path in owlcms-archives (e.g. meets/123/export.json.gz)';
COMMENT ON COLUMN public.owlcms_meets.raw_storage_bytes IS 'Compressed file size in bytes';
COMMENT ON COLUMN public.owlcms_meets.raw_storage_hash IS 'SHA-256 checksum of compressed .json.gz file';
COMMENT ON COLUMN public.owlcms_meets.raw_payload_hash IS 'SHA-256 checksum of raw uncompressed JSON payload';

-- 3. Create index for storage path lookups
CREATE INDEX IF NOT EXISTS idx_owlcms_meets_raw_storage_path
    ON public.owlcms_meets (raw_storage_path);

COMMIT;
