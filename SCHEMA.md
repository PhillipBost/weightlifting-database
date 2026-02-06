# Database Schema Documentation

> [!IMPORTANT]
> This document is the **definitive source** for the database schema, based on the provided SQL definition.
> Last Updated: 2026-02-03

## USAW Tables (National)

### `usaw_meets`

Stores details for USA Weightlifting sanctioned competitions.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `meet_id` | `bigint` | **PK**, NOT NULL | Primary Key |
| `Meet` | `text` | NOT NULL | Meet Name |
| `Level` | `text` | | |
| `Date` | `date` | | |
| `Results` | `integer` | | |
| `URL` | `text` | | |
| `batch_id` | `text` | | |
| `scraped_date` | `timestamp` | | |
| `meet_internal_id` | `integer` | | |
| `address` | `text` | | |
| `street_address` | `text` | | |
| `city` | `text` | | |
| `state` | `text` | | |
| `zip_code` | `text` | | |
| `country` | `text` | | |
| `latitude` | `numeric` | | |
| `longitude` | `numeric` | | |
| `elevation_meters` | `numeric` | | |
| `elevation_source` | `text` | | |
| `elevation_fetched_at` | `timestamp with time zone` | | |
| `geocode_display_name` | `text` | | |
| `geocode_precision_score` | `integer` | | |
| `geocode_success` | `boolean` | DEFAULT false | |
| `geocode_error` | `text` | | |
| `geocode_strategy_used` | `text` | | |
| `location_text` | `text` | | |
| `date_range` | `text` | | |
| `wso_geography` | `text` | | |

### `usaw_meet_listings`

Stores upcoming meet announcements scraped from Sport80, potentially before they have results. Acts as the parent for `usaw_meet_entries`.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `listing_id` | `integer` | **PK**, SERIAL | |
| `meet_name` | `text` | NOT NULL | |
| `event_date` | `text` | | Date or range string from source |
| `date_range` | `text` | | Original format |
| `meet_type` | `text` | | |
| `address` | `text` | | |
| `organizer` | `text` | | |
| `contact_phone` | `text` | | |
| `contact_email` | `text` | | |
| `registration_open` | `date` | | |
| `registration_close` | `date` | | |
| `entries_on_platform` | `text` | | |
| `has_entry_list` | `boolean` | DEFAULT false | |
| `meet_id` | `integer` | **FK** | References `usaw_meets(meet_id)` |
| `entry_count` | `integer` | DEFAULT 0 | Count of entries entries |
| `first_discovered_at` | `timestamp` | DEFAULT NOW() | |
| `last_seen_at` | `timestamp` | DEFAULT NOW() | |
| `last_scraped_at` | `timestamp` | | |

### `usaw_meet_entries`

Stores entry lists for upcoming and past meets scraped from Sport80.
> [!NOTE]
> Entries are linked to `usaw_meet_listings` via `listing_id`.
> Unique key constraint on `(listing_id, membership_number)`.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | **PK**, NOT NULL | Generated ALWAYS AS IDENTITY |
| `listing_id` | `integer` | **FK**, NOT NULL | References `usaw_meet_listings(listing_id)` |
| `meet_id` | `bigint` | **Deprecated** | References `usaw_meets(meet_id)`. Use `listing_id`. |
| `athlete_id` | `bigint` | **FK** | References `usaw_lifters(lifter_id)` |
| `membership_number` | `text` | | USAW Membership Number |
| `first_name` | `text` | | |
| `last_name` | `text` | | |
| `state` | `text` | | |
| `birth_year` | `integer` | | |
| `weightlifting_age` | `integer` | | |
| `club` | `text` | | |
| `gender` | `text` | | |
| `division` | `text` | | |
| `weight_class` | `text` | | |
| `entry_total` | `numeric` | | |
| `created_at` | `timestamptz` | DEFAULT now() | |
| `updated_at` | `timestamptz` | DEFAULT now() | |

### `usaw_lifters`

