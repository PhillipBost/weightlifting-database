# Geography / Organizer Cascade & Competition-Scope API Contract

> Date: 2026-09-21. This document defines the deployed application API for the
> editable cascade (**Continent → Country → Organizer / regional body**) and the
> competition-scope inference contract. It is the reusable contract for the
> collaborator website: collaborators call these HTTP endpoints only and never
> receive database or service-role credentials.

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
| `parent_id` | no | UUID; restricts to direct children (`registry.parent_federation_id`) |
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

Complete parent chain from a recognized organizer, over affiliation edges,
with PIT filtering of edge effective windows. Unlike the older governance
route (which lists active immediate parents/children without date filtering),
this walks the full multi-parent graph (depth cap 6, cycle-guarded).

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
does not exist.

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


