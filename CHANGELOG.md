# Changelog

All notable changes to the Weightlifting Database project will be documented in this file.

## [Fixed] - 2026-11-09 (Eastern Standard Time)

- **Preservation of Creation Timestamps on Meet, Location & Result Updates (`scripts/production/iwf-meet-manager.js`, `scripts/production/iwf-results-importer.js`)**:
  - Fixed `upsertIWFMeet()` and `upsertIWFMeetLocation()` in `scripts/production/iwf-meet-manager.js` to omit `created_at` from the upsert payload when updating an existing competition or venue location, preventing PostgreSQL `ON CONFLICT (iwf_meet_id) DO UPDATE SET` clauses from overwriting historical creation timestamps with the current execution time.
  - Omitted `created_at` from `updatePayload` in `insertResultRecord()` (`scripts/production/iwf-results-importer.js`), ensuring that re-scrapes or targeted single-athlete updates in `public.iwf_meet_results` preserve their original insertion timestamps while updating `updated_at`.
  - Preserved existing database values on updates so partial re-scrapes do not replace existing non-null venue coordinates or names with null.

- **Dynamic Competition Metadata Discovery & Single-Event On-Demand Ingestion (`scripts/production/iwf-results-scraper.js`, `scripts/production/iwf-database-importer.js`)**:
  - Implemented `discoverEventCardMetadata()` in `scripts/production/iwf-results-scraper.js` to query the annual competition listing page and extract authentic competition titles, dates, and venue locations (`city`, `country`) from event cards whenever on-disk annual discovery caches (`output/iwf_events_YYYY.json`) are absent, automatically persisting newly discovered events to disk.
  - Extracted competition headings directly from the page Document Object Model (DOM) (`.title__filters h2`, `.title__event h2`) during results scraping.
  - Eliminated synthetic placeholder date injection (`YYYY-01-01`) in `scripts/production/iwf-database-importer.js`, synchronizing authentic competition metadata and dates discovered during scraping into `meetMetadata` before invoking meet and location upserts.

- **IWF Modern Era Endpoint Resolution & Direct `--url` Pipeline Navigation (`scripts/production/iwf-config.js`, `scripts/production/iwf-database-importer.js`, `scripts/production/iwf-results-scraper.js`, `weightlifting-frontend/app/api/admin/iwf-upload/route.ts`)**:
  - Corrected `URLS.MODERN` in `scripts/production/iwf-config.js` to target the official `results-by-events-2025-2026/` sub-path instead of the generic search landing page (`results-by-events/`), preventing Puppeteer scrapers from landing on search forms where competition result tabs are absent.
  - Added direct `--url <url>` parameter support across `scripts/production/iwf-database-importer.js` and `scripts/production/iwf-results-scraper.js`, ensuring that when an administrator inputs a full event URL, the scraper navigates directly to that exact URL rather than reconstructing or altering endpoint paths.
  - Updated frontend admin upload API route (`weightlifting-frontend/app/api/admin/iwf-upload/route.ts`) to forward `--url` when a full HTTP URL is entered into the dashboard.

## [Added] - 2026-11-09 (Eastern Standard Time)

- **Persistent Cross-Federation Meet Aliases & Verbose Linker Telemetry (`scripts/production/link-new-iwf-athletes.js`)**:
  - Integrated `scripts/production/link-new-iwf-athletes.js` with `public.meet_aliases` to resolve and persist cross-federation competition pairings across International Weightlifting Federation (IWF) and USA Weightlifting (USAW), querying persistent meet relationships prior to evaluating heuristics or manual code maps.
  - Automatically writes newly discovered and verified meet pairings to `public.meet_aliases` to ensure competition cross-references persist for bidirectional frontend navigation.
  - Upgraded linker console logging to explicitly output every recently updated IWF competition (ID, title, date), every established meet pairing with provenance tag, and the names, federation identifiers, and confidence scores for each athlete alias inserted into `public.athlete_aliases`.

- **Automated Post-Import Duplicate Audit & Idempotent Queue Staging (`scripts/production/iwf-database-importer.js`)**:
  - Implemented `auditMeetDuplicates(dbMeetId, meetName, iwfMeetId)` in `scripts/production/iwf-database-importer.js`, executing an automated database audit immediately following meet results ingestion in `importEventToDatabase()`.
  - Audits `public.iwf_meet_results` for the ingested competition to detect any athlete recorded under multiple distinct bodyweight classes (`count(DISTINCT weight_class) > 1`), automatically staging new anomaly review items into `public.admin_review_queue` with category `iwf_duplicate`.
  - Integrates with database-enforced idempotency (`uq_admin_review_iwf_duplicate_pending`) to safely handle repeat imports without creating duplicate tickets, permanently eliminating reliance on static catalog seeder files (`DUPLICATE_DATA_CORRECTION.json`).
  - Exported `auditMeetDuplicates` in `module.exports` for programmatic and maintenance execution.

## [Changed] - 2026-11-08 (Eastern Standard Time)

- **Strict Canonical IWF Shard Identification & Surrogate Key Isolation (`scripts/production/assembler.js`)**:
  - Enforced strict primary-source indexing in `id_collector` by requiring `iwf_lifter_id NOT NULL` and eliminating the `COALESCE(iwf_lifter_id, db_lifter_id)` fallback for International Weightlifting Federation (IWF) static shards, guaranteeing internal database serial surrogate keys (`public.iwf_lifters.db_lifter_id`) never pollute the public `/iwf/` shard storage directory or cause future identifier namespace collisions.
  - Canonicalized the root `data.id` property in `generateAthlete()` to resolve strictly to `row.prime_iwf_official_id` when assembling IWF profiles, and explicitly exposed `iwf_lifter_id` and `db_lifter_id` at the root of the assembled athlete payload.
  - Joined `public.iwf_lifters` in `iwf_results_agg` to inject both `iwf_lifter_id` and `db_lifter_id` onto each competition result scorecard item in `data.iwf_results`, ensuring downstream frontend components (meet tables, personal best adapters, and charts) link exclusively to canonical federation numbers.

