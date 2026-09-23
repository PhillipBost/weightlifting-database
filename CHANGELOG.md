# Changelog

All notable changes to the Weightlifting Database project will be documented in this file.

## [Fixed] - 2026-09-22 (Eastern Time)

- **Affiliations-Aware Parent Filter for Cascade Options — Ecuador Missing Under the Pan American Weightlifting Federation (PAWF) (`migrations/create_federation_cascade_rpcs.sql` — re-generate `list_federation_options` with the affiliations-aware parent filter; generated, NOT yet applied since this fix; run manually per project protocol, then `migrations/verify-federation-cascade-rpcs.sql` blocks 10–11)**:
  - Root cause (frontend report, confirmed): all 198 National Governing Bodies (NGBs) carry `parent_federation_id = NULL` — their dual membership (Edge: `international_member` to the International Weightlifting Federation (IWF); Edge: `continental_member` to their confederation) lives exclusively in `public.federation_affiliations`. The deployed `list_federation_options` filtered parents with `f.parent_federation_id = p_parent_id` only, so `level=national&parent_id=<PAWF>` returned 0 rows (Ecuador and all 39 sibling members absent).
  - Fix in the Remote Procedure Call (RPC): the parent predicate now also accepts an `EXISTS` on an active, Point-in-Time (PIT)-filtered `federation_affiliations` edge (`fa.child_id = f.id AND fa.parent_id = p_parent_id`, null-tolerant `effective_start`/`effective_end` against `v_target`). Applied at every level, not just `national` — the legacy column remains a fast-path only.
  - Parity fix in the HTTP path (`scripts/production/federation-lookup.js` `listFederationOptions`): the PostgREST query no longer hard-filters `.eq('parent_federation_id', …)`; it unions legacy-column children with edge `child_id`s (`is_active`, PIT-window filtered) before display-name enrichment, keeping `GET /api/federations/options` field-for-field equivalent to the RPC.
  - `docs/GEOGRAPHY_ORGANIZER_CASCADE_API.md` §2 `parent_id` row and §8.1 updated to document the affiliations-aware semantics.
  - Verification additions: `migrations/verify-federation-cascade-rpcs.sql` blocks 10–11 assert PAWF national options = active PAWF `continental_member` edge count (40) with Ecuador present, with and without a PIT date.
  - First manual run (2026-09-22): counts confirmed 40/40/40 — the affiliations-aware filter is deployed and correct; both `has_ecuador` assertions returned `false` and block 2 returned 0 rows due to faulty test predicates, now corrected: Ecuador's canonical name is Spanish (`Federación Ecuatoriana de Levantamiento de Pesas`, so `LIKE '%ecuador%'` never matches — presence now checked via `short_code = 'ECU'` / exact alias `'ecuador'`), and `information_schema.role_routine_grants` stores the bare routine name in `routine_name`, not `specific_name` (which holds the internal signature string).

## [Fixed] - 2026-09-22 (Eastern Time)

