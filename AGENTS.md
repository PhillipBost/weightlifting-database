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
