# Changelog

All notable changes to the Weightlifting Database project will be documented in this file.

## [Changed] - 2026-09-15 (Eastern Time)

- **OWLCMS Database-Driven Review Queue Support (`owlcms_lifters` & `link-new-owlcms-athletes.js`)**:
  - Added schema columns `review_candidate JSONB` and `rejected_candidate_ids JSONB DEFAULT '[]'::jsonb` to `public.owlcms_lifters`.
  - Updated linker script to persist candidate type, ID, name, score, and breakdown into `review_candidate` on `REVIEW_NEEDED`.
  - Added automated candidate skipping for any candidate ID present in `rejected_candidate_ids` or `OWLCMS_BLACKLIST_MAP`.
  - Automatically clears `review_candidate` upon transition to `LINKED` or `ISOLATED`.

- **OWLCMS Event-Driven Automation Daemon (`scripts/production/owlcms-event-daemon.js`)**:
  - Implemented persistent PostgreSQL `LISTEN / NOTIFY` daemon listening on channel `owlcms_pipeline_event`.
  - Added PostgreSQL notification triggers on `public.owlcms_lifters` (`link_status = 'PENDING'`) and `public.athlete_aliases` to wake up the worker instantly upon database mutation.
  - Added 1500ms burst-write debouncer to cleanly handle multi-row meet uploads.
  - Added `"daemon:owlcms"` npm script.

- **OWLCMS Static Shard Assembler & Linker Trigger (`scripts/production/assembler.js` & `link-new-owlcms-athletes.js`)**:
  - Added OWLCMS identity resolution and recursive alias traversal (`owlcms_lifter_id`, `owlcms_lifter_id_2`) to `generateAthlete()`.
  - Added `owlcms_results_agg` CTE assembling meet metadata, signed platform attempt weights, attempt timestamps, attempt efficiencies, bounce-back metrics, and `participations` JSONB.
  - Added `owlcms` directory output (`owlcms/${shard}/${id}.json.gz`) to Quad-Writer shard emitter alongside USAW, IWF, and internal IDs.
  - Wired automatic shard generation trigger into `link-new-owlcms-athletes.js` to execute for all newly linked athletes upon pipeline completion.

- **OWLCMS Meet 1 Athlete Mappings (`scripts/shared/athlete-mappings.js`)**:
  - Whitelisted Gabby DAHMER (`owlcms_lifter_id: 60` -> `iwf_db_lifter_id: 58931`) and Sasha MILLIN (`owlcms_lifter_id: 140` -> `usaw_lifter_id: 42566`).
  - Blacklisted Lexi FUNG (`owlcms_lifter_id: 8` -> `iwf_db_lifter_id: 58823`).

## [Changed] - 2026-09-14 (Eastern Time)

- **OWLCMS Manual Mappings Reset (`scripts/shared/athlete-mappings.js`)**:
  - Cleared `OWLCMS_MANUAL_MAP` and `OWLCMS_BLACKLIST_MAP` in preparation for a clean database re-import following quarantine standard establishment.

## [Fixed] - 2026-09-14 (Eastern Time)

- **Athlete Aliases Nullability & Linker Accounting (`athlete_aliases` & `link-new-owlcms-athletes.js`)**:
  - Dropped `NOT NULL` constraint on `athlete_aliases.iwf_db_lifter_id` in Supabase to allow pairwise rows where `iwf_db_lifter_id` is null (`USAW ── OWLCMS` and `OWLCMS ── OWLCMS`).
  - Corrected `linkedCount` counter in `scripts/production/link-new-owlcms-athletes.js` to only increment upon confirmed database insertion.

## [Added] - 2026-09-14 (Eastern Time)

- **OWLCMS Pipeline Runner & Concurrency Guard (`scripts/production/run-owlcms-pipeline.js` & `owlcms-upload-server.js`)**:
  - Implemented singleton pipeline runner with PID-verified mutex lock and auto-reclaim for crash resilience.
  - Added self-draining processing loop that automatically sweeps up newly ingested athletes if a meet finishes uploading while an existing linker run is active.
  - Added non-blocking trigger route `POST /api/pipeline/run` in `owlcms-upload-server.js` for instant frontend response.

