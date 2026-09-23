# Geography / Organizer Cascade & Competition-Scope API Contract

> Date: 2026-09-21. This document defines the deployed application API for the
> editable cascade (**Continent → Country → Organizer / regional body**) and the
> competition-scope inference contract. It is the reusable contract for the
> collaborator website: collaborators call these HTTP endpoints only and never
> receive database or service-role credentials.
> Direct service-role callers (e.g., the owanalytics.org frontend gateway) call
> Supabase itself instead — see **§8 Supabase-native surface** for the RPC
> equivalents of §2–§4 and the resolve recipe.

**Acronyms (defined at first use):** owlcms = Online Weightlifting Competition
Management System · PIT = Point-in-Time · RLS = Row-Level Security ·
USAW = USA Weightlifting · PAWF = Pan American Weightlifting Federation ·
WCH = Weightlifting Canada Haltérophilie · FHQ = Fédération d'haltérophilie du Québec.

---

## 1. Data model summary (deployed facts)

- Federation classification is stored in `public.federation_registry.level`
  with check-constrained values: `international | continental | national |
  regional_state_wso | club`.
- There are **no geographic country/continent/subdivision tables**. A "country"
  exists only as `federation_registry.country_code` on the national body, as
  aliases (`WCH` carries `CAN`, `Canada`), and as localization names.
  Country → continent resolves only organizationally: national body →
  continental federation via a `continental_member` affiliation edge.
- The owlcms export format has **no host-country, continent, subdivision, or
  explicit competition-level field**. `competition.competitionSite` is the
  venue free-text (school names, street addresses, sometimes a city) and must
  never be treated as a country.
- `owlcms_meets` gains (migration, run manually, see §6): `venue`,
  `host_country_code`, `organizer_federation_id`, `competition_scope`,
  `scope_evidence`, `geography_inference`, `uploader_selections`; plus a new
  `owlcms_meet_teams` table for per-competition team/delegation representation.

### Inference provenance rule (critical)

Server inferences and uploader selections are **stored in separate columns and
never overwrite each other**:

| Column | Written by | Overwritten? |
|---|---|---|
| `geography_inference` (JSONB) | Importer, machine evidence only | Never |
| `scope_evidence` (JSONB) | Importer, machine evidence only | Never |
| `uploader_selections` (JSONB) | Explicit uploader input only (incl. clears) | Only by the uploader |

Uploaders correct or clear suggestions by writing `uploader_selections`; the
original machine evidence remains queryable for audit.

---

## 2. `GET /api/federations/options`

Lists valid cascade options **before any search text is entered**, with
optional parent constraint and PIT name filtering.

**Query parameters**

| Param | Required | Meaning |
|---|---|---|
| `level` | no | One of `international`, `continental`, `national`, `regional_state_wso`, `club` |
| `parent_id` | no | UUID; restricts to direct children via `registry.parent_federation_id` **or** an active `federation_affiliations` edge (Point-in-Time (PIT)-filtered) — the edge path is authoritative for National Governing Bodies (NGBs), whose `parent_federation_id` is `NULL` |
| `q` | no | Search text; ≥ 3 characters enables substring matching, shorter requires exact match |
| `as_of_date` | no | `YYYY-MM-DD`; display names filtered to those valid on the date |
| `limit` | no | Page size 1–200, default 50 |
| `offset` | no | Page offset, default 0 |

**Cascade mapping**

| Tier | Call |
|---|---|
| Continent | `?level=continental` |
| Country | `?level=national` (optionally constrained by the selected continent via `parent_id`) |
| Organizer | `?level=national&parent_id=…`, `?level=regional_state_wso&parent_id=…`, `?level=club&parent_id=…` |

**Response** (live-verified shape):

```json
{
  "total_count": 198, "limit": 5, "offset": 0, "has_more": true,
  "items": [
    {
      "id": "53499928-c84f-4681-811d-d8cb7e5cbdeb",
      "canonical_name": "Weightlifting Canada Haltérophilie",
      "short_code": "WCH", "country_code": "CAN", "level": "national",
      "parent_federation_id": null, "is_verified": true,
      "known_aliases": ["WCH", "Canadian Weightlifting Federation", "CWFHC", "CAN", "Canada"],
      "display_names": [
        { "language_code": "en", "full_name": "Weightlifting Canada Haltérophilie", "acronym": "WCH", "name_type": "primary" },
        { "language_code": "en", "full_name": "Canadian Weightlifting Federation", "acronym": "CWFHC", "name_type": "historical" }
      ]
    }
  ]
}
```

