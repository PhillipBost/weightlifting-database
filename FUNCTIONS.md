# Database Function Documentation

> [!IMPORTANT]
> This document is the **definitive reference** for all custom database functions and triggers.
> Last Updated: 2026-02-09

## 📊 Analytics & Calculations

Functions related to athlete performance metrics, Q-points, and age factors.

### `calculate_qpoints_from_row`

Calculates Robi Q-points for a single performance based on total lifted, bodyweight, and gender.

- **Signature:** `(total_lifted numeric, bodyweight numeric, gender text) → numeric`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `public` (Fixed)

### `recalculate_all_qpoints`

Batch recalculates Q-points for all meet results in the database.

- **Signature:** `() → integer`
- **Returns:** Number of records processed (expected, though return type is integer)
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `public` (Fixed)
- **Dependencies:** `meet_results` table, `calculate_qpoints_from_row`

### `get_age_factor`

Retrieves the SMF (Sinclair-Meltzer-Faber) age adjustment factor for Masters lifters.

- **Signature:** `(age integer, gender text) → numeric`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `public` (Fixed)

### `get_youth_factor_exact`

Retrieves the exact youth age adjustment coefficient for a specific age, bodyweight, and gender from the lookup table.

- **Signature:** `(input_age integer, input_bodyweight integer, input_gender text) → numeric`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `public` (Fixed)
- **Dependencies:** `youth_factors` table

### `get_youth_age_factor_interpolated`

Calculates a youth age factor by interpolating between bodyweight brackets if an exact match isn't found.

- **Signature:** `(age integer, bodyweight numeric, gender text) → numeric`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `public` (Fixed)
- **Dependencies:** `youth_factors` table

### `calculate_ytd_best`

Calculates the best performance (Snatch, C&J, or Total) for a lifter within the current calendar year up to a specific date.

- **Signature:** `(p_lifter_id bigint, p_date text, p_current_best text, p_lift_type text) → integer`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `MUTABLE` (Cannot be fixed due to table access)
- **Dependencies:** `meet_results` table

### `calculate_meet_result_analytics`

Computes a comprehensive set of analytics for a single meet result, including successful attempt counts, YTD bests, and "bounce back" stats.

- **Signature:** `(p_lifter_id bigint, p_date text, p_snatch_1..3 text, p_best_snatch text, p_cj_1..3 text, p_best_cj text, p_total text) → TABLE(...)`
- **Returns:** Record with columns: `snatch_successful_attempts`, `cj_successful_attempts`, `total_successful_attempts`, `best_snatch_ytd`, `best_cj_ytd`, `best_total_ytd`, `bounce_back_snatch_2`, `bounce_back_snatch_3`, `bounce_back_cj_2`, `bounce_back_cj_3`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `MUTABLE` (Calls `calculate_ytd_best`)
- **Dependencies:** `calculate_ytd_best`, `count_successful_attempts`, `calculate_bounce_back`

### `recalculate_lifter_analytics`

Batch recalculates and updates analytics columns for all of a lifter's results (optionally filtered by year).

- **Signature:** `(p_lifter_id bigint, p_year integer DEFAULT NULL) → integer`
- **Returns:** Number of records updated
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `MUTABLE` (Cannot be fixed due to table access)
- **Dependencies:** `meet_results` table, `calculate_meet_result_analytics`

---

## 🔍 Search & Retrieval

Functions for finding athletes and records.

### `search_lifters`

Legacy search function for finding lifters.

- **Signature:** `(query text) → TABLE`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `''` (Fixed)

### `search_athletes`

Primary search function with fuzzy matching, returning lifters and their most recent meet result.

- **Signature:** `(search_term text) → TABLE(...)`
- **Returns:** `lifter_id`, `athlete_name`, `membership_number`, `gender`, `club_name`, `wso`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `MUTABLE` (Cannot be fixed due to table access)
- **Dependencies:** `lifters`, `meet_results`, `pg_trgm` extension

---

## 🛠️ Utility Functions

Helper functions for data conversion and simple logic.

### `text_to_numeric_safe`

Safely converts a text string to numeric, handling empty strings and non-numeric characters by returning NULL.

- **Signature:** `(p_input text) → numeric`
- **Volatility:** `IMMUTABLE`
- **Security:** `INVOKER`
- **Search Path:** `''` (Fixed)

### `count_successful_attempts`

Counts the number of successful lifts (where the result is a positive number) from three attempts.

- **Signature:** `(lift1 text, lift2 text, lift3 text) → integer`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `''` (Fixed)

### `calculate_bounce_back`

Determines if a lifter "bounced back" by successfully making a lift after missing the previous attempt.

- **Signature:** `(prev_lift text, current_lift text) → boolean`
- **Volatility:** `VOLATILE`
- **Security:** `INVOKER`
- **Search Path:** `''` (Fixed)

---

## 🛡️ User & Admin

Functions for user management and role checks.

### `is_admin`

Checks if a given user UUID has the 'admin' role in the profiles table.

- **Signature:** `(user_id uuid) → boolean`
- **Volatility:** `VOLATILE`
- **Security:** `DEFINER` (Runs with privileges of the creator)
- **Search Path:** `MUTABLE` (Cannot be fixed due to table access)
- **Dependencies:** `profiles` table

---

## ⚡ Triggers

Functions that execute automatically on table events (INSERT/UPDATE).

### `handle_new_user`

Creates a public profile record when a new user signs up via Supabase Auth.

- **Trigger Event:** `INSERT` on `auth.users`
- **Security:** `DEFINER`
- **Search Path:** `MUTABLE` (Writes to `public.profiles`)

### `update_updated_at_column`

Generic trigger to update the `updated_at` column to current timestamp.

- **Trigger Event:** `UPDATE`
- **Search Path:** `public` (Fixed)

### `update_clubs_analytics_timestamp`

Updates `analytics_updated_at` when club statistics change.

- **Trigger Event:** `UPDATE` on `clubs`
- **Search Path:** `public` (Fixed)

### `update_wso_analytics_updated_at`

Updates `analytics_updated_at` when WSO statistics change.

- **Trigger Event:** `UPDATE` on `wso_information`
- **Search Path:** `public` (Fixed)

### `handle_manual_override`

Prevents automatic re-calculation of fields if `manual_override` flag is true.

- **Trigger Event:** `BEFORE UPDATE` on `meet_results`
- **Search Path:** `public` (Fixed)

### `calculate_competition_age`

Calculates `competition_age` based on `birth_year` and meet `date`.

- **Trigger Event:** `BEFORE INSERT/UPDATE` on `meet_results`
- **Search Path:** `public` (Fixed)

### `calculate_and_set_analytics`

Orchestrates the calculation of all derived analytics fields on insert or update.

- **Trigger Event:** `BEFORE INSERT/UPDATE` on `meet_results`
- **Search Path:** `MUTABLE` (Cannot be fixed due to dependency on table-accessing functions)

### `update_qpoints_on_change`

Recalculates Q-points when relevant fields (total, bodyweight, gender) change.

- **Trigger Event:** `BEFORE INSERT/UPDATE` on `meet_results`
- **Search Path:** `public` (Fixed)
