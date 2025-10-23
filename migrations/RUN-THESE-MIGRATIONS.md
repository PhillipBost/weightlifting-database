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

## Questions?

- Check the SQL comments in each migration file for detailed explanations
- Verify all foreign keys are correct after each migration
- Backup your data before running migrations in production!