Notes:
- `total_count` + `has_more` make truncation **explicit** — no valid choice is
  silently hidden (unlike the deployed `search_federations` SQL function, which
  hard-caps at 10 with no pagination).
- An empty `items` array is a legitimate "no options" result, **not** an error.
- `display_names` are PIT-filtered when `as_of_date` is provided, so historical
  names (e.g., `CWFHC` before 2021-08-01) resolve by competition date.
- Country codes in the registry are **IWF member/delegation codes** (deployed
  data: `ARU`, `HON`, `URU`, `CRC` — not ISO 3166-1 alpha-3 `ABW`, `HND`,
  `URY`, `CRI`). Do not assume ISO semantics client-side.

(Endpoint reference for lineage and resolve continues below.)

---

## 3. `GET /api/federations/lineage/:id?as_of_date=`

Affiliation walk from a recognized organizer, over affiliation edges,
with PIT filtering of edge effective windows. Unlike the older governance
route (which lists active immediate parents/children without date filtering),
this walks the full multi-parent graph (depth cap 6, cycle-guarded).

Recognised-autonomy model (2026-09-22): a hop means "affiliated with /
recognised by", never "subordinate to", unless the edge type is explicitly
hierarchical (e.g. `regional_subdivision`). Continental confederations are
autonomous peer bodies recognised within the International Weightlifting
Federation (IWF) framework — no `continental -> International Weightlifting
Federation (IWF)` edge exists, so no Pan American Weightlifting Federation
(PAWF) -> International Weightlifting Federation (IWF) hop should ever appear.

**Live-verified example — FHQ with `as_of_date=2026-06-05`:**

```json
{
  "status": "ok",
  "entity": { "id": "6d87b83f-…", "canonical_name": "Fédération d'haltérophilie du Québec", "level": "regional_state_wso" },
  "as_of_date": "2026-06-05",
  "hops": [
    { "depth": 1, "via_child_id": "6d87b83f-…", "parent": { "short_code": "WCH", "level": "national" },
      "relationship_type": "regional_subdivision", "is_verified": false, "citation": null,
      "effective_start": null, "effective_end": null },
    { "depth": 2, "parent": { "short_code": "IWF", "level": "international" },
      "relationship_type": "international_member", "is_verified": true },
    { "depth": 2, "parent": { "short_code": "PAWF", "level": "continental" },
      "relationship_type": "continental_member", "is_verified": true }
  ],
  "roots": [ "IWF", "PAWF" ]
}
```

Treat `is_verified: false` edges (such as FHQ → WCH today) as **suggestions the
uploader may confirm**, not established facts. `404` is returned when the id
does not exist. Multiple roots are normal — and neither root is subordinate to
the other: the International Weightlifting Federation (IWF) and the Pan
American Weightlifting Federation (PAWF) are autonomous peers.

---

## 4. `POST /api/federations/resolve`

Batch resolution for cascade inference. **Search-only — it never creates
registry records.**

**Request body** (all fields optional):

```json
{
  "organizer_text": "Federación Panamericana de Levantamiento de Pesas",
  "federation_text": "Weightlifting Canada Haltérophilie",
  "host_country_text": null,
  "record_federations": ["PanAm", "PanAm", "PanAm"],
  "team_names": ["COL", "USA", "ARU"],
  "competition_date": "2026-08-26"
}
```

- `record_federations` accepts the raw `records[].recordFederation` values —
  the endpoint **deduplicates by value first**; repeated rows are not
  independent confirmations.
- When the export has no `competition.federation` (verified: the PanAm export),
  pass the organizer text as `federation_text` too — the importer uses the
  same `comp.federation || organizer` precedence.

**Response** — per-field resolution with explicit status:

| `status` | Meaning |
|---|---|
| `unique` | Single top candidate (`match_rank ≥ 75`); `confidence_tier` = `exact` (≥ 90) or `substring` (75–89) |
| `ambiguous` | Two or more candidates tied at the top rank — **uploader must choose** |
| `no_match` | No candidate at rank ≥ 75 (or no candidates at all) |
| `missing_in_source` | The source field was absent/empty |

Plus `suggested_scope` (`international | continental | national | regional |
unknown`) derived **from the sanctioning federation's registry level only**.
Team/record evidence is returned as corroboration (`teams.analysis`,
`record_federations.resolutions`) and never upgrades the scope. Club team names
never prove a local event (USAW national events use club names as team names).

**Live-verified behaviors:**
- `organizer_text: "Federación Panamericana de Levantamiento de Pesas"` →
  `unique` / `exact`, rank 100 → Pan American Weightlifting Federation.