## [Added] - 2026-11-08 (Eastern Standard Time)

- **High-Fidelity Dry-Run Simulation, Skip Enforcement & Split Action Telemetry (`scripts/production/iwf-database-importer.js`)**:
  - Enforced real-world non-forced skip behavior in `--dry-run` mode when `!options.force`: if the competition already has results in `public.iwf_meet_results`, the importer emits a skip advisory log and returns `wouldSkip: true`, `skipReason`, and 0 simulated mutations without executing unnecessary web scraping.
  - Implemented scorecard simulation evaluation in `--dry-run` mode comparing scraped weight classes and athlete names against existing `public.iwf_meet_results` rows: scorecards are categorized as `UPDATE` (with field-level diff detection across attempts and totals), `INSERT` (for missing scorecards, preserving multi-category additions like Robert Hawkins in 85 kg), or `LOCKED_SKIP` (for scorecards protected by `manual_override = true`).
  - Added `simulatedUpdates`, `simulatedInserts`, `simulatedLocked`, `simulatedAction`, `existingResultId`, and `diffFields` to `summary.importStats` and `###TARGET_ATHLETE_JSON###`.

- **Multi-Category Athlete Parser Keying, Targeted Dry-Run Scorecard Validation & Canonical `iwf_meet_id` Summary Output (`scripts/production/iwf-results-scraper.js`, `scripts/production/iwf-database-importer.js`)**:
  - Scoped athlete keys by weight class (`${name}-${nation}-${birthYear}-${weight_class}`) and broadened weight class header detection (`<h2>` and `<h3>`) in `parseAttemptHTML()` (`scripts/production/iwf-results-scraper.js`) to preserve multi-category athletes competing across distinct bodyweight classes in the same meet (such as Robert Hawkins in 77 kg and 85 kg at the 2000 Junior World Championships, Event #154).
  - Enhanced `--dry-run` mode in `scripts/production/iwf-database-importer.js` to execute in-memory `--athlete-name` filtering, printing a full scorecard breakdown (Snatch 1–3, Clean & Jerk 1–3, Total, Rank, Weight Class, Bodyweight, Nation, and Year of Birth) when matched (`athleteFound: true`) or listing close candidate matches when absent (`athleteFound: false`), and bypassing the pre-scrape skip check on existing meets during dry runs.
  - Added formatted `###TARGET_ATHLETE_JSON###` tagged block to standard output (`stdout`) and aligned `summary.importStats` properties (`athleteName`, `athleteFound`, `targetAthlete`, `targetAthletes`, `matchedScorecards`, `iwf_meet_id`) for frontend preview ingestion.
  - Standardized all summary return objects and structured `__IWF_SUMMARY_JSON__` standard output (`stdout`) payloads in `scripts/production/iwf-database-importer.js` to explicitly expose canonical `iwf_meet_id` at the root and in `importStats`.
  - Implemented `parseIwfEventHtml()` in `scripts/production/iwf-results-scraper.js` and `--html-file` / `--meet-name` Command Line Interface (CLI) options in `scripts/production/iwf-database-importer.js`.

## [Fixed] - 2026-11-07 (Eastern Time)

- **Outbox Queue Deletion Microsecond Precision Fix (`scripts/production/listener.js`, `scripts/production/owlcms-event-daemon.js`)**:
  - Keyed queue deletions strictly on composite primary key `(federation, entity_id)` in `public.athlete_shard_queue`.
  - Eliminated microsecond-to-millisecond truncation mismatch where JavaScript `Date` serialization caused `enqueued_at <= $3` inequality filters to evaluate to `false`, which previously prevented processed athletes from being deleted and trapped both background shard daemons in an unthrottled 100% CPU loop.

- **Headless Stealth Browser Configuration, Total Lift Parsing & Virtual Display Execution (`scripts/production/iwf-config.js`, `scripts/production/iwf-results-scraper.js`, `.github/workflows/iwf-daily-results-pipeline.yml`)**:
  - Configured Puppeteer launch arguments in `iwf-config.js` with `--disable-blink-features=AutomationControlled`, `--disable-features=IsolateOrigins,site-per-process`, and 1080p desktop viewport dimensions.
  - Injected `evaluateOnNewDocument()` overrides in `iwf-results-scraper.js` to suppress `navigator.webdriver` and mock standard `window.chrome`, `navigator.plugins`, and `navigator.languages` to evade automated bot detection heuristics.
  - Added X Virtual Framebuffer (Xvfb) execution (`xvfb-run --auto-servernum`) to `.github/workflows/iwf-daily-results-pipeline.yml` so Chromium runs as a full Graphical User Interface (GUI) desktop browser on Ubuntu runners.
  - Implemented an automated post-verification redirect drain in `iwf-results-scraper.js` that detects Cloudflare's `"Verification successful"` signal and waits for the final page redirect to complete before evaluating results tabs.
  - Added `permissions: { contents: read, issues: write }` to `.github/workflows/iwf-daily-results-pipeline.yml` to authorize failure issue creation.
  - Fixed `parseAttemptHTML()` in `iwf-results-scraper.js` to recognize the `'total'` lift section, extracting official competition ranks and totals while preventing Total cards from overwriting Clean & Jerk attempt fields.

- **Scraper Tab Diagnostics & Output Artifact Upload (`scripts/production/iwf-results-scraper.js`, `.github/workflows/iwf-daily-results-pipeline.yml`)**:
  - Enhanced `clickMensTab()` in `iwf-results-scraper.js` to log all discovered clickable DOM candidate elements, page title, and body text snippets upon selector failure, and saved full HTML page snapshots to `output/event_${eventId}_page.html`.
  - Added `output/` to the failure artifact upload in `.github/workflows/iwf-daily-results-pipeline.yml` to preserve diagnostic screenshots and HTML snapshots across runs.

- **Administrative Repair Protection, Scraper Failure Propagation & Clean Navigation (`scripts/production/iwf-database-importer.js`, `scripts/production/iwf-results-scraper.js`, `scripts/production/iwf-results-importer.js`, `scripts/production/assembler.js`, `scripts/production/populate-admin-review-queue.js`)**:
  - Propagated execution exit codes in `iwf-database-importer.js` so failed scrapes and event imports throw errors and exit with code `1`, preventing GitHub Actions runs from masking failures as successful completions.
  - Replaced custom HTTP cache-busting headers (`page.setExtraHTTPHeaders`) with Puppeteer native `page.setCacheEnabled(false)` in `iwf-results-scraper.js` to eliminate Cross-Origin Resource Sharing (CORS) header rejections on third-party security verification scripts while logging page titles upon navigation.
  - Implemented `manual_override = true` lock protection in `iwf-results-importer.js` (`insertResultRecord()`) to ensure administrator-repaired scorecards are never overwritten during `--force` re-scrapes, and added pre-insert duplicate checks to protect split scorecards from being re-created under donor athletes.
  - Added fallback static shard keying in `assembler.js` using `COALESCE(iwf_lifter_id, db_lifter_id)` so newly provisioned international athletes lacking official registry identifiers receive valid static shards.
  - Added queue deduplication in `populate-admin-review-queue.js` (`ingestIwfDuplicates()`) querying `public.admin_review_queue` across all statuses (`PENDING`, `APPROVED`, `RESOLVED`, `REJECTED`) to avoid re-staging resolved items.

- **Multi-Category Same-Meet Result Preservation & Targeted Workflow Dispatch (`scripts/production/iwf-results-importer.js`, `scripts/production/iwf-database-importer.js`, `scripts/production/iwf-results-scraper.js`, `.github/workflows/iwf-daily-results-pipeline.yml`)**:
  - Fixed conflict detection in `insertResultRecord()` by including `weight_class` in composite key matching, ensuring athletes officially competing across multiple weight classes in the same meet (e.g., Robert Hawkins in 77 kg and 85 kg at the 2000 Junior World Championships, Event #154) are preserved as distinct scorecards rather than overwriting existing records.
  - Added `--athlete-name` filtering and preserved existing meet metadata fallbacks in `iwf-database-importer.js` and `iwf-results-importer.js`.
  - Added fallback resolution for local Google Chrome binaries in `iwf-results-scraper.js`.
  - Enhanced GitHub Actions workflow `iwf-daily-results-pipeline.yml` with `workflow_dispatch` inputs for `event_id`, `force`, and `athlete_name` to allow targeted competition and athlete re-scraping directly from GitHub Actions.

## [Added] - 2026-11-06 (Eastern Time)

- **Unified Shard Daemon & PostgreSQL Outbox Listener (`scripts/production/listener.js`)**:
  - Embedded real-time PostgreSQL `LISTEN athlete_shard_event` notification listener and atomic `public.athlete_shard_queue` outbox drainer directly into `listener.js`.
  - Enabled instantaneous, automatic static shard compilation on disk upon any database `INSERT`, `UPDATE`, or `DELETE` across athletes, scorecards, rankings, and aliases with 1500ms debouncing, while preserving the Transmission Control Protocol (TCP) Port 8889 Hypertext Transfer Protocol (HTTP) webhook endpoint.

- **Tri-Category Member Collision Partitioning & Shard Data Hygiene Guards (`scripts/production/assembler.js`, `scripts/production/scan-usaw-name-changes.js`, `scripts/production/populate-admin-review-queue.js`)**:
  - Implemented three-way partitioning of member collisions in `scan-usaw-name-changes.js` and `populate-admin-review-queue.js`:
    1. `duplicate_profile`: Accounts sharing identical member numbers and names (e.g. Member #1076819) with `display_former_name: false`.
    2. `data_hygiene_typo`: Email placeholders (e.g. Member #1088642), numeric strings, or minor clerical surname typos (e.g. Member #1084623, `Darius Castllo` vs `Castillo`) with `display_former_name: false`.
    3. `name_change_merge`: Authentic surname amendments and aliases (e.g. Member #1030146, `Angelica Romero` → `Truett`) defaulting to `display_former_name: true`.
  - Added shared hygiene and clerical typo detection (`isMinorClericalTypo`, `isDataDefectString`, `levenshteinDistance`, `isAdjacentTransposition`) across the pipeline.
  - Guarded `historical_names` aggregation in `assembler.js` to skip defect strings and minor typos on historical scorecards so public profiles do not advertise scraper/data entry errors as former names.

- **Historical Name Transition Timeline & Static Shard Delivery (`scripts/production/assembler.js`, `scripts/production/scan-usaw-name-changes.js`, `scripts/production/populate-admin-review-queue.js`)**:
  - Enhanced static shard compiler (`assembler.js`) to include `r.lifter_name` in `usaw_results_agg` and dynamically compute `historical_names: [{ name, start_year, end_year, first_seen, last_seen, meet_count }]` in root static athlete shards for all competitions where the scorecard name diverged from the canonical athlete name.
  - Enabled zero-database-overhead frontend rendering of historical name notices (e.g. *"Formerly competed as Angelica Romero (2017–2021)"*) directly from static gzip shards.
  - Enriched name-change review queue staging in `scan-usaw-name-changes.js` and `populate-admin-review-queue.js` by querying `public.usaw_meet_results` for earliest and latest competition dates across candidate lifters and storing `evidence.timeline: { former_name, former_start_year, former_end_year, canonical_name, canonical_start_year, former_meet_count, canonical_meet_count }` for administrative comparison cards.

## [Fixed] - 2026-11-06 (Eastern Time)

- **Comprehensive Sibling Profile Candidate Pool Resolution in Homonym Split Staging (`scripts/production/populate-admin-review-queue.js`)**:
  - Implemented `resolveHomonymCandidates(athleteName)` to query `public.usaw_lifters` by `athlete_name ILIKE ...` with self-draining `.range()` pagination across the entire table, eliminating candidate undercounting and result truncation.
  - Added `reconcileSplitPlanWithSiblings()` to synchronize discovered sibling profiles into `evidence.split_plan.splits`, attaching their existing Primary Key (PK) `lifter_id` values and ensuring previously omitted sibling records (e.g. `lifter_id: 4082`, Member #197954) are fully represented as candidate splits.
  - Reconciled `unidentifiedCompetitions` against candidate `lifter_id`s, automatically reassigning confirmed scorecards (e.g. Meets #224 and #435) to their corresponding candidate splits and purging them from the unidentified pool.
  - Added targeted review item repair capabilities via Command Line Interface (CLI) flags (`--queue-id` and `--athlete-name`).

## [Fixed] - 2026-11-05 (Eastern Time)

- **PostgreSQL Port `5432` External Firewall Hardening on Hetzner Host (`46.62.223.85`)**:
  - Remediated public internet exposure of `supabase-db-zoss8scsow00wsssgkck0g88` (`0.0.0.0:5432` and `[::]:5432`) reported by the German Federal Office for Information Security (*Bundesamt für Sicherheit in der Informationstechnik*, BSI) / Computer Emergency Response Team for Federal Agencies (CERT-Bund) scan from `2026-11-03 09:05:09 AM Eastern Standard Time (EST)`.
  - Inserted persistent `DROP` rules in `DOCKER-USER` and `INPUT` chains across `iptables` (Internet Protocol version 4 (IPv4)) and `ip6tables` (Internet Protocol version 6 (IPv6)) via `netfilter-persistent` (`/etc/iptables/rules.v4` and `/etc/iptables/rules.v6`) restricted strictly to inbound packets on the external Wide Area Network (WAN) interface (`-i eth0 -p tcp --dport 5432 -j DROP`).
  - Preserved uninterrupted internal Docker bridge connectivity (`10.0.1.9 -> 46.62.223.85:5432`) for the containerized Open Weightlifting Competition Management System (OWLCMS) event and static shard daemon (`scripts/production/owlcms-event-daemon.js`).

- **Graceful Handling of Multi-Entity Clusters & Unresolved Collapsed Lifter Identifiers in Homonym Split Engine (`scripts/production/execute-approved-homonym-splits.js`)**:
  - Added resolution for donor/anchor lifters (`evidence.anchor_lifter_id`) when `primary_entity_id <= 0` or when scorecards were historically accumulated under a pre-existing member record (e.g. Person 1 in a scorecard partition).
  - Supported flexible competition schemas accepting both array of numeric meet identifiers (`meets: [413, ...]`, `competitions: [413, ...]`) and detailed objects (`[{ meet_id: 413 }, ...]`).
  - Added short-circuiting for scorecards already attached to the anchor lifter to avoid redundant Database (DB) writes, and enqueued both target and donor lifters to `public.athlete_shard_queue` for static JavaScript Object Notation (JSON) shard rebuilds.

- **Eliminate Cross-Federation False Positives in Static Shard Reconciler (`scripts/production/reconcile-stale-shards.js`)**:
  - Updated `inspectShard()` in deep verification mode (`--deep`) to evaluate result counts strictly against the active scan's federation array (`shardData.usaw_results` for United States of America Weightlifting (USAW), `shardData.iwf_results` for International Weightlifting Federation (IWF), and `shardData.owlcms_results` for Open Weightlifting Competition Management System (OWLCMS)).
  - Prevents athletes with cross-federation alias links from being erroneously flagged with `COUNT_MISMATCH` staleness due to total shard results exceeding single-federation Database (DB) scorecard counts.

## [Added] - 2026-11-05 (Eastern Time)

- **Approved Homonym Split Execution Engine (`scripts/production/execute-approved-homonym-splits.js`)**:
  - Implemented transactional processor for approved review items in `public.admin_review_queue` (`category = 'homonym_split'`, `status = 'APPROVED'`).
  - Provisions distinct Primary Key (PK) records in `public.usaw_lifters` for Persons 1..N based on approved split plans, retaining the collapsed `lifter_id` for Person 1 to preserve historical foreign key stability.
  - Reassigns confirmed scorecards (`splits[i].competitions`) and triaged scorecards (`unidentifiedCompetitions` mapped via `assigned_membership` or `assigned_to`) in `public.usaw_meet_results` to each target athlete.
  - Automatically enqueues all separated `lifter_id`s into `public.athlete_shard_queue` to trigger immediate static JavaScript Object Notation (JSON) shard regeneration.
  - Finalizes queue items to `status = 'RESOLVED'` with an execution summary payload recording reassignments and target identities.

## [Added] - 2026-11-04 (Eastern Time)

- **Universal Multi-Federation Athlete Static Shard Outbox & Event Daemon (`migrations/add_athlete_shard_queue_and_triggers.sql`, `scripts/production/owlcms-event-daemon.js`, `scripts/production/reconcile-stale-shards.js`)**:
  - Implemented transactional PostgreSQL outbox table `public.athlete_shard_queue` with primary key `(federation, entity_id)` to decouple athlete data ingestion from static JavaScript Object Notation (JSON) shard generation.
  - Attached automated row-level and statement-level triggers across all 8 federation tables (`usaw_meet_results`, `usaw_lifters`, `usaw_division_rankings`, `iwf_meet_results`, `iwf_lifters`, `owlcms_meet_results`, `owlcms_lifters`, and `athlete_aliases`), capturing `OLD` and `NEW` entities across inserts, updates, and deletes and publishing `athlete_shard_event` notifications.
  - Upgraded production daemon `scripts/production/owlcms-event-daemon.js` to listen simultaneously on `owlcms_pipeline_event` and `athlete_shard_event`, batch-draining the outbox queue using a persistent PostgreSQL connection pool and generating static compressed shards (`.json.gz`) via `assembler.js`.
  - Created historical reconciliation and catch-up utility `scripts/production/reconcile-stale-shards.js` supporting `--dry-run`, `--compile`, `--deep` (verifying gzip result counts against database aggregates), `--force` (recompiling or enqueuing athletes regardless of timestamp freshness), and verbose single-athlete identity tracking (`--athlete-id=<id>`).

## [Fixed] - 2026-11-04 (Eastern Time)

- **Disambiguate United States of America Weightlifting (USAW) Internal Lifter Identifiers (`lifter_id`) from Membership Numbers (`scripts/production/assembler.js`, `scripts/production/owlcms-event-daemon.js`, `scripts/production/reconcile-stale-shards.js`)**:
  - Resolved numerical Primary Key (PK) collisions where an internal `usaw_lifters.lifter_id` collided with an identical six-digit `membership_number` belonging to a different athlete during background shard compilation.
  - Added dedicated parameter `usaw_lifter_id` to `generateAthlete()` in `scripts/production/assembler.js`, allowing direct internal database identity resolution without ambiguous `membership_number::text = $1 OR lifter_id::text = $1` database queries.
  - Updated outbox queue draining in `scripts/production/owlcms-event-daemon.js` to dispatch `usaw_lifter_id: entity_id` when processing USAW mutations from `public.athlete_shard_queue`.
  - Upgraded `scripts/production/reconcile-stale-shards.js` to check `/var/www/athlete-data/usaw/{shard}/{membership_number}.json.gz` for athletes with valid membership numbers and `/var/www/athlete-data/internal/{shard}/{lifter_id}.json.gz` for unlinked or guest athletes who lack membership numbers, preventing false staleness reports and compiling both public and internal shards accurately.

- **Stale Static Shard Prevention for Unlinked USAW Athletes**:
  - Resolved the systemic issue where United States of America Weightlifting (USAW) athlete mutations (e.g. Denis Couture, USAW Membership Number: `1047936`, internal `lifter_id: 199867`) ingested via GitHub Actions failed to recompile static shards on the Hetzner host because background daemons previously only rebuilt shards for Open Weightlifting Competition Management System (OWLCMS) meets or newly created cross-federation alias links.
  - Dropped defective and inactive webhook trigger `refresh_athlete_json_trigger()` that relied on unconfigured local webhooks.

## [Added] - 2026-11-01 (Eastern Time)

- **Self-Hosted Umami Analytics Deployment & Infrastructure Hardening**:
  - Provisioned self-hosted Umami Analytics (`ghcr.io/umami-software/umami:3.0.3`) paired with an isolated PostgreSQL 16 database container in Coolify on Hetzner host `46.62.223.85`.
  - Configured Traefik reverse proxy routing with automatic Let's Encrypt Transport Layer Security (TLS) certificate generation for `https://analytics.owlanalytics.org`.
  - Remediated root disk saturation (`/dev/sda1` 100% full) by vacuuming system logs and enforcing the 7-day remote backup retention policy across historical database dumps in `/data/coolify/backups/databases/root-team-0`, reclaiming over 20 Gigabytes (GB) of storage.

## [Added] - 2026-10-19 (Eastern Time)

- **Automated Open Weightlifting Competition Management System (OWLCMS) Venue Geocoding & Coordinate Pipeline (`scripts/production/owlcms-geocoder.js`, `scripts/production/sweep-owlcms-geocodes.js`, `scripts/production/run-owlcms-pipeline.js`, `scripts/production/owlcms-upload-server.js`)**:
  - Upgraded `scripts/production/owlcms-geocoder.js` with a multi-engine cascading geocoding pipeline featuring **Photon** (`https://photon.komoot.io`) as the primary Point of Interest (POI) geocoder with **OpenStreetMap (OSM) Nominatim** as an intelligent fallback.
  - Implemented cascading query address resolution: Query 1 Composite (`"{venue}, {city}"`), Query 2 Primary Address (splitting comma-delimited venue strings to extract street address indicators + city), and Query 3 Fallback (`"{city}, {country_name}"`).
  - Added comprehensive International Olympic Committee (IOC), International Organization for Standardization (ISO) 3166-1 alpha-2, and English country name resolution tables covering all 192 International Weightlifting Federation (IWF) member nations, verifying candidate POI country codes against host country metadata.
  - Enhanced sweep worker `scripts/production/sweep-owlcms-geocodes.js` to accept `--meet_id <id>` arguments for targeted immediate geocoding as well as global batch sweeps for un-geocoded competitions.
  - Integrated venue geocoding directly into the singleton pipeline runner `scripts/production/run-owlcms-pipeline.js` as Step 1, ensuring map coordinates (`latitude`, `longitude`) are populated immediately for frontend map rendering (`MeetHubSpokeMap`) before longer-running athlete linking passes execute.
  - Updated upload server endpoint `POST /api/pipeline/run` in `scripts/production/owlcms-upload-server.js` to forward `{ event, meet_id }` payloads to the pipeline runner.
  - Backfilled Meet #5 (*Australian Weightlifting Federation [AWF] Masters and Australian Masters Games* in Gungahlin, Australian Capital Territory [ACT], Australia) with authoritative coordinates (`latitude = -35.187663`, `longitude = 149.1372014`) and synchronized country codes for 110 competition results.

## [Added] - 2026-10-13 (Eastern Time)

- **Incorporate Open Weightlifting Competition Management System (OWLCMS) Results & Lifter Aliases into Athlete Static Shards (`scripts/production/assembler.js`, `scripts/production/listener.js`, `scripts/production/link-new-owlcms-athletes.js`, `scripts/production/seed.js`)**:
  - Enriched `owlcms_results_agg` query in `scripts/production/assembler.js` to output `result_id`, `weight_class`, and `country_code` alongside existing fields, ensuring full compatibility with United States of America Weightlifting (USAW) and International Weightlifting Federation (IWF) shard consumers.
  - Hardened primary OWLCMS Identification (ID) selection with deterministic `ORDER BY id ASC LIMIT 1`, and integrated `mapCountryCodeToName` for accurate country name resolution across international OWLCMS entries.
  - Injected shard-specific `id` into static Gzip-compressed JavaScript Object Notation (`.json.gz`) outputs across all Quad-Writer branches (`/usaw/`, `/iwf/`, `/internal/`, `/owlcms/`).
  - Updated real-time webhook listener `scripts/production/listener.js` on Port 8889 to accept `owlcms_id` in `POST /refresh-athlete` payloads and trigger multi-federation shard regeneration.
  - Enhanced post-ingestion shard triggering in `scripts/production/link-new-owlcms-athletes.js` to compile static shards on Port 8888 for 100% of processed athletes in newly ingested meets (both linked and unlinked OWLCMS lifters).
  - Added Pass 3 to bulk seeder `scripts/production/seed.js` to query and compile static shards for historical standalone OWLCMS lifters who lack USAW or IWF links.

## [Added] - 2026-10-04 (Eastern Time)

- **Open Weightlifting Competition Management System (owlcms) Meet Geocoding & Participant Country Validation (`migrations/add_owlcms_coordinates_and_country_code.sql`, `scripts/production/owlcms-geocoder.js`, `scripts/production/owlcms-importer.js`, `scripts/production/sweep-owlcms-geocodes.js`, `scripts/production/backfill-owlcms-coordinates-and-countries.js`)**:
  - Applied schema migration adding `latitude double precision` and `longitude double precision` to `public.owlcms_meets`, and `country_code text` to `public.owlcms_meet_results` with index `idx_owlcms_meet_results_country_code`.
  - Built automated geocoding service `scripts/production/owlcms-geocoder.js` using OpenStreetMap (OSM) Nominatim Application Programming Interface (API) with 1.1-second rate-limiting delay and intelligent candidate query cascade (including inverted `competitionCity`/`competitionSite` pairs).
  - Integrated automatic geocoding into `scripts/production/owlcms-importer.js` on meet upload and enriched athlete parsing to resolve canonical 3-letter International Olympic Committee (IOC) / International Organization for Standardization (ISO-3) country codes from `ath.federationCodes`, `ath.country`, delegation teams, and 3-letter clubs into `public.owlcms_lifters` and `public.owlcms_meet_results`.
  - Created resilience sweep worker `scripts/production/sweep-owlcms-geocodes.js` and hooked into singleton pipeline runner `scripts/production/run-owlcms-pipeline.js` to automatically heal any un-geocoded meets or missing result country codes.
  - Backfilled historical meets: Meet Identifier (ID) 4 (*CAMPEONATOS PANAMERICANOS SUB 15, SUB 17 Y CAMPEONATOS SUDAMERICANOS...* in Guayaquil, Ecuador) updated to `latitude: -2.1894`, `longitude: -79.8891`, and Meets 1–3 backfilled with Canadian venue coordinates.
  - Backfilled canonical IOC country codes for 100% of participants in Meet ID 4 (181 platform appearances across `ECU`, `VEN`, `PER`, `CHI`, `BOL`, `BRA`, `USA`, `ARG`, `CAN`, `ARU`, `COL`, `URU`, `PAN`, `CRC`, `HON`) and Canadian domestic meets (`CAN`).

## [Fixed] - 2026-09-28 (Eastern Time)

- **USA Weightlifting (USAW) Specialty Clubs Verbatim-Only Correction (`migrations/fix-usaw-specialty-verbatim-2026-09-28.sql` — generated, NOT yet applied; run manually per project protocol, then `migrations/verify-usaw-specialty-verbatim-2026-09-28.sql`)**:
  - Adopted as-written/as-found rule: `public.usaw_clubs.community_designation` is the sole source of truth, stored byte-verbatim from the Black, Indigenous, and People of Color (BIPOC) / Lesbian, Gay, Bisexual, Transgender, Queer, Intersex, and Asexual+ (LGBTQIA+) page. `is_bipoc_owned` / `is_lgbtqia_owned` are deprecated, frozen, never re-derived (any token-to-flag mapping is editorializing and prohibited).
  - Proven defects fixed (static-page assumption, no source-change excuse): `Brightside Barbell` backfilled to verbatim `LGBTQIA+` (flags frozen false); `Blaze Barbell` (Naples, Florida, Jason Anderson) inserted as new stub with verbatim `LGBTQIA+`, geocode / Weightlifting State Organization (WSO) left null for the overnight daily pipeline — never merged with `Ablaze Barbell`; `Ablaze Barbell` specialty fields cleared as proven substring-collision misattribution (`"ablaze barbell".includes("blaze barbell")`), base directory row preserved. Remaining 14 extras untouched pending forensic `SELECT` review.
  - Hardened `scripts/production/sync-usaw-specialty-clubs.js`: removed raw substring fallback, added header-text column resolution (abort on unrecognized shape instead of fixed-index misparse), exact-normalized then token-overlap (>= 0.8) matching with city/state corroboration, verbatim-only writes, empty-designation skip (no NULL-clobber), add-only plus absent-row report (never auto-clears). New exports: `normalizeClubName`, `tokenOverlap`, `resolveBipocHeaderIndexes`, `matchExistingClub`.
  - Added `tests/sync-usaw-specialty-clubs.test.js` (15 tests passing): `Blaze` vs `Ablaze` non-match, `Brave Barbell N Sprinkles` vs `Brave Barbells N Sprinkles WLC` Cary-corroborated match, `Barbarian Barbell` canonical match, fill-only-if-empty contact guard (`Ablaze`/`Jason Anderson` regression), header-resolution abort behavior, row-count-abort guard.
  - `Ablaze Barbell` contact/instagram decontamination (`migrations/fix-ablaze-contact-decontamination-2026-09-28.sql` — generated, NOT yet applied; run manually per project protocol, then `migrations/verify-ablaze-contact-decontamination-2026-09-28.sql`): full-row forensics proved `contact_name='Jason Anderson'` + `instagram='@blazebarbell'` on Ablaze were Blaze's values cross-written by the pre-patch overwrite semantics, while `email='Knight.jcr@gmail.com'`, Fort Walton Beach address, `Florida` state/Weightlifting State Organization (WSO)/coordinates are genuine Ablaze data and preserved. Synchronizer `contact_name`/`instagram` changed to fill-only-if-empty so a future false match can never clobber a real contact.
  - Quarantine phase for the 14 remaining extras (`docs/USAW_SPECIALTY_CLUBS_QUARANTINE_2026-09-28.md`, forensic input only, no clearing migration): zero GitHub Actions runs have ever fired for this pipeline (0 workflow runs; schedule first eligible 2026-10-01), so the 2026-09-25 population was a local `node` run and no run log exists — "likely delisted" labels withdrawn, all 14 stay quarantined suspects (frontend: do not render as vetted) pending proof against the live row or USAW. `Desert Dome Weightlifting` (country-in-address-cell) and `ISA Barbell Club` (designation with no live counterpart) flagged for manual review. `Monument Weightlifting` NOT manually inserted per owner ruling — reserved as the pipeline acceptance test (expected: NEW STUB verbatim incl. `&` contact, flags frozen).
  - Pre-push hardening: BIPOC-table row-count assertion (abort below 20 data rows — a thin parse is a failure, never a delisting event), missing-table now throws instead of returning an empty diff, dry-run-first acceptance protocol documented in the workflow file.
  - Reproduction proof (2026-09-28, old committed script at 833fa8d stashed back to HEAD, `--bipoc --dry-run`): 24 total rows parsed, 21 matched, 2 new stubs (Brave variant + Monument), zero of the 14 suspects produced — current page cannot generate them, so they were added by mistake in the 2026-09-25 local run. Hardened script dry-run same session: 23 processed, Monument NEW STUB verbatim, 14 in ABSENT REPORT with zero writes. Clearing migration `migrations/clear-usaw-specialty-14-suspects-2026-09-28.sql` generated (designation + flags only, base data preserved, no deletes) — run manually per protocol, then `migrations/verify-clear-usaw-specialty-14-suspects-2026-09-28.sql`.
  - Live pipeline run 2026-09-28 4:28 PM Eastern Daylight Time (EDT): 22 matched + Monument inserted verbatim (user-applied clearing migration confirmed — designated count 23). Absent-report keying fixed the same session: report now keys on `normalizeClubName` instead of raw lowercase, so the 4 canonical-variant rows (`BARBARIAN BARBELL CLUB`, `CHFP WEIGHTLIFTING CLUB`, `Industrial Strength WLC`, `Brave Barbells N Sprinkles WLC`) no longer false-positive. Local dry-run after fix: 23/23 matched, 0 stubs, empty absent-report (silent = clean). Tests now 24 passing.
  - Residual flag zeroing (`migrations/zero-usaw-specialty-flags-2026-09-28.sql` — generated, NOT yet applied; run manually per project protocol, then `migrations/verify-zero-usaw-specialty-flags-2026-09-28.sql`): frontend verification caught that the freeze preserved pre-patch token-inferred `true` values — 20 of 23 designated rows still read `is_bipoc_owned`/`is_lgbtqia_owned = true` live (e.g. Barbarian `true/true`), only Blaze/Brightside/Monument were false. Every surviving `true` originated from the prohibited 2026-09-25 local-run inference (`/black|brown|latina|.../`, `/lgbtqia|lgbt/`). Migration zeroes both flags on all rows with `community_designation IS NOT NULL` (guarded `UPDATE`, touches flags + `updated_at` only; designations, contacts, base data untouched; no flags set true; no deletes).
  - Frontend contract: badges render `community_designation` verbatim text-only; filter pills must match on designation text, not deprecated flags. Zero flag values newly set to true by this change.

## [Added] - 2026-09-25 (Eastern Time)

- **Automated USA Weightlifting (USAW) Club Geocoding & Weightlifting State Organization (WSO) Assignment (`.github/workflows/usaw-daily-wso-club-directory-pipeline.yml`)**:
  - Integrated `scripts/geographic/club-geocoder.js` and `scripts/geographic/club-wso-assigner.js --assign` into the daily USA Weightlifting (USAW) directory workflow following `club-scraper.js`.
  - Configured caching and smart precision checks so previously geocoded clubs (`score >= 6`) are skipped instantly, while newly discovered or stubbed community and collegiate clubs are geocoded via OpenStreetMap (OSM) Nominatim and assigned their corresponding WSO territories overnight.
  - Successfully executed local verification: 37 newly added clubs geocoded, 676 skipped, and 714 / 737 clubs assigned WSO geography (96.9% assignment rate, 100% high confidence).

- **USA Weightlifting (USAW) Specialty Clubs & Collegiate University Programs Synchronization (`migrations/add_specialty_clubs_and_university_programs.sql`, `scripts/production/sync-usaw-specialty-clubs.js`, `.github/workflows/usaw-specialty-clubs-pipeline.yml`)**:
  - Implemented schema additions to support USA Weightlifting (USAW) specialty directories:
    - Added community and contact columns to `public.usaw_clubs`: `contact_name`, `instagram`, `website_url`, `community_designation`, `is_bipoc_owned`, `is_lgbtqia_owned`.
    - Created dedicated collegiate table `public.usaw_university_programs` (`program_id`, `school_name`, `state`, `city`, `associated_usaw_club`, `instagram`, `website_url`, `source_sheet`) with relational foreign-key linking to `public.usaw_clubs(club_name)` and uniqueness constraint on `(school_name, state)`.
  - Authored standalone synchronizer script `scripts/production/sync-usaw-specialty-clubs.js`:
    - Dynamically discovers the active Content Management System (CMS) Contentstack Excel (`.xlsx`) download Uniform Resource Locator (URL) from `https://www.usaweightlifting.org/navigation/clubs/university-programs` and parses collegiate rosters across all 50 states.
    - Scrapes and parses the Black, Indigenous, and People of Color (BIPOC) and Lesbian, Gay, Bisexual, Transgender, Queer, Intersex, and Asexual+ (LGBTQIA+) club directory table from `https://www.usaweightlifting.org/club-wso/bipoc-lgbtqia-clubs`.
    - Automatically stubs missing collegiate/community clubs into `public.usaw_clubs` to ensure referential integrity while enriching existing clubs with community designations, contact persons, and social handles.
  - Deployed GitHub Actions (GHA) recurring workflow `.github/workflows/usaw-specialty-clubs-pipeline.yml` scheduled to run monthly on the 1st at 04:00 Universal Time Coordinated (UTC) / 00:00 Eastern Daylight Time (EDT) with manual dispatch support. NOTE (2026-09-28 correction): zero workflow runs had fired as of 2026-09-28 — the initial population below was a local `node` execution, not a pipeline run; no run log exists.
  - Executed initial database population locally on 2026-09-25: 62 collegiate university programs upserted, 15 existing clubs enriched, and 20 community clubs stubbed.

## [Fixed] - 2026-09-24 (Eastern Time)

- **Competition Scope Precision & Domestic Subdivision Separation (`scripts/production/federation-lookup.js`, `scripts/production/owlcms-importer.js`, `migrations/add_state_provincial_competition_scope.sql`)**:
  - Corrected competition scope derivation to strictly separate cross-border Regional Federations from domestic state/provincial subdivisions:
    - Multi-nation Regional & Intercontinental Regional bodies (`regional`, `intercontinental_regional`) map to `competition_scope = 'regional'`.
    - Domestic subdivisions (`regional_state_wso`, e.g., USA Weightlifting (USAW) Weightlifting State Organizations (WSOs), Canadian Provincial Federations) map to `competition_scope = 'state_provincial'`.
  - Authored standalone migration `migrations/add_state_provincial_competition_scope.sql` (generated for manual execution per protocol) to expand `public.owlcms_meets.competition_scope` CHECK constraint with `'state_provincial'`.
  - Updated `docs/GEOGRAPHY_ORGANIZER_CASCADE_API.md` contract documentation accordingly.

## [Added] - 2026-09-24 (Eastern Time)

- **Regional, Intercontinental & Masters Federation Taxonomy & Entity Expansion (`migrations/add_regional_and_masters_levels.sql` & `scripts/production/seed-vetted-regional-and-masters-federations.js` — applied and verified in live database)**:
  - Expanded `public.federation_registry.level` CHECK constraint with `global_international`, `intercontinental_regional`, and `regional` tiers while preserving backward compatibility with `international`.
  - Reclassified the International Weightlifting Federation (IWF) to `level = 'global_international'`.
  - Expanded `public.federation_affiliations.relationship_type` CHECK constraint to include `regional_confederation`, `intercontinental_confederation`, and `regional_member`.
  - Updated `public.list_federation_options` Remote Procedure Call (RPC) parameter validation and level matching to accept the new levels and support bidirectional compatibility between `international` and `global_international`.
  - Updated `scripts/production/federation-lookup.js` with `ALLOWED_LEVELS` and `SCOPE_BY_SANCTION_LEVEL` mappings (`global_international → international`, `intercontinental_regional / regional → regional`).
  - Enforced Rule 11 in `AGENTS.md` (Authentic Primary-Source Representation: Zero Artificial Identifiers), ensuring genuine real-world acronym collisions (such as Arabic Weightlifting Federation `AWF` vs Asian Weightlifting Federation `AWF` vs Australian Weightlifting Federation `AWF`) are modeled faithfully with authentic acronyms in `public.federation_localizations` and `short_code = NULL` on regional registry entities.
  - Ingested 23 vetted entities with complete localizations, primary-source citations, and verified affiliation edges:
    - 2 Global Masters: United Masters Weightlifting Federation (UMWF), International Masters Weightlifting Association (IMWA).
    - 3 Intercontinental Regional: Commonwealth Weightlifting Federation (CWF), Mediterranean Weightlifting Federation (MWF), Arabic Weightlifting Federation (AWF).
    - 18 Regional: South American Weightlifting Confederation (CSLP), Central American and Caribbean Weightlifting Confederation (CCCLP), North American Weightlifting Committee (NAWC), Nordic Weightlifting Federation (NWF), Visegrad Four Weightlifting Federation (V4WF), European Union Weightlifting Confederation (EUWC), Small States of Europe Weightlifting Commission (SSEWC), South Asian Weightlifting Federation (SAWF), East Asian Weightlifting Federation (EAWF), West Asian Weightlifting Federation (WAWF), Central Asian Weightlifting Federation (CAWF), Southeast Asian Weightlifting Federation (SEAWF), Pacific Islands Weightlifting Federation (PIWF), and the 5 Weightlifting Federation of Africa (WFA) Zonal Federations (North, West, Central, East, South Zones).
  - Shipped verification script `migrations/verify-regional-and-masters-federations.sql` verifying 100% data and ranking integrity.

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
