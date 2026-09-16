# OWLCMS Data Model & Front-End Integration Guide

> [!IMPORTANT]
> This document is the definitive architectural specification for how `owlcms` competition data is stored in the database and how the front-end application should query, unpack, and display it.

---

## 1. Core Philosophy: The Single Platform Appearance Rule

A single row in `owlcms_meet_results` represents **one physical platform appearance**:
* **1 weigh-in** (official `body_weight_kg` and digital `scale_weight_kg`).
* **1 platform session** (up to 3 snatch attempts + 3 clean & jerk attempts).
* **1 set of attempt results** and **1 total**.

Even when an athlete is entered into 5 different championships or age divisions simultaneously, they only step onto the platform and lift once. Therefore, they receive **exactly ONE row** in `owlcms_meet_results`.

---

## 2. Relational Schema Architecture

The database implements a 3-tier structure matching `usaw_*` and `iwf_*`:

```
                         ┌──────────────────┐
                         │   owlcms_meets   │
                         └────────┬─────────┘
                                  │ 1:N
┌──────────────────┐     ┌────────┴──────────────┐
│  owlcms_lifters  ├─────┤  owlcms_meet_results  │
└──────────────────┘ 1:N └───────────────────────┘
```

### A. `owlcms_meets`
Captures meet-level configuration and venue details (1 row per competition event).
* **`meet_id`**: Primary Key (`BIGINT GENERATED ALWAYS AS IDENTITY`).
* **Relational Columns**: `meet_name`, `start_date`, `end_date`, `city`, `country`, `organizer`, `format_version`, `source_file_name`.
* **Archival Storage Pointers**: `raw_storage_path` (e.g. `meets/123/export.json.gz`), `raw_storage_bytes` (compressed archive size), `raw_storage_hash` (SHA-256 of stored `.json.gz`), `raw_payload_hash` (SHA-256 of original uncompressed JSON).
* **`raw_payload` (`JSONB`)**: Complete raw `competition`, `config`, `championships`, `ageGroups`, `platforms`, and `technicalOfficials` objects from the source JSON export.

### B. `owlcms_lifters`
Maintains individual athlete career profiles (1 row per unique human).
* **`lifter_id`**: Primary Key (`BIGINT GENERATED ALWAYS AS IDENTITY`).
* **`athlete_name`**: Full display name. **Authentic UTF-8 accents and characters are preserved exactly as entered** (no normalization or accent stripping).
* **Biographical Fields**: `first_name`, `last_name`, `gender`, `birth_year`, `exact_birth_date`, `country_code`, `club_name`.
* **`membership_number`**: Raw text string from the meet file. Stored as entered without assuming it is an authoritative or universal ID across all federations.
* **No Demographic Unique Constraint**: Lifters sharing name, gender, and birth year safely coexist as distinct rows with unique `lifter_id`s to prevent homonym merge corruption.
* **`raw_payload` (`JSONB`)**: Complete raw athlete profile block.

### C. `owlcms_meet_results`
Individual platform performance and attempt records (1 row per platform appearance).
* **`result_id`**: Primary Key (`BIGINT GENERATED ALWAYS AS IDENTITY`).
* **Foreign Keys**: `meet_id` (references `owlcms_meets`), `lifter_id` (references `owlcms_lifters`).
* **Attempt Metrics**: `snatch_1..3`, `best_snatch`, `cj_1..3`, `best_cj`, `total`.
  * **Signed Integer Convention**:
    * **Positive value** ($+105$): Successful make (good lift).
    * **Negative value** ($-105$): Unsuccessful attempt (no lift).
    * **`0` or `null`**: Pass / scratch / did not attempt.
* **Attempt Timestamps**: `snatch_1_time..3_time`, `cj_1_time..3_time` (`TIMESTAMPTZ`).
* **Attempt & Sabermetric Analytics**:
  * `snatch_successful_attempts`, `cj_successful_attempts`, `total_successful_attempts`: Count of successful makes ($0$ to $6$).
  * `bounce_back_snatch_2..3`, `bounce_back_cj_2..3`: Recovery flags (`true` if made attempt immediately after a miss).
  * `best_snatch_ytd`, `best_cj_ytd`, `best_total_ytd`: Career Year-To-Date progression.
* **Analytical Demographics**: `gender`, `birth_year`, `competition_age`.
* **Full GAMX Suite**: `gamx_u` (Youth), `gamx_a` (Junior/Senior), `gamx_masters` (Masters), `gamx_total` (Senior Total), `gamx_s` (Snatch), `gamx_j` (C&J).
* **Q-Scores Suite**: `qpoints` (Senior ages 21–30), `q_masters` (Masters ages 31+), `q_youth` (Youth ages 10–20).
* **Weigh-in Precision**:
  * `body_weight_kg`: Official category bodyweight.
  * `scale_weight_kg`: Raw scale reading from weigh-in.
* **Primary Platform Category (`category`)**: The primary category code under which the lifter's platform card was registered in `owlcms` (e.g. `"S20_M110"`, `"F45"`).
* **Multi-Championship Leaderboards (`participations JSONB`)**: Full array of all championship leaderboards and ranks evaluated for this appearance.
* **Complete Entity Vault (`raw_payload JSONB`)**: Complete source athlete object.

---

## 3. Categories and Weight Boundaries in the Data

The `category` column in `owlcms_meet_results` stores the raw `categoryCode` string from the JSON export (e.g., `"S20_M110"`, `"F24"`).