- `organizer_text: "PanAm"` → `ambiguous` (Panama NGB and PAWF both rank 75) —
  a case that must be surfaced to the uploader, not auto-picked.

**`match_rank` semantics (do not misrepresent):** a deterministic match-tier
score, **not a calibrated probability**. 100 = exact temporally-valid localized
name/acronym; 95 = exact short code; 90 = exact canonical name; 85 = exact but
outside the validity window; 75/70 = substring; 65 = legacy alias.

(Remaining sections follow below.)

---

## 5. Upload integration (`POST /api/upload-owlcms`)

The ingestion endpoint now accepts an optional `uploaderSelections` object:

```json
{ "fileName": "export.json", "dryRun": false, "payload": { … },
  "uploaderSelections": {
    "continent_id": "…", "country_id": "…", "organizer_id": "…",
    "host_country_code": "CAN", "competition_scope": "national",
    "cleared": ["organizer_id"]
  } }
```

Stored verbatim in `owlcms_meets.uploader_selections` (never inferred, never
overwritten by the server). Machine inference from the same import is stored
separately in `geography_inference` / `scope_evidence`. The importer now also:

- stores `competition.competitionSite` in `venue` and **never** in `country`;
- resolves the organizer **search-only** (unmatched club organizers are
  recorded as evidence, never inserted into the registry);
- captures per-meet teams into `owlcms_meet_teams`
  (`team_kind`: `delegation` only for unambiguous 3-letter uppercase codes;
  club vs province/state stays `unknown` for the uploader to confirm);
- skips all registry resolution in `--dry-run` mode (dry-run is strictly
  read-only and can no longer auto-discover registry rows).

---

## 6. Migration runbook (manual execution required)

Per project protocol, migrations are **never auto-applied**. After review, run
manually, then verify:

1. `migrations/add_owlcms_geography_organizer_scope.sql` — adds the
   `owlcms_meets` columns, creates `owlcms_meet_teams`, RLS + grants
   (mirrors the deployed `owlcms_grants.sql` pattern). Idempotent.
2. `migrations/verify-owlcms-geography-organizer-scope.sql` — read-only
   verification (column/constraint/index/RLS checks, and confirmation that no
   historical row was touched and no backfill occurred).

Historical rows are intentionally left NULL. Nothing is backfilled; no
federation registry rows are seeded by the migration or the importer's
organizer path.

---

## 7. Security & collaborator contract

- All federation lookups are proxied by these application endpoints using the
  server-side service role. Anonymous/anon-key database access is blocked by
  RLS on the federation tables (verified deployed behavior: anon-key reads and
  even the `search_federations` SQL function return zero rows for anon).
- The collaborator website consumes **this HTTP API only**. Database and
  service-role credentials must never be shipped to client code.
- owlcms tables carry public-read RLS policies; `owlcms_meet_teams` follows the
  same pattern (public read, service-role writes).

---

## 8. Supabase-native surface (direct service-role callers)

The owanalytics.org frontend gateway calls Supabase directly with the service
role — the same way `/api/federations/search` already calls `search_federations`
— and does **not** proxy read-only lookups through the upload server (port
8890). The port-8890 routes remain for the importer's own pipeline. The two
structural lookups are deployed SQL RPCs (migration
`create_federation_cascade_rpcs.sql`, run manually per protocol); resolve is a
documented client-side recipe over the existing `search_federations` RPC.

### 8.1 `rpc('list_federation_options', …)` — replaces §2 `GET /api/federations/options`

Signature: `list_federation_options(p_level TEXT DEFAULT NULL, p_parent_id UUID DEFAULT NULL, p_query TEXT DEFAULT NULL, p_as_of_date DATE DEFAULT CURRENT_DATE, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)`
→ rows `{ id, canonical_name, short_code, country_code, level, parent_federation_id, is_verified, known_aliases, display_names (JSONB), total_count (BIGINT) }`, ordered by `canonical_name`.

- Same level values, parent constraint, and `q` semantics as §2 (≥ 3 chars
  enables substring; shorter requires exact match on canonical name, short
  code, or alias). The parent constraint is **affiliations-aware**: a child
  matches when `parent_federation_id = p_parent_id` **or** an active,
  PIT-filtered `federation_affiliations` edge links it to `p_parent_id` —
  required because National Governing Bodies (NGBs) carry
  `parent_federation_id = NULL` with dual membership, so a legacy-column-only
  filter returns 0 rows under a continent (Ecuador missing under the Pan
  American Weightlifting Federation (PAWF), reported 2026-09-22).