Stores profiles for USAW athletes.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `lifter_id` | `bigint` | **PK**, NOT NULL | Default: `nextval('lifters_lifter_id_seq')` |
| `athlete_name` | `text` | NOT NULL | |
| `membership_number` | `integer` | | |
| `club_name` | `text` | | |
| `wso` | `text` | | |
| `national_rank` | `integer` | | |
| `created_at` | `timestamp` | DEFAULT now() | |
| `updated_at` | `timestamp` | DEFAULT now() | |
| `internal_id` | `integer` | | |
| `internal_id_2`..`8` | `integer` | | Additional internal IDs |

### `usaw_meet_results`

Individual athlete results linked to meets.
> [!NOTE]
> Unique key constraint on `(meet_id, lifter_id, weight_class)`.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `result_id` | `bigint` | **PK**, NOT NULL | Default: `nextval('meet_results_result_id_seq')` |
| `meet_id` | `bigint` | **FK**, NOT NULL | References `usaw_meets(meet_id)` |
| `lifter_id` | `bigint` | **FK**, NOT NULL | References `usaw_lifters(lifter_id)` |
| `meet_name` | `text` | | |
| `date` | `text` | | |
| `age_category` | `text` | | |
| `weight_class` | `text` | NOT NULL | |
| `lifter_name` | `text` | | |
| `body_weight_kg` | `text` | | |
| `snatch_lift_1`..`3` | `text` | | |
| `best_snatch` | `text` | | |
| `cj_lift_1`..`3` | `text` | | |
| `best_cj` | `text` | | |
| `total` | `text` | | |
| `competition_age` | `integer` | | |
| `qpoints` | `numeric` | | |
| `manual_override` | `boolean` | DEFAULT false | |
| `q_masters` | `numeric` | | |
| `q_youth` | `numeric` | | |
| `wso` | `varchar` | | |
| `club_name` | `varchar` | | |
| `updated_at` | `timestamp` | DEFAULT now() | |
| `created_at` | `timestamp` | DEFAULT now() | |
| `gamx_u` | `numeric` | | |
| `gamx_a` | `numeric` | | |
| `gamx_masters` | `numeric` | | |
| `gamx_total` | `numeric` | | |
| `gamx_s` | `numeric` | | |
| `gamx_j` | `numeric` | | |
| `gender` | `text` | | |
| `birth_year` | `integer` | | |
| `national_rank` | `integer` | | |
| `snatch_successful_attempts` | `integer` | | |
| `cj_successful_attempts` | `integer` | | |
| `total_successful_attempts` | `integer` | | |
| `best_snatch_ytd` | `integer` | | |
| `best_cj_ytd` | `integer` | | |
| `best_total_ytd` | `integer` | | |
| `bounce_back_snatch_2` | `boolean` | | |
| `bounce_back_snatch_3` | `boolean` | | |
| `bounce_back_cj_2` | `boolean` | | |
| `bounce_back_cj_3` | `boolean` | | |

### `usaw_clubs`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `club_name` | `text` | **PK**, NOT NULL | |
| `phone` | `text` | | |
| `created_at` | `timestamptz` | DEFAULT now() | |
| `updated_at` | `timestamptz` | DEFAULT now() | |
| `address` | `text` | | |
| `email` | `text` | | |
| `latitude` | `numeric` | | |
| `longitude` | `numeric` | | |
| `elevation_meters` | `numeric` | | |
| `geocode_display_name` | `text` | | |
| `geocode_success` | `boolean` | DEFAULT false | |
| `geocode_error` | `text` | | |
| `elevation_source` | `text` | | |
| `elevation_fetched_at` | `timestamptz` | | |
| `geocode_precision_score` | `numeric` | | |
| `geocode_strategy_used` | `text` | | |
| `wso_geography` | `text` | | |
| `recent_meets_count` | `integer` | DEFAULT 0 | |
| `active_lifters_count` | `integer` | DEFAULT 0 | |
| `analytics_updated_at` | `timestamptz` | DEFAULT now() | |
| `total_participations` | `integer` | DEFAULT 0 | |
| `activity_factor` | `numeric` | DEFAULT 0 | |
| `state` | `varchar` | | Extracted from address/coords |

