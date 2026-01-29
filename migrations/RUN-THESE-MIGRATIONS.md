# IWF Schema Migrations - Execution Order

**Last Updated:** 2025-01-20

## ⚠️ Important: Run Migrations in This Order

To complete Task 14 (Lifter Manager), you need to run these migrations in Supabase SQL Editor:

---

## Migration 1: Rename Primary Key Columns

**File:** `rename-iwf-lifter-id-to-db-lifter-id.sql`

**What it does:**

- Renames `iwf_lifter_id` → `db_lifter_id` (auto-increment PK)
- Adds new `iwf_lifter_id` column for official IWF athlete IDs (nullable)
- Updates all foreign key references in `iwf_meet_results`

**Run this first!**

```sql
-- Copy and paste entire contents of:
-- migrations/rename-iwf-lifter-id-to-db-lifter-id.sql
```

**Verify:**

```sql
-- Should return db_lifter_id as primary key, iwf_lifter_id as nullable
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'iwf_lifters'
AND column_name IN ('db_lifter_id', 'iwf_lifter_id')
ORDER BY column_name;
```

Expected result:

```
column_name    | data_type | is_nullable
---------------|-----------|------------
db_lifter_id   | bigint    | NO
iwf_lifter_id  | bigint    | YES
```

---

## Migration 2: Add Country Code and Name Columns

**File:** `add-country-code-name-to-iwf-lifters.sql`

**What it does:**

- Adds `country_code` (VARCHAR(3)) for 3-letter codes
- Adds `country_name` (TEXT) for full names
- Creates indexes for both columns
- Applies to both `iwf_lifters` and `iwf_meet_results` tables

**Run this second!**

```sql
-- Copy and paste entire contents of:
-- migrations/add-country-code-name-to-iwf-lifters.sql
```

**Verify:**

```sql
-- Should return country_code and country_name
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'iwf_lifters'
AND column_name IN ('country_code', 'country_name', 'country')
ORDER BY column_name;
```

Expected result:

```
column_name   | data_type
--------------|----------
country       | varchar
country_code  | varchar
country_name  | text
```

---

## Migration 3: Rename Meet Primary Key Columns

**File:** `rename-iwf-meet-id-to-db-meet-id.sql`

**What it does:**

- Renames `iwf_meet_id` → `db_meet_id` (auto-increment PK)
- Keeps `event_id` as TEXT for IWF's official event ID
- Updates all foreign key references in `iwf_meet_locations` and `iwf_meet_results`
- Updates unique constraint to use new column names

**Run this third!**

```sql
-- Copy and paste entire contents of:
-- migrations/rename-iwf-meet-id-to-db-meet-id.sql
```

**Verify:**

```sql
-- Should return db_meet_id as primary key
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'iwf_meets'
AND column_name IN ('db_meet_id', 'event_id')
ORDER BY column_name;
```

Expected result:

```
column_name  | data_type | is_nullable
-------------|-----------|------------
db_meet_id   | bigint    | NO
event_id     | text      | YES
```

**Verify Foreign Keys:**

```sql
-- Should show db_meet_id and db_lifter_id
SELECT db_meet_id, db_lifter_id, lifter_name, date
FROM iwf_meet_results
LIMIT 5;
```

---

## Testing After Migrations

Once both migrations are complete, test the lifter manager:

```bash
node scripts/production/iwf-lifter-manager.js --test
```

Expected output:

```
🧪 Running IWF Lifter Manager Tests...

Test 1: Find existing lifter (should not create duplicate)
  ✅ PASS: Found existing lifter, no duplicate created

Test 2: Create new lifter
  ✅ PASS: Created new lifter - ID: XXX

Test 3: Same name, different countries (should create separate lifters)
  ✅ PASS: Different lifters created for different countries

═══════════════════════════════════════
Tests Passed: 3/3
Tests Failed: 0/3
═══════════════════════════════════════
```

---

## Rollback (if needed)

If you need to roll back Migration 1:

```sql
BEGIN;

-- Rename back
ALTER TABLE iwf_lifters DROP CONSTRAINT IF EXISTS iwf_lifters_pkey;
ALTER TABLE iwf_lifters RENAME COLUMN db_lifter_id TO iwf_lifter_id;
ALTER TABLE iwf_lifters DROP COLUMN IF EXISTS iwf_lifter_id;
ALTER TABLE iwf_lifters ADD PRIMARY KEY (iwf_lifter_id);

-- Update FK
ALTER TABLE iwf_meet_results DROP CONSTRAINT IF EXISTS iwf_meet_results_db_lifter_id_fkey;
ALTER TABLE iwf_meet_results RENAME COLUMN db_lifter_id TO iwf_lifter_id;
ALTER TABLE iwf_meet_results
ADD CONSTRAINT iwf_meet_results_iwf_lifter_id_fkey
FOREIGN KEY (iwf_lifter_id) REFERENCES iwf_lifters(iwf_lifter_id) ON DELETE CASCADE;

COMMIT;
```