- `display_names` is the PIT-filtered localization array — a genuine advantage
  over PostgREST embeds, which cannot express the NULL-tolerant
  `valid_from`/`valid_until` window filtering.
- `total_count` repeats on every row; derive `has_more = offset + limit < total_count`.
- An invalid `p_level` raises error `22023`; an empty result is a legitimate
  "no options", not an error.

```js
const { data, error } = await supabase.rpc('list_federation_options', {
  p_level: 'regional_state_wso',
  p_parent_id: wchId,
  p_as_of_date: '2026-06-05',
  p_limit: 200
});
// data: FHQ + 12 sibling provincial bodies; data[0].total_count === 13
```

### 8.2 `rpc('get_federation_lineage', …)` — replaces §3 `GET /api/federations/lineage/:id`

Signature: `get_federation_lineage(p_entity_id UUID, p_as_of_date DATE DEFAULT CURRENT_DATE)`
→ flat hop rows `{ depth, parent_id, parent_canonical_name, parent_short_code, parent_level, relationship_type, is_verified, citation, effective_start, effective_end, is_root }`, ordered by `depth`.

- Same semantics as §3: multi-parent recursive walk, depth cap 6, cycle-guarded,
  edges filtered to those active on the PIT date. Recognised-autonomy model:
  a hop means "affiliated with / recognised by", never "subordinate to";
  continentals are autonomous roots alongside the International Weightlifting
  Federation (IWF). All §3 UI rules apply
  unchanged (`is_verified: false` hops are suggestions, multiple roots are normal).
- Unknown id **raises** (`P0002`) — map to a 404-style UI state; an entity with
  no affiliations returns an **empty array** (missing association, not an error).

```js
const { data, error } = await supabase.rpc('get_federation_lineage', {
  p_entity_id: fhqId, p_as_of_date: '2026-06-05'
});
// data: [{ depth: 1, parent_short_code: 'WCH', is_verified: false, … },
//        { depth: 2, parent_short_code: 'IWF',  is_verified: true,  … },
//        { depth: 2, parent_short_code: 'PAWF', is_verified: true,  … }]
```

### 8.3 Resolve recipe — replaces §4 `POST /api/federations/resolve`

No new RPC is needed; compose from `search_federations` plus this exact
classification rule (mirrors the HTTP endpoint):

1. Deduplicate `records[].recordFederation` values (and team-name analysis) locally.
2. For each field (organizer, federation, host country, each deduplicated
   record code), call `supabase.rpc('search_federations', { query_text, as_of_date })`.
3. Classify each result: `[]` or top `match_rank < 75` → `no_match` · two or
   more rows tied at the top rank (≥ 75) → `ambiguous` (uploader must choose) ·
   single top row → `unique` with `confidence_tier = 'exact'` (rank ≥ 90) or
   `'substring'` (75–89) · empty source field → `missing_in_source`.
4. `suggested_scope` from a `unique` federation's `level`: `international →
   international`, `continental → continental`, `national → national`,
   `regional_state_wso → regional`, else `unknown`. Never upgrade scope from
   team/record evidence (§4 rules apply unchanged; club names never prove "local").
5. Submit final choices via `uploaderSelections` on `POST /api/upload-owlcms` (§5).

### 8.4 Documented PostgREST query patterns (fallback, no RPC)

Service-role key required (RLS blocks anonymous reads). Useful when a simple
list with embedded names suffices:

```text
GET {SUPABASE_URL}/rest/v1/federation_registry
    ?select=id,canonical_name,short_code,country_code,level,parent_federation_id,
            is_verified,known_aliases,
            federation_localizations(language_code,full_name,acronym,name_type,
                                     valid_from,valid_until)
    &level=eq.national&order=canonical_name.asc&limit=200

# Children of a selected parent via the denormalized column: &parent_federation_id=eq.{uuid}

# Immediate parent edges for an entity (raw edges — NOT a full walk):
GET {SUPABASE_URL}/rest/v1/federation_affiliations
    ?select=*,parent:federation_registry!federation_affiliations_parent_id_fkey(id,canonical_name,short_code,level)
    &child_id=eq.{uuid}&is_active=eq.true
```

Notes: the embed hint names the parent foreign-key constraint — if the deployed
constraint name differs, look it up (`SELECT conname FROM pg_constraint WHERE
conrelid = 'federation_affiliations'::regclass AND contype = 'f';`) and adjust.
PostgREST alone cannot perform the recursive multi-parent walk or the
NULL-tolerant PIT name filtering in one call — that is exactly what §8.1 and
§8.2 provide.