### `usaw_club_rolling_metrics`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | **PK**, NOT NULL | Default: `nextval('club_rolling_metrics_id_seq')` |
| `club_name` | `varchar` | NOT NULL | |
| `snapshot_month` | `date` | NOT NULL | |
| `active_members_12mo` | `integer` | DEFAULT 0 | |
| `total_competitions_12mo` | `integer` | DEFAULT 0 | |
| `unique_lifters_12mo` | `integer` | DEFAULT 0 | |
| `calculated_at` | `timestamptz` | DEFAULT now() | |
| `activity_factor` | `numeric` | | |

### `usaw_meet_locations`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `integer` | **PK**, NOT NULL | Default: `nextval('meet_locations_id_seq')` |
| `meet_id` | `bigint` | **FK** | References `usaw_meets(meet_id)` |
| `meet_name` | `text` | | |
| `raw_address` | `text` | | |
| `street_address` | `text` | | |
| `city` | `text` | | |
| `state` | `text` | | |
| `zip_code` | `text` | | |
| `country` | `text` | | |
| `latitude` | `numeric` | | |
| `longitude` | `numeric` | | |
| `geocode_display_name` | `text` | | |
| `date_range` | `text` | | |
| `location_text` | `text` | | |
| `geocode_success` | `boolean` | | |
| `geocode_error` | `text` | | |
| `created_at` | `timestamptz` | DEFAULT now() | |
| `elevation_meters` | `numeric` | | |
| `elevation_fetched_at` | `timestamptz` | | |
| `elevation_source` | `varchar` | | |
| `geocode_precision_score` | `numeric` | | |

### `usaw_wso_information`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `wso_id` | `integer` | NOT NULL, UNIQUE | Default: `nextval('wso_information_wso_id_seq')` |
| `name` | `varchar` | **PK**, NOT NULL, UNIQUE | |
| `official_url` | `varchar` | | |
| `contact_email` | `varchar` | | |
| `geographic_type` | `varchar` | | |
| `states` | `ARRAY` | | |
| `counties` | `ARRAY` | | |
| `geographic_center_lat` | `numeric` | | |
| `geographic_center_lng` | `numeric` | | |
| `territory_geojson` | `jsonb` | | |
| `population_estimate` | `integer` | | |
| `active_status` | `boolean` | DEFAULT true | |
| `notes` | `text` | | |
| `created_at` | `timestamp` | DEFAULT now() | |
| `updated_at` | `timestamp` | DEFAULT now() | |
| `barbell_clubs_count` | `integer` | DEFAULT 0 | |
| `recent_meets_count` | `integer` | DEFAULT 0 | |
| `active_lifters_count` | `integer` | DEFAULT 0 | |
| `estimated_population` | `bigint` | DEFAULT 0 | |
| `analytics_updated_at` | `timestamptz` | DEFAULT now() | |
| `total_participations` | `integer` | DEFAULT 0 | |
| `activity_factor` | `numeric` | DEFAULT 0 | |

---

## IWF Tables (International)

### `iwf_meets`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `db_meet_id` | `bigint` | **PK**, NOT NULL, UNIQUE | Generated ALWAYS AS IDENTITY |
| `iwf_event_id` | `bigint` | UNIQUE | Official IWF Event ID |
| `meet` | `text` | | |
| `level` | `text` | | |
| `date` | `text` | | |
| `results` | `integer` | | |
| `url` | `text` | | |
| `batch_id` | `text` | | |
| `scraped_date` | `timestamptz` | | |
| `created_at` | `timestamptz` | | |
| `updated_at` | `timestamptz` | | |

### `iwf_lifters`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `db_lifter_id` | `bigint` | **PK**, NOT NULL | Default: `nextval('iwf_lifters_db_lifter_id_seq')` |
| `athlete_name` | `text` | NOT NULL | |
| `gender` | `text` | | |
| `birth_year` | `integer` | | |
| `created_at` | `timestamp` | DEFAULT now() | |
| `updated_at` | `timestamp` | DEFAULT now() | |
| `country_code` | `varchar` | | |
| `country_name` | `text` | | |
| `iwf_lifter_id` | `bigint` | UNIQUE | Official IWF Lifter ID |
| `iwf_athlete_url` | `text` | | |