- **OWLCMS Storage Bucket & Gzip Archival (`migrations/create_owlcms_storage_and_archive_columns.sql`)**:
  - Created private Supabase Storage bucket `owlcms-archives` (15 MB limit, gzip MIME types).
  - Added archival metadata tracking columns to `public.owlcms_meets` (`raw_storage_path`, `raw_storage_bytes`, `raw_storage_hash`, `raw_payload_hash`) with lookup index.
  - Implemented async gzip (level 6) compression, SHA-256 dual checksum generation, and automated storage upload in `scripts/production/owlcms-importer.js`.

- **OWLCMS Cross-Federation Athlete Linking (`migrations/add_owlcms_to_athlete_aliases.sql` & `scripts/production/link-new-owlcms-athletes.js`)**:
  - Extended `public.athlete_aliases` with `owlcms_lifter_id` and `owlcms_lifter_id_2` under a normalized pairwise link model (`= 2` IDs per row) to support multiple OWLCMS meet records linking to the same USAW or IWF profile without collision.
  - Implemented multi-signal matching engine using demographic gating (exact birth year + gender), tokenized name overlap (swallowing middle names), and physics/performance delta verification.
  - Verified 100/100 high-confidence match on Aurora van Ulft (`owlcms_lifter_id: 190` -> `usaw_lifter_id: 201241` / `iwf_db_lifter_id: 59809`).
  - Added `link_status` lifecycle column (`PENDING`, `LINKED`, `REVIEW_NEEDED`, `ISOLATED`) on `public.owlcms_lifters` (`migrations/add_owlcms_link_status_column.sql`) so routine runs automatically skip vetted isolated athletes.
  - Added `OWLCMS_MANUAL_MAP` and `OWLCMS_BLACKLIST_MAP` in `scripts/shared/athlete-mappings.js` for version-controlled manual overrides and candidate rejections.

## [Added] - 2026-09-13 (Eastern Time)

- **OWLCMS Analytics & Sabermetrics Suite (`migrations/add_owlcms_analytics_columns.sql`)**:
  - Added full GAMX breakdown suite (`gamx_u`, `gamx_a`, `gamx_masters`, `gamx_total`, `gamx_s`, `gamx_j`) to `owlcms_meet_results`.
  - Added Q-Scores suite (`qpoints`, `q_masters`, `q_youth`).
  - Added demographic context columns (`gender`, `birth_year`, `competition_age`) to drive calculations without joins.
  - Added attempt performance counters (`snatch_successful_attempts`, `cj_successful_attempts`, `total_successful_attempts`).
  - Added clutch recovery metrics (`bounce_back_snatch_2..3`, `bounce_back_cj_2..3`).
  - Added career Year-To-Date progression (`best_snatch_ytd`, `best_cj_ytd`, `best_total_ytd`).
  - Added automatic calculation trigger `calculate_owlcms_analytics()` and backfill logic.

## [Added] - 2026-09-12 (Eastern Time)

- **OWLCMS JSONv2 Ingestion Engine (`scripts/production/owlcms-importer.js`)**:
  - Implemented end-to-end parser and database importer for `owlcms` JSON Version 2 (`CompetitionDataV2`).
  - Added meet metadata normalization into `owlcms_meets`, preserving full competition configuration in `raw_payload`.
  - Added UTF-8 accent-preserving lifter profile insertion into `owlcms_lifters` with homonym isolation.
  - Implemented the Single Platform Appearance rule into `owlcms_meet_results`, mapping signed attempt values (+make, -miss), attempt timestamps, and all multi-championship standings into `participations` JSONB.
  - Added CLI runner (`npm run import:owlcms <file> [--dry-run]`).

- **OWLCMS Standalone Web Uploader (`scripts/production/owlcms-upload-server.js` & `public/owlcms-uploader.html`)**:
  - Built Express web server and drag-and-drop web UI on port 8890 (`npm run uploader`).
  - Added client-side format validation, metadata preview (dates, venue, lifter count), and real-time upload progress reporting.
  - Implemented `POST /api/upload-owlcms` ingestion endpoint.

- **Next.js 15 Integration Package (`docs/OWLCMS_FRONTEND_INTEGRATION.md`)**:
  - Created drop-in React 19/TypeScript component (`OwlcmsUploader.tsx`) and Next.js 15 API Route (`app/api/owlcms/upload/route.ts`) for the production frontend (`weightlifting-db`).
