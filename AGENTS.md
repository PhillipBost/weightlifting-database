# Living System Architecture & Ingestion Rules

## OWLCMS Ingestion & Quarantine Pipeline
1. **Zero-Contamination Pre-Check**:
   - All uploaded OWLCMS JSON exports must be validated against `public.owlcms_meets` by `(meet_name, start_date)` and `raw_payload_hash`.
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
5. **Universal Demographic Anchoring Across Federations**:
   - Cross-federation candidate discovery across ALL federations (USAW, IWF) must strictly enforce the identical demographic anchor: `(gender, birth_year)`.
   - Never query candidate pools using unanchored surname filters or arbitrary limits on `usaw_lifters`.
   - Because `usaw_lifters` stores demographics at the competition level, USAW candidate resolution must query `usaw_meet_results` by `(gender = oLifter.gender, birth_year = oLifter.birth_year, last_name)` before evaluating token overlap.
   - Never rely on federation-specific identifiers (e.g. domestic membership numbers) for cross-federation imports.
6. **Multi-Federation Peer Parity & Graph Enrichment**:
   - Federations (USAW, IWF, OWLCMS) are equal peer nodes in an identity graph.
   - USAW is never treated as a "primary" bucket that supersedes or erases IWF records, nor is IWF a "fallback" to be dropped when a USAW match exists.
   - Cross-federation matching must evaluate USAW and IWF candidate pools independently.
   - An athlete matching both federations must have both links persisted in `athlete_aliases`.
   - Code must never contain mutual erasure logic (e.g. `iwf_db_lifter_id: resolvedUsawId ? null : resolvedIwfId`) or winner-take-all federation competition.
   - Re-evaluation passes must check existing aliases for missing federation links rather than filtering them out via `!linkedIds.has(l.lifter_id)`.
7. **Repository Cleanliness, Git Mutability & Pairwise Graph Integrity**:
   - Never execute `git commit`, `git push`, or any repository-level git mutation without prior explicit user consent.
   - Never write scratch files, test dumps, temporary output files, or logs into the workspace root. All investigative scripts and one-off artifacts must reside strictly within the dedicated scratch directory.
   - `public.athlete_aliases` is strictly a pairwise edge table enforcing `check_alias_type = 2` (exactly two non-null entity IDs per row). Cross-federation enrichment (e.g. USAW + IWF + OWLCMS) and intra-federation duplicate linking (IWF $\leftrightarrow$ IWF, OWLCMS $\leftrightarrow$ OWLCMS) must always be inserted as distinct pairwise rows (`USAW ── OWLCMS`, `IWF ── OWLCMS`, `OWLCMS ── OWLCMS_2`), never combined into a 3-way row.
8. **Full Symmetrical Identity Pairing Across Federations**:
   - Ingestion pipelines for each federation (OWLCMS, USAW, IWF) must symmetrically evaluate incoming/presumed-new athletes against existing athletes across all federations:
     - **OWLCMS Ingestion** (`link-new-owlcms-athletes.js`): `OWLCMS ↔ OWLCMS`, `OWLCMS ↔ USAW`, `OWLCMS ↔ IWF`.
     - **USAW Ingestion** (`link-new-usaw-athletes.js`): `USAW ↔ USAW`, `USAW ↔ IWF`, `USAW ↔ OWLCMS`.
     - **IWF Ingestion** (`link-new-iwf-athletes.js`): `IWF ↔ IWF`, `IWF ↔ USAW`, `IWF ↔ OWLCMS`.
   - Every cross-federation link must adhere to universal demographic anchoring `(gender, birth_year)` and strictly pairwise alias integrity (`check_alias_type = 2`).