### `iwf_meet_results`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `db_result_id` | `bigint` | **PK**, NOT NULL, UNIQUE | Generated ALWAYS AS IDENTITY |
| `db_lifter_id` | `bigint` | **FK**, NOT NULL | References `iwf_lifters(db_lifter_id)` |
| `db_meet_id` | `bigint` | **FK** | References `iwf_meets(db_meet_id)` |
| `meet_name` | `text` | | |
| `date` | `text` | | |
| `age_category` | `text` | | |
| `weight_class` | `text` | | |
| `lifter_name` | `text` | | |
| `body_weight_kg` | `text` | | |
| `snatch_lift_1`..`3` | `text` | | |
| `best_snatch` | `text` | | |
| `cj_lift_1`..`3` | `text` | | |
| `best_cj` | `text` | | |
| `total` | `text` | | |
| `snatch_successful_attempts` | `integer` | | |
| `cj_successful_attempts` | `integer` | | |
| `total_successful_attempts` | `integer` | | |
| `best_snatch_ytd` | `numeric` | | |
| `best_cj_ytd` | `numeric` | | |
| `best_total_ytd` | `numeric` | | |
| `bounce_back_snatch_2` | `boolean` | | |
| `bounce_back_snatch_3` | `boolean` | | |
| `bounce_back_cj_2` | `boolean` | | |
| `bounce_back_cj_3` | `boolean` | | |
| `gender` | `text` | | |
| `birth_year` | `integer` | | |
| `competition_age` | `integer` | | |
| `competition_group` | `varchar` | | |
| `rank` | `integer` | | |
| `qpoints` | `numeric` | | |
| `q_masters` | `numeric` | | |
| `q_youth` | `numeric` | | |
| `created_at` | `timestamp` | DEFAULT now() | |
| `updated_at` | `timestamp` | DEFAULT now() | |
| `gamx_u` | `numeric` | | |
| `gamx_a` | `numeric` | | |
| `gamx_masters` | `numeric` | | |
| `gamx_total` | `numeric` | | |
| `gamx_s` | `numeric` | | |
| `gamx_j` | `numeric` | | |
| `manual_override` | `boolean` | DEFAULT false | |
| `country_code` | `varchar` | | |
| `country_name` | `text` | | |

### `iwf_meet_locations`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `db_location_id` | `bigint` | **PK**, NOT NULL | Default: `nextval('iwf_meet_locations_db_location_id_seq')` |
| `iwf_meet_id` | `text` | **FK**, NOT NULL, UNIQUE | References `iwf_meets(iwf_meet_id)` |
| `address` | `text` | | |
| `location_text` | `text` | | |
| `date_range` | `text` | | |
| `latitude` | `numeric` | | |
| `longitude` | `numeric` | | |
| `country` | `text` | | |
| `city` | `text` | | |
| `venue_name` | `text` | | |
| `created_at` | `timestamp` | DEFAULT now() | |
| `updated_at` | `timestamp` | DEFAULT now() | |

### `iwf_sanctions`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | **PK**, NOT NULL | Default: `gen_random_uuid()` |
| `name` | `text` | NOT NULL | |
| `gender` | `text` | | |
| `nation` | `text` | | |
| `start_date` | `text` | | |
| `end_date` | `text` | | Text because 'RETIRED' is possible |
| `event_type` | `text` | | |
| `substance` | `text` | | |
| `sanction_year_group` | `text` | | e.g. "2022" |
| `db_lifter_id` | `bigint` | | Link to `iwf_lifters.db_lifter_id` |
| `notes` | `text` | | |
| `duration` | `text` | | |
| `created_at` | `timestamptz` | DEFAULT now() | |

---

## GAMX Tables (Calculation Factors)

### `gamx_u_factors`