---

## Migration 4: Create GAMX Tables

**File:** `create_gamx_tables.sql`

**What it does:**

- Creates 6 new tables for GAMX parameters:
  - `gamx_u_factors` (7-20 year olds)
  - `gamx_a_factors` (13-30 year olds)
  - `gamx_masters_factors` (30-95 year olds)
  - `gamx_points_factors` (Total)
  - `gamx_s_factors` (Snatch)
  - `gamx_j_factors` (Clean & Jerk)
- Each table stores `mu`, `sigma`, `nu`, and `bodyweight` (plus `age` where applicable).

**Run this fourth!**

```sql
-- Copy and paste entire contents of:
-- migrations/create_gamx_tables.sql
```

**Verify:**

```sql
-- Should verify tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_name LIKE 'gamx_%'
ORDER BY table_name;
```

Expected result:

```
gamx_a_factors
gamx_j_factors
gamx_masters_factors
gamx_points_factors
gamx_s_factors
gamx_u_factors
```

---

## Migration 5: Add GAMX Columns

**File:** `add_gamx_columns.sql`

**What it does:**

- Adds 6 new numeric columns to `usaw_meet_results` and `iwf_meet_results`:
  - `gamx_u`
  - `gamx_a`
  - `gamx_masters`
  - `gamx_total`
  - `gamx_s`
  - `gamx_j`

**Run this fifth!**

```sql
-- Copy and paste entire contents of:
-- migrations/add_gamx_columns.sql
```

**Verify:**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('usaw_meet_results', 'iwf_meet_results')
AND column_name LIKE 'gamx_%'
ORDER BY table_name, column_name;
```

---

## Migration 8: Seed GAMX Factors (CRITICAL)

**File:** `seed_gamx_factors.sql`

**What it does:**

- Populates the `gamx_*_factors` tables with thousands of Mu/Sigma/Nu values extracted from the Excel file.
- **Why?** Without this data, all calculations were returning NULL (causing the backfill to fail).

**Run this eighth!**

```sql
-- Copy and paste:
-- migrations/seed_gamx_factors.sql
```

---

## Migration 10: Determinstic Backfill (Range Based)

**File:** `create_iterative_backfill.sql`

**Run this tenth!**

```sql
-- Copy and paste:
-- migrations/create_iterative_backfill.sql
```

**Backfill Workflow (Performance Mode):**

1. **Disable Triggers (Prevents Timeouts):**

    ```sql
    -- migrations/temp_disable_triggers.sql
    ```

2. **Run the Backfill Script:**

    ```bash
    node scripts/maintenance/run_gamx_backfill_range.js
    ```

3. **Re-Enable Triggers (Restore Normal Function):**

    ```sql
    -- migrations/temp_enable_triggers.sql
    ```

---

## Migration 9: Create Backfill Helper (RPC)

**File:** `create_backfill_rpc.sql`

**What it does:**

- Creates a database function `backfill_gamx_batch` that processes data in small chunks.
- Solves the "timeout" issue by allowing an external script to drive the process iteratively.
- **Includes fix for infinite loop.**

**Run this ninth!**

```sql
-- Copy and paste:
-- migrations/create_backfill_rpc.sql
```

**Then Run the Backfill Script:**

```bash
# Reads .env, connects to DB, calls the function repeatedly
node scripts/maintenance/run_gamx_backfill.js
```

---

## Migration 6: Add GAMX Calculation Functions

**File:** `gamx_calc_functions.sql`

**What it does:**

- Creates PL/PGSQL functions to calculate GAMX scores:
  - `gamx_norm_cdf`: Standard Normal CDF
  - `gamx_norm_inv`: Inverse Normal CDF (Approx)
  - `calculate_gamx_raw`: Core Box-Cox formula
  - `get_gamx_score`: Context-aware lookup and calculation

**Run this sixth!**

```sql
-- Copy and paste entire contents of:
-- migrations/gamx_calc_functions.sql
```

**Verify:**

```sql
-- Test query
SELECT get_gamx_score('total', 'm', 30, 89, 311) as test_score;
-- (Result depends on data population for 'm', 89kg)
```

---
