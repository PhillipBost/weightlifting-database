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

**Functions:**
- `backfillYTDForLiftersInYear(year, lifterIds)` - Targeted backfill for specific lifters in a specific year (used by orchestrator)
- `triggerYTDRecalculation(resultId)` - Trigger recalculation for a single result
- `backfillYTDForBatch(resultIds, batchNumber, totalBatches)` - Process batch of result IDs

### 4. Orchestrator Integration
**File:** `scripts/production/iwf-main.js`

**Automatic YTD Backfill:**
The orchestrator now automatically performs targeted YTD backfill after importing events. This ensures correct YTD values even when events are imported out of chronological order.

**How it works:**
1. During import, affected lifter IDs are tracked
2. After all events complete, lifters are grouped by year
3. Backfill runs only for affected lifters in each year
4. Results are logged and included in summary

**Efficiency:**
- **Before:** Backfill all 6000 lifters competing in 2025
- **After:** Backfill only the 10 lifters in the imported event

**Usage:**
```bash
# Normal import - YTD backfill runs automatically
node scripts/production/iwf-main.js --event-id 661 --year 2025

# Skip YTD backfill (for testing or debugging)
node scripts/production/iwf-main.js --event-id 661 --year 2025 --skip-ytd-backfill
```

**Files Modified:**
- `iwf-results-importer.js` - Tracks affected lifter IDs during import
- `iwf-database-importer.js` - Extracts affected lifters and years
- `iwf-main.js` - Coordinates backfill after all events complete

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

### Step 2: Backfill Existing Data (If Needed)
**Note:** The orchestrator now automatically backfills YTD for newly imported events. Manual backfill is only needed for historical data imported before this feature was added.

If you have existing records without YTD values, recalculate them:
```bash
# Backfill all records (time-intensive)
node scripts/maintenance/backfill-iwf-ytd.js --all

# Backfill specific year
node scripts/maintenance/backfill-iwf-ytd.js --year 2025 --all
```

### Step 3: Test New Imports
Import a test event to verify YTD calculation and automatic backfill:
```bash
node scripts/production/iwf-main.js --event-id 661 --year 2025 --limit 5
```

The orchestrator will:
1. Import the event results
2. Automatically backfill YTD for affected lifters
3. Display backfill summary in logs

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

**Current (Database-Driven + Automatic Backfill):**
1. Importer reads athlete data
2. YTD fields set to NULL on insert
3. Database trigger fires on INSERT
4. Trigger queries previous results for same lifter
5. Trigger updates YTD fields automatically
6. **After all events import, orchestrator backfills affected lifters**
7. Ensures correct YTD even when events import out of order

### Orchestrator Workflow

```
FOR each event:
  ├─ Import results (trigger calculates initial YTD)
  └─ Track affected lifter IDs and year

AFTER all events complete:
  ├─ Group affected lifters by year
  ├─ FOR each year:
  │   └─ Backfill YTD for specific lifters only
  └─ Display backfill summary
```

**Why Backfill is Needed:**
Even with the database trigger, YTD can be incorrect if events are imported out of chronological order:

```
Example Problem:
- Import Event B (Feb 20, 2025) → YTD = NULL (no earlier events in DB yet)
- Import Event A (Jan 15, 2025) → YTD = NULL (first event)
- Result: Event B has wrong YTD (should reference Event A)

Solution:
- After both imports, backfill recalculates Event B's YTD
- Trigger fires again, now finds Event A as previous result
- YTD now correct
```

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
2. **Automatic**: YTD updates whenever data changes, orchestrator backfills after imports
3. **Reliable**: Database-level calculation handles edge cases
4. **Performance**: Reduces Node.js processing overhead
5. **Efficient**: Targeted backfill only processes affected lifters (not entire database)
6. **Correct**: Handles out-of-order imports automatically
7. **Retroactive**: Historical records can be recalculated

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