In the source JSON exports, category definitions are located under `ageGroups[].categories[]`. Each category object contains:
* `code`: String matching `categoryCode` (e.g., `"S20_M110"`).
* `categoryName`: Display label (e.g., `"S20 M 110"`).
* `minimumWeight`: Lower weight boundary in kg (e.g., `95`).
* `maximumWeight`: Upper weight boundary in kg (e.g., `110`).
* `gender`: Gender indicator (`"M"` or `"F"`).

Example from `PanAmU17+SudAmAll.json`:
```json
{
  "code": "S20_M110",
  "categoryName": "S20 M 110",
  "minimumWeight": 95,
  "maximumWeight": 110,
  "gender": "M"
}
```

To view the category definitions stored in `owlcms_meets.raw_payload`:
```sql
SELECT 
    m.meet_name,
    c->>'code' AS category_code,
    c->>'categoryName' AS category_name,
    (c->>'minimumWeight')::numeric AS min_kg,
    (c->>'maximumWeight')::numeric AS max_kg,
    c->>'gender' AS gender
FROM public.owlcms_meets m,
     jsonb_array_elements(m.raw_payload->'ageGroups') ag,
     jsonb_array_elements(ag->'categories') c
WHERE m.meet_id = 1;
```

---

## 4. Multi-Championship Leaderboards: The `participations` Array

When an athlete is cross-entered into multiple championships during a single session, their ranks for every championship are stored in `owlcms_meet_results.participations`.

### Anatomy of a Participation Object
```json
[
  {
    "categoryCode": "S20_M110",
    "snatchRank": 2,
    "cleanJerkRank": 2,
    "totalRank": 2,
    "teamMember": true,
    "championshipType": "U"
  },
  {
    "categoryCode": "PSR_M110",
    "snatchRank": 4,
    "cleanJerkRank": 6,
    "totalRank": 4,
    "teamMember": true,
    "championshipType": "U"
  }
]
```

* **`categoryCode`**: The specific category string within that championship (prefix often designates the championship: `S20` = South American Junior, `PSR` = Pan American Senior).
* **`snatchRank` / `cleanJerkRank` / `totalRank`**: 
  * Positive integer: 1st, 2nd, 3rd place.
  * `0` or `null`: Unranked / bombout / DNF (do not display as "0th place").
* **`teamMember`**: Whether this athlete's points contribute to their nation/club's team score.

---

## 5. Front-End Integration Recipes

### Recipe 1: Displaying Medals/Ranks on a Lifter's Result Card (React / JavaScript)

When rendering an individual lifter's performance card:

```javascript
function LifterResultBadges({ result }) {
  // result.participations is the JSONB array from owlcms_meet_results
  const participations = result.participations || [];

  return (
    <div className="championship-badges">
      {participations.map((part, index) => {
        const totalPlace = part.totalRank > 0 ? `${part.totalRank}` : 'DNF';
        return (
          <div key={index} className="badge-pill">
            <span className="championship-code">{part.categoryCode}</span>
            <span className="rank-value">Rank: {totalPlace}</span>
            {part.totalRank === 1 && <span className="gold-medal">🥇</span>}
            {part.totalRank === 2 && <span className="silver-medal">🥈</span>}
            {part.totalRank === 3 && <span className="bronze-medal">🥉</span>}
          </div>
        );
      })}
    </div>
  );
}
```

---

### Recipe 2: Unpacking a Championship Leaderboard in SQL

If the front-end user wants to see the leaderboard for one specific championship (e.g. "Pan American Senior" `PSR_M110`), unpack the `participations` JSONB array using `jsonb_to_recordset()`:

```sql
SELECT 
    l.athlete_name,
    l.country_code,
    r.body_weight_kg,
    r.best_snatch,
    r.best_cj,
    r.total,
    p.category_code,
    p.snatch_rank,
    p.clean_jerk_rank,
    p.total_rank
FROM public.owlcms_meet_results r
JOIN public.owlcms_lifters l ON r.lifter_id = l.lifter_id
CROSS JOIN LATERAL jsonb_to_recordset(r.participations) AS p(
    category_code TEXT,
    snatch_rank INT,
    clean_jerk_rank INT,
    total_rank INT
)
WHERE r.meet_id = 1 
  AND p.category_code = 'PSR_M110'
ORDER BY p.total_rank ASC;
```

---

### Recipe 3: Handling Attempt Visualizations (White / Red Lifts)

Format attempts in the UI using the signed number convention:

```javascript
function formatAttempt(val) {
  if (val === null || val === undefined || val === 0) {
    return { text: '—', status: 'pass' };
  }
  if (val > 0) {
    return { text: `${val}`, status: 'make' }; // Render with green/white badge
  }
  return { text: `${Math.abs(val)}`, status: 'miss' }; // Render with strikethrough/red badge
}
```

---

## 6. Edge Case Summary

1. **Double-Lifting in One Meet**:
   * If an athlete physically lifts twice in the same meet (e.g. Master and Senior in separate sessions), they receive two distinct rows in `owlcms_meet_results` distinguished by `category`.
2. **Bombouts / DNF**:
   * When an athlete misses all three attempts in Snatch or Clean & Jerk:
   * `best_snatch` or `best_cj` is `0` or `null`.
   * `total` is `0` (or `null`).
   * `totalRank` in `participations` is `0`.
3. **Accents and Names**:
   * Query matching should use exact casing or `ILIKE`. Never strip accents from `athlete_name`.
