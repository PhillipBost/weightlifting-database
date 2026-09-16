-- ========================================================================
-- Migration: Add Audit Columns to OWLCMS Meets
-- Purpose: Track uploader identity (user_id, email) and source IP for accountability.
-- Date: 2026-09-14
-- ========================================================================

BEGIN;

ALTER TABLE public.owlcms_meets
    ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS uploader_email TEXT,
    ADD COLUMN IF NOT EXISTS uploader_ip TEXT;

CREATE INDEX IF NOT EXISTS idx_owlcms_meets_uploaded_by
    ON public.owlcms_meets (uploaded_by);

COMMIT;