Factors for Age 7-20.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | **PK**, Generated Always | |
| `gender` | `text` | NOT NULL | 'm' or 'f' |
| `age` | `integer` | NOT NULL | |
| `bodyweight` | `numeric` | NOT NULL | |
| `mu` | `numeric` | NOT NULL | |
| `sigma` | `numeric` | NOT NULL | |
| `nu` | `numeric` | NOT NULL | |

### `gamx_a_factors`

Factors for Age 13-30.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | **PK**, Generated Always | |
| `gender` | `text` | NOT NULL | 'm' or 'f' |
| `age` | `integer` | NOT NULL | |
| `bodyweight` | `numeric` | NOT NULL | |
| `mu` | `numeric` | NOT NULL | |
| `sigma` | `numeric` | NOT NULL | |
| `nu` | `numeric` | NOT NULL | |

### `gamx_masters_factors`

Factors for Age 30-95.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | **PK**, Generated Always | |
| `gender` | `text` | NOT NULL | 'm' or 'f' |
| `age` | `integer` | NOT NULL | |
| `bodyweight` | `numeric` | NOT NULL | |
| `mu` | `numeric` | NOT NULL | |
| `sigma` | `numeric` | NOT NULL | |
| `nu` | `numeric` | NOT NULL | |

### `gamx_points_factors`

Factors for Senior Total (Weight based only).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | **PK**, Generated Always | |
| `gender` | `text` | NOT NULL | 'm' or 'f' |
| `bodyweight` | `numeric` | NOT NULL | |
| `mu` | `numeric` | NOT NULL | |
| `sigma` | `numeric` | NOT NULL | |
| `nu` | `numeric` | NOT NULL | |

### `gamx_s_factors`

Factors for Snatch (Weight based only).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | **PK**, Generated Always | |
| `gender` | `text` | NOT NULL | 'm' or 'f' |
| `bodyweight` | `numeric` | NOT NULL | |
| `mu` | `numeric` | NOT NULL | |
| `sigma` | `numeric` | NOT NULL | |
| `nu` | `numeric` | NOT NULL | |

### `gamx_j_factors`

Factors for Clean & Jerk (Weight based only).

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | **PK**, Generated Always | |
| `gender` | `text` | NOT NULL | 'm' or 'f' |
| `bodyweight` | `numeric` | NOT NULL | |
| `mu` | `numeric` | NOT NULL | |
| `sigma` | `numeric` | NOT NULL | |
| `nu` | `numeric` | NOT NULL | |

---

## Use & System Tables

### `profiles`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | **PK**, NOT NULL | |
| `email` | `text` | NOT NULL | |
| `name` | `text` | | |
| `role` | `text` | NOT NULL, DEFAULT 'default' | |
| `created_at` | `timestamptz` | DEFAULT now() | |
| `updated_at` | `timestamptz` | DEFAULT now() | |

### `youth_factors`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `integer` | **PK**, NOT NULL | |
| `gender` | `text` | NOT NULL | |
| `bodyweight_kg` | `integer` | NOT NULL | |
| `age` | `integer` | NOT NULL | |
| `factor` | `numeric` | NOT NULL | |

### `q_masters_backfill_audit`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `audit_id` | `bigint` | **PK**, NOT NULL | |
| `result_id` | `bigint` | NOT NULL | |
| `lifter_name` | `text` | | |
| `gender` | `text` | | |
| `competition_age` | `integer` | | |
| `old_q_masters` | `numeric` | | |
| `new_q_masters` | `numeric` | | |
| `changed_at` | `timestamptz` | DEFAULT now() | |
| `batch_tag` | `text` | | |
| `source_table` | `text` | | |
| `source_pk` | `bigint` | | |
| `notes` | `text` | | |

### `test_github_actions`

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `integer` | **PK**, NOT NULL | |
| `test_run_timestamp` | `timestamptz` | DEFAULT now() | |
| `test_source` | `text` | NOT NULL | |
| `test_data` | `jsonb` | | |
| `created_at` | `timestamptz` | DEFAULT now() | |
