# Weightlifting Database System Architecture

## 1. System Overview & Core Sync Model

The Weightlifting Database is an identity and performance graph connecting domestic, international, and regional weightlifting organizations:
- **USA Weightlifting (USAW)**: Domestic national governing body sanctioning United States competitions.
- **International Weightlifting Federation (IWF)**: International federation sanctioning world championships, Olympic qualifiers, and continental championships.
- **Open Weightlifting Competition Management System (owlcms)**: Digital platform powering local, regional, national, and international competition scoring.
- **Additional Governing Bodies**: Managed dynamically via `public.federation_registry`.

The system enforces a **decoupled graph topology**:
- **Identity Graph (`public.athlete_aliases`)**: An operational, pairwise edge table (`check_alias_type = 2`) that defines career equivalence across federations.
- **Evaluation Ledger (`public.athlete_linking_evaluations`)**: A federation-agnostic state machine and provenance ledger tracking the evaluation lifecycle of every athlete against every target federation.
- **Federation Registry (`public.federation_registry`)**: A longitudinal registry of governing bodies, localizations, and regional affiliations.

---

## 2. Federation-Agnostic Athlete Linking & Evaluation Ledger

Ingestion pipelines across all federations must decouple topological identity edges (`public.athlete_aliases`) from evaluation lifecycle states.

### 2.1 Ledger Schema & Lifecycle States
Evaluations are recorded in `public.athlete_linking_evaluations` keyed by `(source_federation_id, source_athlete_id, target_federation_id)` referencing `public.federation_registry(id)`:

- **`PENDING`**: Athlete has been ingested or updated; evaluation against the target federation is queued.
- **`MATCHED`**: Confidence score $\ge 80\%$. A pairwise row is inserted into `public.athlete_aliases` and full provenance is logged in `evidence_breakdown`.
- **`REVIEW_NEEDED`**: Confidence score between $60\%$ and $79\%$. Candidate details are staged for human review in the administrative triage queue. Zero rows are written to `public.athlete_aliases`.
- **`VETTED_ISOLATED`**: Confidence score $< 60\%$ or candidate pool demographic empty. The athlete has been vetted with no peer match found. Subsequent ingestion passes skip this athlete.

### 2.2 Telemetry & Provenance
Evaluations must persist complete provenance in `evidence_breakdown` (demographic matching, token overlap, career performance deltas) alongside numeric confidence scores and algorithm version tags.

---

## 3. Universal Demographic Anchoring & Peer Parity

1. **Universal Demographic Anchoring**:
   - Cross-federation candidate discovery across ALL federations must strictly enforce the identical demographic anchor: `(gender, birth_year)`.
   - Never query candidate pools using unanchored surname filters or arbitrary limits on `usaw_lifters`.
   - Because `usaw_lifters` stores demographics at the competition level, USAW candidate resolution must query `usaw_meet_results` by `(gender = oLifter.gender, birth_year = oLifter.birth_year, last_name)` before evaluating token overlap.
   - Never rely on federation-specific identifiers (e.g. domestic membership numbers) for cross-federation imports.

2. **Multi-Federation Peer Parity & Graph Enrichment**:
   - Federations (USAW, IWF, owlcms, etc.) are equal peer nodes in an identity graph.
   - USAW is never treated as a "primary" bucket that supersedes or erases IWF records, nor is IWF a "fallback" to be dropped when a USAW match exists.
   - Cross-federation matching must evaluate candidate pools independently.
   - An athlete matching multiple federations must have all pairwise links persisted in `public.athlete_aliases`.
   - Code must never contain mutual erasure logic (e.g. `iwf_db_lifter_id: resolvedUsawId ? null : resolvedIwfId`) or winner-take-all federation competition.
   - Re-evaluation passes must check existing aliases for missing federation links rather than filtering them out via monolithic flags.

3. **Pairwise Edge Integrity (`check_alias_type = 2`)**:
   - `public.athlete_aliases` strictly enforces that each row represents exactly two non-null entity IDs (`check_alias_type = 2`).
   - Multi-federation enrichment (e.g. USAW + IWF + owlcms) and intra-federation duplicate linking (IWF $\leftrightarrow$ IWF, owlcms $\leftrightarrow$ owlcms) must always be inserted as distinct pairwise rows (`USAW ── owlcms`, `IWF ── owlcms`, `owlcms ── owlcms_2`), never combined into a 3-way row.

---

## 4. Full Symmetrical Identity Pairing Across Federations

