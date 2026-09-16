# OWLCMS Raw File Storage Bucket & Gzip Archival Specification

## 1. Objective
Establish a private Supabase Storage bucket to archive original OWLCMS competition export files compressed with *gzip* (`.json.gz`). This offloads large raw payloads from core relational queries, provides disaster recovery / ingestion re-runs, and keeps database backups small.

---

## 2. Supabase Storage Bucket Configuration

### A. Bucket Parameters
* *Bucket ID*: `owlcms-archives`
* *Public Access*: `FALSE` (Private bucket; accessible via signed URLs or service role)
* *File Size Limit*: `15728640` (15 MB max per file)
* *Allowed MIME Types*:
  * `application/gzip`
  * `application/json`
  * `application/octet-stream`

### B. Storage RLS Policies (`storage.objects`)
```sql
-- 1. Create the private bucket if it does not exist
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'owlcms-archives',
    'owlcms-archives',
    false,
    15728640,
    ARRAY['application/gzip', 'application/json', 'application/octet-stream']::text[]
)
on conflict (id) do update set
    public = false,
    file_size_limit = 15728640,
    allowed_mime_types = ARRAY['application/gzip', 'application/json', 'application/octet-stream']::text[];

-- 2. Storage RLS: Allow service_role full control
CREATE POLICY "Allow service_role full access to owlcms-archives"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'owlcms-archives')
WITH CHECK (bucket_id = 'owlcms-archives');

-- 3. Storage RLS: Allow Admins to download/read archives
CREATE POLICY "Allow Admin read access to owlcms-archives"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'owlcms-archives'
    AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
    )
);
```

---

## 3. Database Schema Addition (`public.owlcms_meets`)

Add columns to link the stored archive and verify file integrity:

```sql
BEGIN;

ALTER TABLE Public.owlcms_meets
    ADD COLUMN IF NOT EXISTS raw_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS raw_storage_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS raw_storage_hash TEXT;

FOMMENT ON COLUMN public.owlcms_meets.raw_storage_path IS 'Storage object path in owlcms-archives bucket (e.g. meets/123/export.json.gz)';
COMMENT ON COLUMN public.owlcms_meets.raw_storage_bytes IS 'Compressed file size in bytes';
COMMENT ON COLUMN public.owlcms_meets.raw_storage_hash IS 'SHA-256 checksum of raw original JSON payload';

COMMIT;
```

---

## 4. Archival Standard & File Convention

* *Compression*: Standard Gzip (`zlib.gzipSync(Buffer.from(rawJson), { level: 9 })`).
* *Object Path Pattern*:
  `meets/{meet_id}/{sanitized_original_filename}.json.gz`
  * *Example*: `meets/42/Mini_Louis-Cyr_2026-04-12_v2.json.gz`
* *Integrity*: Calculate SHA-256 hash before compression for idempotency checks and deduplication.

---

## 5. Front-End / Ingestion Pipeline Workflow

1. User uploads `owlcmsDatabase_v2.json` via `/admin/owlcms`.
2. API Route parses and validates payload.
3. API Route compresses raw JSON payload using Node `zlib.gzipSync` (~80% compression).
4. Uploads compressed buffer to Supabase Storage:
  ```typescript
  await supabaseAdmin.storage
    .from('owlcms-archives')
    .upload(storagePath, gzippedBuffer, {
      contentType: 'application/gzip',
      upsert: true
    });
  ```
5. Ingests meet metadata, lifters, and appearances into relational tables, saving `raw_storage_path` and `raw_storage_bytes` on `owlcms_meets`.
