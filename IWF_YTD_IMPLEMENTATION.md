# IWF YTD Calculation Implementation

## Overview

This document describes the implementation of automatic Year-to-Date (YTD) best calculations for the IWF database, matching the pattern used in the USAW database.

## Files Created/Modified

### 1. Database Migration
**File:** `migrations/add-iwf-ytd-calculation-trigger.sql`

Creates a PostgreSQL trigger function that automatically calculates YTD bests:
- Function: `calculate_iwf_ytd_bests()`
- Trigger: `iwf_meet_results_ytd_calculation_trigger`
- Calculates: `best_snatch_ytd`, `best_cj_ytd`, `best_total_ytd`

**What it does:**
- Queries all previous results for the same lifter in the same calendar year
- Finds maximum snatch, C&J, and total from results BEFORE the current meet date
- Sets YTD fields to NULL if no previous results exist
- Handles "---" (no lift) and non-numeric values gracefully

### 2. Application Code Changes
**File:** `scripts/production/iwf-results-importer.js`

**Changes:**
- Removed YTD calculation from `importAthleteResult()` function (lines 265-279)
- Simplified import workflow - database trigger now handles YTD calculation
- Updated comments to indicate YTD is database-driven
- Kept `calculateYTDBests()` function for reference (marked @deprecated)

**Behavior:**
- YTD fields are set to NULL on insert
- Database trigger automatically populates them on INSERT and UPDATE
- No application-level delays or database queries needed

### 3. Backfill Script
**File:** `scripts/maintenance/backfill-iwf-ytd.js`

Recalculates YTD values for existing records by triggering the database function.

**Usage:**
```bash
# Backfill all records
node scripts/maintenance/backfill-iwf-ytd.js

# Backfill specific year
node scripts/maintenance/backfill-iwf-ytd.js --year 2025

# Backfill limited records (for testing)
node scripts/maintenance/backfill-iwf-ytd.js --limit 100
```

## Implementation Steps

### Step 1: Apply Database Migration
Run the migration in Supabase SQL Editor:
```bash
# Copy contents of migrations/add-iwf-ytd-calculation-trigger.sql
# Paste into Supabase SQL Editor and execute
```

**Verify migration:**
```sql
-- Check trigger exists
SELECT trigger_name FROM information_schema.triggers 
WHERE event_object_table = 'iwf_meet_results';

-- Check function exists
SELECT proname FROM pg_proc 
WHERE proname = 'calculate_iwf_ytd_bests';
```

### Step 2: Backfill Existing Data (Optional)
If you have existing records, recalculate their YTD values:
```bash
node scripts/maintenance/backfill-iwf-ytd.js
```

### Step 3: Test New Imports
Import a test event to verify YTD calculation works:
```bash
node scripts/production/iwf-main.js --event-id 661 --year 2025 --limit 5
```

Verify in database:
```sql
SELECT result_id, lifter_name, date, best_snatch_ytd, best_cj_ytd, best_total_ytd
FROM iwf_meet_results
WHERE date >= '2025-01-01'
LIMIT 10;
```

## How It Works

### YTD Calculation Flow

**Before (Application-Driven):**
1. Importer reads athlete data
2. JavaScript calculates YTD by querying database
3. Inserts record with YTD values
4. No automatic updates if data changes

**After (Database-Driven):**
1. Importer reads athlete data
2. YTD fields set to NULL
3. Database trigger fires on INSERT
4. Trigger queries previous results for same lifter
5. Trigger updates YTD fields automatically
6. Trigger fires again on UPDATE if data changes

### Example: Multiple Meets Same Year

```
Meet A (Jan 15, 2025):
  - Snatch: 100, C&J: 120, Total: 220
  - YTD: NULL (no previous results)

Meet B (Feb 20, 2025):
  - Snatch: 105, C&J: 115, Total: 220
  - YTD calculated: snatch_ytd=100, cj_ytd=120, total_ytd=220
    (values from Meet A, which occurred before Feb 20)

Meet C (Mar 10, 2025):
  - Snatch: 98, C&J: 125, Total: 223
  - YTD calculated: snatch_ytd=105, cj_ytd=125, total_ytd=223
    (best values from Meet A and B before Mar 10)
```

## Benefits

1. **Consistency**: Matches USAW database pattern
2. **Automatic**: YTD updates whenever data changes
3. **Reliable**: Database-level calculation handles edge cases
4. **Performance**: Reduces Node.js processing overhead
5. **Retroactive**: Historical records can be recalculated

## Troubleshooting

### Trigger Not Calculating YTD
Check that:
1. Migration was successfully applied
2. Trigger exists: `SELECT * FROM information_schema.triggers WHERE event_object_table = 'iwf_meet_results';`
3. Function exists: `SELECT * FROM pg_proc WHERE proname = 'calculate_iwf_ytd_bests';`
4. No syntax errors in migration

### Wrong YTD Values
Check that:
1. Records are sorted by date (earlier dates first)
2. Lifter IDs are correct (`db_lifter_id` not `iwf_lifter_id`)
3. Field names are text, not numeric (handles "---" values)

### Performance Issues
If backfill is slow:
1. Reduce BATCH_SIZE in backfill-iwf-ytd.js
2. Increase DELAY_MS between batches
3. Run during off-hours
4. Consider filtering by year: `--year 2025`

## Future Improvements

1. Add more YTD-based analytics:
   - Month-to-date (MTD)
   - Lifetime personal records (PR)
   - Seasonal comparisons

2. Performance optimization:
   - Index on `(db_lifter_id, date)` for faster queries
   - Materialized views for frequently-accessed YTD stats

3. Historical corrections:
   - Automatically recalculate when data is corrected
   - Audit trail of YTD calculation changes

## References

- USAW Database: Similar implementation pattern
- IWF Analytics Triggers: `migrations/add-iwf-analytics-triggers.sql`
- IWF Importer: `scripts/production/iwf-results-importer.js`