Ingestion pipelines for each federation must symmetrically evaluate incoming/presumed-new athletes against existing athletes across all federations:
- **owlcms Ingestion** (`link-new-owlcms-athletes.js`): `owlcms ↔ owlcms`, `owlcms ↔ USAW`, `owlcms ↔ IWF`.
- **USAW Ingestion** (`link-new-usaw-athletes.js`): `USAW ↔ USAW`, `USAW ↔ IWF`, `USAW ↔ owlcms`.
- **IWF Ingestion** (`link-new-iwf-athletes.js`): `IWF ↔ IWF`, `IWF ↔ USAW`, `IWF ↔ owlcms`.

Every cross-federation link must adhere to universal demographic anchoring `(gender, birth_year)` and strictly pairwise alias integrity.

---

## 5. owlcms Ingestion, Quarantine & Concurrency Pipeline

1. **Zero-Contamination Pre-Check**:
   - All uploaded owlcms JSON exports must be validated against `public.owlcms_meets` by `(meet_name, start_date)` and `raw_payload_hash`.
   - Collision meets (duplicate names/dates or alternative revisions like v1/v2) must be held in quarantine.
   - **Zero rows** may be written to `public.owlcms_lifters` or `public.owlcms_meet_results` during a quarantine hold.

2. **Triage Resolution Lifecycle**:
   - **Reject & Delete**: Deletes staged metadata and removes the `.json.gz` file from `owlcms-archives`.
   - **Reject & Blacklist Hash**: Stores the `raw_payload_hash` in the rejected signatures index to automatically reject future duplicate uploads at the gateway.
   - **Accept & Ingest**: Triggers the insertion of athletes into `owlcms_lifters` and appearances into `owlcms_meet_results`, followed by cross-federation alias linking.

3. **Post-Ingestion Pipeline & Concurrency**:
   - Triggered either via API (`POST /api/pipeline/run`) or event-driven PostgreSQL notifications (`pg_notify('owlcms_pipeline_event')`).
   - Enforced by a Singleton Mutex Lock with live process verification and stale-lock timeout (`scripts/production/run-owlcms-pipeline.js`).
   - Overlapping meet imports never spawn duplicate runners; the active process executes a self-draining loop until all `PENDING` lifters across all newly uploaded meets are linked.

4. **Change-Triggered Automation Daemon**:
   - Persistent worker daemon (`scripts/production/owlcms-event-daemon.js`) connects to PostgreSQL via `LISTEN owlcms_pipeline_event`.
   - Wakes up instantaneously upon `INSERT` on `owlcms_lifters` (`link_status = 'PENDING'`) or `athlete_aliases`.
   - Debounces burst imports (1500ms window), executes `runPipeline()`, and automatically updates affected static shards on disk without polling or open inbound firewall ports.

---

## 6. Longitudinal Federation & Regional Registry (`public.federation_registry`)

1. **Canonical Governing Body Linkage**:
   - Meets ingested across all federations link to canonical governing bodies via `federation_id` in `public.owlcms_meets`.
   - Identity graph spans `public.federation_registry`, `public.federation_localizations`, `public.federation_affiliations`, and `public.federation_headquarters`.
   - Resolution must query `search_federations(query_text, as_of_date)` using meet start dates for Point-in-Time (PIT) matching against temporal names and acronyms (`valid_from`, `valid_until`).

2. **Strict Vetting Standard**:
   - Verified entries (`is_verified = true`) must cite primary source governing documents (constitutions, corporate filings). Multiple historical names in the same language are bound by `UNIQUE (federation_id, language_code, full_name)`.

3. **Auto-Discovery Protocol**:
   - When an ingested meet specifies an unseen or unrecognized federation/club, the system non-destructively captures it (`is_verified = false`) in `public.federation_registry` rather than failing or rejecting the meet.

4. **Authentic Primary-Source Representation (Zero Artificial Identifiers)**:
   - Never synthesize, invent, or editorialize artificial abbreviations, acronyms, or identifiers to resolve namespace, schema, or key collisions.
   - All entity names, acronyms, and historical aliases must strictly reflect verified primary-source governing documents (constitutions, official directories, statutes).
   - Real-world acronym collisions (e.g., Arabic Weightlifting Federation `AWF` vs. Asian Weightlifting Federation `AWF` vs. Australian Weightlifting Federation `AWF`) are genuine domain realities that must be handled structurally (via `public.federation_localizations`, nullable `short_code`, and disambiguation ranking), never obscured by fabricated labels.