- **Recognised-Autonomy Model: Continental Confederations Are Not Subordinate to the International Weightlifting Federation (IWF) (`migrations/remove-continental-confederation-parent-edges-2026-09-22.sql` — applied manually 2026-09-22 after review, per project protocol; verified `0` remaining edges, 5 Continentals at `0` outgoing, Fédération d'haltérophilie du Québec (FHQ) exactly 3 rows with no depth-3 hop)**:
  - Removes the 5 `continental_confederation -> International Weightlifting Federation (IWF)` edges (Asian Weightlifting Federation (AWF), European Weightlifting Federation (EWF), Oceania Weightlifting Federation (OWF), Pan American Weightlifting Federation (PAWF), Weightlifting Federation of Africa (WFA)) that mis-modeled autonomous recognition as subordination. Continentals become roots alongside the International Weightlifting Federation (IWF); National Governing Bodies (NGBs) keep dual direct membership (`international_member` + `continental_member`).
  - A hop in `public.federation_affiliations` now means "affiliated with / recognised by", never "subordinate to", unless the edge type is explicitly hierarchical (e.g. `regional_subdivision`).
  - `scripts/production/seed-vetted-baseline.js` no longer seeds these edges (re-seeding cannot resurrect them); wording updated in `scripts/production/federation-lookup.js`, `docs/GEOGRAPHY_ORGANIZER_CASCADE_API.md` (§3, §8.2), and `migrations/create_federation_cascade_rpcs.sql`.
  - Supersedes `migrations/verify-affiliation-verification-2026-09-21.sql` §4 (expected `IWF continental_confederation=5`, now `0`).
  - Read-only verification companion: `migrations/verify-remove-continental-confederation-edges-2026-09-22.sql` (zero remaining edges, continental root status, Weightlifting Canada Haltérophilie (WCH) dual membership, Fédération d'haltérophilie du Québec (FHQ) exactly 3 rows with no depth-3 hop).

## [Added] - 2026-09-22 (Eastern Time)

- **Federation Cascade Supabase RPCs (`migrations/create_federation_cascade_rpcs.sql` — applied manually 2026-09-22 after review, per project protocol; verified via the read-only companion script: functions exist, counts match, parent/PIT/pagination pass, P0002 error path confirmed)**:
  - `public.list_federation_options(p_level, p_parent_id, p_query, p_as_of_date, p_limit, p_offset)` — Point-in-Time (PIT)-filtered cascade option lists (level- and parent-constrained, explicit `total_count`, clamped pagination 1–200, JSONB `display_names`) so direct service-role callers (the owanalytics.org frontend gateway) can use `supabase.rpc()` instead of proxying through the port-8890 upload server.
  - `public.get_federation_lineage(p_entity_id, p_as_of_date)` — recursive multi-parent lineage walk over `federation_affiliations` (depth cap 6, cycle-guarded, PIT edge filtering, `is_root` flag); unknown id raises `P0002`, absent affiliations return an empty set.
  - `EXECUTE` granted to `anon, authenticated, service_role`, mirroring the deployed `search_federations` convention. The HTTP routes on the upload server remain for the importer's own pipeline; the RPC surface, the client-side resolve recipe over `search_federations`, and PostgREST fallback patterns are documented in `docs/GEOGRAPHY_ORGANIZER_CASCADE_API.md` §8.
  - Read-only verification companion: `migrations/verify-federation-cascade-rpcs.sql`.


## [Added] - 2026-09-21 (Eastern Time)

- **Geographic/Organizer Cascade & Competition-Scope Backend Support (`migrations/add_owlcms_geography_organizer_scope.sql` — applied manually 2026-09-21 after review, per project protocol; verified via the read-only companion script)**:
  - Adds `venue`, `host_country_code`, `organizer_federation_id`, `competition_scope` (check-constrained to international/continental/national/regional/local/unknown), `scope_evidence`, `geography_inference`, and `uploader_selections` columns to `public.owlcms_meets` so host geography, organizer identity, and competition scope stop being conflated with the legacy free-text `country`/`organizer` columns.
  - Creates `public.owlcms_meet_teams` (team_code, team_name, team_kind: delegation/subdivision/club/unknown, raw JSONB) with a NULL-tolerant deduplication unique index, moving per-competition team/delegation representation off the permanent `owlcms_lifters.club_name` column.
  - Applies the deployed `owlcms_grants.sql` access pattern: Row Level Security (RLS) enabled, public read policy, service-role-only writes. Historical rows are left NULL — no backfill, and no federation registry rows are seeded.
  - Ships a read-only companion verification script (`migrations/verify-owlcms-geography-organizer-scope.sql`).
- **Venue/Country Conflation Fix (`scripts/production/owlcms-importer.js`)**:
  - `competition.competitionSite` (verified venue free-text: school names, street addresses, sometimes a city) is now stored in `owlcms_meets.venue` and can never land in `country`. Verified previously: 4/4 deployed meet rows held venue strings in `country`.
  - Organizer resolution is now SEARCH-ONLY with explicit statuses (`no_match | unique | ambiguous | lookup_failed`); unmatched club organizers are recorded as evidence and never auto-inserted into the registry (no pre-seeding). Adoption requires exact-tier matches (match_rank >= 90).
  - `competition_scope` is derived conservatively from the sanctioning federation's registry level only; deduplicated `(recordFederation, recordName)` record sets and team analysis are stored as corroboration in `scope_evidence` and never upgrade the scope. Club team names never prove a local event.
  - Per-meet teams are captured (JSONv2 `teams[]` by code, legacy `athlete.team` strings), with `team_kind = 'delegation'` assigned only to unambiguous 3-letter uppercase codes.
  - Dry-run mode is now strictly read-only: federation resolution (which can auto-discover registry rows) is skipped during dry-runs.
  - New inference helpers (`extractMeetTeams`, `extractRecordEvidence`, `inferCompetitionScope`, `classifyTeamKind`, `summarizeCandidates`, `classifyCandidates`) are exported for testability.
- **Federation Cascade Lookup API (`scripts/production/federation-lookup.js` + `scripts/production/owlcms-upload-server.js`)**:
  - `GET /api/federations/options` — PIT-filtered, parent-constrained option lists with explicit `total_count`/`has_more` pagination (fixes the hard `LIMIT 10` silent truncation of `search_federations`).
  - `GET /api/federations/lineage/:id` — full multi-parent lineage walk over affiliation edges with `as_of_date` Point-in-Time (PIT) filtering (the governance route lacks date filtering).
  - `POST /api/federations/resolve` — batch search-only resolution (organizer, federation, host country, deduplicated record federations, team names) with explicit `no_match | unique | ambiguous | missing_in_source` statuses and evidence.
  - `POST /api/upload-owlcms` accepts an optional `uploaderSelections` object persisted to `owlcms_meets.uploader_selections`, keeping uploader-confirmed selections permanently distinguishable from server inference.
  - Full contract documented in `docs/GEOGRAPHY_ORGANIZER_CASCADE_API.md` (includes the collaborator-website security model: application API only; anon-key database reads are RLS-blocked).

## [Added] - 2026-09-20 (Eastern Time)

- **Canadian Provinces & Territories Living Registry (`scripts/production/seed-vetted-canadian-provinces.js`)**:
  - Populated all 13 Canadian regional bodies under Weightlifting Canada Haltérophilie (WCH) with `short_code = NULL` (maintaining parity with USAW WSOs) and `level = 'regional_state_wso'`.
  - Enriched existing Fédération d'haltérophilie du Québec (FHQ) record with official websites, bilingual aliases (`Québec`, `Quebec`), and two-letter code `QC`.
  - Mapped verified corporate names and domains for 9 incorporated Provincial Associations, while registering Yukon and the non-corporate jurisdictions (Northwest Territories, Nunavut, Prince Edward Island) sourced from the Weightlifting Canada Haltérophilie Athletes' Council.
  - Linked all 13 entities via `public.federation_affiliations` with `relationship_type = 'regional_subdivision'`.

## [Fixed] - 2026-09-20 (Eastern Time)

- **USA Weightlifting (USAW) Daily Meet Scraper (`scripts/production/meet_scraper.js`)**:
  - Hardened `setResultsPerPage` against timing race conditions on GitHub Actions (GHA) virtual machine runners by adding explicit `waitForSelector` guards on dropdown triggers and menu items.
  - Added non-blocking error handling and fallback so timing delays log a warning and proceed with default pagination rather than terminating the daily ingestion pipeline.
- **Federation Search RPC Ranking & Short Query Substring Guard (`migrations/fix_search_federations_ranking.sql`)**:
  - Resolved an ordering defect in `public.search_federations` where PostgreSQL `DISTINCT ON (c.id)` emitted candidate results ordered by Universally Unique Identifier (UUID) alphanumeric string value rather than `match_rank DESC`.
  - Wrapped deduplicated candidates in an outer query explicitly sorted by `match_rank DESC, is_temporally_exact DESC, is_verified DESC, canonical_name ASC`.
  - Added a character-length guard on substring matching (`length(trim(query_text)) >= 3`) to prevent two-letter queries (e.g. `AB`, `ON`, `SK`, `NS`) from matching inside unrelated words like "Association" or "Federation".

## [Added] - 2026-09-19 (Eastern Time)

- **Longitudinal Living Federation Registry (`migrations/create_longitudinal_federation_registry.sql`)**:
  - Restructured federation governance into a multi-table temporal model: `public.federation_registry`, `public.federation_localizations`, `public.federation_affiliations`, and `public.federation_headquarters`.
  - Added temporal boundaries (`valid_from`, `valid_until`), `name_type`, and mandatory `citation` references to `federation_localizations`.
  - Added headquarters relocation tracking (`public.federation_headquarters`) for historical administrative seats.
  - Implemented Point-in-Time ranked search RPC `public.search_federations(query_text TEXT, as_of_date DATE DEFAULT CURRENT_DATE)` prioritizing names and acronyms actively valid on competition dates (Rank 100 temporally exact vs. Rank 85 historical match).
  - Seeded vetted baseline: Apex International (IWF with historical French names `FIH`, `FIHC`, `FHI` and Budapest → Lausanne relocation history) + 5 Continental Confederations (PAWF, EWF, AWF, WFA, OWF) with bidirectional affiliation edges (`scripts/production/seed-vetted-baseline.js`).
  - Seeded vetted National Governing Bodies (Batch 2): USA Weightlifting (`USAW` with historical `USWF` and dual IWF + PAWF governance), Weightlifting Canada Haltérophilie (`WCH` with historical `CWFHC` and dual IWF + PAWF governance), and Fédération d'haltérophilie du Québec (`FHQ` under WCH) (`scripts/production/seed-vetted-batch2.js`).
  - Linked active owlcms meets (Meet 1 → WCH, Meets 2 & 3 → FHQ).

## [Added] - 2026-09-18 (Eastern Time)

- **Admin Review Queue & Daily Pipeline Integration (`public.admin_review_queue`)**:
  - Established unified PostgreSQL table `public.admin_review_queue` spanning all four data quality and identity resolution streams: `cross_federation`, `homonym_split`, `name_change_merge`, and `iwf_duplicate`.
  - Created [`scripts/production/populate-admin-review-queue.js`](file:///c:/Users/PB/Desktop/Bost%20Laboratory%20Services/Weightlifting/weightlifting-database/scripts/production/populate-admin-review-queue.js) to stage baseline historical candidates: 1,103 homonym splits, 169 USAW name change merges, and 14 IWF duplicate records.
  - Created [`scripts/production/scan-usaw-name-changes.js`](file:///c:/Users/PB/Desktop/Bost%20Laboratory%20Services/Weightlifting/weightlifting-database/scripts/production/scan-usaw-name-changes.js) to detect shared USAW membership numbers across differing surnames.
  - Wired Step 8 into [`scripts/maintenance/daily_scraper.js`](file:///c:/Users/PB/Desktop/Bost%20Laboratory%20Services/Weightlifting/weightlifting-database/scripts/maintenance/daily_scraper.js) to automatically run the name change scan during the daily USAW scrape.
  - Updated [`scripts/analysis/contamination-cleanup-master.js`](file:///c:/Users/PB/Desktop/Bost%20Laboratory%20Services/Weightlifting/weightlifting-database/scripts/analysis/contamination-cleanup-master.js) to automatically stage newly identified homonym collisions directly into `public.admin_review_queue` during daily 4:00 AM EST runs.
  - Updated [`scripts/production/link-new-iwf-athletes.js`](file:///c:/Users/PB/Desktop/Bost%20Laboratory%20Services/Weightlifting/weightlifting-database/scripts/production/link-new-iwf-athletes.js) to capture ambiguous IWF ↔ USAW and IWF ↔ OWLCMS candidates and stage them into `public.admin_review_queue` with deduplication during daily 5:00 PM EST runs.

- **Living Federation & Regional Registry (`migrations/create_federation_registry.sql`)**:
  - Created `public.federation_registry` table with hierarchical parent-child relationships (`parent_federation_id`), ISO-3 country codes, level classifications (`international`, `continental`, `national`, `regional_state_wso`, `club`), and GIN-indexed `known_aliases` array.
  - Implemented ranked search RPC `public.search_federations(query_text TEXT)` returning weighted matches (Rank 100 exact alias, Rank 90 short code, Rank 80 canonical name, Rank 70 alias substring).
  - Added foreign key column `federation_id UUID REFERENCES public.federation_registry(id) ON DELETE SET NULL` to `public.owlcms_meets`.

- **Governing Body Seeding & USAW WSO Migration (`scripts/production/seed-federation-registry.js`)**:
  - Migrated all 26 existing USAW WSOs from `usaw_wso_information` into `federation_registry` under USAW.
  - Seeded Canada (Weightlifting Canada Haltérophilie / WCH) + 10 provincial associations (OWA, FHQ, BCWA, etc.).
  - Seeded Brazil (CBLP) + 7 state federations (FELP / São Paulo, FEPERJ / Rio de Janeiro, etc.).
  - Seeded international/continental bodies (IWF, PAWF, EWF) and Latin American NGBs (Colombia, Mexico, Ecuador, Venezuela, Peru).

- **Federation Auto-Discovery & Importer Integration (`scripts/production/federation-resolver.js` & `scripts/production/owlcms-importer.js`)**:
  - Added resolution utility supporting high-confidence matching and non-destructive auto-discovery (`is_verified = false`) for unseen bodies to guarantee zero upload failures.
  - Integrated canonical federation resolution into `owlcms-importer.js` to link uploaded meets directly to their canonical governing body.

## [Added] - 2026-09-16 (Eastern Time)

- **Full Symmetrical Identity Pairing Pipelines (`USAW ↔ OWLCMS` and `IWF ↔ OWLCMS`)**:
  - Built `scripts/production/link-new-usaw-athletes.js` to cross-reference newly ingested/scraped USAW lifters against existing OWLCMS lifters under strict universal demographic anchoring `(gender, birth_year)`.
  - Added Step 6c & Step 7 to `scripts/maintenance/daily_scraper.js` to automatically reconcile newly scraped USAW meets against OWLCMS athlete profiles.
  - Implemented Phase 3 (`IWF ↔ OWLCMS`) in `scripts/production/link-new-iwf-athletes.js` and `scripts/maintenance/link_iwf_usaw_athletes.js` to evaluate incoming IWF athletes against OWLCMS lifters.
  - Enforced pairwise alias integrity (`check_alias_type = 2`) and automated static shard generation (`assembler.js`) across all new cross-federation links.

## [Fixed] - 2026-09-16 (Eastern Time)


- **Universal Demographic Candidate Retrieval for USAW (`scripts/production/link-new-owlcms-athletes.js`)**:
  - Replaced unanchored `lastName`-only query with strict demographic gate `(gender, birth_year, lastName)` on `usaw_meet_results`.
  - Eliminated arbitrary `.limit(10)` truncation that previously discarded valid candidates sharing common American surnames (e.g. Jones, Smith).
  - Brought USAW candidate discovery into 100% architectural symmetry with IWF candidate retrieval.

- **Multi-Federation Peer Parity & Graph Enrichment (`scripts/production/link-new-owlcms-athletes.js`)**:
  - Eliminated single-destination routing and mutual erasure logic (`iwf_db_lifter_id: resolvedUsawId ? null : resolvedIwfId`).
  - Decoupled candidate discovery into independent USAW and IWF evaluation loops so that dual-federation athletes (competing both in USAW domestic and IWF international circuits) link to both profiles simultaneously.
  - Refactored candidate filter to allow re-evaluation and graph enrichment across already-linked athletes.
  - Refactored alias persistence to insert distinct pairwise edges (strictly enforcing PostgreSQL `check_alias_type = 2`) for dual-federation athletes (`USAW ── OWLCMS` and `IWF ── OWLCMS`) rather than invalid 3-way rows.


## [Fixed] - 2026-09-15 (Eastern Time)

- **OWLCMS Daemon Signal Listener Reconnect Leak (`scripts/production/owlcms-event-daemon.js`)**:
  - Moved `process.on('SIGINT')` and `process.on('SIGTERM')` listeners and graceful shutdown handlers to top-level scope.
  - Eliminated `MaxListenersExceededWarning` during automated PostgreSQL reconnect loops.

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
